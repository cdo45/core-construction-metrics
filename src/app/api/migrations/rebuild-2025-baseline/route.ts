import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-shot migration: walks weekly_balances chronologically from the first
// week ending on/after START_DATE, recomputing end_balance from the
// signed-storage formula end = beg + period_debit - period_credit. The
// 12/31/24 baseline (verified against Foundation BS) is left untouched —
// the first week we visit reads its prior end_balance from the 2024-12-31
// row.
//
// For P&L accounts (category_id IN (6,7,8,9)) we reset beg_balance = 0 at
// fiscal-year boundaries so revenue / expense lines accumulate per FY and
// don't carry across years.
//
// After the cascade runs we read AP (account_no = 2005) at 2026-04-18 and
// return it alongside the gap from the Foundation BS authoritative value
// (-2,766,772.88) so the caller can verify in one round trip.

const START_DATE = "2025-01-04";
const VERIFY_WEEK = "2026-04-18";
const VERIFY_ACCT_NO = 2005;
const VERIFY_AUTHORITATIVE = -2766772.88;
const PNL_CATEGORY_IDS = [6, 7, 8, 9];

export async function POST() {
  try {
    const sql = getDb();

    const weekRows = (await sql`
      SELECT week_ending::text AS week_ending, fiscal_year
      FROM weeks
      WHERE week_ending >= ${START_DATE}::date
      ORDER BY week_ending ASC
    `) as Array<{ week_ending: string; fiscal_year: number }>;

    const priorWeekRows = (await sql`
      SELECT week_ending::text AS week_ending, fiscal_year
      FROM weeks
      WHERE week_ending < ${START_DATE}::date
      ORDER BY week_ending DESC
      LIMIT 1
    `) as Array<{ week_ending: string; fiscal_year: number }>;
    const priorWeek = priorWeekRows[0] ?? null;

    let weeks_updated = 0;
    let accounts_touched = 0;

    let prevWeek: string | null = priorWeek?.week_ending ?? null;
    let prevFy: number | null = priorWeek?.fiscal_year ?? null;

    for (const w of weekRows) {
      const fyChanged = prevFy != null && w.fiscal_year !== prevFy;

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

    // Verification: pull AP (sum across divisions) at the verify week.
    const verifyRows = (await sql`
      SELECT
        SUM(wb.end_balance)::text  AS ap_end_balance,
        SUM(wb.period_debit)::text  AS ap_period_debit,
        SUM(wb.period_credit)::text AS ap_period_credit,
        COUNT(*)::int               AS row_count
      FROM weekly_balances wb
      JOIN gl_accounts ga ON ga.id = wb.gl_account_id
      WHERE wb.week_ending = ${VERIFY_WEEK}::date
        AND ga.account_no = ${VERIFY_ACCT_NO}
    `) as Array<{
      ap_end_balance: string | null;
      ap_period_debit: string | null;
      ap_period_credit: string | null;
      row_count: number;
    }>;

    const apEnd = parseFloat(verifyRows[0]?.ap_end_balance ?? "0");
    const gap = +(apEnd - VERIFY_AUTHORITATIVE).toFixed(2);

    return NextResponse.json({
      start_date: START_DATE,
      prior_week: priorWeek?.week_ending ?? null,
      weeks_in_range: weekRows.length,
      weeks_updated,
      accounts_touched,
      verification: {
        week_ending: VERIFY_WEEK,
        account_no: VERIFY_ACCT_NO,
        rows_summed: verifyRows[0]?.row_count ?? 0,
        ap_end_balance: apEnd,
        ap_period_debit: parseFloat(verifyRows[0]?.ap_period_debit ?? "0"),
        ap_period_credit: parseFloat(verifyRows[0]?.ap_period_credit ?? "0"),
        authoritative_bs: VERIFY_AUTHORITATIVE,
        gap_from_bs: gap,
        within_tolerance: Math.abs(gap) < 1,
      },
    });
  } catch (err) {
    console.error("/api/migrations/rebuild-2025-baseline error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
