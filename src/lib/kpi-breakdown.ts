// KPI breakdown helper.
//
// For a given metricKey + the latest WeekMetric + the per-account snapshot
// the API ships in MetricsResponse.account_breakdown, returns the human-
// readable formula, the input rows that feed it (account-level for SUM-
// based KPIs, numerator/denominator for ratios), the substituted-numbers
// computation string, and the final result that should match the card
// face.
//
// The drilldown modal renders the four fields directly. New metric keys
// can be added by extending the switch — the helper deliberately doesn't
// import any UI / formatting concerns beyond money + ratio formatters.
//
// Formulas mirror /api/metrics/route.ts exactly:
//   net_liquidity = cat_1_cash − ap − payroll_accruals
//   current_ratio = (cat_1_cash + cat_2_ar) / (ap + payroll_accruals)
//   quick_ratio   =  cat_1_cash             / (ap + payroll_accruals)
//   ar_to_ap      =  cat_2_ar               /  ap
// where ap = |end_balance(2005)| and payroll_accruals =
// |Σ end_balance(2150–2166)|.

import type { WeekMetric, AccountSnapshot } from "@/app/api/metrics/route";

// ─── Constants (must mirror /api/metrics) ────────────────────────────────────

const CAT = {
  CASH:          1,
  AR:            2,
  CURRENT_DEBT:  3,
  PAYROLL_LIAB:  5,
  PAYROLL_FIELD: 6,
  OVERHEAD:      7,
  REVENUE:       8,
  DJC:           9,
} as const;

const ACCT_AP = 2005;
const ACCT_PAYROLL_ACCRUALS_MIN = 2150;
const ACCT_PAYROLL_ACCRUALS_MAX = 2166;

// ─── Public types ────────────────────────────────────────────────────────────

export interface KpiInput {
  /** Display label — usually the gl_account description, or "Subtotal" /
   *  "Numerator" for derived rows. */
  label: string;
  /** Signed value (matches the underlying storage convention). */
  value: number;
  /** Optional secondary text (account number, derivation hint). */
  detail?: string;
  /** When true the modal renders this row in bold and adds a divider
   *  above it. Used for Subtotal / Numerator / Denominator rows. */
  emphasis?: boolean;
}

export interface KpiBreakdown {
  /** Human-readable formula (e.g. "Net Liquidity = Cash − AP − Payroll Accruals"). */
  formula: string;
  /** Input rows feeding the formula. */
  inputs: KpiInput[];
  /** Substituted-numbers computation string. */
  computation: string;
  /** Final value — must match the value displayed on the card face. */
  result: number;
  /** Format hint for the modal so it knows how to render `result`. */
  resultFormat: "money" | "ratio";
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtRatio(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toFixed(3);
}

// Build "a + b + c" style strings without showing a leading "+".
function joinPlus(values: number[]): string {
  if (values.length === 0) return "0";
  return values.map((v) => fmtMoney(v)).join(" + ");
}

// ─── Account-level helpers ───────────────────────────────────────────────────

function filterAccounts(
  accounts: AccountSnapshot[],
  pred: (a: AccountSnapshot) => boolean,
): { rows: AccountSnapshot[]; sum: number } {
  const rows = accounts.filter(pred);
  const sum = rows.reduce((s, a) => s + a.end_balance, 0);
  return { rows, sum };
}

function accountInputRows(rows: AccountSnapshot[]): KpiInput[] {
  return rows.map((a) => ({
    label: a.description || `Account ${a.account_no}`,
    value: a.end_balance,
    detail: a.division ? `Acct ${a.account_no} · div ${a.division}` : `Acct ${a.account_no}`,
  }));
}

// ─── Sum-based BS metrics ────────────────────────────────────────────────────

function sumByCategory(
  formula: string,
  subtotalLabel: string,
  accounts: AccountSnapshot[],
  categoryId: number,
): KpiBreakdown {
  const { rows, sum } = filterAccounts(accounts, (a) => a.category_id === categoryId);
  return {
    formula,
    inputs: [
      ...accountInputRows(rows),
      { label: subtotalLabel, value: sum, emphasis: true },
    ],
    computation:
      rows.length === 0
        ? "(no accounts in category) = $0.00"
        : `${joinPlus(rows.map((r) => r.end_balance))} = ${fmtMoney(sum)}`,
    result: sum,
    resultFormat: "money",
  };
}

// ─── Main dispatch ───────────────────────────────────────────────────────────

export function getKpiBreakdown(
  metricKey: string,
  weekData: WeekMetric,
  breakdown: AccountSnapshot[],
): KpiBreakdown | null {
  switch (metricKey) {
    // ── BS sums ────────────────────────────────────────────────────────────
    case "cash":
      return sumByCategory(
        "Cash on Hand = Σ end_balance for accounts in Cash category (cat 1)",
        "Subtotal: Cash on Hand",
        breakdown,
        CAT.CASH,
      );

    case "ar":
      return sumByCategory(
        "AR = Σ end_balance for accounts in Accounts Receivable category (cat 2)",
        "Subtotal: AR",
        breakdown,
        CAT.AR,
      );

    // ── AP (specific account, ABS for display) ─────────────────────────────
    case "ap": {
      const { rows, sum } = filterAccounts(breakdown, (a) => a.account_no === ACCT_AP);
      const result = Math.abs(sum);
      const inputs: KpiInput[] = [
        ...accountInputRows(rows),
        { label: "Subtotal (signed)", value: sum, emphasis: true },
        { label: "AP (absolute value)", value: result, emphasis: true },
      ];
      return {
        formula: "AP = |Σ end_balance for account 2005 (all divisions)|",
        inputs,
        computation:
          rows.length === 0
            ? "(no rows for account 2005) = $0.00"
            : `|${joinPlus(rows.map((r) => r.end_balance))}| = |${fmtMoney(sum)}| = ${fmtMoney(result)}`,
        result,
        resultFormat: "money",
      };
    }

    // ── Net Liquidity = Cash − AP − Payroll Accruals ──────────────────────
    case "net_liquidity": {
      const cash = weekData.cat_1_cash;
      const ap = weekData.ap;
      const accruals = weekData.payroll_accruals;
      const result = cash - ap - accruals;
      // Account-level expansion of the payroll-accruals term so the user
      // can see the 2150–2166 range that was summed.
      const { rows: accrualRows, sum: accrualSigned } = filterAccounts(
        breakdown,
        (a) =>
          a.account_no >= ACCT_PAYROLL_ACCRUALS_MIN &&
          a.account_no <= ACCT_PAYROLL_ACCRUALS_MAX,
      );
      return {
        formula: "Net Liquidity = Cash − AP − Payroll Accruals",
        inputs: [
          { label: "Cash", value: cash, detail: "Σ end_balance for cat 1" },
          { label: "AP", value: ap, detail: "|end_balance(2005)|" },
          { label: "Payroll Accruals", value: accruals, detail: `|Σ end_balance(${ACCT_PAYROLL_ACCRUALS_MIN}–${ACCT_PAYROLL_ACCRUALS_MAX})|` },
          ...(accrualRows.length > 0
            ? [
                ...accountInputRows(accrualRows),
                { label: "Subtotal (signed)", value: accrualSigned, emphasis: true } as KpiInput,
              ]
            : []),
        ],
        computation: `${fmtMoney(cash)} − ${fmtMoney(ap)} − ${fmtMoney(accruals)} = ${fmtMoney(result)}`,
        result,
        resultFormat: "money",
      };
    }

    // ── Current Ratio = (Cash + AR) / (AP + Payroll Accruals) ─────────────
    case "current_ratio": {
      const cash = weekData.cat_1_cash;
      const ar = weekData.cat_2_ar;
      const ap = weekData.ap;
      const accruals = weekData.payroll_accruals;
      const numerator = cash + ar;
      const denominator = ap + accruals;
      const ok = denominator > 0;
      const result = ok ? numerator / denominator : NaN;
      return {
        formula: "Current Ratio = (Cash + AR) / (AP + Payroll Accruals)",
        inputs: [
          { label: "Cash", value: cash },
          { label: "AR", value: ar },
          { label: "Numerator: Cash + AR", value: numerator, emphasis: true },
          { label: "AP", value: ap },
          { label: "Payroll Accruals", value: accruals },
          { label: "Denominator: AP + Payroll Accruals", value: denominator, emphasis: true },
        ],
        computation: ok
          ? `(${fmtMoney(cash)} + ${fmtMoney(ar)}) / (${fmtMoney(ap)} + ${fmtMoney(accruals)}) = ${fmtMoney(numerator)} / ${fmtMoney(denominator)} = ${fmtRatio(result)}`
          : "denominator is 0 — undefined",
        result,
        resultFormat: "ratio",
      };
    }

    // ── Quick Ratio = Cash / (AP + Payroll Accruals) ──────────────────────
    case "quick_ratio": {
      const cash = weekData.cat_1_cash;
      const ap = weekData.ap;
      const accruals = weekData.payroll_accruals;
      const denominator = ap + accruals;
      const ok = denominator > 0;
      const result = ok ? cash / denominator : NaN;
      return {
        formula: "Quick Ratio = Cash / (AP + Payroll Accruals)",
        inputs: [
          { label: "Cash", value: cash, detail: "Numerator" },
          { label: "AP", value: ap },
          { label: "Payroll Accruals", value: accruals },
          { label: "Denominator: AP + Payroll Accruals", value: denominator, emphasis: true },
        ],
        computation: ok
          ? `${fmtMoney(cash)} / (${fmtMoney(ap)} + ${fmtMoney(accruals)}) = ${fmtMoney(cash)} / ${fmtMoney(denominator)} = ${fmtRatio(result)}`
          : "denominator is 0 — undefined",
        result,
        resultFormat: "ratio",
      };
    }

    // ── AR / AP ───────────────────────────────────────────────────────────
    case "ar_to_ap": {
      const ar = weekData.cat_2_ar;
      const ap = weekData.ap;
      const ok = ap > 0;
      const result = ok ? ar / ap : NaN;
      return {
        formula: "AR/AP = AR ÷ AP",
        inputs: [
          { label: "AR", value: ar, detail: "Numerator" },
          { label: "AP", value: ap, detail: "Denominator" },
        ],
        computation: ok
          ? `${fmtMoney(ar)} / ${fmtMoney(ap)} = ${fmtRatio(result)}`
          : "AP is 0 — undefined",
        result,
        resultFormat: "ratio",
      };
    }

    default:
      return null;
  }
}

// ─── Inline sanity check (dev only) ──────────────────────────────────────────
//
// Mirrors the convention in src/lib/week-math.ts. Runs once at module load
// in dev / test and asserts the helper produces results that match the
// underlying formulas to the cent.

if (process.env.NODE_ENV !== "production") {
  const accounts: AccountSnapshot[] = [
    // cat 1 cash
    { account_no: 1001, division: null, description: "PETTY CASH",         category_id: 1, normal_balance: "debit",  end_balance:    9987.74, period_debit: 0, period_credit: 0 },
    { account_no: 1021, division: "99", description: "Chase BK Operating", category_id: 1, normal_balance: "debit",  end_balance:  908353.56, period_debit: 0, period_credit: 0 },
    // cat 2 AR
    { account_no: 1200, division: "99", description: "AR - Contracts",     category_id: 2, normal_balance: "debit",  end_balance: 4000000.00, period_debit: 0, period_credit: 0 },
    { account_no: 1201, division: "99", description: "AR - Retention",     category_id: 2, normal_balance: "debit",  end_balance:  254264.78, period_debit: 0, period_credit: 0 },
    // AP (account 2005, signed negative)
    { account_no: 2005, division: "99", description: "A/P - TRADE",        category_id: 3, normal_balance: "credit", end_balance: -2766772.88, period_debit: 0, period_credit: 0 },
    // payroll accruals 2150-2166 (signed negative)
    { account_no: 2150, division: "99", description: "Payroll Tax Accrual",category_id: 5, normal_balance: "credit", end_balance:  -50000.00, period_debit: 0, period_credit: 0 },
    { account_no: 2160, division: "99", description: "Workers Comp Accrual", category_id: 5, normal_balance: "credit", end_balance: -50000.00, period_debit: 0, period_credit: 0 },
  ];

  // Minimal WeekMetric stub — the helper only reads cat_1_cash, cat_2_ar,
  // ap, payroll_accruals. Cast the rest with `as` to keep the fixture
  // small.
  const weekData = {
    week_ending: "2026-04-18",
    cat_1_cash: 9987.74 + 908353.56,        // 918,341.30
    cat_2_ar:   4000000.00 + 254264.78,     // 4,254,264.78
    ap:         2766772.88,                  // |−2,766,772.88|
    payroll_accruals: 100000.00,             // |−50,000 + −50,000|
  } as unknown as WeekMetric;

  const cash = getKpiBreakdown("cash", weekData, accounts);
  console.assert(cash !== null && Math.abs(cash.result - 918341.30) < 0.01,
    "[kpi-breakdown] cash:", cash?.result);

  const ar = getKpiBreakdown("ar", weekData, accounts);
  console.assert(ar !== null && Math.abs(ar.result - 4254264.78) < 0.01,
    "[kpi-breakdown] ar:", ar?.result);

  const ap = getKpiBreakdown("ap", weekData, accounts);
  console.assert(ap !== null && Math.abs(ap.result - 2766772.88) < 0.01,
    "[kpi-breakdown] ap:", ap?.result);

  const nl = getKpiBreakdown("net_liquidity", weekData, accounts);
  // 918,341.30 − 2,766,772.88 − 100,000 = −1,948,431.58
  console.assert(nl !== null && Math.abs(nl.result - (-1948431.58)) < 0.01,
    "[kpi-breakdown] net_liquidity:", nl?.result);

  const cr = getKpiBreakdown("current_ratio", weekData, accounts);
  // (918,341.30 + 4,254,264.78) / (2,766,772.88 + 100,000) = 5,172,606.08 / 2,866,772.88 ≈ 1.804
  console.assert(cr !== null && Math.abs(cr.result - 1.8043) < 0.001,
    "[kpi-breakdown] current_ratio:", cr?.result);

  const qr = getKpiBreakdown("quick_ratio", weekData, accounts);
  // 918,341.30 / 2,866,772.88 ≈ 0.320
  console.assert(qr !== null && Math.abs(qr.result - 0.3203) < 0.001,
    "[kpi-breakdown] quick_ratio:", qr?.result);

  const ratio = getKpiBreakdown("ar_to_ap", weekData, accounts);
  // 4,254,264.78 / 2,766,772.88 ≈ 1.538
  console.assert(ratio !== null && Math.abs(ratio.result - 1.5376) < 0.001,
    "[kpi-breakdown] ar_to_ap:", ratio?.result);

  console.log("[kpi-breakdown] dev sanity checks passed");
}
