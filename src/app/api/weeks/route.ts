import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/weeks
 *
 * Returns all distinct week_ending dates from weekly_balances, ordered desc.
 * Each row includes category-level totals (summing end_balance), plus
 * bid_activity and weekly_notes data via LEFT JOIN.
 *
 * The category totals use category names to bucket: Cash on Hand, Who Owes Us,
 * Who We Owe, Payroll Liabilities. Unknown categories are ignored in totals.
 */
export async function GET() {
  try {
    const sql = getDb();

    const weeks = await sql`
      WITH week_dates AS (
        SELECT DISTINCT week_ending
        FROM weekly_balances
      ),
      category_totals AS (
        SELECT
          wb.week_ending,
          c.name AS category_name,
          CASE WHEN bool_or(g.is_pl_flow)
               THEN SUM(wb.period_debit - wb.period_credit)
               ELSE SUM(wb.end_balance)
          END AS total
        FROM weekly_balances wb
        JOIN gl_accounts g ON g.id = wb.gl_account_id
        LEFT JOIN categories c ON c.id = g.category_id
        GROUP BY wb.week_ending, c.name
      )
      SELECT
        wd.week_ending::text,
        MAX(CASE WHEN ct.category_name = 'Cash on Hand'        THEN ct.total ELSE 0 END) AS cash_total,
        MAX(CASE WHEN ct.category_name = 'Who Owes Us'         THEN ct.total ELSE 0 END) AS ar_total,
        MAX(CASE WHEN ct.category_name = 'Who We Owe (Current)'   THEN ct.total ELSE 0 END) AS ap_total,
        MAX(CASE WHEN ct.category_name = 'Who We Owe (Long-Term)' THEN ct.total ELSE 0 END) AS lt_debt_total,
        MAX(CASE WHEN ct.category_name = 'Payroll Liabilities' THEN ct.total ELSE 0 END) AS payroll_total,
        MAX(CASE WHEN ct.category_name = 'Payroll (Field)'     THEN ct.total ELSE 0 END) AS payroll_field_total,
        MAX(CASE WHEN ct.category_name = 'Overhead (Div 99)'   THEN ct.total ELSE 0 END) AS overhead_total,
        ba.bids_submitted_count,
        ba.bids_submitted_value,
        ba.bids_won_count,
        ba.bids_won_value,
        ba.notes          AS bid_notes,
        wn.doc_link,
        wn.summary
      FROM week_dates wd
      LEFT JOIN category_totals ct ON ct.week_ending = wd.week_ending
      LEFT JOIN bid_activity ba    ON ba.week_ending  = wd.week_ending
      LEFT JOIN weekly_notes wn    ON wn.week_ending  = wd.week_ending
      GROUP BY wd.week_ending, ba.bids_submitted_count, ba.bids_submitted_value,
               ba.bids_won_count, ba.bids_won_value, ba.notes, wn.doc_link, wn.summary
      ORDER BY wd.week_ending DESC
    `;

    return NextResponse.json(weeks);
  } catch (err) {
    console.error("GET /api/weeks error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
