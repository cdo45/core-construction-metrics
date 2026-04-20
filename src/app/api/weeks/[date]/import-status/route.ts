import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function n(v: unknown): number {
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const type = req.nextUrl.searchParams.get("type") ?? "full_gl";

  if (type !== "full_gl" && type !== "overhead") {
    return NextResponse.json(
      { error: "type must be 'full_gl' or 'overhead'" },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  try {
    const sql = getDb();

    let row_count  = 0;
    let total_debit  = 0;
    let total_credit = 0;

    if (type === "full_gl") {
      const rows = await sql`
        SELECT
          COUNT(*)                        AS row_count,
          COALESCE(SUM(debit),  0)        AS total_debit,
          COALESCE(SUM(credit), 0)        AS total_credit
        FROM weekly_transactions
        WHERE week_ending = ${date}
      `;
      row_count    = Number(rows[0].row_count    ?? 0);
      total_debit  = n(rows[0].total_debit);
      total_credit = n(rows[0].total_credit);
    } else {
      const rows = await sql`
        SELECT
          COUNT(*)                              AS row_count,
          COALESCE(SUM(weekly_debit),  0)       AS total_debit,
          COALESCE(SUM(weekly_credit), 0)       AS total_credit
        FROM weekly_overhead_spend
        WHERE week_ending = ${date} AND division = '99'
      `;
      row_count    = Number(rows[0].row_count    ?? 0);
      total_debit  = n(rows[0].total_debit);
      total_credit = n(rows[0].total_credit);
    }

    // Most recent successful import timestamp for this week + type
    const logRows = await sql`
      SELECT created_at
      FROM import_log
      WHERE week_ending = ${date}
        AND import_type  = ${type}
        AND status       = 'success'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return NextResponse.json({
      exists:      row_count > 0,
      row_count,
      total_debit,
      total_credit,
      last_import: logRows.length > 0 ? logRows[0].created_at : null,
    });
  } catch (err) {
    console.error("GET /api/weeks/[date]/import-status error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
