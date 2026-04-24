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
  /** true = depreciation / internal allocation / other non-cash. */
  is_non_cash: boolean;
  /** true = internal cost transfer (e.g. 6050 ALLOCATED EQ. COSTS). The
   *  underlying cash was already spent against other accounts, so these
   *  are display-only and do NOT flow into the cash-op-income add-back.
   *  Only meaningful when is_non_cash is true. */
  is_allocation: boolean;
}

export interface PnlCategoryGroup {
  /** All activity, including non-cash — matches prior contract. */
  total: number;
  /** Sum across accounts where is_non_cash = false. */
  cash_total: number;
  /** Sum across accounts where is_non_cash = true. Still equals
   *  depreciation_total + allocation_total for backwards compat. */
  non_cash_total: number;
  /** True non-cash (is_non_cash = true AND is_allocation = false).
   *  Drives the cash_operating_income add-back. */
  depreciation_total: number;
  /** Internal transfers (is_non_cash = true AND is_allocation = true).
   *  Display-only; never added back. */
  allocation_total: number;
  accounts: PnlAccount[];
}

export interface PnlBreakdownResponse {
  revenue: PnlCategoryGroup;
  direct_job_costs: PnlCategoryGroup;
  payroll_field: PnlCategoryGroup;
  overhead: PnlCategoryGroup;
  /** Accrual basis — includes non-cash expenses. */
  operating_income: number;
  /** Cash basis. Adds back DEPRECIATION only (not allocations):
   *    cash_operating_income = operating_income + Σ depreciation_total
   *  Allocations stay subtracted because their underlying cash was
   *  already spent via other accounts. */
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
    // is_non_cash + is_allocation are fetched alongside the other fields so
    // the JS bucketing below can split cash / depreciation / allocation
    // in one pass.
    const rows = await sql`
      SELECT
        ga.category_id,
        ga.account_no,
        ga.division,
        ga.description,
        ga.is_non_cash,
        ga.is_allocation,
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
      GROUP BY ga.category_id, ga.account_no, ga.division, ga.description,
               ga.is_non_cash, ga.is_allocation
      HAVING SUM(wb.period_debit + wb.period_credit) > 0
      ORDER BY ga.category_id ASC, signed_total DESC
    `;

    const groups: Record<number, PnlCategoryGroup> = {
      [CAT.PAYROLL_FIELD]: { total: 0, cash_total: 0, non_cash_total: 0, depreciation_total: 0, allocation_total: 0, accounts: [] },
      [CAT.OVERHEAD]:      { total: 0, cash_total: 0, non_cash_total: 0, depreciation_total: 0, allocation_total: 0, accounts: [] },
      [CAT.REVENUE]:       { total: 0, cash_total: 0, non_cash_total: 0, depreciation_total: 0, allocation_total: 0, accounts: [] },
      [CAT.DJC]:           { total: 0, cash_total: 0, non_cash_total: 0, depreciation_total: 0, allocation_total: 0, accounts: [] },
    };

    // Per-account display values:
    //   - Revenue & non-allocation expenses → Math.abs(signed_total).
    //     These are "magnitudes": revenue adds, costs subtract, and the
    //     category orientation is implicit. Math.abs guards against a
    //     stray negative week flipping a line red by mistake.
    //   - Allocations (is_allocation = true) → PRESERVE SIGN. Allocation
    //     accounts carry credits that offset costs OUT of the category
    //     (e.g. 6050 ALLOCATED EQ. COSTS with a $145K credit to DJC Div
    //     10 means $145K was moved out of that division). If we ABS'd
    //     them, the negative offset would flip positive and inflate the
    //     category total. Keeping the sign lets DJC.total correctly
    //     equal "real DJC − allocations out".
    // The aggregates below propagate from these per-account totals:
    //   total              signed sum (allocations subtract naturally)
    //   cash_total         Math.abs, is_non_cash = false
    //   depreciation_total Math.abs, is_non_cash = true AND NOT is_allocation
    //   allocation_total   SIGNED, is_allocation = true
    //   non_cash_total     = depreciation_total + allocation_total
    //                       (mixed sign; backwards-compat)
    for (const r of rows) {
      const cid = Number(r.category_id);
      const rawSigned = parseFloat(String(r.signed_total));
      const isNonCash = Boolean(r.is_non_cash);
      // is_allocation only matters when is_non_cash is true; coerce to
      // false otherwise so a stray flag on a cash row can't leak into the
      // allocation bucket.
      const isAllocation = isNonCash && Boolean(r.is_allocation);
      const accountTotal = isAllocation ? rawSigned : Math.abs(rawSigned);
      if (!groups[cid]) continue;
      groups[cid].accounts.push({
        account_no: Number(r.account_no),
        division: String(r.division ?? ""),
        description: String(r.description ?? ""),
        total: accountTotal,
        is_non_cash: isNonCash,
        is_allocation: isAllocation,
      });
      groups[cid].total += accountTotal;
      if (isNonCash) {
        groups[cid].non_cash_total += accountTotal;
        if (isAllocation) {
          groups[cid].allocation_total += accountTotal; // signed
        } else {
          groups[cid].depreciation_total += accountTotal; // magnitude
        }
      } else {
        groups[cid].cash_total += accountTotal;
      }
    }

    // Re-sort per-category by display value (desc). With signed allocation
    // totals, they'll naturally fall to the bottom of a cost category
    // (typically negative) — matches the visual grouping in the UI where
    // allocations render below depreciation below cash.
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

    // Cash Op Income adds back DEPRECIATION only. Allocations are internal
    // transfers whose underlying cash was already spent via other accounts,
    // so adding them back would overstate cash. Revenue's own depreciation_
    // total is effectively zero for normal data — included for symmetry.
    const depreciationAddBack =
      revenue.depreciation_total +
      direct_job_costs.depreciation_total +
      payroll_field.depreciation_total +
      overhead.depreciation_total;

    const cash_operating_income = operating_income + depreciationAddBack;

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
