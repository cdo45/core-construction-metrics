import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// Hand-maintained list of tables we KNOW about and handle explicitly.
// Any FK discovered by the information_schema lookup that's NOT in this list
// is treated as a blocker so the endpoint fails safe when a future table
// starts referencing gl_accounts.id.
const KNOWN_REFS = new Set([
  "weekly_transactions",
  "weekly_balances",
  "excluded_transactions",
]);

// POST /api/gl-accounts/[id]/exclude
// Reverses an activation: moves all weekly_transactions for this account
// back into excluded_transactions, drops derived weekly_balances, and soft-
// deletes the gl_accounts row (is_active = false). Preserves audit trail.
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const sql = getDb();
    const { id } = await ctx.params;
    const glId = parseInt(id, 10);
    if (!glId || glId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // ── 1. Validate the account exists and is currently active ─────────────
    const acct = await sql`
      SELECT id, account_no, division, description, is_active
      FROM gl_accounts
      WHERE id = ${glId}
      LIMIT 1
    `;
    if (acct.length === 0) {
      return NextResponse.json({ error: "gl_account not found" }, { status: 400 });
    }
    if (!acct[0].is_active) {
      return NextResponse.json(
        { error: "gl_account is already inactive" },
        { status: 400 }
      );
    }
    const accountNo = Number(acct[0].account_no);
    const division = String(acct[0].division ?? "");

    // ── 2. Look for OTHER tables referencing gl_accounts.id ────────────────
    // Uses the PG information_schema properly (the spec's shape used
    // `referenced_table_name`, which is a MySQL-ism — mapped to the PG
    // constraint_column_usage view here).
    const otherRefs = await sql`
      SELECT tc.table_name AS table_name,
             kcu.column_name AS column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema   = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema   = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name  = 'gl_accounts'
        AND ccu.column_name = 'id'
    `;

    const blockers: string[] = [];
    for (const r of otherRefs) {
      const tableName = String(r.table_name);
      const colName = String(r.column_name);
      if (KNOWN_REFS.has(tableName)) continue;
      // Defense-in-depth: validate PG identifier shape before interpolating
      // into raw SQL (the values come from information_schema, but better safe).
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(colName)) continue;
      const countRows = (await sql(
        `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "${colName}" = $1`,
        [glId]
      )) as Array<{ count: number }>;
      if ((countRows[0]?.count ?? 0) > 0) {
        blockers.push(`${tableName}.${colName}`);
      }
    }

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot exclude — other tables still reference this account: ${blockers.join(", ")}`,
          blocking_tables: blockers,
        },
        { status: 409 }
      );
    }

    // ── 3. Snapshot affected weeks for the response ─────────────────────────
    const weekRows = await sql`
      SELECT DISTINCT week_ending::text AS week_ending
      FROM weekly_transactions
      WHERE gl_account_id = ${glId}
      ORDER BY week_ending
    `;
    const affectedWeeks = weekRows.map((r) => String(r.week_ending));

    // ── 4. Re-open prior audit-trail rows ──────────────────────────────────
    // Any excluded_transactions rows that were previously activated TO this
    // gl_account get their activated_at / activated_to_gl_account_id cleared
    // so they reappear in the aggregated excluded view. This also drops the
    // FK reference from excluded_transactions.activated_to_gl_account_id.
    await sql`
      UPDATE excluded_transactions
      SET activated_at = NULL,
          activated_to_gl_account_id = NULL
      WHERE activated_to_gl_account_id = ${glId}
    `;

    // ── 5. INSERT excluded_transactions rows for every weekly_transactions ─
    // ON CONFLICT (dedupe_hash) DO NOTHING covers the case where the row
    // already exists in excluded (it was originally imported into excluded,
    // activated, and now being re-excluded — step 4 already reset its flags).
    const txRows = await sql`
      SELECT week_ending::text AS week_ending,
             date_booked::text AS date_booked,
             basic_account_no,
             division,
             description,
             debit,
             credit,
             audit_number,
             job_no,
             vendor_no,
             dedupe_hash
      FROM weekly_transactions
      WHERE gl_account_id = ${glId}
    `;

    if (txRows.length > 0) {
      const srcArr: string[] = [];
      const weekArr: string[] = [];
      const dateArr: string[] = [];
      const acctArr: string[] = [];
      const divArr: string[] = [];
      const descArr: (string | null)[] = [];
      const acctDescArr: (string | null)[] = [];
      const drArr: number[] = [];
      const crArr: number[] = [];
      const journalArr: (string | null)[] = [];
      const auditArr: (string | null)[] = [];
      const trxNoArr: (string | null)[] = [];
      const jobArr: (string | null)[] = [];
      const vendorArr: (string | null)[] = [];
      const hashArr: string[] = [];
      const seen = new Set<string>();

      for (const r of txRows) {
        const hash = String(r.dedupe_hash ?? "");
        if (!hash || seen.has(hash)) continue;
        seen.add(hash);
        srcArr.push(`exclude:gl_account_id=${glId}`);
        weekArr.push(String(r.week_ending));
        dateArr.push(String(r.date_booked));
        acctArr.push(String(r.basic_account_no ?? accountNo));
        divArr.push(String(r.division ?? division));
        descArr.push(r.description != null ? String(r.description) : null);
        acctDescArr.push(acct[0].description != null ? String(acct[0].description) : null);
        drArr.push(parseFloat(String(r.debit ?? 0)));
        crArr.push(parseFloat(String(r.credit ?? 0)));
        journalArr.push(null);
        auditArr.push(r.audit_number != null ? String(r.audit_number) : null);
        trxNoArr.push(null);
        jobArr.push(r.job_no != null ? String(r.job_no) : null);
        vendorArr.push(r.vendor_no != null ? String(r.vendor_no) : null);
        hashArr.push(hash);
      }

      if (hashArr.length > 0) {
        await sql`
          INSERT INTO excluded_transactions (
            source_file, week_ending, date_booked, basic_account_no, division,
            description, account_description, debit, credit,
            journal_no, audit_number, transaction_no, job_no, vendor_no, dedupe_hash
          )
          SELECT * FROM UNNEST(
            ${srcArr}::text[],
            ${weekArr}::date[],
            ${dateArr}::date[],
            ${acctArr}::text[],
            ${divArr}::text[],
            ${descArr}::text[],
            ${acctDescArr}::text[],
            ${drArr}::numeric[],
            ${crArr}::numeric[],
            ${journalArr}::text[],
            ${auditArr}::text[],
            ${trxNoArr}::text[],
            ${jobArr}::text[],
            ${vendorArr}::text[],
            ${hashArr}::text[]
          )
          ON CONFLICT (dedupe_hash) DO NOTHING
        `;
      }
    }

    // ── 6. Clear derived data for this gl_account ──────────────────────────
    await sql`DELETE FROM weekly_transactions WHERE gl_account_id = ${glId}`;
    await sql`DELETE FROM weekly_balances      WHERE gl_account_id = ${glId}`;

    // ── 7. Soft-delete the gl_account ──────────────────────────────────────
    await sql`
      UPDATE gl_accounts
      SET is_active = false
      WHERE id = ${glId}
    `;

    return NextResponse.json({
      success: true,
      transactions_moved: txRows.length,
      weeks_affected: affectedWeeks.length,
      gl_account_deactivated: true,
    });
  } catch (err) {
    const e = err as {
      message?: string;
      code?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
    };
    console.error("POST /api/gl-accounts/[id]/exclude error:", {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
      constraint: e?.constraint,
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
