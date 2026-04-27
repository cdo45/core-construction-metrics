import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// P&L category IDs — must reset beg_balance=0 at fiscal-year boundaries.
const PNL_CATEGORY_IDS = [6, 7, 8, 9];

export async function POST(req: NextRequest) {
  try {
    const sql = getDb();
    const body = (await req.json()) as { start_date?: string };
    const start_date = body?.start_date;

    if (!start_date || !ISO_DATE.test(start_date)) {
      return NextResponse.json(
        { error: "start_date (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }

    // Load every week >= start_date in chronological order, plus its fiscal
    // year. We need fiscal_year so we can detect year boundaries for the
    // P&L-reset rule.
    const weekRows = (await sql`
      SELECT week_ending::text AS week_ending, fiscal_year
      FROM weeks
      WHERE week_ending >= ${start_date}::date
      ORDER BY week_ending ASC
    `) as Array<{ week_ending: string; fiscal_year: number }>;

    // Find the prior week (week_ending < start_date) — its end_balance feeds
    // the first week's beg_balance.
    const priorWeekRows = (await sql`
      SELECT week_ending::text AS week_ending, fiscal_year
      FROM weeks
      WHERE week_ending < ${start_date}::date
      ORDER BY week_ending DESC
      LIMIT 1
    `) as Array<{ week_ending: string; fiscal_year: number }>;
    const priorWeek = priorWeekRows[0] ?? null;

    let weeks_updated = 0;
    let accounts_touched = 0;

    let prevWeek = priorWeek?.week_ending ?? null;
    let prevFy = priorWeek?.fiscal_year ?? null;

    for (const w of weekRows) {
      const fyChanged = prevFy != null && w.fiscal_year !== prevFy;

      // For each weekly_balances row in THIS week:
      //   beg_balance = (P&L row && fyChanged) ? 0 : prev week's end_balance
      //   end_balance = beg_balance + period_debit - period_credit
      // Set-based update so a single SQL handles all gl_accounts for the week.
      const updated = (await sql`
        WITH src AS (
          SELECT
            cur.id,
            cur.period_debit,
            cur.period_credit,
            CASE
              WHEN ${fyChanged}::boolean
                AND ga.category_id = ANY(${PNL_CATEGORY_IDS}::int[])
              THEN 0::numeric
              ELSE COALESCE(prev.end_balance, 0)::numeric
            END AS new_beg
          FROM weekly_balances cur
          JOIN gl_accounts ga ON ga.id = cur.gl_account_id
          LEFT JOIN weekly_balances prev
            ON prev.gl_account_id = cur.gl_account_id
           AND prev.week_ending = ${prevWeek}::date
          WHERE cur.week_ending = ${w.week_ending}::date
        )
        UPDATE weekly_balances wb
        SET beg_balance = src.new_beg,
            end_balance = src.new_beg + src.period_debit - src.period_credit
        FROM src
        WHERE wb.id = src.id
        RETURNING wb.gl_account_id
      `) as Array<{ gl_account_id: number }>;

      if (updated.length > 0) {
        weeks_updated++;
        accounts_touched += updated.length;
      }

      prevWeek = w.week_ending;
      prevFy = w.fiscal_year;
    }

    return NextResponse.json({
      start_date,
      prior_week: priorWeek?.week_ending ?? null,
      weeks_in_range: weekRows.length,
      weeks_updated,
      accounts_touched,
    });
  } catch (err) {
    console.error("/api/admin/cascade-balances error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
