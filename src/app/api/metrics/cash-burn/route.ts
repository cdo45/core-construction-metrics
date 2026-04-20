import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyBurn {
  overhead_cash:    number;
  overhead_non_cash: number;
  payroll_outflow:  number;
  ap_paydown:       number;
  ar_collections:   number;
  net_weekly_burn:  number;
}

export interface FixedOverheadAccount {
  account_no:       number;
  description:      string;
  trailing_4wk_avg: number;
  variance_pct:     number;
}

export interface CashBurnData {
  current_cash:          number;
  safety_floor:          number;
  weekly_burn:           WeeklyBurn;
  prior_net_weekly_burn: number | null;
  runway_weeks:          number;
  critical_date:         string | null;
  required_weekly_ar:    number;
  data_confidence:       "low" | "medium" | "high";
  fixed_overhead_accounts: FixedOverheadAccount[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

function avgOf(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

interface WeekRow {
  week_ending: string;
  cash:    number;
  ar:      number;
  ap:      number;
  payroll: number;
}

// Compute burn components from a slice of week rows (sorted DESC).
// Returns average outflow/inflow figures across the delta periods in this slice.
function burnFromSlice(slice: WeekRow[]): {
  payroll_outflow: number;
  ap_paydown:      number;
  ar_collections:  number;
} {
  if (slice.length < 2) return { payroll_outflow: 0, ap_paydown: 0, ar_collections: 0 };

  const payrollOutflows: number[] = [];
  const apPaydowns:      number[] = [];
  const arCollections:   number[] = [];

  for (let i = 0; i < slice.length - 1; i++) {
    // slice[i] is more recent than slice[i+1]
    const dAR      = slice[i].ar      - slice[i + 1].ar;
    const dAP      = slice[i].ap      - slice[i + 1].ap;
    const dPayroll = slice[i].payroll - slice[i + 1].payroll;

    if (dAR      < 0) arCollections.push(-dAR);
    if (dAP      < 0) apPaydowns.push(-dAP);
    if (dPayroll < 0) payrollOutflows.push(-dPayroll);
  }

  return {
    payroll_outflow: avgOf(payrollOutflows),
    ap_paydown:      avgOf(apPaydowns),
    ar_collections:  avgOf(arCollections),
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const sql = getDb();

    // ── 1. Last 9 weeks of category totals (for current + prior period) ────────
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
        COALESCE(MAX(CASE WHEN ct.cat = 'Payroll Liabilities' THEN ct.total END), 0) AS payroll
      FROM (SELECT DISTINCT week_ending FROM weekly_balances) w
      LEFT JOIN cat_totals ct ON ct.week_ending = w.week_ending
      GROUP BY w.week_ending
      ORDER BY w.week_ending DESC
      LIMIT 9
    `;

    if (rawWeeks.length < 2) {
      return NextResponse.json({ error: "Not enough data" }, { status: 422 });
    }

    const weeks: WeekRow[] = rawWeeks.map((r) => ({
      week_ending: r.week_ending as string,
      cash:    n(r.cash),
      ar:      n(r.ar),
      ap:      n(r.ap),
      payroll: n(r.payroll),
    }));

    // ── 2. Safety floor from app_settings ────────────────────────────────────
    let safety_floor = 500_000;
    try {
      const sfRows = await sql`
        SELECT value FROM app_settings WHERE key = 'cash_safety_floor'
      `;
      if (sfRows.length > 0) safety_floor = n(sfRows[0].value);
    } catch {
      // table may not exist yet — use default
    }

    // ── 3. Overhead spend (last 4 weeks) from weekly_balances ────────────────
    interface OverheadWeek {
      week_ending:       string;
      cash_overhead:     number;
      non_cash_overhead: number;
    }

    const ohRows = await sql`
      SELECT
        wb.week_ending::text,
        SUM(wb.period_debit - wb.period_credit)::numeric AS net_overhead
      FROM weekly_balances wb
      JOIN gl_accounts g ON g.id = wb.gl_account_id
      JOIN categories  c ON c.id = g.category_id
      WHERE c.name = 'Overhead (Div 99)'
      GROUP BY wb.week_ending
      ORDER BY wb.week_ending DESC
      LIMIT 4
    `;

    const overheadWeeks: OverheadWeek[] = ohRows.map((r) => ({
      week_ending:       r.week_ending as string,
      cash_overhead:     n(r.net_overhead),
      non_cash_overhead: 0,
    }));

    const overheadDataWeeks = overheadWeeks.length;
    const avgOverheadCash    = avgOf(overheadWeeks.map((w) => w.cash_overhead));
    const avgOverheadNonCash = 0;

    const data_confidence: "low" | "medium" | "high" =
      overheadDataWeeks >= 4 ? "high" :
      overheadDataWeeks >= 2 ? "medium" : "low";

    // ── 4. Compute burn components from balance history ───────────────────────
    // weeks[0] = most recent, weeks[N-1] = oldest
    // Current period: use 5 rows (indices 0-4) → 4 delta periods
    // Prior period:   use 5 rows (indices 4-8) → 4 delta periods (if available)

    const currentSlice = weeks.slice(0, 5);
    const priorSlice   = weeks.length >= 9 ? weeks.slice(4, 9) : null;

    const current = burnFromSlice(currentSlice);
    const prior   = priorSlice ? burnFromSlice(priorSlice) : null;

    const net_weekly_burn = avgOverheadCash + current.payroll_outflow + current.ap_paydown - current.ar_collections;
    const prior_net_weekly_burn = prior
      ? avgOverheadCash + prior.payroll_outflow + prior.ap_paydown - prior.ar_collections
      : null;

    // ── 5. Runway ─────────────────────────────────────────────────────────────
    const current_cash    = weeks[0].cash;
    const available_cash  = Math.max(0, current_cash - safety_floor);
    const runway_weeks    = net_weekly_burn > 0
      ? Math.max(0, available_cash / net_weekly_burn)
      : 999;

    const critical_date = runway_weeks < 999
      ? addDays(weeks[0].week_ending, runway_weeks * 7)
      : null;

    const required_weekly_ar = avgOverheadCash + current.payroll_outflow + current.ap_paydown;

    // ── 6. Per-account overhead breakdown from weekly_balances ───────────────
    let fixed_overhead_accounts: FixedOverheadAccount[] = [];

    if (overheadDataWeeks >= 2 && overheadWeeks.length > 0) {
      const cutoffDate   = overheadWeeks[overheadWeeks.length - 1].week_ending;
      const latestOhWeek = overheadWeeks[0].week_ending;

      const acctRows = await sql`
        SELECT
          g.account_no,
          g.division,
          g.description,
          AVG(wb.period_debit - wb.period_credit)::numeric AS trailing_avg,
          MAX(CASE WHEN wb.week_ending = ${latestOhWeek}::date
                   THEN wb.period_debit - wb.period_credit END)::numeric AS last_week_amt
        FROM weekly_balances wb
        JOIN gl_accounts g ON g.id = wb.gl_account_id
        JOIN categories  c ON c.id = g.category_id
        WHERE c.name = 'Overhead (Div 99)'
          AND wb.week_ending >= ${cutoffDate}::date
        GROUP BY g.account_no, g.division, g.description
        HAVING AVG(wb.period_debit - wb.period_credit) > 0
        ORDER BY AVG(wb.period_debit - wb.period_credit) DESC
        LIMIT 10
      `;
      fixed_overhead_accounts = acctRows.map((r) => {
        const avg  = n(r.trailing_avg);
        const last = n(r.last_week_amt);
        return {
          account_no:       Number(r.account_no),
          description:      String(r.description),
          trailing_4wk_avg: avg,
          variance_pct:     avg > 0 ? ((last - avg) / avg) * 100 : 0,
        };
      });
    }

    // ── 7. Response ───────────────────────────────────────────────────────────
    const response: CashBurnData = {
      current_cash,
      safety_floor,
      weekly_burn: {
        overhead_cash:    avgOverheadCash,
        overhead_non_cash: avgOverheadNonCash,
        payroll_outflow:  current.payroll_outflow,
        ap_paydown:       current.ap_paydown,
        ar_collections:   current.ar_collections,
        net_weekly_burn,
      },
      prior_net_weekly_burn,
      runway_weeks,
      critical_date,
      required_weekly_ar,
      data_confidence,
      fixed_overhead_accounts,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/metrics/cash-burn error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
