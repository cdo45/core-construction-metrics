import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/weekly-balances?week_ending=YYYY-MM-DD
 *
 * Returns all balances for the given week joined with account + category info.
 * If no data exists for that week, returns all active GL accounts with 0 balances
 * so the entry form pre-populates a blank row for every account.
 *
 * Also accepts ?prior=1 to return the most recent week_ending strictly before
 * week_ending — used by the entry form to auto-fill beg_balance defaults.
 */
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(req.url);
    const weekEnding = searchParams.get("week_ending");
    const prior = searchParams.get("prior") === "1";

    if (!weekEnding) {
      return NextResponse.json(
        { error: "week_ending query param is required" },
        { status: 400 }
      );
    }

    if (prior) {
      // Return the most recent week that has data before this date
      const priorWeeks = await sql`
        SELECT DISTINCT week_ending::text
        FROM weekly_balances
        WHERE week_ending < ${weekEnding}::date
        ORDER BY week_ending DESC
        LIMIT 1
      `;

      if (priorWeeks.length === 0) {
        return NextResponse.json({ week_ending: null, balances: [] });
      }

      const priorDate = priorWeeks[0].week_ending as string;
      const balances = await sql`
        SELECT
          wb.gl_account_id,
          wb.beg_balance,
          wb.end_balance,
          g.account_no,
          g.description,
          g.normal_balance,
          g.category_id,
          c.name  AS category_name,
          c.color AS category_color,
          c.sort_order AS category_sort_order
        FROM weekly_balances wb
        JOIN gl_accounts g ON g.id = wb.gl_account_id
        LEFT JOIN categories c ON c.id = g.category_id
        WHERE wb.week_ending = ${priorDate}::date
        ORDER BY c.sort_order ASC, g.account_no ASC
      `;

      return NextResponse.json({ week_ending: priorDate, balances });
    }

    // Check whether any rows exist for this week
    const existing = await sql`
      SELECT
        wb.id,
        wb.gl_account_id,
        wb.beg_balance,
        wb.end_balance,
        g.account_no,
        g.description,
        g.normal_balance,
        g.category_id,
        c.name  AS category_name,
        c.color AS category_color,
        c.sort_order AS category_sort_order
      FROM weekly_balances wb
      JOIN gl_accounts g ON g.id = wb.gl_account_id
      LEFT JOIN categories c ON c.id = g.category_id
      WHERE wb.week_ending = ${weekEnding}::date
      ORDER BY c.sort_order ASC, g.account_no ASC
    `;

    if (existing.length > 0) {
      return NextResponse.json({ week_ending: weekEnding, balances: existing });
    }

    // No data yet — return all active accounts with 0 balances
    const accounts = await sql`
      SELECT
        g.id AS gl_account_id,
        0::numeric AS beg_balance,
        0::numeric AS end_balance,
        g.account_no,
        g.description,
        g.normal_balance,
        g.category_id,
        c.name  AS category_name,
        c.color AS category_color,
        c.sort_order AS category_sort_order
      FROM gl_accounts g
      LEFT JOIN categories c ON c.id = g.category_id
      WHERE g.is_active = true
      ORDER BY c.sort_order ASC, g.account_no ASC
    `;

    return NextResponse.json({ week_ending: weekEnding, balances: accounts });
  } catch (err) {
    console.error("GET /api/weekly-balances error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/weekly-balances
 * Body: { week_ending: string, balances: Array<{ gl_account_id, beg_balance, end_balance }> }
 * Upserts each balance row.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = await req.json();
    const { week_ending, balances } = body as {
      week_ending: string;
      balances: { gl_account_id: number; beg_balance: number; end_balance: number }[];
    };

    if (!week_ending) {
      return NextResponse.json({ error: "week_ending is required" }, { status: 400 });
    }
    if (!Array.isArray(balances) || balances.length === 0) {
      return NextResponse.json({ error: "balances array is required" }, { status: 400 });
    }

    for (const row of balances) {
      await sql`
        INSERT INTO weekly_balances (week_ending, gl_account_id, beg_balance, end_balance)
        VALUES (
          ${week_ending}::date,
          ${row.gl_account_id},
          ${row.beg_balance},
          ${row.end_balance}
        )
        ON CONFLICT (week_ending, gl_account_id) DO UPDATE
          SET beg_balance = EXCLUDED.beg_balance,
              end_balance = EXCLUDED.end_balance
      `;
    }

    return NextResponse.json({ success: true, saved: balances.length });
  } catch (err) {
    console.error("POST /api/weekly-balances error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
