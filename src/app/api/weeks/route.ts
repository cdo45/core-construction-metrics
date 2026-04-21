import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const sql = getDb();

    const rows = await sql`
      SELECT
        w.week_ending::text,
        w.week_start::text,
        w.fiscal_year,
        w.is_partial_week,
        w.is_confirmed,
        w.confirmed_at,
        (SELECT COUNT(*)::int FROM weekly_balances b WHERE b.week_ending = w.week_ending) AS balance_count,
        (SELECT COUNT(*)::int FROM weekly_transactions t WHERE t.week_ending = w.week_ending) AS transaction_count
      FROM weeks w
      ORDER BY w.week_ending DESC
    `;

    const weeks = rows.map((r) => ({
      ...r,
      status: r.is_confirmed
        ? "Confirmed"
        : r.balance_count > 0 || r.transaction_count > 0
        ? "In Progress"
        : "Empty",
    }));

    return NextResponse.json(weeks);
  } catch (err) {
    console.error("GET /api/weeks error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
