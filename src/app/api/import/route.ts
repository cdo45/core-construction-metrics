import { NextRequest, NextResponse } from "next/server";
import { getDb, type Sql } from "@/lib/db";
import { detectDivision99Percentage } from "@/lib/csv-parser";
import { checkWeekWindow } from "@/lib/week-check";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomingTransaction {
  account_no:      number;
  full_account_no: string;
  trx_date:        string | null;
  journal:         string;
  audit_no:        string;
  gl_trx_no:       string;
  line:            string;
  job:             string;
  description:     string;
  debit:           number;
  credit:          number;
  vendor_cust_no:  string;
  trx_no:          string;
}

interface ImportBody {
  week_ending:   string;
  transactions:  IncomingTransaction[];
  source_file?:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

async function writeImportLog(
  sql: Sql,
  params: {
    week_ending:    string;
    status:         "success" | "failed";
    rows_imported?: number;
    total_debit?:   number | null;
    total_credit?:  number | null;
    net_total?:     number | null;
    warnings?:      string[] | null;
    error_message?: string | null;
    source_file?:   string | null;
  },
) {
  const {
    week_ending, status,
    rows_imported  = 0,
    total_debit    = null,
    total_credit   = null,
    net_total      = null,
    warnings       = null,
    error_message  = null,
    source_file    = null,
  } = params;

  try {
    await sql`
      INSERT INTO import_log
        (import_type, week_ending, status, rows_imported,
         total_debit, total_credit, net_total,
         warnings, error_message, source_file)
      VALUES
        ('full_gl', ${week_ending}, ${status}, ${rows_imported},
         ${total_debit}, ${total_credit}, ${net_total},
         ${warnings ? JSON.stringify(warnings) : null},
         ${error_message}, ${source_file})
    `;
  } catch (logErr) {
    console.error("Failed to write import_log:", logErr);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: ImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { week_ending, transactions, source_file } = body;

  if (!week_ending || !/^\d{4}-\d{2}-\d{2}$/.test(week_ending)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(transactions)) {
    return NextResponse.json(
      { error: "transactions must be an array" },
      { status: 400 },
    );
  }

  const sql = getDb();

  // ── HARD BLOCK: empty payload ─────────────────────────────────────────────
  if (transactions.length === 0) {
    const msg = "No importable rows found in this file";
    await writeImportLog(sql, { week_ending, source_file, status: "failed", error_message: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // ── HARD BLOCK: looks like a Div 99 overhead export ───────────────────────
  if (detectDivision99Percentage(transactions) > 0.9) {
    const msg = "This looks like a Div 99 overhead export. Use the overhead importer instead.";
    await writeImportLog(sql, { week_ending, source_file, status: "failed", error_message: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    // ── a. Load all active GL accounts ──────────────────────────────────────
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
        id:             Number(row.id),
        normal_balance: row.normal_balance as "debit" | "credit",
      });
    }

    // ── b. Filter to matched accounts ────────────────────────────────────────
    const matched: (IncomingTransaction & {
      gl_account_id:  number;
      normal_balance: "debit" | "credit";
    })[] = [];
    const skippedAccountNos = new Set<number>();

    for (const trx of transactions) {
      const acct = accountMap.get(trx.account_no);
      if (!acct) {
        skippedAccountNos.add(trx.account_no);
        continue;
      }
      matched.push({ ...trx, gl_account_id: acct.id, normal_balance: acct.normal_balance });
    }

    // ── HARD BLOCK: all transactions unrecognised ─────────────────────────
    if (matched.length === 0) {
      const msg = "No importable rows found in this file";
      await writeImportLog(sql, { week_ending, source_file, status: "failed", error_message: msg });
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // ── c. Per-account debit/credit sums ────────────────────────────────────
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

    // ── d. Load prior end_balances for ALL active accounts (pre-transaction) ─
    const allActiveIds = Array.from(accountMap.values()).map((a) => a.id);
    const priorMap = new Map<number, number>();

    for (const gl_account_id of allActiveIds) {
      const rows = await sql`
        SELECT end_balance
        FROM weekly_balances
        WHERE gl_account_id = ${gl_account_id}
          AND week_ending < ${week_ending}
        ORDER BY week_ending DESC
        LIMIT 1
      `;
      if (rows.length > 0) priorMap.set(gl_account_id, n(rows[0].end_balance));
    }

    // ── e. Compute final balances in memory ──────────────────────────────────
    const computedBalances = new Map<number, { beg: number; end: number }>();
    for (const [gl_account_id, acct] of byAccount.entries()) {
      const beg = priorMap.get(gl_account_id) ?? 0;
      const net =
        acct.normal_balance === "debit"
          ? acct.debits - acct.credits
          : acct.credits - acct.debits;
      computedBalances.set(gl_account_id, { beg, end: beg + net });
    }

    const affectedIds    = new Set(byAccount.keys());
    const zeroActivityIds = allActiveIds.filter((id) => !affectedIds.has(id));

    // ── f. Aggregate totals ──────────────────────────────────────────────────
    const total_debit  = matched.reduce((s, t) => s + n(t.debit),  0);
    const total_credit = matched.reduce((s, t) => s + n(t.credit), 0);
    let   net_total    = 0;
    for (const bal of computedBalances.values()) net_total += bal.end - bal.beg;

    // ── g. Soft warnings ─────────────────────────────────────────────────────
    const warnings: string[] = [];

    const windowResult = checkWeekWindow(
      matched.map((t) => t.trx_date),
      week_ending,
    );
    if (windowResult.warning) warnings.push(windowResult.warning);

    const datedTrx    = matched.map((t) => t.trx_date).filter((d): d is string => d !== null);
    const distinctDates = new Set(datedTrx);
    if (datedTrx.length > 0 && distinctDates.size < 3) {
      warnings.push(
        `Transactions span only ${distinctDates.size} distinct date${distinctDates.size === 1 ? "" : "s"} — possible partial export`,
      );
    }
    if (distinctDates.size > 10) {
      warnings.push(
        `Transactions span ${distinctDates.size} distinct dates — possible multi-week export`,
      );
    }
    if (total_debit === 0 && total_credit === 0) {
      warnings.push("Zero activity detected — verify file contents");
    }

    // ── h. Transactional writes (BEGIN / COMMIT — auto-rollback on error) ────
    await sql.transaction((txSql) => [
      // Step 1: delete existing rows for idempotent re-import
      txSql`DELETE FROM weekly_transactions WHERE week_ending = ${week_ending}`,

      // Step 2: insert every matched transaction
      ...matched.map((trx) => txSql`
        INSERT INTO weekly_transactions (
          week_ending, gl_account_id, full_account_no, trx_date,
          journal, audit_no, gl_trx_no, line, job, description,
          debit, credit, vendor_cust_no, trx_no
        ) VALUES (
          ${week_ending},
          ${trx.gl_account_id},
          ${trx.full_account_no  || null},
          ${trx.trx_date         || null},
          ${trx.journal          || null},
          ${trx.audit_no         || null},
          ${trx.gl_trx_no        || null},
          ${trx.line             || null},
          ${trx.job              || null},
          ${trx.description      || null},
          ${trx.debit},
          ${trx.credit},
          ${trx.vendor_cust_no   || null},
          ${trx.trx_no           || null}
        )
      `),

      // Step 3: upsert balances for every account that had activity
      ...Array.from(computedBalances.entries()).map(([gl_account_id, bal]) => txSql`
        INSERT INTO weekly_balances (week_ending, gl_account_id, beg_balance, end_balance)
        VALUES (${week_ending}, ${gl_account_id}, ${bal.beg}, ${bal.end})
        ON CONFLICT (week_ending, gl_account_id)
        DO UPDATE SET
          beg_balance = EXCLUDED.beg_balance,
          end_balance = EXCLUDED.end_balance
      `),

      // Step 4: carry-forward zero-activity accounts
      ...zeroActivityIds.map((gl_account_id) => {
        const prior_end = priorMap.get(gl_account_id) ?? 0;
        return txSql`
          INSERT INTO weekly_balances (week_ending, gl_account_id, beg_balance, end_balance)
          VALUES (${week_ending}, ${gl_account_id}, ${prior_end}, ${prior_end})
          ON CONFLICT (week_ending, gl_account_id)
          DO UPDATE SET
            beg_balance = EXCLUDED.beg_balance,
            end_balance = EXCLUDED.end_balance
        `;
      }),
    ]);

    // ── i. Log success ───────────────────────────────────────────────────────
    await writeImportLog(sql, {
      week_ending,
      source_file,
      status:        "success",
      rows_imported: matched.length,
      total_debit,
      total_credit,
      net_total,
      warnings:      warnings.length > 0 ? warnings : null,
    });

    return NextResponse.json({
      imported_count:    matched.length,
      accounts_affected: byAccount.size,
      skipped_accounts:  Array.from(skippedAccountNos),
      week_ending,
      warnings,
    });
  } catch (err) {
    console.error("POST /api/import error:", err);
    await writeImportLog(sql, {
      week_ending,
      source_file,
      status:        "failed",
      error_message: String(err),
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
