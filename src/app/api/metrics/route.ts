import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Types returned to the client ────────────────────────────────────────────

export interface WeekMetric {
  week_ending: string;          // YYYY-MM-DD
  cash: number;
  ar: number;
  ap: number;
  payroll: number;
  net_position: number;
  cash_change: number | null;
  ar_change: number | null;
  ap_change: number | null;
  payroll_change: number | null;
  ar_collected: number | null;
  ap_paid: number | null;
  bids_submitted_count: number;
  bids_submitted_value: number;
  bids_won_count: number;
  bids_won_value: number;
  // Financial health ratios
  current_ratio: number | null;       // (cash + ar) / (ap + payroll)
  quick_ratio: number | null;         // cash / (ap + payroll)
  ar_to_ap: number | null;            // ar / ap
  net_liquidity: number;              // cash - ap - payroll (alias of net_position)
  payroll_coverage: number | null;    // cash / payroll
  cash_coverage_weeks: number | null; // cash / abs(avg weekly cash burn)
}

export interface MonthMetric {
  month: string;                // "YYYY-MM"
  avg_cash: number;
  avg_ar: number;
  avg_ap: number;
  avg_payroll: number;
  avg_net_position: number;
  total_bids_submitted_value: number;
  total_bids_won_value: number;
  win_rate_pct: number;
}

export interface MetricsResponse {
  weeks: WeekMetric[];
  months: MonthMetric[];
}

// ─── Helper: safe number parse from Neon (NUMERIC → string or number) ────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const sql = getDb();

    // ── 1. Weekly category totals + bid activity ──────────────────────────────
    const rawWeeks = await sql`
      WITH cat_totals AS (
        SELECT
          wb.week_ending,
          c.name AS cat,
          SUM(wb.end_balance) AS total
        FROM weekly_balances wb
        JOIN  gl_accounts g ON g.id = wb.gl_account_id
        LEFT JOIN categories c ON c.id = g.category_id
        GROUP BY wb.week_ending, c.name
      )
      SELECT
        w.week_ending::text,
        COALESCE(MAX(CASE WHEN ct.cat = 'Cash on Hand'        THEN ct.total END), 0) AS cash,
        COALESCE(MAX(CASE WHEN ct.cat = 'Who Owes Us'         THEN ct.total END), 0) AS ar,
        COALESCE(MAX(CASE WHEN ct.cat = 'Who We Owe'          THEN ct.total END), 0) AS ap,
        COALESCE(MAX(CASE WHEN ct.cat = 'Payroll Liabilities' THEN ct.total END), 0) AS payroll,
        COALESCE(ba.bids_submitted_count, 0) AS bids_submitted_count,
        COALESCE(ba.bids_submitted_value, 0) AS bids_submitted_value,
        COALESCE(ba.bids_won_count,       0) AS bids_won_count,
        COALESCE(ba.bids_won_value,       0) AS bids_won_value
      FROM (
        SELECT DISTINCT week_ending FROM weekly_balances
      ) w
      LEFT JOIN cat_totals ct   ON ct.week_ending = w.week_ending
      LEFT JOIN bid_activity ba ON ba.week_ending = w.week_ending
      GROUP BY w.week_ending, ba.bids_submitted_count, ba.bids_submitted_value,
               ba.bids_won_count, ba.bids_won_value
      ORDER BY w.week_ending ASC
    `;

    // ── 2. Compute WoW deltas in application layer ────────────────────────────
    const weeksBase = rawWeeks.map((row, i) => {
      const cash    = n(row.cash);
      const ar      = n(row.ar);
      const ap      = n(row.ap);
      const payroll = n(row.payroll);

      let cash_change: number | null    = null;
      let ar_change: number | null      = null;
      let ap_change: number | null      = null;
      let payroll_change: number | null = null;
      let ar_collected: number | null   = null;
      let ap_paid: number | null        = null;

      if (i > 0) {
        const prev = rawWeeks[i - 1];
        cash_change    = cash    - n(prev.cash);
        ar_change      = ar      - n(prev.ar);
        ap_change      = ap      - n(prev.ap);
        payroll_change = payroll - n(prev.payroll);
        ar_collected   = n(prev.ar) - ar;
        ap_paid        = n(prev.ap) - ap;
      }

      const liabilities = ap + payroll;
      const current_ratio    = liabilities > 0 ? (cash + ar) / liabilities : null;
      const quick_ratio      = liabilities > 0 ? cash / liabilities : null;
      const ar_to_ap         = ap > 0 ? ar / ap : null;
      const payroll_coverage = payroll > 0 ? cash / payroll : null;

      return {
        week_ending: row.week_ending as string,
        cash,
        ar,
        ap,
        payroll,
        net_position: cash - ap - payroll,
        cash_change,
        ar_change,
        ap_change,
        payroll_change,
        ar_collected,
        ap_paid,
        bids_submitted_count: n(row.bids_submitted_count),
        bids_submitted_value: n(row.bids_submitted_value),
        bids_won_count:       n(row.bids_won_count),
        bids_won_value:       n(row.bids_won_value),
        current_ratio,
        quick_ratio,
        ar_to_ap,
        net_liquidity: cash - ap - payroll,
        payroll_coverage,
        cash_coverage_weeks: null as number | null, // filled in pass 2
      };
    });

    // ── Pass 2: compute global avg cash burn → cash_coverage_weeks ───────────
    const cashChanges = weeksBase
      .filter((w) => w.cash_change !== null)
      .map((w) => w.cash_change!);
    const avgCashChange =
      cashChanges.length > 0
        ? cashChanges.reduce((s, v) => s + v, 0) / cashChanges.length
        : 0;

    const weeks: WeekMetric[] = weeksBase.map((w) => ({
      ...w,
      cash_coverage_weeks:
        avgCashChange < 0 && w.cash > 0
          ? w.cash / Math.abs(avgCashChange)
          : null,
    }));

    // ── 3. Monthly aggregates ─────────────────────────────────────────────────
    // Group weeks by YYYY-MM and average the category totals.
    const monthMap = new Map<
      string,
      {
        cash: number[]; ar: number[]; ap: number[]; payroll: number[];
        net: number[]; sub_value: number; won_value: number;
        sub_count: number; won_count: number;
      }
    >();

    for (const w of weeks) {
      const month = w.week_ending.slice(0, 7); // "YYYY-MM"
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          cash: [], ar: [], ap: [], payroll: [], net: [],
          sub_value: 0, won_value: 0, sub_count: 0, won_count: 0,
        });
      }
      const m = monthMap.get(month)!;
      m.cash.push(w.cash);
      m.ar.push(w.ar);
      m.ap.push(w.ap);
      m.payroll.push(w.payroll);
      m.net.push(w.net_position);
      m.sub_value += w.bids_submitted_value;
      m.won_value += w.bids_won_value;
      m.sub_count += w.bids_submitted_count;
      m.won_count += w.bids_won_count;
    }

    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

    const months: MonthMetric[] = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        avg_cash:    avg(m.cash),
        avg_ar:      avg(m.ar),
        avg_ap:      avg(m.ap),
        avg_payroll: avg(m.payroll),
        avg_net_position: avg(m.net),
        total_bids_submitted_value: m.sub_value,
        total_bids_won_value:       m.won_value,
        win_rate_pct:
          m.sub_count > 0 ? (m.won_count / m.sub_count) * 100 : 0,
      }));

    const response: MetricsResponse = { weeks, months };
    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/metrics error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
