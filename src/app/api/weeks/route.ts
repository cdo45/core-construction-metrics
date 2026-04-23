import { NextRequest, NextResponse } from "next/server";
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

// POST /api/weeks
// Body: { week_start, week_ending, fiscal_year, is_partial_week }
// Idempotent: ON CONFLICT (week_ending) DO NOTHING. Returns the row that now
// lives in the table (either the newly inserted one or the pre-existing one).
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = (await req.json()) as {
      week_start?: string;
      week_ending?: string;
      fiscal_year?: number;
      is_partial_week?: boolean;
    };

    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!body.week_start || !isoRe.test(body.week_start)) {
      return NextResponse.json({ error: "week_start (YYYY-MM-DD) is required" }, { status: 400 });
    }
    if (!body.week_ending || !isoRe.test(body.week_ending)) {
      return NextResponse.json({ error: "week_ending (YYYY-MM-DD) is required" }, { status: 400 });
    }
    if (!body.fiscal_year || typeof body.fiscal_year !== "number" || !Number.isInteger(body.fiscal_year)) {
      return NextResponse.json({ error: "fiscal_year (integer) is required" }, { status: 400 });
    }
    const isPartial = Boolean(body.is_partial_week);

    await sql`
      INSERT INTO weeks (week_start, week_ending, fiscal_year, is_partial_week)
      VALUES (${body.week_start}::date, ${body.week_ending}::date, ${body.fiscal_year}, ${isPartial})
      ON CONFLICT (week_ending) DO NOTHING
    `;

    const [row] = await sql`
      SELECT
        w.week_start::text   AS week_start,
        w.week_ending::text  AS week_ending,
        w.fiscal_year,
        w.is_partial_week,
        w.is_confirmed,
        w.confirmed_at
      FROM weeks w
      WHERE w.week_ending = ${body.week_ending}::date
      LIMIT 1
    `;

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("POST /api/weeks error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
