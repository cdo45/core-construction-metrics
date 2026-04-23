import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportAccount {
  gl_account_id: number;
  account_no: number;
  description: string;
  beg_balance: number;
  end_balance: number;
  change: number;
  change_pct: number;
}

export interface ReportCategory {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  current_total: number;
  prior_total: number;
  change: number;
  change_pct: number;
  accounts: ReportAccount[];
}

export interface ReportRatios {
  /** AR / AP — how well receivables cover payables */
  ar_to_ap: number | null;
  /** Cash / AP — weeks of AP coverage if no new cash in */
  cash_coverage_weeks: number | null;
  /** Cash / Payroll — weeks of payroll runway */
  payroll_coverage: number | null;
  /** Net position: Cash − AP − Payroll */
  net_liquidity: number;
  /** (Cash + AR) / (AP + Payroll) — broad liquidity ratio */
  current_ratio: number | null;
  /** Cash / (AP + Payroll) — quick ratio (cash-only) */
  quick_ratio: number | null;
}

export interface WeeklyReportData {
  week_ending: string;
  prior_week_ending: string | null;
  categories: ReportCategory[];
  ratios: ReportRatios;
  prior_ratios: ReportRatios | null;
}

// ─── Helper: safe numeric parse ───────────────────────────────────────────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

function safeDivide(a: number, b: number): number | null {
  if (b === 0) return null;
  return a / b;
}

// ─── Build ratios from category totals ───────────────────────────────────────

function buildRatios(
  cash: number,
  ar: number,
  ap: number,
  payroll: number
): ReportRatios {
  const liabilities = ap + payroll;
  const assets = cash + ar;
  return {
    ar_to_ap:            safeDivide(ar, ap),
    cash_coverage_weeks: safeDivide(cash, ap / 52),   // weeks of AP coverage
    payroll_coverage:    safeDivide(cash, payroll / 52), // weeks of payroll runway
    net_liquidity:       cash - ap - payroll,
    current_ratio:       safeDivide(assets, liabilities),
    quick_ratio:         safeDivide(cash, liabilities),
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weekEnding = searchParams.get("week_ending");

  if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
    return NextResponse.json(
      { error: "week_ending (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  try {
    const sql = getDb();

    // ── 1. Balances for requested week ────────────────────────────────────────
    const currentRows = await sql`
      SELECT
        wb.gl_account_id,
        g.account_no,
        g.description,
        c.id         AS category_id,
        c.name       AS category_name,
        c.color      AS category_color,
        c.sort_order AS category_sort_order,
        wb.beg_balance::numeric AS beg_balance,
        wb.end_balance::numeric AS end_balance
      FROM weekly_balances wb
      JOIN  gl_accounts g ON g.id = wb.gl_account_id
      LEFT JOIN categories c ON c.id = g.category_id
      WHERE wb.week_ending = ${weekEnding}
        AND g.is_active = true
      ORDER BY c.sort_order NULLS LAST, g.account_no
    `;

    if (currentRows.length === 0) {
      return NextResponse.json(
        { error: "No balance data found for this week" },
        { status: 404 }
      );
    }

    // ── 2. Prior week ─────────────────────────────────────────────────────────
    const priorWeekRows = await sql`
      SELECT DISTINCT week_ending::text
      FROM weekly_balances
      WHERE week_ending < ${weekEnding}
      ORDER BY week_ending DESC
      LIMIT 1
    `;
    const priorWeekEnding: string | null =
      priorWeekRows[0]?.week_ending ?? null;

    let priorRows: typeof currentRows = [];
    if (priorWeekEnding) {
      priorRows = await sql`
        SELECT
          wb.gl_account_id,
          wb.beg_balance::numeric AS beg_balance,
          wb.end_balance::numeric AS end_balance
        FROM weekly_balances wb
        WHERE wb.week_ending = ${priorWeekEnding}
      `;
    }

    // Index prior rows by gl_account_id for quick lookup
    const priorMap = new Map<number, { beg: number; end: number }>();
    for (const r of priorRows) {
      priorMap.set(Number(r.gl_account_id), {
        beg: n(r.beg_balance),
        end: n(r.end_balance),
      });
    }

    // ── 3. Build category groups (keyed by category_id, with -1 for null) ────
    const UNCATEGORIZED_ID = -1;
    const catMap = new Map<
      number,
      {
        id: number;
        name: string;
        color: string;
        sort_order: number;
        accounts: ReportAccount[];
        prior_total: number;
      }
    >();

    for (const row of currentRows) {
      const rawId = row.category_id;
      const catId = rawId !== null && rawId !== undefined ? Number(rawId) : UNCATEGORIZED_ID;
      const catName = (row.category_name as string | null) ?? "Uncategorized";
      const catColor = (row.category_color as string | null) ?? "#6B7280";
      const catSort = row.category_sort_order !== null ? Number(row.category_sort_order) : 999;
      const glId = Number(row.gl_account_id);
      const beg = n(row.beg_balance);
      const end = n(row.end_balance);
      const change = end - beg;
      const change_pct = beg !== 0 ? (change / Math.abs(beg)) * 100 : 0;

      if (!catMap.has(catId)) {
        catMap.set(catId, {
          id: catId,
          name: catName,
          color: catColor,
          sort_order: catSort,
          accounts: [],
          prior_total: 0,
        });
      }

      const prior = priorMap.get(glId);
      const priorEnd = prior ? prior.end : 0;
      catMap.get(catId)!.prior_total += priorEnd;
      catMap.get(catId)!.accounts.push({
        gl_account_id: glId,
        account_no: Number(row.account_no),
        description: String(row.description),
        beg_balance: beg,
        end_balance: end,
        change,
        change_pct,
      });
    }

    const categories: ReportCategory[] = Array.from(catMap.values())
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((cat) => {
        const current_total = cat.accounts.reduce((s, a) => s + a.end_balance, 0);
        const prior_total = cat.prior_total;
        const change = current_total - prior_total;
        const change_pct =
          prior_total !== 0 ? (change / Math.abs(prior_total)) * 100 : 0;
        cat.accounts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        return {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          sort_order: cat.sort_order,
          current_total,
          prior_total,
          change,
          change_pct,
          accounts: cat.accounts,
        };
      });

    // ── 4. Build ratios — lookup by category_id, not name ────────────────────
    const CAT_ID = { CASH: 1, AR: 2, CURRENT_DEBT: 3, PAYROLL_LIAB: 5 };
    const catById = (id: number) =>
      categories.find((c) => c.id === id)?.current_total ?? 0;
    const priorCatTotal = (id: number) =>
      categories.find((c) => c.id === id)?.prior_total ?? 0;

    const cash    = catById(CAT_ID.CASH);
    const ar      = catById(CAT_ID.AR);
    const ap      = catById(CAT_ID.CURRENT_DEBT);
    const payroll = catById(CAT_ID.PAYROLL_LIAB);

    const ratios = buildRatios(cash, ar, ap, payroll);

    let prior_ratios: ReportRatios | null = null;
    if (priorWeekEnding) {
      const pCash    = priorCatTotal(CAT_ID.CASH);
      const pAR      = priorCatTotal(CAT_ID.AR);
      const pAP      = priorCatTotal(CAT_ID.CURRENT_DEBT);
      const pPayroll = priorCatTotal(CAT_ID.PAYROLL_LIAB);
      prior_ratios = buildRatios(pCash, pAR, pAP, pPayroll);
    }

    const response: WeeklyReportData = {
      week_ending: weekEnding,
      prior_week_ending: priorWeekEnding,
      categories,
      ratios,
      prior_ratios,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/weekly-report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
