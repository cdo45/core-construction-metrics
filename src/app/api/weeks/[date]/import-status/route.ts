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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const sql = getDb();

    // Count existing weekly_balances rows for this week
    const balRows = await sql`
      SELECT
        COUNT(*)                           AS row_count,
        COALESCE(SUM(period_debit),  0)    AS total_debit,
        COALESCE(SUM(period_credit), 0)    AS total_credit
      FROM weekly_balances
      WHERE week_ending = ${date}
    `;

    const row_count    = Number(balRows[0].row_count    ?? 0);
    const total_debit  = n(balRows[0].total_debit);
    const total_credit = n(balRows[0].total_credit);

    // Most recent successful trial_balance import for this week
    const logRows = await sql`
      SELECT created_at
      FROM import_log
      WHERE week_ending  = ${date}
        AND import_type  = 'trial_balance'
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
