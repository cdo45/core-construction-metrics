import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isActiveWeek, lastActiveWeeks } from "@/lib/active-weeks";

// ─── Category IDs (must match DB categories table) ───────────────────────────
// Using category_id throughout this route to avoid name-based fragility.

export const CAT = {
  CASH:          1,
  AR:            2,
  CURRENT_DEBT:  3,
  LT_DEBT:       4,
  PAYROLL_LIAB:  5,
  PAYROLL_FIELD: 6,
  OVERHEAD:      7,
  REVENUE:       8,
  DJC:           9,
} as const;

// ─── Specific account pulls ──────────────────────────────────────────────────
// These accounts drive the user-facing ratios. The category totals (cat 3,
// cat 5) also get ABS'd for display but aren't used in the ratios anymore —
// the ratios operate on AP (2005) + payroll accruals (2150-2166) specifically.
const ACCT_AP = 2005;                         // A/P Trade
const ACCT_PAYROLL_ACCRUALS_MIN = 2150;
const ACCT_PAYROLL_ACCRUALS_MAX = 2166;
const ACCT_PAYROLL_RUN_DIRECT = 5101;         // Direct labor
const ACCT_PAYROLL_RUN_FIELD  = 6080;         // Field payroll

// Runway-section specific accounts. Cash collections land in operating bank
// accounts 1021/1027/1120. Payroll cash-outs span the direct-labor bucket
// plus related payroll-tax / burden accounts.
const ACCTS_CASH_COLLECTED = [1021, 1027, 1120] as const;
const ACCTS_PAYROLL_PAID   = [5101, 5210, 5220, 5250, 6080, 6100] as const;

// Line of credit — hardcoded single-facility model. Account 2050 "LINE OF
// CREDIT" (cat 3) carries the current drawn balance (credit-normal, so
// stored negative). Limit is configured in code, not in the DB; no
// facility editor.
const LOC_LIMIT = 2_000_000;
const LOC_ACCOUNT_NO = 2050;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeekMetric {
  week_ending: string; // YYYY-MM-DD
  confirmed: boolean;

  // BS — end_balance totals per category.
  // Cat 3 and 5 are ABS'd so liabilities display as positive dollars; the
  // underlying weekly_balances rows stay signed (credit-normal → negative).
  cat_1_cash: number;
  cat_2_ar: number;
  cat_3_current_debt: number;
  cat_4_lt_debt: number;
  cat_5_payroll_liab: number;

  // Specific-account display fields. AP (2005) and payroll accruals
  // (2150-2166) drive every ratio below; the whole-category sums above are
  // still exposed for dashboards that show total liabilities.
  ap: number;
  payroll_accruals: number;

  // P&L — signed period activity per category (positive when normal).
  cat_6_payroll_field: number;
  cat_7_overhead: number;
  cat_8_revenue: number;
  cat_9_djc: number;

  // Debt paydown (dollars moved off current-debt balance this week).
  // Cat 3 is credit-normal liabilities; a DEBIT post pays the balance down.
  cat_3_debt_paydown: number;

  // Derived ratios (all >= 0 for a non-upside-down company).
  //   net_liquidity       = cash − ap − payroll_accruals
  //   current_ratio       = (cash + ar) / (ap + payroll_accruals)
  //   quick_ratio         =  cash       / (ap + payroll_accruals)
  //   ar_to_ap            =  ar         /  ap
  //   cash_coverage_weeks =  cash       /  weekly_ap_burn
  //   payroll_runway_wks  =  cash       /  weekly_payroll
  net_liquidity: number;
  current_ratio: number | null;
  quick_ratio: number | null;
  ar_to_ap: number | null;
  payroll_runway_wks: number | null;
  cash_coverage_weeks: number | null;
  burn_rate_weekly: number | null;
  gross_margin_pct: number | null;
  operating_margin_pct: number | null;

  // WoW changes for BS categories
  cash_change: number | null;
  ar_change: number | null;
  current_debt_change: number | null;
  lt_debt_change: number | null;
  payroll_liab_change: number | null;
  net_liquidity_change: number | null;

  // Bid activity (passthrough, unchanged)
  bids_submitted_count: number;
  bids_submitted_value: number;
  bids_won_count: number;
  bids_won_value: number;

  // Runway-section per-week cash flows. All ABS'd, positive = money moved.
  //   weekly_cash_collected  = Σ period_debit to 1021,1027,1120
  //   weekly_ap_paid         = Σ period_debit to 2005
  //   weekly_payroll_paid    = Σ period_debit to 5101,5210,5220,5250,6080,6100
  //   weekly_overhead_paid   = Σ period_debit to cat-7 accounts
  //   weekly_revenue         = Σ period_credit to cat-8 accounts
  weekly_cash_collected: number;
  weekly_ap_paid: number;
  weekly_payroll_paid: number;
  weekly_overhead_paid: number;
  weekly_revenue: number;
}

// ─── Runway summary ──────────────────────────────────────────────────────────

export interface RunwaySummary {
  // 8-week rolling averages over active weeks only.
  //
  // Every avg_weekly_* field derives from per-week values that have ALREADY
  // been summed across divisions in SQL — see the account_weekly CTE in the
  // runway query. An account like 5101 that exists under divisions 10/20/99
  // contributes a single summed pd per week, not three separate rows. This
  // is what makes avg_weekly_payroll hit the real ~$100K/wk instead of a
  // division-sliced fraction.
  avg_weekly_collections: number;
  avg_weekly_ap_paid: number;
  avg_weekly_payroll: number;      // 8-wk smoothed payroll cash-out
  avg_weekly_overhead: number;
  avg_weekly_burn: number;         // ap + payroll + overhead (all smoothed)
  avg_weekly_revenue: number;
  collection_efficiency: number | null; // collections / revenue
  weeks_of_runway: number | null;       // current_cash / avg_weekly_burn
  coast_weekly: number;                 // burn (what to collect to stay flat)
  grow_weekly: number;                  // coast + growth_target_pct * revenue
  growth_target_pct: number;            // echo of input (0..1)
  current_cash: number;                 // anchor week's cat_1_cash
  anchor_week_ending: string | null;
}

// ─── Trend series (sparklines) ───────────────────────────────────────────────
// Per-metric time-series used by the sparkline renderer next to each KPI
// card. Granularity follows the filter:
//   month set        → one point per active week in that month (~4-5 pts)
//   fiscal_year set  → one point per month in that FY (up to 12 pts)
//   no filter        → one point per month in the latest FY (default)
//
// Per-period values:
//   Balance-sheet (cash/ar/ap/net_liquidity/working_capital): end-of-period
//     snapshot from the LAST active week in the period.
//   P&L (revenue, margins): SUM of per-week period activity within the
//     period; margins derived from those summed totals.
//   Ratios (current/quick/ar_to_ap): taken from the last active week's
//     pre-computed ratio — they already reflect EOM snapshots.
//   Weeks (runway/coverage/payroll_runway): last active week's values.

export interface TrendPoint {
  period_label: string;
  value: number;
}

export interface TrendSeries {
  cash: TrendPoint[];
  ar: TrendPoint[];
  ap: TrendPoint[];
  net_liquidity: TrendPoint[];
  working_capital: TrendPoint[]; // cash + ar − ap
  current_ratio: TrendPoint[];
  quick_ratio: TrendPoint[];
  ar_to_ap: TrendPoint[];
  weeks_of_runway: TrendPoint[];
  cash_coverage_weeks: TrendPoint[];
  payroll_runway_wks: TrendPoint[];
  revenue: TrendPoint[];
  gross_margin_pct: TrendPoint[];
  operating_margin_pct: TrendPoint[];
  // Runway-section series (per-period sums of weekly cash flows).
  weekly_collections: TrendPoint[];
  weekly_burn: TrendPoint[];
  net_cash_flow: TrendPoint[];
  coast_weekly: TrendPoint[]; // = weekly_burn (shown as weekly rate)
  grow_weekly: TrendPoint[];  // coast + growth_target * weekly revenue
}

export interface Benchmarks {
  current_ratio: number;
  quick_ratio: number;
  ar_to_ap: number;
  weeks_of_runway: number;
  cash_coverage_weeks: number;
  payroll_runway_wks: number;
}

// Industry-standard thresholds used as the dotted reference line on
// ratio / weeks sparklines. Conservative values; user can tune later.
const BENCHMARKS: Benchmarks = {
  current_ratio: 1.5,
  quick_ratio: 1.0,
  ar_to_ap: 1.0,
  weeks_of_runway: 12,
  cash_coverage_weeks: 4,
  payroll_runway_wks: 8,
};

// ─── KPI drilldowns ──────────────────────────────────────────────────────────
//
// Click-to-expand backing data for every KPI card on the dashboard. Each entry
// carries the formula (plain English), the inputs that fed it, the literal
// arithmetic, and — where applicable — the rolling-average week-by-week
// breakdown and the contributing source accounts. The dashboard shells render
// this verbatim; no client-side recomputation happens.

export type DrilldownInputFormat = "money" | "ratio" | "pct" | "weeks" | "int";
export type DrilldownBreakdownFormat = "money" | "int";

export interface DrilldownInput {
  label: string;
  value: number;
  format: DrilldownInputFormat;
  note?: string;
}

export interface DrilldownBreakdownRow {
  label: string;
  value: number;
  format: DrilldownBreakdownFormat;
}

export interface DrilldownBreakdown {
  title: string;
  rows: DrilldownBreakdownRow[];
  aggregate_label: string;
  aggregate_value: number;
  methodology_note?: string;
}

export interface DrilldownAccountSource {
  account_no: number;
  division: string | null;
  description: string;
  contribution: number;
}

export interface DrilldownComputation {
  expression: string;
  result: string;
}

export interface DrilldownData {
  formula_plain: string;
  formula_latex?: string;
  result: number;
  inputs: DrilldownInput[];
  computation: DrilldownComputation;
  breakdown?: DrilldownBreakdown;
  account_sources?: DrilldownAccountSource[];
}

export type DrilldownMap = Record<string, DrilldownData>;

export interface MonthMetric {
  month: string; // "YYYY-MM"
  avg_cat_1_cash: number;
  avg_cat_2_ar: number;
  avg_cat_3_current_debt: number;
  avg_cat_5_payroll_liab: number;
  avg_net_liquidity: number;
  total_cat_8_revenue: number;
  total_cat_9_djc: number;
  total_bids_submitted_value: number;
  total_bids_won_value: number;
  win_rate_pct: number;
}

// ─── P&L window totals ───────────────────────────────────────────────────────
//
// Computed over the entire filter window (FY + optional month). These are
// the numbers the KPI cards should show when the user asks "how much
// revenue did we do in FY 2025?" — NOT the latest week's P&L alone.
//
// All totals are non-negative (Math.abs applied). Margin is null when the
// denominator is 0 to avoid divide-by-zero.
export interface PnlSummary {
  revenue: number;
  djc: number;
  payroll_field: number;
  overhead: number;
  operating_income: number;
  gross_margin_pct: number | null;       // (revenue − djc) / revenue
  operating_margin_pct: number | null;   // operating_income / revenue
}

export interface MetricsResponse {
  weeks: WeekMetric[];
  months: MonthMetric[];
  runway: RunwaySummary;
  pnl: PnlSummary;
  // Line of credit snapshot, anchored to the last active week in the
  // filter window. See LOC_LIMIT / LOC_ACCOUNT_NO constants at top.
  //   loc_drawn   = ABS(end_balance of 2050) at anchor week
  //   loc_undrawn = max(0, loc_limit − loc_drawn)
  loc_limit: number;
  loc_drawn: number;
  loc_undrawn: number;
  // Per-metric time-series for sparklines. Granularity reflects the
  // active filter (see TrendSeries docs above).
  trend_series: TrendSeries;
  trend_granularity: "week" | "month";
  benchmarks: Benchmarks;
  // Click-to-expand backing data for every KPI card (formula, inputs,
  // computation, rolling-window breakdown, source accounts).
  drilldowns: DrilldownMap;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

function safeDiv(a: number, b: number): number | null {
  if (b === 0) return null;
  return a / b;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();

    // ── Query-param filtering ────────────────────────────────────────────────
    // fiscal_year comes from the weeks table (auto-computed on auto-create);
    // we never compute it off week_ending year so year-boundary partial weeks
    // stay grouped with their dateBooked year.
    // month is a YYYY-MM string used as TO_CHAR(week_ending, 'YYYY-MM').
    const { searchParams } = new URL(req.url);
    const fyRaw = searchParams.get("fiscal_year");
    const monthRaw = searchParams.get("month");
    const gtRaw = searchParams.get("growth_target_pct");
    const fyFilter = fyRaw && /^\d{4}$/.test(fyRaw) ? parseInt(fyRaw, 10) : null;
    const monthFilter = monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : null;
    // growth_target_pct accepts a decimal (0.10) OR an int-as-pct (10) for
    // convenience. Clamp to [0, 1]. Default 0.10.
    let growthTargetPct = 0.10;
    if (gtRaw !== null && gtRaw !== "") {
      const parsed = parseFloat(gtRaw);
      if (isFinite(parsed)) {
        growthTargetPct = parsed > 1 ? parsed / 100 : parsed;
        if (growthTargetPct < 0) growthTargetPct = 0;
        if (growthTargetPct > 1) growthTargetPct = 1;
      }
    }

    // Single query: one row per (week, category) with sums.
    // Always JOIN fresh so changing gl_accounts.category_id retroactively
    // reclassifies history without any data migration.
    // Filters are applied at the weeks JOIN; if both params are null they
    // become no-ops (the ($x::text IS NULL OR …) pattern).
    const rawRollups = await sql`
      SELECT
        wb.week_ending::text AS week_ending,
        ga.category_id,
        SUM(wb.end_balance)::numeric   AS cat_end,
        SUM(wb.period_debit)::numeric  AS cat_pd,
        SUM(wb.period_credit)::numeric AS cat_pc
      FROM weekly_balances wb
      JOIN gl_accounts ga ON ga.id = wb.gl_account_id
      JOIN weeks w         ON w.week_ending = wb.week_ending
      WHERE ga.category_id IS NOT NULL
        AND ga.is_active = true
        AND (${fyFilter}::int  IS NULL OR w.fiscal_year = ${fyFilter}::int)
        AND (${monthFilter}::text IS NULL OR TO_CHAR(w.week_ending, 'YYYY-MM') = ${monthFilter}::text)
      GROUP BY wb.week_ending, ga.category_id
      ORDER BY wb.week_ending ASC, ga.category_id ASC
    `;

    const weekRows = await sql`
      SELECT week_ending::text AS week_ending, is_confirmed
      FROM weeks
      WHERE (${fyFilter}::int  IS NULL OR fiscal_year = ${fyFilter}::int)
        AND (${monthFilter}::text IS NULL OR TO_CHAR(week_ending, 'YYYY-MM') = ${monthFilter}::text)
      ORDER BY week_ending ASC
    `;
    const confirmedMap = new Map<string, boolean>();
    for (const r of weekRows) {
      confirmedMap.set(String(r.week_ending), Boolean(r.is_confirmed));
    }

    const bidRows = await sql`
      SELECT week_ending::text AS week_ending,
             bids_submitted_count, bids_submitted_value,
             bids_won_count, bids_won_value
      FROM bid_activity
    `;
    const bidMap = new Map<string, {
      submitted_count: number; submitted_value: number;
      won_count: number; won_value: number;
    }>();
    for (const r of bidRows) {
      bidMap.set(String(r.week_ending), {
        submitted_count: n(r.bids_submitted_count),
        submitted_value: n(r.bids_submitted_value),
        won_count:       n(r.bids_won_count),
        won_value:       n(r.bids_won_value),
      });
    }

    // Group rollup rows by week → {categoryId: {end, pd, pc}}
    const perWeek = new Map<string, Map<number, { end: number; pd: number; pc: number }>>();
    for (const r of rawRollups) {
      const wk = String(r.week_ending);
      const cid = Number(r.category_id);
      if (!perWeek.has(wk)) perWeek.set(wk, new Map());
      perWeek.get(wk)!.set(cid, {
        end: n(r.cat_end),
        pd:  n(r.cat_pd),
        pc:  n(r.cat_pc),
      });
    }

    // ── Specific-account rollup ─────────────────────────────────────────────
    // Ratios + runway share this query so the DB only does the JOIN once.
    // Accounts included:
    //   2005                      A/P Trade              (ratios + runway)
    //   2050                      Line of Credit          (LOC toggle)
    //   2150-2166 (range)          Payroll accruals       (ratios)
    //   5101, 6080                 Labor + field          (ratios + runway)
    //   1021, 1027, 1120           Cash collection deposits (runway)
    //   5210, 5220, 5250, 6100     Payroll-related debits  (runway)
    const runwayAccountList = [
      ACCT_AP,
      LOC_ACCOUNT_NO,
      ACCT_PAYROLL_RUN_DIRECT,
      ACCT_PAYROLL_RUN_FIELD,
      ...ACCTS_CASH_COLLECTED,
      ...ACCTS_PAYROLL_PAID,
    ];
    // Pre-aggregate by (account_no, week_ending) in an explicit CTE BEFORE
    // any downstream averaging. Each gl_account row is (account_no, division)
    // unique — an account like 5101 may have separate rows for division 10,
    // 20, and 99. The CTE collapses those into a single per-week total so the
    // JS rolling average sees ONE number per (account_no, week), not one per
    // (account_no, division, week). Without this collapse, the 8-week payroll
    // avg divides a divisional slice instead of the whole-company total, and
    // the Weekly Burn card understates reality (bug: $17K/wk displayed vs
    // $100K/wk actual).
    const acctRollups = await sql`
      WITH account_weekly AS (
        SELECT
          wb.week_ending::text AS week_ending,
          ga.account_no,
          SUM(wb.end_balance)::numeric   AS end_sum,
          SUM(wb.period_debit)::numeric  AS pd_sum,
          SUM(wb.period_credit)::numeric AS pc_sum
        FROM weekly_balances wb
        JOIN gl_accounts ga ON ga.id = wb.gl_account_id
        JOIN weeks w        ON w.week_ending = wb.week_ending
        WHERE ga.is_active = true
          AND (
            ga.account_no = ANY(${runwayAccountList}::int[])
            OR ga.account_no BETWEEN ${ACCT_PAYROLL_ACCRUALS_MIN} AND ${ACCT_PAYROLL_ACCRUALS_MAX}
          )
          AND (${fyFilter}::int  IS NULL OR w.fiscal_year = ${fyFilter}::int)
          AND (${monthFilter}::text IS NULL OR TO_CHAR(w.week_ending, 'YYYY-MM') = ${monthFilter}::text)
        GROUP BY wb.week_ending, ga.account_no
      )
      SELECT week_ending, account_no, end_sum, pd_sum, pc_sum
      FROM account_weekly
    `;

    // Per-week per-account: { end, pd, pc } keyed by week_ending → account_no.
    const perWeekAcct = new Map<string, Map<number, { end: number; pd: number; pc: number }>>();
    for (const r of acctRollups) {
      const wk = String(r.week_ending);
      const acct = Number(r.account_no);
      if (!perWeekAcct.has(wk)) perWeekAcct.set(wk, new Map());
      perWeekAcct.get(wk)!.set(acct, {
        end: n(r.end_sum),
        pd:  n(r.pd_sum),
        pc:  n(r.pc_sum),
      });
    }

    // Build ordered list of week_ending strings. Union of weekly_balances
    // rollup weeks and weeks-table rows.
    const weekEndingSet = new Set<string>();
    for (const wk of perWeek.keys()) weekEndingSet.add(wk);
    for (const wk of confirmedMap.keys()) weekEndingSet.add(wk);
    const orderedWeeks = Array.from(weekEndingSet).sort();

    // Per-week aggregation with sign normalization for dashboard display.
    //   Sign rules (raw → displayed):
    //     cat 1 Cash            → keep as-is (debit-normal, positive)
    //     cat 2 AR              → keep as-is
    //     cat 3 Current Debt    → ABS (credit-normal liabilities)
    //     cat 4 LT Debt         → keep as-is (stored debit or credit depending
    //                             on account; UI shows whatever sign comes)
    //     cat 5 Payroll Liab    → ABS
    //     cat 6 Payroll Field   → already positive via plSigned (expense up)
    //     cat 7 Overhead        → already positive via plSigned
    //     cat 8 Revenue         → ABS (belt-and-suspenders on top of plSigned)
    //     cat 9 DJC             → already positive via plSigned
    //   Specific account pulls all ABS'd: ap (2005), payroll_accruals
    //   (2150-2166), the underlying series for weekly_ap_burn /
    //   weekly_payroll used in the rolling coverage metrics below.
    // Per-week aggregation preserves the sibling {_ap_period_credit,
    // _payroll_period_debit} hidden fields so the rolling avg below can
    // read them without a second pass over the DB.
    interface WeekBaseRow extends Omit<WeekMetric, "payroll_runway_wks" | "cash_coverage_weeks" | "burn_rate_weekly" | "cash_change" | "ar_change" | "current_debt_change" | "lt_debt_change" | "payroll_liab_change" | "net_liquidity_change"> {
      payroll_runway_wks: number | null;
      cash_coverage_weeks: number | null;
      burn_rate_weekly: number | null;
      cash_change: number | null;
      ar_change: number | null;
      current_debt_change: number | null;
      lt_debt_change: number | null;
      payroll_liab_change: number | null;
      net_liquidity_change: number | null;
      // Hidden rolling-window inputs. Not serialized to WeekMetric.
      _ap_period_credit: number;
      _payroll_period_debit: number;
    }

    const weeksBase: WeekBaseRow[] = orderedWeeks.map((wk) => {
      const cats = perWeek.get(wk) ?? new Map<number, { end: number; pd: number; pc: number }>();
      const get = (id: number) => cats.get(id);

      const accts = perWeekAcct.get(wk) ?? new Map<number, { end: number; pd: number; pc: number }>();
      const getAcct = (no: number) => accts.get(no);

      const cat_1_cash           =       (get(CAT.CASH)?.end          ?? 0);
      const cat_2_ar             =       (get(CAT.AR)?.end            ?? 0);
      const cat_3_current_debt   = Math.abs(get(CAT.CURRENT_DEBT)?.end ?? 0);
      const cat_4_lt_debt        =       (get(CAT.LT_DEBT)?.end       ?? 0);
      const cat_5_payroll_liab   = Math.abs(get(CAT.PAYROLL_LIAB)?.end ?? 0);

      // P&L sign flip is hardcoded by category_id, NOT by ga.normal_balance.
      // A revenue account with a mis-configured `debit` normal_balance used
      // to come back negative; hardcoding here makes the displayed number
      // independent of that data-quality hazard. All four are wrapped in
      // Math.abs for display — in normal bookkeeping the signs work out
      // positive, so |x| is a safety belt.
      //   cat 6 Payroll Field / cat 7 Overhead / cat 9 DJC: pd − pc (expense)
      //   cat 8 Revenue:                                     pc − pd
      const plExpense = (id: number) => {
        const row = get(id);
        if (!row) return 0;
        return Math.abs(row.pd - row.pc);
      };
      const plRevenue = () => {
        const row = get(CAT.REVENUE);
        if (!row) return 0;
        return Math.abs(row.pc - row.pd);
      };
      const cat_6_payroll_field = plExpense(CAT.PAYROLL_FIELD);
      const cat_7_overhead      = plExpense(CAT.OVERHEAD);
      const cat_8_revenue       = plRevenue();
      const cat_9_djc           = plExpense(CAT.DJC);

      const cat_3_debt_paydown  = get(CAT.CURRENT_DEBT)?.pd    ?? 0;

      // Specific-account positive displays.
      const ap               = Math.abs(getAcct(ACCT_AP)?.end ?? 0);
      let accrualsSum = 0;
      for (let acctNo = ACCT_PAYROLL_ACCRUALS_MIN; acctNo <= ACCT_PAYROLL_ACCRUALS_MAX; acctNo++) {
        accrualsSum += getAcct(acctNo)?.end ?? 0;
      }
      const payroll_accruals = Math.abs(accrualsSum);

      // Rolling-window inputs: weekly AP burn = credits to 2005 (bills paid);
      // weekly payroll = debits to 5101 + 6080 (labor hit the P&L).
      const _ap_period_credit     = Math.abs(getAcct(ACCT_AP)?.pc ?? 0);
      const _payroll_period_debit = Math.abs(
        (getAcct(ACCT_PAYROLL_RUN_DIRECT)?.pd ?? 0) +
        (getAcct(ACCT_PAYROLL_RUN_FIELD)?.pd ?? 0)
      );

      // Runway per-week cash flows (all ABS, positive = cash moved).
      //   collected = deposits to ops banks (debit on debit-normal assets).
      //   ap_paid   = debit to 2005 (bills paid out of cash).
      //   payroll_paid = debits to the labor + payroll-tax accounts.
      //   overhead_paid = cat-7 period_debit (expense posts; pd proxy).
      //   revenue  = cat-8 period_credit (revenue earned this week).
      let _cashCollected = 0;
      for (const a of ACCTS_CASH_COLLECTED) _cashCollected += getAcct(a)?.pd ?? 0;
      const weekly_cash_collected = Math.abs(_cashCollected);
      const weekly_ap_paid = Math.abs(getAcct(ACCT_AP)?.pd ?? 0);
      let _payrollPaid = 0;
      for (const a of ACCTS_PAYROLL_PAID) _payrollPaid += getAcct(a)?.pd ?? 0;
      const weekly_payroll_paid = Math.abs(_payrollPaid);
      const weekly_overhead_paid = Math.abs(get(CAT.OVERHEAD)?.pd ?? 0);
      const weekly_revenue       = Math.abs(get(CAT.REVENUE)?.pc ?? 0);

      // All-positive ratio inputs.
      const shortTermLiab = ap + payroll_accruals;
      const net_liquidity = cat_1_cash - ap - payroll_accruals;
      const current_ratio = safeDiv(cat_1_cash + cat_2_ar, shortTermLiab);
      const quick_ratio   = safeDiv(cat_1_cash,             shortTermLiab);
      const ar_to_ap      = safeDiv(cat_2_ar,               ap);

      // Per-week margins; rolling windows live in the second pass below.
      const gross = cat_8_revenue - cat_9_djc;
      const gross_margin_pct = cat_8_revenue !== 0 ? (gross / cat_8_revenue) * 100 : null;
      const op = cat_8_revenue - cat_9_djc - cat_6_payroll_field - cat_7_overhead;
      const operating_margin_pct = cat_8_revenue !== 0 ? (op / cat_8_revenue) * 100 : null;

      const bids = bidMap.get(wk);

      return {
        week_ending: wk,
        confirmed: confirmedMap.get(wk) ?? false,
        cat_1_cash,
        cat_2_ar,
        cat_3_current_debt,
        cat_4_lt_debt,
        cat_5_payroll_liab,
        ap,
        payroll_accruals,
        cat_6_payroll_field,
        cat_7_overhead,
        cat_8_revenue,
        cat_9_djc,
        cat_3_debt_paydown,
        net_liquidity,
        current_ratio,
        quick_ratio,
        ar_to_ap,
        gross_margin_pct,
        operating_margin_pct,
        // Filled below after we have the ordered weeks
        payroll_runway_wks:  null as number | null,
        cash_coverage_weeks: null as number | null,
        burn_rate_weekly:    null as number | null,
        cash_change:          null as number | null,
        ar_change:            null as number | null,
        current_debt_change:  null as number | null,
        lt_debt_change:       null as number | null,
        payroll_liab_change:  null as number | null,
        net_liquidity_change: null as number | null,
        bids_submitted_count: bids?.submitted_count ?? 0,
        bids_submitted_value: bids?.submitted_value ?? 0,
        bids_won_count:       bids?.won_count       ?? 0,
        bids_won_value:       bids?.won_value       ?? 0,
        weekly_cash_collected,
        weekly_ap_paid,
        weekly_payroll_paid,
        weekly_overhead_paid,
        weekly_revenue,
        // Hidden — stripped before JSON response.
        _ap_period_credit,
        _payroll_period_debit,
      };
    });

    // WoW deltas + 4-week rolling avgs for payroll runway / AP coverage /
    // burn rate. Strips hidden rolling-input fields before returning
    // WeekMetric.
    const weeks: WeekMetric[] = weeksBase.map((w, i) => {
      if (i > 0) {
        const prev = weeksBase[i - 1];
        w.cash_change          = w.cat_1_cash         - prev.cat_1_cash;
        w.ar_change            = w.cat_2_ar           - prev.cat_2_ar;
        w.current_debt_change  = w.cat_3_current_debt - prev.cat_3_current_debt;
        w.lt_debt_change       = w.cat_4_lt_debt      - prev.cat_4_lt_debt;
        w.payroll_liab_change  = w.cat_5_payroll_liab - prev.cat_5_payroll_liab;
        w.net_liquidity_change = w.net_liquidity      - prev.net_liquidity;
      }

      // Rolling 4-week averages over active weeks up through this week.
      const windowWeeks = lastActiveWeeks(weeksBase.slice(0, i + 1), 4);
      const avg = (fn: (w: typeof windowWeeks[number]) => number) =>
        windowWeeks.length > 0
          ? windowWeeks.reduce((s, v) => s + fn(v), 0) / windowWeeks.length
          : 0;

      const weekly_ap_burn = avg((x) => x._ap_period_credit);
      const weekly_payroll = avg((x) => x._payroll_period_debit);
      const avgOverhead    = avg((x) => x.cat_7_overhead);

      w.cash_coverage_weeks = weekly_ap_burn > 0 ? w.cat_1_cash / weekly_ap_burn : null;
      w.payroll_runway_wks  = weekly_payroll > 0 ? w.cat_1_cash / weekly_payroll : null;
      w.burn_rate_weekly    = avgOverhead;

      // Strip the hidden rolling-input fields before serializing as WeekMetric.
      const {
        _ap_period_credit: _apPc,
        _payroll_period_debit: _plPd,
        ...clean
      } = w;
      void _apPc; void _plPd;
      return clean as WeekMetric;
    });

    // Monthly rollup.
    const monthMap = new Map<string, {
      cash: number[]; ar: number[]; cd: number[]; prLiab: number[]; netLiq: number[];
      revenue: number; djc: number;
      sub_count: number; sub_value: number; won_count: number; won_value: number;
    }>();
    for (const w of weeks) {
      // Skip zero-activity weeks so a configured-but-unimported week can't
      // drag a monthly cash/AR/etc. average toward zero.
      if (!isActiveWeek(w)) continue;
      const m = w.week_ending.slice(0, 7);
      if (!monthMap.has(m)) {
        monthMap.set(m, {
          cash: [], ar: [], cd: [], prLiab: [], netLiq: [],
          revenue: 0, djc: 0,
          sub_count: 0, sub_value: 0, won_count: 0, won_value: 0,
        });
      }
      const mm = monthMap.get(m)!;
      mm.cash.push(w.cat_1_cash);
      mm.ar.push(w.cat_2_ar);
      mm.cd.push(w.cat_3_current_debt);
      mm.prLiab.push(w.cat_5_payroll_liab);
      mm.netLiq.push(w.net_liquidity);
      mm.revenue += w.cat_8_revenue;
      mm.djc     += w.cat_9_djc;
      mm.sub_count += w.bids_submitted_count;
      mm.sub_value += w.bids_submitted_value;
      mm.won_count += w.bids_won_count;
      mm.won_value += w.bids_won_value;
    }
    const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
    const months: MonthMetric[] = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({
        month: m,
        avg_cat_1_cash:         mean(v.cash),
        avg_cat_2_ar:           mean(v.ar),
        avg_cat_3_current_debt: mean(v.cd),
        avg_cat_5_payroll_liab: mean(v.prLiab),
        avg_net_liquidity:      mean(v.netLiq),
        total_cat_8_revenue:    v.revenue,
        total_cat_9_djc:        v.djc,
        total_bids_submitted_value: v.sub_value,
        total_bids_won_value:       v.won_value,
        win_rate_pct: v.sub_count > 0 ? (v.won_count / v.sub_count) * 100 : 0,
      }));

    // ── Runway summary ──────────────────────────────────────────────────────
    // Anchor on the LAST active week (not the literal last row) so a future
    // configured-but-unimported week can't nuke current_cash → runway.
    const activeTail8 = lastActiveWeeks(weeks, 8);
    const anchor = activeTail8.length > 0
      ? activeTail8[activeTail8.length - 1]
      : weeks[weeks.length - 1] ?? null;

    const avgOver = (fn: (w: WeekMetric) => number) =>
      activeTail8.length > 0
        ? activeTail8.reduce((s, w) => s + fn(w), 0) / activeTail8.length
        : 0;

    const avg_weekly_collections = avgOver((w) => w.weekly_cash_collected);
    const avg_weekly_ap_paid     = avgOver((w) => w.weekly_ap_paid);
    const avg_weekly_payroll     = avgOver((w) => w.weekly_payroll_paid);
    const avg_weekly_overhead    = avgOver((w) => w.weekly_overhead_paid);
    const avg_weekly_revenue     = avgOver((w) => w.weekly_revenue);

    // All three burn legs are 8-wk smoothed. The previous convention anchored
    // payroll to the CURRENT week, which under-reported on off-cycle weeks
    // (the bug behind "$17K/wk displayed vs $100K/wk actual"). Each per-week
    // input here is already summed-across-divisions via the account_weekly
    // CTE, so the avg reflects whole-company totals.
    const avg_weekly_burn =
      avg_weekly_ap_paid + avg_weekly_payroll + avg_weekly_overhead;

    const current_cash = anchor?.cat_1_cash ?? 0;
    const weeks_of_runway = avg_weekly_burn > 0 ? current_cash / avg_weekly_burn : null;
    const collection_efficiency =
      avg_weekly_revenue > 0 ? avg_weekly_collections / avg_weekly_revenue : null;

    const coast_weekly = avg_weekly_burn;
    const grow_weekly  = coast_weekly + growthTargetPct * avg_weekly_revenue;

    const runway: RunwaySummary = {
      avg_weekly_collections,
      avg_weekly_ap_paid,
      avg_weekly_payroll,
      avg_weekly_overhead,
      avg_weekly_burn,
      avg_weekly_revenue,
      collection_efficiency,
      weeks_of_runway,
      coast_weekly,
      grow_weekly,
      growth_target_pct: growthTargetPct,
      current_cash,
      anchor_week_ending: anchor?.week_ending ?? null,
    };

    // ── P&L window totals ───────────────────────────────────────────────────
    // Sum over every week in the filter window (NOT last-N active). A user
    // looking at "FY 2025" expects the full-year total, not a 4-week trail.
    // Per-week fields are already |pd − pc|, so summing them preserves the
    // window-total period-activity meaning.
    let pnlRevenue = 0;
    let pnlDjc = 0;
    let pnlPayrollField = 0;
    let pnlOverhead = 0;
    for (const w of weeks) {
      pnlRevenue      += w.cat_8_revenue;
      pnlDjc          += w.cat_9_djc;
      pnlPayrollField += w.cat_6_payroll_field;
      pnlOverhead     += w.cat_7_overhead;
    }
    const pnlOpIncome = pnlRevenue - pnlDjc - pnlPayrollField - pnlOverhead;
    const pnl: PnlSummary = {
      revenue:              pnlRevenue,
      djc:                  pnlDjc,
      payroll_field:        pnlPayrollField,
      overhead:             pnlOverhead,
      operating_income:     pnlOpIncome,
      gross_margin_pct:     pnlRevenue !== 0 ? ((pnlRevenue - pnlDjc) / pnlRevenue) * 100 : null,
      operating_margin_pct: pnlRevenue !== 0 ? (pnlOpIncome / pnlRevenue) * 100 : null,
    };

    // ── LOC snapshot ────────────────────────────────────────────────────────
    // Anchored to the last active week (same anchor used by runway totals).
    // 2050 is credit-normal so stored negative; Math.abs yields drawn dollars.
    // If the anchor or the LOC row isn't present, treat drawn as 0 so the
    // response always ships a numeric triple.
    const locAcctEnd = anchor
      ? (perWeekAcct.get(anchor.week_ending)?.get(LOC_ACCOUNT_NO)?.end ?? 0)
      : 0;
    const loc_drawn = Math.abs(locAcctEnd);
    const loc_undrawn = Math.max(0, LOC_LIMIT - loc_drawn);

    // ── Trend series ────────────────────────────────────────────────────────
    // Granularity: monthFilter → weekly; else monthly. If neither filter was
    // supplied and we're implicitly showing "everything", still default to
    // monthly so the sparkline has a readable point count.
    const trend_granularity: "week" | "month" = monthFilter ? "week" : "month";

    // Short month-day label for weekly sparkline points ("Jan 4").
    const weekLabel = (iso: string): string => {
      const [, m, d] = iso.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${monthNames[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
    };
    const monthLabel = (ym: string): string => {
      const [y, m] = ym.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
    };

    // Per-week runway (weeks_of_runway / cash_coverage / payroll_runway)
    // uses the OVERALL avg_weekly_burn as the divisor. A fully per-period
    // burn would add noise — the sparkline reads "how does runway move as
    // cash moves" with a stable burn denominator.
    const runwayDivisor = avg_weekly_burn;

    const trend_series: TrendSeries = {
      cash: [], ar: [], ap: [], net_liquidity: [], working_capital: [],
      current_ratio: [], quick_ratio: [], ar_to_ap: [],
      weeks_of_runway: [], cash_coverage_weeks: [], payroll_runway_wks: [],
      revenue: [], gross_margin_pct: [], operating_margin_pct: [],
      weekly_collections: [], weekly_burn: [], net_cash_flow: [],
      coast_weekly: [], grow_weekly: [],
    };

    if (trend_granularity === "week") {
      // One point per active week in the filter window.
      for (const w of weeks) {
        if (!isActiveWeek(w)) continue;
        const label = weekLabel(w.week_ending);
        trend_series.cash.push({ period_label: label, value: w.cat_1_cash });
        trend_series.ar.push({ period_label: label, value: w.cat_2_ar });
        trend_series.ap.push({ period_label: label, value: w.ap });
        trend_series.net_liquidity.push({ period_label: label, value: w.net_liquidity });
        trend_series.working_capital.push({ period_label: label, value: w.cat_1_cash + w.cat_2_ar - w.ap });
        trend_series.current_ratio.push({ period_label: label, value: w.current_ratio ?? 0 });
        trend_series.quick_ratio.push({ period_label: label, value: w.quick_ratio ?? 0 });
        trend_series.ar_to_ap.push({ period_label: label, value: w.ar_to_ap ?? 0 });
        trend_series.weeks_of_runway.push({
          period_label: label,
          value: runwayDivisor > 0 ? w.cat_1_cash / runwayDivisor : 0,
        });
        trend_series.cash_coverage_weeks.push({ period_label: label, value: w.cash_coverage_weeks ?? 0 });
        trend_series.payroll_runway_wks.push({ period_label: label, value: w.payroll_runway_wks ?? 0 });
        trend_series.revenue.push({ period_label: label, value: w.cat_8_revenue });
        trend_series.gross_margin_pct.push({ period_label: label, value: w.gross_margin_pct ?? 0 });
        trend_series.operating_margin_pct.push({ period_label: label, value: w.operating_margin_pct ?? 0 });

        // Runway-section per-week series.
        const weeklyBurn = w.weekly_ap_paid + w.weekly_payroll_paid + w.weekly_overhead_paid;
        trend_series.weekly_collections.push({ period_label: label, value: w.weekly_cash_collected });
        trend_series.weekly_burn.push({ period_label: label, value: weeklyBurn });
        trend_series.net_cash_flow.push({ period_label: label, value: w.weekly_cash_collected - weeklyBurn });
        trend_series.coast_weekly.push({ period_label: label, value: weeklyBurn });
        trend_series.grow_weekly.push({
          period_label: label,
          value: weeklyBurn + growthTargetPct * w.weekly_revenue,
        });
      }
    } else {
      // Monthly: group active weeks by YYYY-MM. BS / ratios / weeks take the
      // last active week's value; revenue sums period activity; margins
      // derive from summed P&L.
      const byMonth = new Map<string, WeekMetric[]>();
      for (const w of weeks) {
        if (!isActiveWeek(w)) continue;
        const ym = w.week_ending.slice(0, 7);
        if (!byMonth.has(ym)) byMonth.set(ym, []);
        byMonth.get(ym)!.push(w);
      }
      const months = Array.from(byMonth.keys()).sort();
      for (const ym of months) {
        const group = byMonth.get(ym)!; // at least one active week
        const eom = group[group.length - 1]; // last active week of the month
        const label = monthLabel(ym);

        // Sums for revenue + margin derivation
        let sumRevenue = 0, sumDjc = 0, sumPayroll = 0, sumOverhead = 0;
        for (const w of group) {
          sumRevenue  += w.cat_8_revenue;
          sumDjc      += w.cat_9_djc;
          sumPayroll  += w.cat_6_payroll_field;
          sumOverhead += w.cat_7_overhead;
        }
        const opIncome = sumRevenue - sumDjc - sumPayroll - sumOverhead;
        const gmPct = sumRevenue !== 0 ? ((sumRevenue - sumDjc) / sumRevenue) * 100 : 0;
        const omPct = sumRevenue !== 0 ? (opIncome / sumRevenue) * 100 : 0;

        trend_series.cash.push({ period_label: label, value: eom.cat_1_cash });
        trend_series.ar.push({ period_label: label, value: eom.cat_2_ar });
        trend_series.ap.push({ period_label: label, value: eom.ap });
        trend_series.net_liquidity.push({ period_label: label, value: eom.net_liquidity });
        trend_series.working_capital.push({ period_label: label, value: eom.cat_1_cash + eom.cat_2_ar - eom.ap });
        trend_series.current_ratio.push({ period_label: label, value: eom.current_ratio ?? 0 });
        trend_series.quick_ratio.push({ period_label: label, value: eom.quick_ratio ?? 0 });
        trend_series.ar_to_ap.push({ period_label: label, value: eom.ar_to_ap ?? 0 });
        trend_series.weeks_of_runway.push({
          period_label: label,
          value: runwayDivisor > 0 ? eom.cat_1_cash / runwayDivisor : 0,
        });
        trend_series.cash_coverage_weeks.push({ period_label: label, value: eom.cash_coverage_weeks ?? 0 });
        trend_series.payroll_runway_wks.push({ period_label: label, value: eom.payroll_runway_wks ?? 0 });
        trend_series.revenue.push({ period_label: label, value: sumRevenue });
        trend_series.gross_margin_pct.push({ period_label: label, value: gmPct });
        trend_series.operating_margin_pct.push({ period_label: label, value: omPct });

        // Runway-section monthly aggregates. Collections / burn / net are
        // FLOWS → sum over the month (matches how CFOs read "monthly
        // collections"). Coast and grow are per-WEEK RATES → average so
        // the sparkline point scale matches the card's "$X/wk" readout.
        let sumCollected = 0, sumBurn = 0, sumWeeklyRev = 0;
        for (const w of group) {
          sumCollected += w.weekly_cash_collected;
          sumBurn      += w.weekly_ap_paid + w.weekly_payroll_paid + w.weekly_overhead_paid;
          sumWeeklyRev += w.weekly_revenue;
        }
        const weeksInMonth = group.length;
        const avgBurn = weeksInMonth > 0 ? sumBurn / weeksInMonth : 0;
        const avgGrow =
          weeksInMonth > 0
            ? avgBurn + growthTargetPct * (sumWeeklyRev / weeksInMonth)
            : 0;
        trend_series.weekly_collections.push({ period_label: label, value: sumCollected });
        trend_series.weekly_burn.push({ period_label: label, value: sumBurn });
        trend_series.net_cash_flow.push({ period_label: label, value: sumCollected - sumBurn });
        trend_series.coast_weekly.push({ period_label: label, value: avgBurn });
        trend_series.grow_weekly.push({ period_label: label, value: avgGrow });
      }
    }

    // ── KPI drilldowns ──────────────────────────────────────────────────────
    // Click-to-expand backing data for every KPI card. Each entry packages
    // the formula in plain English, the inputs that fed it, the literal
    // arithmetic, the rolling-window breakdown (where applicable), and the
    // contributing GL accounts. The dashboard renders this verbatim — no
    // client-side recomputation.
    //
    // Anchor-week per-account snapshot: pre-aggregates end_balance across
    // divisions (one row per account_no) and joins gl_accounts for the
    // user-facing description. Covers cat 1 cash + cat 2 AR + every account
    // already pulled by the runway query (AP 2005, LOC 2050, payroll
    // accruals 2150-2166, payroll-run accounts, deposit accounts).
    const drilldownAccountList = [
      ACCT_AP,
      LOC_ACCOUNT_NO,
      ACCT_PAYROLL_RUN_DIRECT,
      ACCT_PAYROLL_RUN_FIELD,
      ...ACCTS_CASH_COLLECTED,
      ...ACCTS_PAYROLL_PAID,
    ];
    interface AnchorAcct {
      description: string;
      category_id: number | null;
      end: number;
    }
    const anchorAccts = new Map<number, AnchorAcct>();
    if (anchor) {
      const anchorRows = await sql`
        SELECT
          ga.account_no,
          MIN(ga.description) AS description,
          MAX(ga.category_id) AS category_id,
          SUM(wb.end_balance)::numeric AS end_sum
        FROM weekly_balances wb
        JOIN gl_accounts ga ON ga.id = wb.gl_account_id
        WHERE wb.week_ending = ${anchor.week_ending}::date
          AND ga.is_active = true
          AND (
            ga.category_id IN (${CAT.CASH}, ${CAT.AR})
            OR ga.account_no = ANY(${drilldownAccountList}::int[])
            OR ga.account_no BETWEEN ${ACCT_PAYROLL_ACCRUALS_MIN} AND ${ACCT_PAYROLL_ACCRUALS_MAX}
          )
        GROUP BY ga.account_no
        ORDER BY ga.account_no
      `;
      for (const r of anchorRows) {
        anchorAccts.set(Number(r.account_no), {
          description: String(r.description ?? ""),
          category_id: r.category_id == null ? null : Number(r.category_id),
          end: n(r.end_sum),
        });
      }
    }

    // ── Drilldown formatters ────────────────────────────────────────────────
    const fmtUSD0 = (v: number): string =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);
    const fmtRatio3 = (v: number): string => v.toFixed(3);
    const fmtPct1 = (v: number): string => `${v.toFixed(1)}%`;
    const fmtWeeks2 = (v: number): string => `${v.toFixed(2)} wks`;

    // Build account_sources for a category at the anchor week. ABS values
    // when the category is credit-normal (so AP / accrual sources display
    // as positive contributions). Filters out zero-balance rows.
    const sourcesForCategory = (
      catId: number,
      opts: { abs?: boolean } = {},
    ): DrilldownAccountSource[] => {
      const out: DrilldownAccountSource[] = [];
      for (const [acctNo, info] of anchorAccts) {
        if (info.category_id !== catId) continue;
        const v = opts.abs ? Math.abs(info.end) : info.end;
        if (v === 0) continue;
        out.push({
          account_no: acctNo,
          division: null,
          description: info.description,
          contribution: v,
        });
      }
      out.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
      return out;
    };

    const sourcesForAccountList = (
      accts: readonly number[],
      opts: { abs?: boolean } = {},
    ): DrilldownAccountSource[] => {
      const out: DrilldownAccountSource[] = [];
      for (const acctNo of accts) {
        const info = anchorAccts.get(acctNo);
        if (!info) continue;
        const v = opts.abs ? Math.abs(info.end) : info.end;
        if (v === 0) continue;
        out.push({
          account_no: acctNo,
          division: null,
          description: info.description,
          contribution: v,
        });
      }
      return out;
    };

    // ── Drilldown map ───────────────────────────────────────────────────────
    const drilldowns: DrilldownMap = {};

    // Anchor-week breakdown windows. The 4-wk window backs the rolling
    // coverage / payroll runway metrics; the 8-wk window backs the runway
    // section. weeksBase still carries the hidden _ap_period_credit and
    // _payroll_period_debit fields used for the 4-wk windows.
    const last4Active = lastActiveWeeks(weeksBase, 4);
    const last8Active = lastActiveWeeks(weeks, 8);

    const baseCash = anchor?.cat_1_cash ?? 0;
    const baseAr = anchor?.cat_2_ar ?? 0;
    const baseAp = anchor?.ap ?? 0;
    const baseAccruals = anchor?.payroll_accruals ?? 0;
    const shortTermLiab = baseAp + baseAccruals;
    const baseNetLiquidity = anchor?.net_liquidity ?? 0;

    // Avg AP burn (4-wk rolling, anchored at last active week) for cash
    // coverage. Uses the same hidden field (_ap_period_credit) the per-week
    // computation used so the displayed breakdown matches the headline
    // number exactly.
    const avg4 = (fn: (w: typeof weeksBase[number]) => number): number =>
      last4Active.length > 0
        ? last4Active.reduce((s, w) => s + fn(w), 0) / last4Active.length
        : 0;
    const avg4ApBurn = avg4((w) => w._ap_period_credit);
    const avg4Payroll = avg4((w) => w._payroll_period_debit);

    // ─── Snapshot drilldowns ────────────────────────────────────────────────

    drilldowns.cash = {
      formula_plain: "Sum of end-of-week balances across all cash accounts (Category 1).",
      result: baseCash,
      inputs: [
        {
          label: "Cash on Hand (latest active week)",
          value: baseCash,
          format: "money",
          note: anchor ? `End balance as of ${anchor.week_ending}` : undefined,
        },
      ],
      computation: {
        expression: "Σ end_balance(cat 1 accounts)",
        result: fmtUSD0(baseCash),
      },
      account_sources: sourcesForCategory(CAT.CASH),
    };

    drilldowns.ar = {
      formula_plain: "Sum of end-of-week balances across all A/R accounts (Category 2).",
      result: baseAr,
      inputs: [
        {
          label: "Accounts Receivable (latest active week)",
          value: baseAr,
          format: "money",
          note: anchor ? `End balance as of ${anchor.week_ending}` : undefined,
        },
      ],
      computation: {
        expression: "Σ end_balance(cat 2 accounts)",
        result: fmtUSD0(baseAr),
      },
      account_sources: sourcesForCategory(CAT.AR),
    };

    drilldowns.ap = {
      formula_plain: "End-of-week balance of A/P Trade (account 2005), absolute value.",
      result: baseAp,
      inputs: [
        {
          label: "A/P Trade (account 2005)",
          value: baseAp,
          format: "money",
          note: anchor ? `End balance as of ${anchor.week_ending}` : undefined,
        },
      ],
      computation: {
        expression: "|end_balance(2005)|",
        result: fmtUSD0(baseAp),
      },
      account_sources: sourcesForAccountList([ACCT_AP], { abs: true }),
    };

    drilldowns.net_liquidity = {
      formula_plain: "Cash on Hand − A/P − Payroll Accruals.",
      result: baseNetLiquidity,
      inputs: [
        { label: "Cash on Hand",      value: baseCash,      format: "money", note: "Σ end_balance(cat 1)" },
        { label: "A/P (account 2005)", value: baseAp,       format: "money", note: "|end_balance(2005)|" },
        { label: "Payroll Accruals",   value: baseAccruals, format: "money", note: "|Σ end_balance(2150-2166)|" },
      ],
      computation: {
        expression: `${fmtUSD0(baseCash)} − ${fmtUSD0(baseAp)} − ${fmtUSD0(baseAccruals)}`,
        result: fmtUSD0(baseNetLiquidity),
      },
    };

    drilldowns.cash_coverage_weeks = {
      formula_plain: "Cash on Hand ÷ 4-week rolling average of AP paid (bills paid out of cash).",
      result: anchor?.cash_coverage_weeks ?? 0,
      inputs: [
        { label: "Cash on Hand",                value: baseCash,    format: "money" },
        { label: "Avg Weekly AP Burn (4-wk)",   value: avg4ApBurn,  format: "money", note: "Mean of period_credit posts to account 2005 over the last 4 active weeks" },
      ],
      computation: {
        expression: `${fmtUSD0(baseCash)} ÷ ${fmtUSD0(avg4ApBurn)}`,
        result: anchor?.cash_coverage_weeks != null ? fmtWeeks2(anchor.cash_coverage_weeks) : "—",
      },
      breakdown: {
        title: "4-Week AP Burn Calculation",
        rows: last4Active.map((w) => ({
          label: w.week_ending,
          value: w._ap_period_credit,
          format: "money" as const,
        })),
        aggregate_label: "Average",
        aggregate_value: avg4ApBurn,
        methodology_note: "Active weeks only; weeks with no GL activity are skipped so unimported future weeks don't drag the average toward zero.",
      },
      account_sources: sourcesForAccountList([ACCT_AP], { abs: true }),
    };

    drilldowns.payroll_runway_wks = {
      formula_plain: "Cash on Hand ÷ 4-week rolling average of payroll cash-out (labor + field payroll).",
      result: anchor?.payroll_runway_wks ?? 0,
      inputs: [
        { label: "Cash on Hand",                  value: baseCash,     format: "money" },
        { label: "Avg Weekly Payroll (4-wk)",     value: avg4Payroll,  format: "money", note: "Mean of period_debit to accounts 5101 + 6080 over the last 4 active weeks" },
      ],
      computation: {
        expression: `${fmtUSD0(baseCash)} ÷ ${fmtUSD0(avg4Payroll)}`,
        result: anchor?.payroll_runway_wks != null ? fmtWeeks2(anchor.payroll_runway_wks) : "—",
      },
      breakdown: {
        title: "4-Week Payroll Calculation",
        rows: last4Active.map((w) => ({
          label: w.week_ending,
          value: w._payroll_period_debit,
          format: "money" as const,
        })),
        aggregate_label: "Average",
        aggregate_value: avg4Payroll,
        methodology_note: "Active weeks only; weeks with no GL activity are skipped.",
      },
      account_sources: sourcesForAccountList([ACCT_PAYROLL_RUN_DIRECT, ACCT_PAYROLL_RUN_FIELD], { abs: true }),
    };

    drilldowns.current_ratio = {
      formula_plain: "(Cash + A/R) ÷ (A/P + Payroll Accruals).",
      result: anchor?.current_ratio ?? 0,
      inputs: [
        { label: "Cash on Hand",     value: baseCash,      format: "money" },
        { label: "A/R",              value: baseAr,        format: "money" },
        { label: "A/P",              value: baseAp,        format: "money" },
        { label: "Payroll Accruals", value: baseAccruals,  format: "money" },
      ],
      computation: {
        expression: `(${fmtUSD0(baseCash)} + ${fmtUSD0(baseAr)}) ÷ (${fmtUSD0(baseAp)} + ${fmtUSD0(baseAccruals)})`,
        result: anchor?.current_ratio != null ? fmtRatio3(anchor.current_ratio) : "—",
      },
    };

    drilldowns.quick_ratio = {
      formula_plain: "Cash ÷ (A/P + Payroll Accruals).",
      result: anchor?.quick_ratio ?? 0,
      inputs: [
        { label: "Cash on Hand",     value: baseCash,      format: "money" },
        { label: "A/P",              value: baseAp,        format: "money" },
        { label: "Payroll Accruals", value: baseAccruals,  format: "money" },
      ],
      computation: {
        expression: `${fmtUSD0(baseCash)} ÷ (${fmtUSD0(baseAp)} + ${fmtUSD0(baseAccruals)})`,
        result: anchor?.quick_ratio != null ? fmtRatio3(anchor.quick_ratio) : "—",
      },
    };

    drilldowns.ar_to_ap = {
      formula_plain: "A/R ÷ A/P.",
      result: anchor?.ar_to_ap ?? 0,
      inputs: [
        { label: "A/R", value: baseAr, format: "money" },
        { label: "A/P", value: baseAp, format: "money" },
      ],
      computation: {
        expression: `${fmtUSD0(baseAr)} ÷ ${fmtUSD0(baseAp)}`,
        result: anchor?.ar_to_ap != null ? fmtRatio3(anchor.ar_to_ap) : "—",
      },
    };

    // ─── P&L window drilldowns ──────────────────────────────────────────────
    // Sum across every active week in the filter window. The breakdown list
    // is bounded by the filter — a single-month filter shows ~4 rows, an
    // FY filter shows up to ~52.
    const pnlWindowActive = weeks.filter(isActiveWeek);
    const revenueRows: DrilldownBreakdownRow[] = pnlWindowActive.map((w) => ({
      label: w.week_ending,
      value: w.cat_8_revenue,
      format: "money" as const,
    }));

    drilldowns.revenue = {
      formula_plain: "Sum of revenue (Category 8) period activity across every active week in the filter window.",
      result: pnl.revenue,
      inputs: [
        { label: "Revenue (filter window)", value: pnl.revenue, format: "money" },
      ],
      computation: {
        expression: "Σ |period_credit − period_debit|(cat 8) over weeks in window",
        result: fmtUSD0(pnl.revenue),
      },
      breakdown: revenueRows.length > 0 ? {
        title: "Per-Week Revenue (Filter Window)",
        rows: revenueRows,
        aggregate_label: "Total",
        aggregate_value: pnl.revenue,
        methodology_note: "Active weeks only. Each weekly value is |period_credit − period_debit| of all Category 8 (Revenue) accounts.",
      } : undefined,
    };

    const _gross = pnl.revenue - pnl.djc;
    drilldowns.gross_margin_pct = {
      formula_plain: "(Revenue − Direct Job Costs) ÷ Revenue × 100.",
      result: pnl.gross_margin_pct ?? 0,
      inputs: [
        { label: "Revenue",            value: pnl.revenue, format: "money" },
        { label: "Direct Job Costs",   value: pnl.djc,     format: "money", note: "Σ period activity of Category 9 accounts" },
      ],
      computation: {
        expression: `(${fmtUSD0(pnl.revenue)} − ${fmtUSD0(pnl.djc)}) ÷ ${fmtUSD0(pnl.revenue)} × 100`,
        result: pnl.gross_margin_pct != null ? fmtPct1(pnl.gross_margin_pct) : "—",
      },
    };

    drilldowns.operating_income = {
      formula_plain: "Revenue − Direct Job Costs − Field Payroll − Overhead.",
      result: pnl.operating_income,
      inputs: [
        { label: "Revenue",            value: pnl.revenue,        format: "money" },
        { label: "Direct Job Costs",   value: pnl.djc,            format: "money" },
        { label: "Field Payroll",      value: pnl.payroll_field,  format: "money", note: "Σ period activity of Category 6" },
        { label: "Overhead",           value: pnl.overhead,       format: "money", note: "Σ period activity of Category 7" },
      ],
      computation: {
        expression: `${fmtUSD0(pnl.revenue)} − ${fmtUSD0(pnl.djc)} − ${fmtUSD0(pnl.payroll_field)} − ${fmtUSD0(pnl.overhead)}`,
        result: fmtUSD0(pnl.operating_income),
      },
    };

    drilldowns.operating_margin_pct = {
      formula_plain: "Operating Income ÷ Revenue × 100. Accrual basis — see P&L Breakdown for cash-only view.",
      result: pnl.operating_margin_pct ?? 0,
      inputs: [
        { label: "Operating Income",   value: pnl.operating_income, format: "money" },
        { label: "Revenue",            value: pnl.revenue,          format: "money" },
      ],
      computation: {
        expression: `${fmtUSD0(pnl.operating_income)} ÷ ${fmtUSD0(pnl.revenue)} × 100`,
        result: pnl.operating_margin_pct != null ? fmtPct1(pnl.operating_margin_pct) : "—",
      },
    };

    // ─── Runway drilldowns (8-wk rolling) ───────────────────────────────────
    const runwayBreakdownRow = (
      w: WeekMetric,
      pick: (w: WeekMetric) => number,
    ): DrilldownBreakdownRow => ({
      label: w.week_ending,
      value: pick(w),
      format: "money",
    });

    drilldowns.avg_weekly_collections = {
      formula_plain: "8-week average of cash deposits to operating bank accounts (1021, 1027, 1120).",
      result: runway.avg_weekly_collections,
      inputs: [
        { label: "Avg Weekly Collections (8-wk)", value: runway.avg_weekly_collections, format: "money" },
      ],
      computation: {
        expression: "mean(weekly_cash_collected over last 8 active weeks)",
        result: fmtUSD0(runway.avg_weekly_collections),
      },
      breakdown: {
        title: "8-Week Average Calculation",
        rows: last8Active.map((w) => runwayBreakdownRow(w, (x) => x.weekly_cash_collected)),
        aggregate_label: "Average",
        aggregate_value: runway.avg_weekly_collections,
        methodology_note: "Active weeks only; weeks with no activity skipped. Per-week values are pre-summed across divisions in SQL.",
      },
      account_sources: sourcesForAccountList(ACCTS_CASH_COLLECTED),
    };

    drilldowns.avg_weekly_burn = {
      formula_plain: "8-week average of (AP paid + Payroll paid + Overhead paid). Each leg is averaged separately and the three averages are summed.",
      result: runway.avg_weekly_burn,
      inputs: [
        { label: "Avg Weekly AP Paid (8-wk)",       value: runway.avg_weekly_ap_paid,   format: "money", note: "Σ period_debit to account 2005, averaged" },
        { label: "Avg Weekly Payroll Paid (8-wk)",  value: runway.avg_weekly_payroll,   format: "money", note: "Σ period_debit to 5101 + 5210 + 5220 + 5250 + 6080 + 6100, averaged" },
        { label: "Avg Weekly Overhead Paid (8-wk)", value: runway.avg_weekly_overhead,  format: "money", note: "Σ period_debit of Category 7 accounts, averaged" },
      ],
      computation: {
        expression: `${fmtUSD0(runway.avg_weekly_ap_paid)} + ${fmtUSD0(runway.avg_weekly_payroll)} + ${fmtUSD0(runway.avg_weekly_overhead)}`,
        result: fmtUSD0(runway.avg_weekly_burn),
      },
      breakdown: {
        title: "8-Week Burn Calculation",
        rows: last8Active.map((w) => runwayBreakdownRow(w, (x) => x.weekly_ap_paid + x.weekly_payroll_paid + x.weekly_overhead_paid)),
        aggregate_label: "Average",
        aggregate_value: runway.avg_weekly_burn,
        methodology_note: "Active weeks only. Each per-week burn is summed across divisions in SQL before averaging — a payroll account spanning divisions 10/20/99 contributes one whole-company total per week, not three slices.",
      },
      account_sources: sourcesForAccountList([ACCT_AP, ...ACCTS_PAYROLL_PAID]),
    };

    const netCashFlowRunway = runway.avg_weekly_collections - runway.avg_weekly_burn;
    drilldowns.net_cash_flow = {
      formula_plain: "Avg Weekly Collections − Avg Weekly Burn. Positive = building cash; negative = draining cash.",
      result: netCashFlowRunway,
      inputs: [
        { label: "Avg Weekly Collections (8-wk)", value: runway.avg_weekly_collections, format: "money" },
        { label: "Avg Weekly Burn (8-wk)",        value: runway.avg_weekly_burn,        format: "money" },
      ],
      computation: {
        expression: `${fmtUSD0(runway.avg_weekly_collections)} − ${fmtUSD0(runway.avg_weekly_burn)}`,
        result: `${netCashFlowRunway >= 0 ? "+" : "-"}${fmtUSD0(Math.abs(netCashFlowRunway))} / wk`,
      },
    };

    drilldowns.weeks_of_runway = {
      formula_plain: "Current Cash ÷ 8-week Avg Weekly Burn. Worst-case: how many weeks if collections stopped tomorrow.",
      result: runway.weeks_of_runway ?? 0,
      inputs: [
        { label: "Current Cash",                value: runway.current_cash,    format: "money", note: anchor ? `Anchor week ${anchor.week_ending}` : undefined },
        { label: "Avg Weekly Burn (8-wk)",      value: runway.avg_weekly_burn, format: "money" },
      ],
      computation: {
        expression: `${fmtUSD0(runway.current_cash)} ÷ ${fmtUSD0(runway.avg_weekly_burn)}`,
        result: runway.weeks_of_runway != null ? fmtWeeks2(runway.weeks_of_runway) : "—",
      },
    };

    drilldowns.coast_weekly = {
      formula_plain: "Equal to Avg Weekly Burn — the weekly collection target that keeps cash flat.",
      result: runway.coast_weekly,
      inputs: [
        { label: "Avg Weekly Burn (8-wk)", value: runway.avg_weekly_burn, format: "money" },
      ],
      computation: {
        expression: `coast = burn = ${fmtUSD0(runway.avg_weekly_burn)}`,
        result: `${fmtUSD0(runway.coast_weekly)} / wk`,
      },
    };

    const growthAdd = growthTargetPct * runway.avg_weekly_revenue;
    drilldowns.grow_weekly = {
      formula_plain: "Coast number + (growth target % × Avg Weekly Revenue). The weekly collection target to fund the configured growth bump.",
      result: runway.grow_weekly,
      inputs: [
        { label: "Coast Number",                  value: runway.coast_weekly,          format: "money" },
        { label: "Growth Target %",               value: growthTargetPct * 100,        format: "pct" },
        { label: "Avg Weekly Revenue (8-wk)",     value: runway.avg_weekly_revenue,    format: "money" },
        { label: "Growth Add ($/wk)",             value: growthAdd,                    format: "money", note: `${(growthTargetPct * 100).toFixed(0)}% × ${fmtUSD0(runway.avg_weekly_revenue)}` },
      ],
      computation: {
        expression: `${fmtUSD0(runway.coast_weekly)} + (${(growthTargetPct * 100).toFixed(0)}% × ${fmtUSD0(runway.avg_weekly_revenue)}) = ${fmtUSD0(runway.coast_weekly)} + ${fmtUSD0(growthAdd)}`,
        result: `${fmtUSD0(runway.grow_weekly)} / wk`,
      },
    };

    return NextResponse.json({
      weeks,
      months,
      runway,
      pnl,
      loc_limit: LOC_LIMIT,
      loc_drawn,
      loc_undrawn,
      trend_series,
      trend_granularity,
      benchmarks: BENCHMARKS,
      drilldowns,
    } satisfies MetricsResponse);
  } catch (err) {
    console.error("GET /api/metrics error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
