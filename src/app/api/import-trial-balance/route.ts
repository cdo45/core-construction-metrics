import { NextRequest, NextResponse } from "next/server";
import { getDb, type Sql } from "@/lib/db";
import { isValidWeekEnding } from "@/lib/fiscal-weeks";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomingRow {
  account_no: number;
  division:   string;
  debit:      number;
  credit:     number;
}

interface ImportBody {
  week_ending:  string;
  parsed_rows:  IncomingRow[];
  source_file?: string;
  file_totals?: { debits: number; credits: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
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
         total_debit, total_credit, net_total, warnings, error_message, source_file)
      VALUES
        ('trial_balance', ${week_ending}, ${status}, ${rows_imported},
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

  const { week_ending, parsed_rows, source_file, file_totals } = body;

  // ── Validate week_ending ──────────────────────────────────────────────────
  if (!week_ending || !/^\d{4}-\d{2}-\d{2}$/.test(week_ending)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) is required" },
      { status: 400 },
    );
  }
  if (!isValidWeekEnding(week_ending)) {
    return NextResponse.json(
      { error: `${week_ending} is not a valid fiscal week ending (must be a Saturday or Dec 31).` },
      { status: 400 },
    );
  }
  if (!Array.isArray(parsed_rows) || parsed_rows.length === 0) {
    return NextResponse.json(
      { error: "parsed_rows must be a non-empty array" },
      { status: 400 },
    );
  }

  // ── Validate file-level balance (hard block if file footer present + unbalanced) ──
  // We intentionally import only ~143 of 300+ accounts, so the filtered subset
  // will never balance on its own — that's by design. Only the full-file totals matter.
  const inputDebit  = parsed_rows.reduce((s, r) => s + n(r.debit),  0);
  const inputCredit = parsed_rows.reduce((s, r) => s + n(r.credit), 0);

  if (file_totals && Math.abs(file_totals.debits - file_totals.credits) > 1.0) {
    const diff = Math.abs(file_totals.debits - file_totals.credits);
    const msg =
      `Source file is not balanced — Foundation export may be corrupted. ` +
      `File totals: debits $${file_totals.debits.toFixed(2)}, ` +
      `credits $${file_totals.credits.toFixed(2)}, ` +
      `difference $${diff.toFixed(2)}`;
    const sql = getDb();
    await writeImportLog(sql, { week_ending, source_file, status: "failed", error_message: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const sql = getDb();

  try {
    // ── 1. Load all active GL accounts ────────────────────────────────────────
    const acctRows = await sql`
      SELECT id, account_no, division, normal_balance, is_pl_flow
      FROM gl_accounts
      WHERE is_active = TRUE
      ORDER BY account_no ASC, division ASC
    `;

    // Map keyed by "account_no-division"
    const acctMap = new Map<string, {
      id:             number;
      normal_balance: "debit" | "credit";
      is_pl_flow:     boolean;
    }>();
    for (const r of acctRows) {
      const key = `${Number(r.account_no)}-${String(r.division ?? "")}`;
      acctMap.set(key, {
        id:             Number(r.id),
        normal_balance: r.normal_balance as "debit" | "credit",
        is_pl_flow:     Boolean(r.is_pl_flow),
      });
    }

    // ── 2. Classify incoming rows ──────────────────────────────────────────────
    const rowMap = new Map<string, { debit: number; credit: number }>();
    const unknown: IncomingRow[] = [];

    for (const row of parsed_rows) {
      const key = `${n(row.account_no)}-${String(row.division ?? "")}`;
      if (acctMap.has(key)) {
        // Last row wins if duplicate account in the TB (shouldn't happen, but safe)
        const existing = rowMap.get(key);
        if (existing) {
          existing.debit  += n(row.debit);
          existing.credit += n(row.credit);
        } else {
          rowMap.set(key, { debit: n(row.debit), credit: n(row.credit) });
        }
      } else {
        unknown.push(row);
      }
    }

    // ── 3. Load prior end_balances + existing beg_balances ───────────────────
    // Two bulk queries instead of N+1 per-account selects.
    const bsIds = Array.from(acctMap.values())
      .filter((a) => !a.is_pl_flow)
      .map((a) => a.id);

    const priorMap       = new Map<number, number>(); // gl_account_id → prior end_balance
    const existingBegMap = new Map<number, number>(); // gl_account_id → this week's beg_balance

    if (bsIds.length > 0) {
      // Most recent prior end_balance per account (one query instead of N)
      const priorRows = await sql`
        SELECT DISTINCT ON (gl_account_id)
          gl_account_id, end_balance::numeric
        FROM weekly_balances
        WHERE gl_account_id = ANY(${bsIds})
          AND week_ending < ${week_ending}
        ORDER BY gl_account_id, week_ending DESC
      `;
      for (const r of priorRows) {
        priorMap.set(Number(r.gl_account_id), n(r.end_balance));
      }

      // Existing beg_balances for this exact week — used when no prior week
      // exists to preserve manually-seeded opening balances.
      const existingRows = await sql`
        SELECT gl_account_id, beg_balance::numeric
        FROM weekly_balances
        WHERE gl_account_id = ANY(${bsIds})
          AND week_ending = ${week_ending}
      `;
      for (const r of existingRows) {
        existingBegMap.set(Number(r.gl_account_id), n(r.beg_balance));
      }
    }

    // ── 4. Compute inserts for all 143 accounts ────────────────────────────────
    interface BalanceInsert {
      gl_account_id: number;
      beg_balance:   number;
      end_balance:   number;
      period_debit:  number;
      period_credit: number;
    }

    const inserts: BalanceInsert[] = [];

    for (const [key, acct] of acctMap.entries()) {
      const tbRow = rowMap.get(key);
      const period_debit  = tbRow ? n(tbRow.debit)  : 0;
      const period_credit = tbRow ? n(tbRow.credit) : 0;

      let beg_balance = 0;
      let end_balance = 0;

      if (!acct.is_pl_flow) {
        // Prior week exists → carry its end_balance forward as beg.
        // No prior week → preserve any manually-seeded opening beg_balance, else 0.
        beg_balance = priorMap.has(acct.id)
          ? priorMap.get(acct.id)!
          : (existingBegMap.get(acct.id) ?? 0);
        const net = acct.normal_balance === "debit"
          ? period_debit - period_credit
          : period_credit - period_debit;
        end_balance = beg_balance + net;
      }
      // P&L flow: beg=0, end=0 — only period_debit/credit matter

      inserts.push({ gl_account_id: acct.id, beg_balance, end_balance, period_debit, period_credit });
    }

    // ── 5. Write to DB (transaction) ──────────────────────────────────────────
    // ON CONFLICT preserves beg_balance from any existing row (e.g. manual
    // opening balance entries) — only the period activity and derived end_balance
    // are updated on reimport.
    await sql.transaction((txSql) =>
      inserts.map((ins) => txSql`
        INSERT INTO weekly_balances
          (week_ending, gl_account_id, beg_balance, end_balance, period_debit, period_credit)
        VALUES
          (${week_ending}, ${ins.gl_account_id},
           ${ins.beg_balance}, ${ins.end_balance},
           ${ins.period_debit}, ${ins.period_credit})
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE SET
          period_debit  = EXCLUDED.period_debit,
          period_credit = EXCLUDED.period_credit,
          end_balance   = EXCLUDED.end_balance
      `)
    );

    // ── 6. Compute category totals for response ────────────────────────────────
    const catRows = await sql`
      SELECT c.name AS cat, SUM(wb.end_balance) AS bal_total,
             SUM(wb.period_debit - wb.period_credit) AS flow_total
      FROM weekly_balances wb
      JOIN gl_accounts g   ON g.id = wb.gl_account_id
      JOIN categories c    ON c.id = g.category_id
      WHERE wb.week_ending = ${week_ending}
      GROUP BY c.name
    `;
    const totals: Record<string, number> = {};
    for (const r of catRows) {
      const cat = r.cat as string;
      totals[cat] = n(r.flow_total) !== 0 ? n(r.flow_total) : n(r.bal_total);
    }

    const active_accounts = inserts.filter(
      (i) => i.period_debit !== 0 || i.period_credit !== 0 || i.end_balance !== 0,
    ).length;

    const warnings: string[] = [];
    if (!file_totals) {
      warnings.push("Could not verify file balance — no totals row found. Proceeding with import.");
    }
    if (unknown.length > 10) {
      warnings.push(`${unknown.length} account(s) in the CSV were not recognised and were skipped.`);
    }

    await writeImportLog(sql, {
      week_ending,
      source_file,
      status:        "success",
      rows_imported: inserts.length,
      total_debit:   inputDebit,
      total_credit:  inputCredit,
      net_total:     inputDebit - inputCredit,
      warnings:      warnings.length > 0 ? warnings : null,
    });

    return NextResponse.json({
      imported_count:      inserts.length,
      active_accounts,
      totals_by_category:  totals,
      unknown_accounts:    unknown,
      warnings,
    });
  } catch (err) {
    console.error("POST /api/import-trial-balance error:", err);
    await writeImportLog(sql, {
      week_ending, source_file,
      status:        "failed",
      error_message: String(err),
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
