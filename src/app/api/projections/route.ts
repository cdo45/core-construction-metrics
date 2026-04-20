import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ─── Exported types ───────────────────────────────────────────────────────────

export interface BaselineRates {
  avg_weekly_cash_change: number;
  avg_weekly_ar_billing: number;
  avg_weekly_ar_collection: number;
  avg_collection_rate: number;
  avg_weekly_ap_new_invoices: number;
  avg_weekly_ap_payments: number;
  avg_weekly_payroll_accrual: number;
  avg_weekly_payroll_remittance: number;
  payroll_remittance_frequency: number;
  weeks_since_last_payroll_remittance: number;
  weeks_since_last_union_remittance: number;
  insurance_payment_amount: number;
  insurance_payment_frequency: number;
  historical_weeks_count: number;
  avg_overhead_cash_burn: number;
  avg_overhead_non_cash: number;
}

export interface ProjectedWeek {
  week_ending: string;
  cash: number;
  ar: number;
  ap: number;
  payroll: number;
  net_position: number;
  cash_change: number;
  ar_collections: number;
  new_billing: number;
  ap_payments: number;
  new_invoices: number;
  payroll_remit: number;
  notes: string[];
}

export interface ScenarioData {
  label: string;
  color: string;
  assumptions: {
    collection_rate_multiplier: number;
    ap_payment_rate: number;
    new_ap_invoices: number;
    new_ar_billing: number;
    payroll_accrual: number;
  };
  weeks: ProjectedWeek[];
}

export interface HistoricalWeek {
  week_ending: string;
  cash: number;
  ar: number;
  ap: number;
  payroll: number;
  net_position: number;
}

export interface ProjectionsData {
  latest_week: string;
  historical_weeks: HistoricalWeek[];
  baseline_rates: BaselineRates;
  scenarios: {
    ideal: ScenarioData;
    realistic: ScenarioData;
    survival: ScenarioData;
  };
  action_items: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const p = parseFloat(String(v));
  return isFinite(p) ? p : 0;
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Add N weeks (7 days each) to an ISO date string. */
function addWeeks(iso: string, weeks: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Projection engine ────────────────────────────────────────────────────────

interface ScenarioConfig {
  label: string;
  color: string;
  collection_rate_multiplier: number;
  ap_payment_rate: number;
  new_ap_invoices: number;
  new_ar_billing: number;
  payroll_accrual: number;
  remittance_on_schedule: boolean;
}

function runScenario(
  config: ScenarioConfig,
  rates: BaselineRates,
  latest: { cash: number; ar: number; ap: number; payroll: number },
  numWeeks: number,
  latestWeekEnding: string
): ScenarioData {
  let { cash, ar, ap, payroll } = latest;

  // Track weeks since last payroll remittance
  let weeksSincePayroll = rates.weeks_since_last_payroll_remittance;
  let weeksSinceUnion   = rates.weeks_since_last_union_remittance;
  let weeksSinceInsurance = rates.insurance_payment_frequency > 0
    ? Math.round(rates.insurance_payment_frequency * 0.5) // assume mid-cycle
    : 999;

  const projectedWeeks: ProjectedWeek[] = [];

  for (let w = 1; w <= numWeeks; w++) {
    const weekEnding = addWeeks(latestWeekEnding, w);
    const notes: string[] = [];

    weeksSincePayroll    += 1;
    weeksSinceUnion      += 1;
    weeksSinceInsurance  += 1;

    // ── AR ──────────────────────────────────────────────────────────────────

    const ar_collections = ar * rates.avg_collection_rate * config.collection_rate_multiplier;
    const new_billing    = rates.avg_weekly_ar_billing * config.new_ar_billing;
    const new_ar         = Math.max(0, ar + new_billing - ar_collections);

    // ── AP ──────────────────────────────────────────────────────────────────

    const new_invoices = rates.avg_weekly_ap_new_invoices * config.new_ap_invoices;
    const ap_payments  = rates.avg_weekly_ap_payments * config.ap_payment_rate;
    const new_ap       = Math.max(0, ap + new_invoices - ap_payments);

    // ── Payroll ──────────────────────────────────────────────────────────────

    const payroll_growth = rates.avg_weekly_payroll_accrual * config.payroll_accrual;
    let payroll_remit = 0;

    const shouldRemitPayroll =
      config.remittance_on_schedule &&
      rates.payroll_remittance_frequency > 0 &&
      weeksSincePayroll >= rates.payroll_remittance_frequency;

    if (shouldRemitPayroll) {
      payroll_remit = rates.avg_weekly_payroll_remittance;
      weeksSincePayroll = 0;
      notes.push(`Payroll remittance ~${fmtMoney(payroll_remit)}`);
    }

    const new_payroll = Math.max(0, payroll + payroll_growth - payroll_remit);

    // ── Union remittance ─────────────────────────────────────────────────────

    let union_remit = 0;
    if (
      config.remittance_on_schedule &&
      rates.weeks_since_last_union_remittance > 0 &&
      weeksSinceUnion >= rates.payroll_remittance_frequency // use same frequency as payroll
    ) {
      // Estimate union portion as ~30% of payroll remittance if specific data not available
      union_remit = payroll_remit * 0.3;
      weeksSinceUnion = 0;
      if (union_remit > 0) notes.push(`Union remittance ~${fmtMoney(union_remit)}`);
    }

    // ── Insurance ────────────────────────────────────────────────────────────

    let insurance_payment = 0;
    if (
      rates.insurance_payment_amount > 0 &&
      rates.insurance_payment_frequency > 0 &&
      weeksSinceInsurance >= rates.insurance_payment_frequency
    ) {
      insurance_payment = rates.insurance_payment_amount;
      weeksSinceInsurance = 0;
      notes.push(`Insurance payment ~${fmtMoney(insurance_payment)}`);
    }

    // ── Cash ─────────────────────────────────────────────────────────────────

    const cash_out  = ap_payments + payroll_remit + insurance_payment + rates.avg_overhead_cash_burn;
    const cash_in   = ar_collections;
    const new_cash  = cash + cash_in - cash_out;
    const cash_change = new_cash - cash;

    if (new_cash < 0) {
      notes.push(`⚠ Cash goes negative at ${fmtMoney(new_cash)}`);
    }

    projectedWeeks.push({
      week_ending: weekEnding,
      cash:         new_cash,
      ar:           new_ar,
      ap:           new_ap,
      payroll:      new_payroll,
      net_position: new_cash - new_ap - new_payroll,
      cash_change,
      ar_collections,
      new_billing,
      ap_payments,
      new_invoices,
      payroll_remit,
      notes,
    });

    cash    = new_cash;
    ar      = new_ar;
    ap      = new_ap;
    payroll = new_payroll;
  }

  return {
    label: config.label,
    color: config.color,
    assumptions: {
      collection_rate_multiplier: config.collection_rate_multiplier,
      ap_payment_rate:            config.ap_payment_rate,
      new_ap_invoices:            config.new_ap_invoices,
      new_ar_billing:             config.new_ar_billing,
      payroll_accrual:            config.payroll_accrual,
    },
    weeks: projectedWeeks,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const sql = getDb();

    // ── 1. Weekly category totals ─────────────────────────────────────────────
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
      ORDER BY w.week_ending ASC
    `;

    if (rawWeeks.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 weeks of data to compute projections." },
        { status: 422 }
      );
    }

    // Parse into typed rows
    const weeks = rawWeeks.map((r) => ({
      week_ending: r.week_ending as string,
      cash:    n(r.cash),
      ar:      n(r.ar),
      ap:      n(r.ap),
      payroll: n(r.payroll),
    }));

    // ── 2. Account-specific data: account 2120 (union), insurance accounts ────
    const acctRows = await sql`
      SELECT
        g.account_no,
        g.description,
        wb.week_ending::text,
        wb.end_balance::numeric AS end_balance
      FROM weekly_balances wb
      JOIN gl_accounts g ON g.id = wb.gl_account_id
      WHERE (g.account_no = 2120 OR LOWER(g.description) LIKE '%insurance%')
      ORDER BY g.account_no, wb.week_ending ASC
    `;

    // Index by account_no → array of {week_ending, end_balance}
    const acctHistory = new Map<number, { week_ending: string; end_balance: number }[]>();
    for (const r of acctRows) {
      const ano = Number(r.account_no);
      if (!acctHistory.has(ano)) acctHistory.set(ano, []);
      acctHistory.get(ano)!.push({
        week_ending: r.week_ending as string,
        end_balance: n(r.end_balance),
      });
    }

    // ── 3. Compute WoW deltas and baseline rates ──────────────────────────────

    const cashChanges: number[] = [];
    const arIncreases: number[] = [];
    const arDecreases: number[] = [];  // stored as positive
    const apIncreases: number[] = [];
    const apDecreases: number[] = [];
    const payrollIncreases: number[] = [];
    const payrollDecreases: number[] = [];
    const payrollDecreaseWeekIdxs: number[] = []; // indices where payroll decreased

    for (let i = 1; i < weeks.length; i++) {
      const cur = weeks[i];
      const prv = weeks[i - 1];

      cashChanges.push(cur.cash - prv.cash);

      const dAR = cur.ar - prv.ar;
      if (dAR > 0) arIncreases.push(dAR);
      else if (dAR < 0) arDecreases.push(-dAR);

      const dAP = cur.ap - prv.ap;
      if (dAP > 0) apIncreases.push(dAP);
      else if (dAP < 0) apDecreases.push(-dAP);

      const dPay = cur.payroll - prv.payroll;
      if (dPay > 0) payrollIncreases.push(dPay);
      else if (dPay < 0) {
        payrollDecreases.push(-dPay);
        payrollDecreaseWeekIdxs.push(i);
      }
    }

    // Payroll remittance frequency (avg weeks between decreases)
    let payrollRemittanceFrequency = 4; // default: every 4 weeks
    if (payrollDecreaseWeekIdxs.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < payrollDecreaseWeekIdxs.length; i++) {
        gaps.push(payrollDecreaseWeekIdxs[i] - payrollDecreaseWeekIdxs[i - 1]);
      }
      payrollRemittanceFrequency = Math.round(avg(gaps));
    }

    const lastPayrollDecreaseIdx =
      payrollDecreaseWeekIdxs.length > 0
        ? payrollDecreaseWeekIdxs[payrollDecreaseWeekIdxs.length - 1]
        : -1;
    const weeksSinceLastPayrollRemittance =
      lastPayrollDecreaseIdx >= 0
        ? weeks.length - 1 - lastPayrollDecreaseIdx
        : Math.floor(payrollRemittanceFrequency / 2);

    // Union remittance (account 2120)
    let weeksSinceLastUnionRemittance = weeksSinceLastPayrollRemittance; // fallback
    const unionHistory = acctHistory.get(2120) ?? [];
    if (unionHistory.length >= 2) {
      let lastDecreaseIdx = -1;
      for (let i = 1; i < unionHistory.length; i++) {
        if (unionHistory[i].end_balance < unionHistory[i - 1].end_balance) {
          lastDecreaseIdx = i;
        }
      }
      if (lastDecreaseIdx >= 0) {
        weeksSinceLastUnionRemittance = unionHistory.length - 1 - lastDecreaseIdx;
      }
    }

    // Insurance payment stats (from insurance accounts)
    let insurancePaymentAmount   = 0;
    let insurancePaymentFrequency = 0;
    for (const [, history] of acctHistory.entries()) {
      if (history.length < 2) continue;
      const decreases: number[] = [];
      const decIdxs: number[]   = [];
      for (let i = 1; i < history.length; i++) {
        const d = history[i].end_balance - history[i - 1].end_balance;
        if (d < 0) {
          decreases.push(-d);
          decIdxs.push(i);
        }
      }
      if (decreases.length > 0) {
        insurancePaymentAmount += avg(decreases);
        if (decIdxs.length >= 2) {
          const gaps: number[] = [];
          for (let j = 1; j < decIdxs.length; j++) gaps.push(decIdxs[j] - decIdxs[j - 1]);
          insurancePaymentFrequency = Math.round(avg(gaps));
        }
      }
    }
    if (insurancePaymentFrequency === 0 && insurancePaymentAmount > 0) {
      insurancePaymentFrequency = 4; // default monthly
    }

    const avgAR = avg(weeks.map((w) => w.ar));

    const avgWeeklyArCollection = avg(arDecreases);
    const avgCollectionRate =
      avgAR > 0 && avgWeeklyArCollection > 0
        ? avgWeeklyArCollection / avgAR
        : 0.1; // fallback 10%

    // ── 3b. Trailing 4-week overhead averages ────────────────────────────────
    let avgOverheadCashBurn = 0;
    let avgOverheadNonCash  = 0;
    let latestOverheadCash  = 0;

    try {
      const ohRows = await sql`
        SELECT
          wos.week_ending::text,
          COALESCE(SUM(CASE WHEN g.is_non_cash = FALSE THEN wos.net_activity ELSE 0 END), 0)::numeric AS cash_oh,
          COALESCE(SUM(CASE WHEN g.is_non_cash = TRUE  THEN wos.net_activity ELSE 0 END), 0)::numeric AS non_cash_oh
        FROM weekly_overhead_spend wos
        JOIN gl_accounts g ON g.id = wos.gl_account_id
        WHERE wos.division = '99'
        GROUP BY wos.week_ending
        ORDER BY wos.week_ending DESC
        LIMIT 4
      `;
      if (ohRows.length > 0) {
        avgOverheadCashBurn = ohRows.reduce((s, r) => s + n(r.cash_oh),     0) / ohRows.length;
        avgOverheadNonCash  = ohRows.reduce((s, r) => s + n(r.non_cash_oh), 0) / ohRows.length;
        latestOverheadCash  = n(ohRows[0].cash_oh);
      }
    } catch {
      // is_non_cash column may not exist yet — try without it
      try {
        const ohRows = await sql`
          SELECT
            week_ending::text,
            COALESCE(SUM(net_activity), 0)::numeric AS cash_oh
          FROM weekly_overhead_spend
          WHERE division = '99'
          GROUP BY week_ending
          ORDER BY week_ending DESC
          LIMIT 4
        `;
        if (ohRows.length > 0) {
          avgOverheadCashBurn = ohRows.reduce((s, r) => s + n(r.cash_oh), 0) / ohRows.length;
          latestOverheadCash  = n(ohRows[0].cash_oh);
        }
      } catch {
        // no overhead data available
      }
    }

    const rates: BaselineRates = {
      avg_weekly_cash_change:          avg(cashChanges),
      avg_weekly_ar_billing:           avg(arIncreases) || 0,
      avg_weekly_ar_collection:        avgWeeklyArCollection || 0,
      avg_collection_rate:             avgCollectionRate,
      avg_weekly_ap_new_invoices:      avg(apIncreases) || 0,
      avg_weekly_ap_payments:          avg(apDecreases) || 0,
      avg_weekly_payroll_accrual:      avg(payrollIncreases) || 0,
      avg_weekly_payroll_remittance:   avg(payrollDecreases) || 0,
      payroll_remittance_frequency:    payrollRemittanceFrequency,
      weeks_since_last_payroll_remittance: weeksSinceLastPayrollRemittance,
      weeks_since_last_union_remittance:   weeksSinceLastUnionRemittance,
      insurance_payment_amount:        insurancePaymentAmount,
      insurance_payment_frequency:     insurancePaymentFrequency,
      historical_weeks_count:          weeks.length,
      avg_overhead_cash_burn:          avgOverheadCashBurn,
      avg_overhead_non_cash:           avgOverheadNonCash,
    };

    const latest = weeks[weeks.length - 1];
    const latestWeekEnding = latest.week_ending;

    // ── 4. Run three scenarios ────────────────────────────────────────────────

    const scenarioConfigs: Record<string, ScenarioConfig> = {
      ideal: {
        label: "Strengthen Position",
        color: "#548235",
        collection_rate_multiplier: 2.0,
        ap_payment_rate:            0.5,
        new_ap_invoices:            0.8,
        new_ar_billing:             1.0,
        payroll_accrual:            1.0,
        remittance_on_schedule:     true,
      },
      realistic: {
        label: "Business as Usual",
        color: "#4472C4",
        collection_rate_multiplier: 1.0,
        ap_payment_rate:            1.0,
        new_ap_invoices:            1.0,
        new_ar_billing:             1.0,
        payroll_accrual:            1.0,
        remittance_on_schedule:     true,
      },
      survival: {
        label: "Keep the Lights On",
        color: "#C00000",
        collection_rate_multiplier: 0.5,
        ap_payment_rate:            1.2,
        new_ap_invoices:            1.2,
        new_ar_billing:             0.7,
        payroll_accrual:            1.0,
        remittance_on_schedule:     true,
      },
    };

    const ideal    = runScenario(scenarioConfigs.ideal,    rates, latest, 4, latestWeekEnding);
    const realistic = runScenario(scenarioConfigs.realistic, rates, latest, 4, latestWeekEnding);
    const survival = runScenario(scenarioConfigs.survival,  rates, latest, 4, latestWeekEnding);

    // ── 5. Auto-generate action items ─────────────────────────────────────────

    const action_items: string[] = [];

    // Ideal collections target
    const idealTotalCollections = ideal.weeks.reduce((s, w) => s + w.ar_collections, 0);
    if (idealTotalCollections > 0) {
      action_items.push(
        `Collect ${fmtMoney(idealTotalCollections)} from AR over the next 4 weeks to hit the ideal target.`
      );
    }

    // AP deferral opportunity
    const idealApSavings = realistic.weeks.reduce((s, w) => s + w.ap_payments, 0) -
      ideal.weeks.reduce((s, w) => s + w.ap_payments, 0);
    if (idealApSavings > 0) {
      action_items.push(
        `Deferring ~${fmtMoney(idealApSavings)} in AP payments (ideal scenario) would strengthen cash by Week +4.`
      );
    }

    // Payroll remittance schedule
    ideal.weeks.forEach((w, i) => {
      if (w.payroll_remit > 0) {
        action_items.push(
          `Payroll remittance of ~${fmtMoney(w.payroll_remit)} expected in Week +${i + 1} (${w.week_ending}).`
        );
      }
    });

    // Insurance events
    ideal.weeks.forEach((w, i) => {
      const insNote = w.notes.find((n) => n.startsWith("Insurance"));
      if (insNote) {
        action_items.push(`${insNote} — Week +${i + 1} (${w.week_ending}).`);
      }
    });

    // Survival warning: if survival cash goes negative
    survival.weeks.forEach((w, i) => {
      if (w.cash < 0) {
        const realisticW = realistic.weeks[i];
        const collectTarget = realisticW.ar_collections * 1.5;
        action_items.push(
          `⚠ Cash goes negative in Week +${i + 1} under the worst case — ensure AR collections exceed ${fmtMoney(collectTarget)}/week to avoid a cash shortfall.`
        );
      }
    });

    // Overhead acceleration warning
    if (avgOverheadCashBurn > 0 && latestOverheadCash > avgOverheadCashBurn * 1.2) {
      action_items.push(
        `⚠ Overhead spending accelerating — latest week ${fmtMoney(latestOverheadCash)} vs ${fmtMoney(avgOverheadCashBurn)} trailing avg (${((latestOverheadCash / avgOverheadCashBurn - 1) * 100).toFixed(0)}% above average).`
      );
    }

    // Week +4 net position comparison
    const idealW4    = ideal.weeks[3];
    const survivalW4 = survival.weeks[3];
    if (idealW4 && survivalW4) {
      const spread = idealW4.net_position - survivalW4.net_position;
      if (spread > 0) {
        action_items.push(
          `Range of outcomes by Week +4: ${fmtMoney(survivalW4.net_position)} (worst) to ${fmtMoney(idealW4.net_position)} (best) net position — a ${fmtMoney(spread)} spread.`
        );
      }
    }

    // ── 6. Build response ─────────────────────────────────────────────────────

    const historical_weeks: HistoricalWeek[] = weeks.slice(-8).map((w) => ({
      week_ending: w.week_ending,
      cash:         w.cash,
      ar:           w.ar,
      ap:           w.ap,
      payroll:      w.payroll,
      net_position: w.cash - w.ap - w.payroll,
    }));

    const response: ProjectionsData = {
      latest_week: latestWeekEnding,
      historical_weeks,
      baseline_rates: rates,
      scenarios: { ideal, realistic, survival },
      action_items,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("GET /api/projections error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
