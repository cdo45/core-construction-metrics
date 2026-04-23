import { NextResponse } from "next/server";
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeekMetric {
  week_ending: string; // YYYY-MM-DD
  confirmed: boolean;

  // BS — end_balance totals per category
  cat_1_cash: number;
  cat_2_ar: number;
  cat_3_current_debt: number;
  cat_4_lt_debt: number;
  cat_5_payroll_liab: number;

  // P&L — signed period activity per category
  // debit-normal categories: period_debit - period_credit (expense up = positive)
  // credit-normal category:  period_credit - period_debit (revenue up = positive)
  cat_6_payroll_field: number;
  cat_7_overhead: number;
  cat_8_revenue: number;
  cat_9_djc: number;

  // Derived ratios (computed over this week)
  net_liquidity: number;
  current_ratio: number | null;
  quick_ratio: number | null;
  ar_to_ap: number | null;
  payroll_runway_wks: number | null;
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

export interface MetricsResponse {
  weeks: WeekMetric[];
  months: MonthMetric[];
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

export async function GET() {
  try {
    const sql = getDb();

    // Single query: one row per (week, category) with sums.
    // Always JOIN fresh so changing gl_accounts.category_id retroactively
    // reclassifies history without any data migration.
    const rawRollups = await sql`
      SELECT
        wb.week_ending::text AS week_ending,
        ga.category_id,
        SUM(wb.end_balance)::numeric   AS cat_end,
        SUM(wb.period_debit)::numeric  AS cat_pd,
        SUM(wb.period_credit)::numeric AS cat_pc
      FROM weekly_balances wb
      JOIN gl_accounts ga ON ga.id = wb.gl_account_id
      WHERE ga.category_id IS NOT NULL
      GROUP BY wb.week_ending, ga.category_id
      ORDER BY wb.week_ending ASC, ga.category_id ASC
    `;

    const weekRows = await sql`
      SELECT week_ending::text AS week_ending, is_confirmed
      FROM weeks
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

    // Build ordered list of week_ending strings. Union of weekly_balances
    // rollup weeks and weeks-table rows.
    const weekEndingSet = new Set<string>();
    for (const wk of perWeek.keys()) weekEndingSet.add(wk);
    for (const wk of confirmedMap.keys()) weekEndingSet.add(wk);
    const orderedWeeks = Array.from(weekEndingSet).sort();

    const weeksBase = orderedWeeks.map((wk) => {
      const cats = perWeek.get(wk) ?? new Map<number, { end: number; pd: number; pc: number }>();
      const get = (id: number) => cats.get(id);

      const cat_1_cash           = get(CAT.CASH)?.end          ?? 0;
      const cat_2_ar             = get(CAT.AR)?.end            ?? 0;
      const cat_3_current_debt   = get(CAT.CURRENT_DEBT)?.end  ?? 0;
      const cat_4_lt_debt        = get(CAT.LT_DEBT)?.end       ?? 0;
      const cat_5_payroll_liab   = get(CAT.PAYROLL_LIAB)?.end  ?? 0;

      const plSigned = (id: number, creditNormal: boolean) => {
        const row = get(id);
        if (!row) return 0;
        return creditNormal ? row.pc - row.pd : row.pd - row.pc;
      };
      const cat_6_payroll_field = plSigned(CAT.PAYROLL_FIELD, false);
      const cat_7_overhead      = plSigned(CAT.OVERHEAD,      false);
      const cat_8_revenue       = plSigned(CAT.REVENUE,       true);
      const cat_9_djc           = plSigned(CAT.DJC,           false);

      const net_liquidity = cat_1_cash - cat_3_current_debt - cat_5_payroll_liab;

      const currentLiab = cat_3_current_debt + cat_5_payroll_liab;
      const current_ratio = safeDiv(cat_1_cash + cat_2_ar, currentLiab);
      const quick_ratio   = safeDiv(cat_1_cash, currentLiab);
      const ar_to_ap      = safeDiv(cat_2_ar, cat_3_current_debt);

      // Margins (this week only; meaningful rolling margins should use
      // multi-week sums — flag: per-week gross margin on a week with zero
      // revenue returns null, which is correct).
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
        cat_6_payroll_field,
        cat_7_overhead,
        cat_8_revenue,
        cat_9_djc,
        net_liquidity,
        current_ratio,
        quick_ratio,
        ar_to_ap,
        gross_margin_pct,
        operating_margin_pct,
        // Filled below after we have the ordered weeks
        payroll_runway_wks: null as number | null,
        burn_rate_weekly:   null as number | null,
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
      };
    });

    // WoW deltas, then 4-week rolling avgs for payroll_runway + burn_rate.
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

      // Rolling 4-week averages: last 4 weeks WITH ACTIVITY up through this
      // week. Empty (no-import) weeks don't dilute the average. If the current
      // week is itself inactive it's naturally excluded, so the runway/burn
      // stay anchored to the latest real activity.
      const windowWeeks = lastActiveWeeks(weeksBase.slice(0, i + 1), 4);
      const avg = (fn: (w: typeof windowWeeks[number]) => number) =>
        windowWeeks.length > 0
          ? windowWeeks.reduce((s, v) => s + fn(v), 0) / windowWeeks.length
          : 0;
      const avgPayrollField = avg((x) => x.cat_6_payroll_field);
      const avgOverhead     = avg((x) => x.cat_7_overhead);
      w.payroll_runway_wks = avgPayrollField > 0 ? w.cat_1_cash / avgPayrollField : null;
      w.burn_rate_weekly   = avgOverhead;

      return w as WeekMetric;
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

    return NextResponse.json({ weeks, months } satisfies MetricsResponse);
  } catch (err) {
    console.error("GET /api/metrics error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
