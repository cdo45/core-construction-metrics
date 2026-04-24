import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Category IDs — canonical across /api/metrics + /api/pnl-breakdown.
const CAT = {
  PAYROLL_FIELD: 6,
  OVERHEAD:      7,
  REVENUE:       8,
  DJC:           9,
} as const;

export interface PnlAccount {
  account_no: number;
  division: string;
  description: string;
  total: number;
  /** true = depreciation / internal allocation / other non-cash. Drives the
   *  cash vs non-cash subgroup split in PnlBreakdownTable. */
  is_non_cash: boolean;
}

export interface PnlCategoryGroup {
  /** All activity, including non-cash — matches prior contract. */
  total: number;
  /** Sum across accounts where is_non_cash = false. */
  cash_total: number;
  /** Sum across accounts where is_non_cash = true. Zero for categories
   *  without any flagged accounts (Revenue always; expense cats when the
   *  user hasn't flagged anything). */
  non_cash_total: number;
  accounts: PnlAccount[];
}

export interface PnlBreakdownResponse {
  revenue: PnlCategoryGroup;
  direct_job_costs: PnlCategoryGroup;
  payroll_field: PnlCategoryGroup;
  overhead: PnlCategoryGroup;
  /** Accrual basis — includes non-cash expenses. */
  operating_income: number;
  /** Cash basis — revenue cash_total minus cash costs. Always >=
   *  operating_income when any expense category has non-cash lines. */
  cash_operating_income: number;
  fiscal_year: number;
  month: string | null;
}

// GET /api/pnl-breakdown?fiscal_year=2025[&month=2025-03]
// Per-account signed P&L activity for categories 6,7,8,9, filtered by
// weeks.fiscal_year (+ optional TO_CHAR(week_ending,'YYYY-MM') = month).
// Also surfaces is_non_cash per account + cash/non-cash subtotals.
export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(req.url);

    const fyRaw = searchParams.get("fiscal_year");
    const monthRaw = searchParams.get("month");
    if (!fyRaw || !/^\d{4}$/.test(fyRaw)) {
      return NextResponse.json(
        { error: "fiscal_year (YYYY) is required" },
        { status: 400 }
      );
    }
    const fiscalYear = parseInt(fyRaw, 10);
    const month = monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : null;

    // Account-level rollup. Period-activity ONLY (no end_balance). Sign flip
    // is hardcoded by category_id instead of gl_accounts.normal_balance so
    // a mis-configured revenue account (normal_balance='debit') can't
    // render as a large negative.
    //   cat 8 (Revenue):                             period_credit − period_debit
    //   cat 6 / 7 / 9 (Payroll Field / OH / DJC):    period_debit − period_credit
    // HAVING hides dormant accounts that have zero activity in the window.
    // is_non_cash is fetched alongside the other account fields so the JS
    // bucketing below can split cash vs non-cash in one pass.
    const rows = await sql`
      SELECT
        ga.category_id,
        ga.account_no,
        ga.division,
        ga.description,
        ga.is_non_cash,
        SUM(
          CASE
            WHEN ga.category_id = ${CAT.REVENUE} THEN wb.period_credit - wb.period_debit
            ELSE wb.period_debit - wb.period_credit
          END
        )::numeric AS signed_total
      FROM weekly_balances wb
      JOIN gl_accounts ga ON ga.id = wb.gl_account_id
      JOIN weeks w        ON w.week_ending = wb.week_ending
      WHERE ga.category_id IN (${CAT.PAYROLL_FIELD}, ${CAT.OVERHEAD}, ${CAT.REVENUE}, ${CAT.DJC})
        AND ga.is_active = true
        AND w.fiscal_year = ${fiscalYear}::int
        AND (${month}::text IS NULL OR TO_CHAR(w.week_ending, 'YYYY-MM') = ${month}::text)
      GROUP BY ga.category_id, ga.account_no, ga.division, ga.description, ga.is_non_cash
      HAVING SUM(wb.period_debit + wb.period_credit) > 0
      ORDER BY ga.category_id ASC, signed_total DESC
    `;

    const groups: Record<number, PnlCategoryGroup> = {
      [CAT.PAYROLL_FIELD]: { total: 0, cash_total: 0, non_cash_total: 0, accounts: [] },
      [CAT.OVERHEAD]:      { total: 0, cash_total: 0, non_cash_total: 0, accounts: [] },
      [CAT.REVENUE]:       { total: 0, cash_total: 0, non_cash_total: 0, accounts: [] },
      [CAT.DJC]:           { total: 0, cash_total: 0, non_cash_total: 0, accounts: [] },
    };

    // Display values are positive magnitudes — the category's sign is
    // implicit (Revenue adds, cost categories subtract). Wrapping in
    // Math.abs guards against legitimate negative weeks (e.g. a refund-
    // heavy week) masquerading as the sign of an accounting mistake.
    for (const r of rows) {
      const cid = Number(r.category_id);
      const displayTotal = Math.abs(parseFloat(String(r.signed_total)));
      const isNonCash = Boolean(r.is_non_cash);
      if (!groups[cid]) continue;
      groups[cid].accounts.push({
        account_no: Number(r.account_no),
        division: String(r.division ?? ""),
        description: String(r.description ?? ""),
        total: displayTotal,
        is_non_cash: isNonCash,
      });
      groups[cid].total += displayTotal;
      if (isNonCash) {
        groups[cid].non_cash_total += displayTotal;
      } else {
        groups[cid].cash_total += displayTotal;
      }
    }

    // Re-sort per-category by display value (desc) — the SQL ORDER BY was
    // on signed_total which isn't the same order after the Math.abs above.
    for (const cid of Object.keys(groups) as unknown as number[]) {
      groups[cid].accounts.sort((a, b) => b.total - a.total);
    }

    const revenue          = groups[CAT.REVENUE];
    const direct_job_costs = groups[CAT.DJC];
    const payroll_field    = groups[CAT.PAYROLL_FIELD];
    const overhead         = groups[CAT.OVERHEAD];

    // Op Income = Revenue − all cost buckets (accrual, includes non-cash).
    const operating_income =
      revenue.total -
      direct_job_costs.total -
      payroll_field.total -
      overhead.total;

    // Cash Op Income strips non-cash expenses out of the cost side. Revenue
    // uses its cash_total — which equals revenue.total whenever no revenue
    // accounts are flagged non_cash (the normal case).
    const cash_operating_income =
      revenue.cash_total -
      direct_job_costs.cash_total -
      payroll_field.cash_total -
      overhead.cash_total;

    const body: PnlBreakdownResponse = {
      revenue,
      direct_job_costs,
      payroll_field,
      overhead,
      operating_income,
      cash_operating_income,
      fiscal_year: fiscalYear,
      month,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error("GET /api/pnl-breakdown error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
