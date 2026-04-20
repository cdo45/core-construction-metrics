import { NextRequest, NextResponse } from "next/server";
import { getDb, type Sql } from "@/lib/db";

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
    error_message?: string | null;
  },
) {
  const {
    week_ending, status,
    rows_imported  = 0,
    total_debit    = null,
    total_credit   = null,
    net_total      = null,
    error_message  = null,
  } = params;
  try {
    await sql`
      INSERT INTO import_log
        (import_type, week_ending, status, rows_imported,
         total_debit, total_credit, net_total,
         error_message, source_file)
      VALUES
        ('overhead', ${week_ending}, ${status}, ${rows_imported},
         ${total_debit}, ${total_credit}, ${net_total},
         ${error_message}, 'manual-entry')
    `;
  } catch (logErr) {
    console.error("Failed to write import_log:", logErr);
  }
}

// ─── GET /api/weekly-overhead?week_ending=YYYY-MM-DD ──────────────────────────

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("week_ending");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        ga.id              AS gl_account_id,
        ga.account_no,
        ga.description,
        c.name             AS category_name,
        c.color            AS category_color,
        COALESCE(wos.weekly_debit,  0) AS weekly_debit,
        COALESCE(wos.weekly_credit, 0) AS weekly_credit,
        COALESCE(wos.net_activity,  0) AS net_activity,
        COALESCE(wos.excluded_ye_reclass_gross, 0) AS excluded_ye_reclass_gross,
        (wos.id IS NOT NULL)           AS has_data,
        wos.source_file
      FROM gl_accounts ga
      JOIN categories c ON c.id = ga.category_id
      LEFT JOIN weekly_overhead_spend wos
        ON  wos.gl_account_id = ga.id
        AND wos.week_ending   = ${date}
        AND wos.division      = '99'
      WHERE c.name       = 'Overhead (Div 99)'
        AND ga.is_active = TRUE
      ORDER BY ga.account_no ASC
    `;
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    console.error("GET /api/weekly-overhead error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── POST /api/weekly-overhead ────────────────────────────────────────────────

interface OverheadEntry {
  gl_account_id: number;
  weekly_debit:  number;
  weekly_credit: number;
}

interface PostBody {
  week_ending: string;
  entries:     OverheadEntry[];
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { week_ending, entries } = body;

  if (!week_ending || !/^\d{4}-\d{2}-\d{2}$/.test(week_ending)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      { error: "entries must be a non-empty array" },
      { status: 400 },
    );
  }

  const sql = getDb();

  try {
    await sql.transaction((txSql) =>
      entries.map((e) => {
        const net = n(e.weekly_debit) - n(e.weekly_credit);
        return txSql`
          INSERT INTO weekly_overhead_spend (
            week_ending, gl_account_id, division,
            weekly_debit, weekly_credit, net_activity,
            excluded_ye_reclass_gross, source_file
          ) VALUES (
            ${week_ending}, ${e.gl_account_id}, '99',
            ${n(e.weekly_debit)}, ${n(e.weekly_credit)}, ${net},
            0, 'manual-entry'
          )
          ON CONFLICT (week_ending, gl_account_id, division)
          DO UPDATE SET
            weekly_debit  = EXCLUDED.weekly_debit,
            weekly_credit = EXCLUDED.weekly_credit,
            net_activity  = EXCLUDED.net_activity,
            source_file   = 'manual-entry'
        `;
      }),
    );

    const total_debit  = entries.reduce((s, e) => s + n(e.weekly_debit),  0);
    const total_credit = entries.reduce((s, e) => s + n(e.weekly_credit), 0);

    await writeImportLog(sql, {
      week_ending,
      status:        "success",
      rows_imported: entries.length,
      total_debit,
      total_credit,
      net_total:     total_debit - total_credit,
    });

    return NextResponse.json({ saved_count: entries.length });
  } catch (err) {
    console.error("POST /api/weekly-overhead error:", err);
    await writeImportLog(sql, {
      week_ending,
      status:        "failed",
      error_message: String(err),
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
