import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ActivateBody {
  basic_account_no: string | number;
  division: string;
  category_id: number;
  normal_balance: "debit" | "credit";
  description: string;
}

// POST /api/excluded-accounts/activate
// 1. Create/upsert gl_accounts row for (account_no, division)
// 2. Move all non-activated excluded_transactions rows for that key into
//    weekly_transactions (linked to new gl_account_id)
// 3. Mark excluded rows as activated
// 4. Re-chain weekly_balances for affected weeks + carry forward to all
//    existing later weeks so the account appears in every week thereafter.
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = (await req.json()) as Partial<ActivateBody>;

    // ── Validate ────────────────────────────────────────────────────────────
    const acctRaw = body.basic_account_no;
    const acctNo =
      typeof acctRaw === "number"
        ? acctRaw
        : typeof acctRaw === "string"
          ? parseInt(acctRaw, 10)
          : NaN;
    if (!isFinite(acctNo) || acctNo <= 0) {
      return NextResponse.json({ error: "basic_account_no must be a positive integer" }, { status: 400 });
    }

    const division = typeof body.division === "string" ? body.division : "";

    if (!body.category_id || typeof body.category_id !== "number") {
      return NextResponse.json({ error: "category_id (number) is required" }, { status: 400 });
    }
    if (body.normal_balance !== "debit" && body.normal_balance !== "credit") {
      return NextResponse.json({ error: "normal_balance must be 'debit' or 'credit'" }, { status: 400 });
    }
    if (!body.description || typeof body.description !== "string" || body.description.trim() === "") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const categoryId = body.category_id;
    const normalBalance = body.normal_balance;
    const description = body.description.trim();

    const catCheck = await sql`SELECT id FROM categories WHERE id = ${categoryId} LIMIT 1`;
    if (catCheck.length === 0) {
      return NextResponse.json({ error: `Unknown category_id ${categoryId}` }, { status: 400 });
    }

    // ── 1. Create or update gl_accounts (handles race) ──────────────────────
    const existing = await sql`
      SELECT id FROM gl_accounts
      WHERE account_no = ${acctNo} AND division = ${division}
      LIMIT 1
    `;

    let glAccountId: number;
    if (existing.length > 0) {
      glAccountId = Number(existing[0].id);
      await sql`
        UPDATE gl_accounts
        SET category_id = ${categoryId},
            normal_balance = ${normalBalance},
            description = ${description},
            is_active = true
        WHERE id = ${glAccountId}
      `;
    } else {
      const created = await sql`
        INSERT INTO gl_accounts
          (account_no, division, description, normal_balance, category_id, is_active)
        VALUES
          (${acctNo}, ${division}, ${description}, ${normalBalance}, ${categoryId}, true)
        RETURNING id
      `;
      glAccountId = Number(created[0].id);
    }

    // ── 2. Pull excluded rows to move ───────────────────────────────────────
    const excluded = await sql`
      SELECT id, week_ending::text AS week_ending, date_booked::text AS date_booked,
             basic_account_no, division, description, debit, credit,
             audit_number, job_no, vendor_no, dedupe_hash
      FROM excluded_transactions
      WHERE basic_account_no = ${String(acctNo)}
        AND division = ${division}
        AND activated_at IS NULL
    `;

    if (excluded.length === 0) {
      return NextResponse.json({
        gl_account_id: glAccountId,
        transactions_moved: 0,
        weeks_backfilled: 0,
        first_week: null,
        last_week: null,
      });
    }

    const affectedWeeksSet = new Set<string>();
    for (const r of excluded) affectedWeeksSet.add(String(r.week_ending));
    const affectedWeeks = Array.from(affectedWeeksSet).sort();

    // ── 3. Pre-filter hashes that already exist in weekly_transactions ──────
    // (There is no UNIQUE index on weekly_transactions.dedupe_hash, so we can't
    //  rely on ON CONFLICT; filter in memory instead.)
    const incomingHashes = excluded.map((r) => String(r.dedupe_hash));
    const existingTxHashes = new Set<string>();
    if (incomingHashes.length > 0) {
      const existingTx = await sql`
        SELECT dedupe_hash FROM weekly_transactions
        WHERE dedupe_hash = ANY(${incomingHashes}::text[])
      `;
      for (const r of existingTx) existingTxHashes.add(String(r.dedupe_hash));
    }

    const txWeek: string[] = [];
    const txGl: number[] = [];
    const txAcct: number[] = [];
    const txDiv: string[] = [];
    const txDate: string[] = [];
    const txAudit: string[] = [];
    const txJob: string[] = [];
    const txDesc: string[] = [];
    const txDr: number[] = [];
    const txCr: number[] = [];
    const txVendor: string[] = [];
    const txHash: string[] = [];

    for (const r of excluded) {
      const hash = String(r.dedupe_hash);
      if (existingTxHashes.has(hash)) continue;
      txWeek.push(String(r.week_ending));
      txGl.push(glAccountId);
      txAcct.push(Number(r.basic_account_no));
      txDiv.push(String(r.division ?? ""));
      txDate.push(String(r.date_booked));
      txAudit.push(String(r.audit_number ?? ""));
      txJob.push(String(r.job_no ?? ""));
      txDesc.push(String(r.description ?? ""));
      txDr.push(parseFloat(String(r.debit)));
      txCr.push(parseFloat(String(r.credit)));
      txVendor.push(String(r.vendor_no ?? ""));
      txHash.push(hash);
    }

    // ── 4. Bulk insert into weekly_transactions ─────────────────────────────
    if (txHash.length > 0) {
      await sql`
        INSERT INTO weekly_transactions (
          week_ending, gl_account_id, basic_account_no, division,
          date_booked, audit_number, job_no, description,
          debit, credit, vendor_no, dedupe_hash
        )
        SELECT * FROM UNNEST(
          ${txWeek}::date[],
          ${txGl}::int[],
          ${txAcct}::int[],
          ${txDiv}::text[],
          ${txDate}::date[],
          ${txAudit}::text[],
          ${txJob}::text[],
          ${txDesc}::text[],
          ${txDr}::numeric[],
          ${txCr}::numeric[],
          ${txVendor}::text[],
          ${txHash}::text[]
        )
      `;
    }

    // ── 5. Mark excluded rows as activated ──────────────────────────────────
    await sql`
      UPDATE excluded_transactions
      SET activated_at = NOW(),
          activated_to_gl_account_id = ${glAccountId}
      WHERE basic_account_no = ${String(acctNo)}
        AND division = ${division}
        AND activated_at IS NULL
    `;

    // ── 6. Re-chain weekly_balances for affected weeks (chronological) ──────
    // For each affected week in order: look up prior week's end_balance (JIT so
    // we see the row we just wrote), sum period_dr/cr from weekly_transactions,
    // upsert a row for this account.
    for (const weekISO of affectedWeeks) {
      // Prior weekly_balances row for this account
      const priorRows = await sql`
        SELECT end_balance FROM weekly_balances
        WHERE gl_account_id = ${glAccountId}
          AND week_ending < ${weekISO}::date
        ORDER BY week_ending DESC
        LIMIT 1
      `;
      const begBalance = priorRows.length > 0 ? parseFloat(String(priorRows[0].end_balance)) : 0;

      // Period totals from the source of truth
      const periodRows = await sql`
        SELECT
          COALESCE(SUM(debit), 0)  AS dr,
          COALESCE(SUM(credit), 0) AS cr
        FROM weekly_transactions
        WHERE gl_account_id = ${glAccountId}
          AND week_ending = ${weekISO}::date
      `;
      const periodDr = parseFloat(String(periodRows[0].dr));
      const periodCr = parseFloat(String(periodRows[0].cr));

      const endBalance =
        normalBalance === "debit"
          ? begBalance + periodDr - periodCr
          : begBalance - periodDr + periodCr;

      await sql`
        INSERT INTO weekly_balances
          (week_ending, gl_account_id, beg_balance, end_balance, period_debit, period_credit)
        VALUES
          (${weekISO}::date, ${glAccountId}, ${begBalance}, ${endBalance}, ${periodDr}, ${periodCr})
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE SET
          beg_balance   = EXCLUDED.beg_balance,
          period_debit  = EXCLUDED.period_debit,
          period_credit = EXCLUDED.period_credit,
          end_balance   = EXCLUDED.end_balance
      `;
    }

    // ── 7. Cascade forward: ensure the account has a row in every later week ─
    // Any week_ending already present in weekly_balances (any account) that is
    // AFTER the last affected week needs a zero-activity carry-forward row for
    // this gl_account so dashboards don't drop the account.
    const lastAffected = affectedWeeks[affectedWeeks.length - 1];
    const laterWeekRows = await sql`
      SELECT DISTINCT week_ending::text AS week_ending
      FROM weekly_balances
      WHERE week_ending > ${lastAffected}::date
      ORDER BY week_ending ASC
    `;

    for (const r of laterWeekRows) {
      const weekISO = String(r.week_ending);
      const priorRows = await sql`
        SELECT end_balance FROM weekly_balances
        WHERE gl_account_id = ${glAccountId}
          AND week_ending < ${weekISO}::date
        ORDER BY week_ending DESC
        LIMIT 1
      `;
      const begBalance = priorRows.length > 0 ? parseFloat(String(priorRows[0].end_balance)) : 0;
      // No activity in carry-forward weeks → beg = end.
      await sql`
        INSERT INTO weekly_balances
          (week_ending, gl_account_id, beg_balance, end_balance, period_debit, period_credit)
        VALUES
          (${weekISO}::date, ${glAccountId}, ${begBalance}, ${begBalance}, 0, 0)
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE SET
          beg_balance   = EXCLUDED.beg_balance,
          end_balance   = EXCLUDED.end_balance,
          period_debit  = 0,
          period_credit = 0
      `;
    }

    const weeksBackfilled = affectedWeeks.length + laterWeekRows.length;

    return NextResponse.json({
      gl_account_id: glAccountId,
      transactions_moved: txHash.length,
      weeks_backfilled: weeksBackfilled,
      first_week: affectedWeeks[0],
      last_week:
        laterWeekRows.length > 0
          ? String(laterWeekRows[laterWeekRows.length - 1].week_ending)
          : lastAffected,
    });
  } catch (err) {
    const e = err as {
      message?: string;
      code?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
    };
    console.error("POST /api/excluded-accounts/activate error:", {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
      constraint: e?.constraint,
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
