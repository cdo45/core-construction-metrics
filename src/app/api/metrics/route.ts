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

    return NextResponse.json({
      weeks,
      months,
      runway,
      pnl,
      loc_limit: LOC_LIMIT,
      loc_drawn,
      loc_undrawn,
    } satisfies MetricsResponse);
  } catch (err) {
    console.error("GET /api/metrics error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
