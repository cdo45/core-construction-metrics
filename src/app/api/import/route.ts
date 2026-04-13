import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Request body type ────────────────────────────────────────────────────────

interface IncomingTransaction {
  account_no: number;
  full_account_no: string;
  trx_date: string | null;
  journal: string;
  audit_no: string;
  gl_trx_no: string;
  line: string;
  job: string;
  description: string;
  debit: number;
  credit: number;
  vendor_cust_no: string;
  trx_no: string;
}

interface ImportBody {
  week_ending: string;
  transactions: IncomingTransaction[];
}

// ─── Helper: safe number ──────────────────────────────────────────────────────

function n(v: unknown): number {
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: ImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { week_ending, transactions } = body;

  if (!week_ending || !/^\d{4}-\d{2}-\d{2}$/.test(week_ending)) {
    return NextResponse.json({ error: "week_ending (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (!Array.isArray(transactions)) {
    return NextResponse.json({ error: "transactions must be an array" }, { status: 400 });
  }

  try {
    const sql = getDb();

    // ── a. Load all active GL accounts ────────────────────────────────────────
    const accountRows = await sql`
      SELECT id, account_no, normal_balance
      FROM gl_accounts
      WHERE is_active = TRUE
    `;

    const accountMap = new Map<
      number,
      { id: number; normal_balance: "debit" | "credit" }
    >();
    for (const row of accountRows) {
      accountMap.set(Number(row.account_no), {
        id: Number(row.id),
        normal_balance: row.normal_balance as "debit" | "credit",
      });
    }

    // ── b. Filter to matched accounts ─────────────────────────────────────────
    const matched: (IncomingTransaction & { gl_account_id: number; normal_balance: "debit" | "credit" })[] = [];
    const skippedAccountNos = new Set<number>();

    for (const trx of transactions) {
      const acct = accountMap.get(trx.account_no);
      if (!acct) {
        skippedAccountNos.add(trx.account_no);
        continue;
      }
      matched.push({ ...trx, gl_account_id: acct.id, normal_balance: acct.normal_balance });
    }

    // ── c. Delete existing transactions for re-import idempotency ─────────────
    await sql`
      DELETE FROM weekly_transactions WHERE week_ending = ${week_ending}
    `;

    // ── d. Batch insert transactions ──────────────────────────────────────────
    // Insert in chunks to avoid parameter limits
    const CHUNK = 50;
    for (let i = 0; i < matched.length; i += CHUNK) {
      const chunk = matched.slice(i, i + CHUNK);
      for (const trx of chunk) {
        await sql`
          INSERT INTO weekly_transactions (
            week_ending, gl_account_id, full_account_no, trx_date,
            journal, audit_no, gl_trx_no, line, job, description,
            debit, credit, vendor_cust_no, trx_no
          ) VALUES (
            ${week_ending},
            ${trx.gl_account_id},
            ${trx.full_account_no || null},
            ${trx.trx_date || null},
            ${trx.journal || null},
            ${trx.audit_no || null},
            ${trx.gl_trx_no || null},
            ${trx.line || null},
            ${trx.job || null},
            ${trx.description || null},
            ${trx.debit},
            ${trx.credit},
            ${trx.vendor_cust_no || null},
            ${trx.trx_no || null}
          )
        `;
      }
    }

    // ── e. Compute balances for each affected account ─────────────────────────

    // Group matched transactions by gl_account_id
    const byAccount = new Map<
      number,
      { normal_balance: "debit" | "credit"; debits: number; credits: number }
    >();

    for (const trx of matched) {
      const existing = byAccount.get(trx.gl_account_id);
      if (existing) {
        existing.debits  += n(trx.debit);
        existing.credits += n(trx.credit);
      } else {
        byAccount.set(trx.gl_account_id, {
          normal_balance: trx.normal_balance,
          debits:  n(trx.debit),
          credits: n(trx.credit),
        });
      }
    }

    // For each account: look up prior end_balance → compute end_balance → upsert
    for (const [gl_account_id, acct] of byAccount.entries()) {
      // Prior week's end balance
      const priorRows = await sql`
        SELECT end_balance
        FROM weekly_balances
        WHERE gl_account_id = ${gl_account_id}
          AND week_ending < ${week_ending}
        ORDER BY week_ending DESC
        LIMIT 1
      `;
      const beg_balance = priorRows.length > 0 ? n(priorRows[0].end_balance) : 0;

      // Net activity depends on normal balance type
      const net_activity =
        acct.normal_balance === "debit"
          ? acct.debits - acct.credits
          : acct.credits - acct.debits;

      const end_balance = beg_balance + net_activity;

      await sql`
        INSERT INTO weekly_balances (week_ending, gl_account_id, beg_balance, end_balance)
        VALUES (${week_ending}, ${gl_account_id}, ${beg_balance}, ${end_balance})
        ON CONFLICT (week_ending, gl_account_id)
        DO UPDATE SET
          beg_balance = EXCLUDED.beg_balance,
          end_balance = EXCLUDED.end_balance
      `;
    }

    // ── f. Carry forward zero-activity accounts ───────────────────────────────
    const affectedIds = new Set(byAccount.keys());
    const allActiveIds = Array.from(accountMap.values()).map((a) => a.id);
    const zeroActivityIds = allActiveIds.filter((id) => !affectedIds.has(id));

    for (const gl_account_id of zeroActivityIds) {
      // Find most recent prior end_balance
      const priorRows = await sql`
        SELECT end_balance
        FROM weekly_balances
        WHERE gl_account_id = ${gl_account_id}
          AND week_ending < ${week_ending}
        ORDER BY week_ending DESC
        LIMIT 1
      `;
      const prior_end = priorRows.length > 0 ? n(priorRows[0].end_balance) : 0;

      await sql`
        INSERT INTO weekly_balances (week_ending, gl_account_id, beg_balance, end_balance)
        VALUES (${week_ending}, ${gl_account_id}, ${prior_end}, ${prior_end})
        ON CONFLICT (week_ending, gl_account_id)
        DO UPDATE SET
          beg_balance = EXCLUDED.beg_balance,
          end_balance = EXCLUDED.end_balance
      `;
    }

    return NextResponse.json({
      imported_count:    matched.length,
      accounts_affected: byAccount.size,
      skipped_accounts:  Array.from(skippedAccountNos),
      week_ending,
    });
  } catch (err) {
    console.error("POST /api/import error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
