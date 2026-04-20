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
  week_ending:  string;
  transactions: IncomingTransaction[];
  source_file?: string;
}

// ─── YE reclass patterns (case-insensitive) ───────────────────────────────────

const YE_RECLASS_PATTERNS = [
  "year end reclass",
  "yr ed recl",
  "ye reclass",
  "yr end",
];

function isYeReclass(description: string): boolean {
  const lower = description.toLowerCase();
  return YE_RECLASS_PATTERNS.some((p) => lower.includes(p));
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
        ('overhead', ${week_ending}, ${status}, ${rows_imported},
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

  const {
    week_ending,
    transactions,
    source_file = "unknown.csv",
  } = body;

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

  // ── HARD BLOCK: does not look like a Div 99 export ───────────────────────
  if (detectDivision99Percentage(transactions) < 0.9) {
    const msg = "This doesn't look like a Div 99 overhead export. Use the full GL importer instead.";
    await writeImportLog(sql, { week_ending, source_file, status: "failed", error_message: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    // ── 1. Load all active GL accounts ───────────────────────────────────────
    const accountRows = await sql`
      SELECT id, account_no
      FROM gl_accounts
      WHERE is_active = TRUE
    `;

    const accountMap = new Map<number, number>(); // account_no → id
    for (const row of accountRows) {
      accountMap.set(Number(row.account_no), Number(row.id));
    }

    // ── 2. Match transactions; collect unknowns ───────────────────────────────
    const matched:    IncomingTransaction[] = [];
    const unknownMap  = new Map<number, number>(); // account_no → net_activity

    for (const trx of transactions) {
      if (accountMap.has(trx.account_no)) {
        matched.push(trx);
      } else {
        const prev = unknownMap.get(trx.account_no) ?? 0;
        unknownMap.set(trx.account_no, prev + n(trx.debit) - n(trx.credit));
      }
    }

    // ── 3. Soft warnings ─────────────────────────────────────────────────────
    const warnings: string[] = [];

    const windowResult = checkWeekWindow(
      transactions.map((t) => t.trx_date),
      week_ending,
    );
    if (windowResult.warning) warnings.push(windowResult.warning);

    const datedTrx     = transactions.map((t) => t.trx_date).filter((d): d is string => d !== null);
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

    // ── 4. YE reclass split + per-account grouping ───────────────────────────
    // Maps are keyed by gl_account_id (DB PK).
    const grouped       = new Map<number, { debits: number; credits: number }>();
    const yeReclassMap  = new Map<number, number>(); // gl_account_id → gross excluded

    for (const trx of matched) {
      const gl_account_id = accountMap.get(trx.account_no)!;

      if (isYeReclass(trx.description)) {
        // Accumulate absolute value of both sides
        const prev = yeReclassMap.get(gl_account_id) ?? 0;
        yeReclassMap.set(gl_account_id, prev + Math.abs(n(trx.debit)) + Math.abs(n(trx.credit)));
        continue;
      }

      const existing = grouped.get(gl_account_id);
      if (existing) {
        existing.debits  += n(trx.debit);
        existing.credits += n(trx.credit);
      } else {
        grouped.set(gl_account_id, { debits: n(trx.debit), credits: n(trx.credit) });
      }
    }

    // Ensure accounts that had ONLY YE reclass rows still get a zero-activity row
    for (const gl_account_id of yeReclassMap.keys()) {
      if (!grouped.has(gl_account_id)) {
        grouped.set(gl_account_id, { debits: 0, credits: 0 });
      }
    }

    // Zero-activity check (after YE reclass separation)
    const total_debit  = Array.from(grouped.values()).reduce((s, a) => s + a.debits,  0);
    const total_credit = Array.from(grouped.values()).reduce((s, a) => s + a.credits, 0);
    if (total_debit === 0 && total_credit === 0) {
      warnings.push("Zero activity detected — verify file contents");
    }

    // Totals for response / log
    const net_total                 = total_debit - total_credit;
    const excluded_ye_reclass_total = Array.from(yeReclassMap.values()).reduce((s, v) => s + v, 0);

    // ── 5. Transactional writes ───────────────────────────────────────────────
    await sql.transaction((txSql) => [
      txSql`
        DELETE FROM weekly_overhead_spend
        WHERE week_ending = ${week_ending} AND division = '99'
      `,
      ...Array.from(grouped.entries()).map(([gl_account_id, acct]) => {
        const ye_gross   = yeReclassMap.get(gl_account_id) ?? 0;
        const net_acct   = acct.debits - acct.credits;
        return txSql`
          INSERT INTO weekly_overhead_spend (
            week_ending, gl_account_id, division,
            weekly_debit, weekly_credit, net_activity,
            excluded_ye_reclass_gross, source_file
          ) VALUES (
            ${week_ending}, ${gl_account_id}, '99',
            ${acct.debits}, ${acct.credits}, ${net_acct},
            ${ye_gross},
            ${source_file}
          )
        `;
      }),
    ]);

    // ── 6. Log success ────────────────────────────────────────────────────────
    await writeImportLog(sql, {
      week_ending,
      source_file,
      status:        "success",
      rows_imported: grouped.size,
      total_debit,
      total_credit,
      net_total,
      warnings:      warnings.length > 0 ? warnings : null,
    });

    return NextResponse.json({
      imported_count:            grouped.size,
      total_debit,
      total_credit,
      net_total,
      excluded_ye_reclass_total,
      unknown_accounts: Array.from(unknownMap.entries()).map(
        ([account_no, net_activity]) => ({ account_no, net_activity }),
      ),
      warnings,
    });
  } catch (err) {
    console.error("POST /api/import-overhead error:", err);
    await writeImportLog(sql, {
      week_ending,
      source_file,
      status:        "failed",
      error_message: String(err),
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
