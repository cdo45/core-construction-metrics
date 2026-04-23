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
}

export interface PnlCategoryGroup {
  total: number;
  accounts: PnlAccount[];
}

export interface PnlBreakdownResponse {
  revenue: PnlCategoryGroup;
  direct_job_costs: PnlCategoryGroup;
  payroll_field: PnlCategoryGroup;
  overhead: PnlCategoryGroup;
  operating_income: number;
  fiscal_year: number;
  month: string | null;
}

// GET /api/pnl-breakdown?fiscal_year=2025[&month=2025-03]
// Per-account signed P&L activity for categories 6,7,8,9, filtered by
// weeks.fiscal_year (+ optional TO_CHAR(week_ending,'YYYY-MM') = month).
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

    // Account-level rollup. HAVING clause hides dormant accounts that landed
    // under a P&L category but had no activity in the filtered window.
    const rows = await sql`
      SELECT
        ga.category_id,
        ga.account_no,
        ga.division,
        ga.description,
        SUM(
          CASE
            WHEN ga.normal_balance = 'credit' THEN wb.period_credit - wb.period_debit
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
      GROUP BY ga.category_id, ga.account_no, ga.division, ga.description
      HAVING SUM(wb.period_debit + wb.period_credit) > 0
      ORDER BY ga.category_id ASC, signed_total DESC
    `;

    const groups: Record<number, PnlCategoryGroup> = {
      [CAT.PAYROLL_FIELD]: { total: 0, accounts: [] },
      [CAT.OVERHEAD]:      { total: 0, accounts: [] },
      [CAT.REVENUE]:       { total: 0, accounts: [] },
      [CAT.DJC]:           { total: 0, accounts: [] },
    };

    for (const r of rows) {
      const cid = Number(r.category_id);
      const total = parseFloat(String(r.signed_total));
      if (!groups[cid]) continue;
      groups[cid].accounts.push({
        account_no: Number(r.account_no),
        division: String(r.division ?? ""),
        description: String(r.description ?? ""),
        total,
      });
      groups[cid].total += total;
    }

    const revenue         = groups[CAT.REVENUE];
    const direct_job_costs = groups[CAT.DJC];
    const payroll_field   = groups[CAT.PAYROLL_FIELD];
    const overhead        = groups[CAT.OVERHEAD];

    const operating_income =
      revenue.total -
      direct_job_costs.total -
      payroll_field.total -
      overhead.total;

    const body: PnlBreakdownResponse = {
      revenue,
      direct_job_costs,
      payroll_field,
      overhead,
      operating_income,
      fiscal_year: fiscalYear,
      month,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error("GET /api/pnl-breakdown error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
