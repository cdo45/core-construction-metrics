"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunwaySummary } from "@/app/api/metrics/route";
import InfoTooltip from "@/components/ui/InfoTooltip";
import WhatIfComparisonChart, {
  type WhatIfMetricPair,
  type CashProjectionPoint,
} from "@/components/dashboard/WhatIfComparisonChart";

// ─── Shared types ────────────────────────────────────────────────────────────

export interface GlAccountRow {
  id: number;
  account_no: number;
  description: string;
  category_id: number | null;
  is_active: boolean;
  latest_end_balance: number | null;
}

type TabKey = "equipment" | "job" | "debt";

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtMoneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtMoneyFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtWeeks(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(1)} wks`;
}

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

// 52 weeks / 12 months. Used to prorate monthly payments into the burn line.
const WEEKS_PER_MONTH = 52 / 12;

// ─── useDebounced ────────────────────────────────────────────────────────────
// Holds a snapshot of `value` and returns the last value that stopped
// changing for `delay` ms. Tabs bind inputs to local state immediately but
// run scenario math off the debounced copy so dragging a number doesn't
// recalculate on every keystroke.

function useDebounced<T>(value: T, delay = 200): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ─── Baseline ────────────────────────────────────────────────────────────────
// Derived-once-per-runway shape. Keeping derivation here means tabs can't
// disagree on net_weekly / weeks_of_runway formulas.

interface Baseline {
  collections: number;
  burn: number;
  cash: number;
  avg_weekly_revenue: number;
  growth_target_pct: number;
  coast: number;
  grow: number;
  net_weekly: number;
  weeks_of_runway: number | null;
}

function baselineFrom(r: RunwaySummary): Baseline {
  const net = r.avg_weekly_collections - r.avg_weekly_burn;
  const weeks = r.avg_weekly_burn > 0 ? r.current_cash / r.avg_weekly_burn : null;
  return {
    collections: r.avg_weekly_collections,
    burn: r.avg_weekly_burn,
    cash: r.current_cash,
    avg_weekly_revenue: r.avg_weekly_revenue,
    growth_target_pct: r.growth_target_pct,
    coast: r.coast_weekly,
    grow: r.grow_weekly,
    net_weekly: net,
    weeks_of_runway: weeks,
  };
}

// ─── Scenario input shape ────────────────────────────────────────────────────
// Any tab builds one of these. Common projector then renders the shared
// 5-metric comparison + 12-week cash-projection chart at the bottom.

interface Scenario {
  new_collections: number;
  new_burn: number;
  /** Immediate cash drop at week 0 (down payment, debt payment, etc). */
  cash_step?: number;
  /**
   * Optional revert-after-N-weeks horizon. Used for Job tab so cash
   * projection uses scenario rate for the job duration, then reverts to
   * baseline collections/burn afterwards. Omit/0 = scenario runs the whole
   * 12-week horizon.
   */
  revert_after_weeks?: number;
}

function projectCash(baseline: Baseline, scenario: Scenario): CashProjectionPoint[] {
  const out: CashProjectionPoint[] = [];
  let cur = baseline.cash;
  let scn = baseline.cash - (scenario.cash_step ?? 0);
  const revert = scenario.revert_after_weeks ?? 0;
  for (let w = 0; w <= 12; w++) {
    out.push({ week: w, current: cur, scenario: scn });
    cur += baseline.collections - baseline.burn;
    if (revert > 0 && w >= revert) {
      scn += baseline.collections - baseline.burn;
    } else {
      scn += scenario.new_collections - scenario.new_burn;
    }
  }
  return out;
}

function compareMetrics(baseline: Baseline, scenario: Scenario): WhatIfMetricPair[] {
  const newNet = scenario.new_collections - scenario.new_burn;
  const newCash = baseline.cash - (scenario.cash_step ?? 0);
  const newRunway = scenario.new_burn > 0 ? newCash / scenario.new_burn : null;
  return [
    {
      label: "Weekly Collections",
      current: baseline.collections,
      scenario: scenario.new_collections,
      higherIsWorse: false,
    },
    {
      label: "Weekly Burn",
      current: baseline.burn,
      scenario: scenario.new_burn,
      higherIsWorse: true,
    },
    {
      label: "Net Cash Flow",
      current: baseline.net_weekly,
      scenario: newNet,
      higherIsWorse: false,
    },
    {
      label: "Weeks of Runway",
      current: baseline.weeks_of_runway ?? 0,
      scenario: newRunway ?? 0,
      unit: "weeks",
      higherIsWorse: false,
    },
    {
      label: "Coast Number",
      current: baseline.coast,
      scenario: scenario.new_burn,
      higherIsWorse: true,
    },
  ];
}

// ─── Shared UI primitives ────────────────────────────────────────────────────

function MoneyInput({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      <span className="flex items-center gap-1">
        {label}
        {help && <InfoTooltip text={help} />}
      </span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="input-field pl-6"
          placeholder="0"
        />
      </div>
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  suffix,
  step,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  /** "int" restricts to digits only; "decimal" allows one dot for rates. */
  step?: "int" | "decimal";
  help?: string;
}) {
  const clean = step === "decimal"
    ? (s: string) => s.replace(/[^0-9.]/g, "")
    : (s: string) => s.replace(/[^0-9]/g, "");
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      <span className="flex items-center gap-1">
        {label}
        {help && <InfoTooltip text={help} />}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode={step === "decimal" ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onChange(clean(e.target.value))}
          className="input-field"
          placeholder="0"
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

type VerdictKind = "good" | "warn" | "caution" | "bad";

function VerdictBadge({ kind, text }: { kind: VerdictKind; text: string }) {
  const styles: Record<VerdictKind, string> = {
    good:    "bg-green-50  text-green-700  border-green-200",
    warn:    "bg-amber-50  text-amber-700  border-amber-200",
    caution: "bg-orange-50 text-orange-700 border-orange-200",
    bad:     "bg-red-50    text-red-700    border-red-200",
  };
  return (
    <div className={`mt-2 px-3 py-2 rounded-md border text-xs font-medium ${styles[kind]}`}>
      {text}
    </div>
  );
}

function OutputRow({
  label,
  value,
  valueColor,
  emphasize,
  help,
}: {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
  help?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-t border-gray-100 first:border-t-0">
      <span className="text-xs text-gray-600 flex items-center gap-1">
        {label}
        {help && <InfoTooltip text={help} />}
      </span>
      <span
        className={`tabular-nums ${emphasize ? "text-sm font-semibold" : "text-xs"} ${
          valueColor ?? "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Equipment tab ───────────────────────────────────────────────────────────

function EquipmentTab({ baseline }: { baseline: Baseline }) {
  const [price, setPrice] = useState("");
  const [down, setDown] = useState("0");
  const [apr, setApr] = useState("7.5");
  const [months, setMonths] = useState("60");

  // Debounce everything so PMT doesn't thrash on each keystroke.
  const dPrice = useDebounced(price);
  const dDown = useDebounced(down);
  const dApr = useDebounced(apr);
  const dMonths = useDebounced(months);

  const math = useMemo(() => {
    const priceNum = parseFloat(dPrice) || 0;
    const downNum = parseFloat(dDown) || 0;
    const aprNum = parseFloat(dApr) || 0;
    const monthsNum = parseInt(dMonths, 10) || 0;
    const financed = Math.max(0, priceNum - downNum);
    // Standard amortization (PMT). Zero-rate fallback is simple division
    // so the UI doesn't NaN when APR is blank or 0.
    let monthlyPayment = 0;
    if (financed > 0 && monthsNum > 0) {
      const r = aprNum / 100 / 12;
      monthlyPayment = r === 0
        ? financed / monthsNum
        : financed * (r * Math.pow(1 + r, monthsNum)) /
          (Math.pow(1 + r, monthsNum) - 1);
    }
    const weeklyPayment = monthlyPayment / WEEKS_PER_MONTH;
    const totalInterest = monthsNum > 0 ? monthlyPayment * monthsNum - financed : 0;
    const totalCost = priceNum + totalInterest;
    return {
      priceNum, downNum, financed,
      monthlyPayment, weeklyPayment, totalInterest, totalCost, monthsNum,
    };
  }, [dPrice, dDown, dApr, dMonths]);

  const scenario: Scenario = useMemo(() => ({
    new_collections: baseline.collections,
    new_burn: baseline.burn + math.weeklyPayment,
    cash_step: math.downNum,
  }), [baseline, math]);

  const newCash = baseline.cash - math.downNum;
  const newBurn = baseline.burn + math.weeklyPayment;
  const newNet = baseline.collections - newBurn;
  const newRunway = newBurn > 0 ? newCash / newBurn : null;
  const newCoast = newBurn;
  const newGrow = newCoast + baseline.growth_target_pct * baseline.avg_weekly_revenue;

  let verdict: { kind: VerdictKind; text: string } | null = null;
  if (math.priceNum > 0 && math.monthsNum > 0) {
    const baseRunway = baseline.weeks_of_runway;
    if (newCash <= 0 || newRunway === null) {
      verdict = { kind: "bad", text: "Do not purchase — down payment exceeds cash on hand." };
    } else if (baseRunway !== null && newRunway >= baseRunway) {
      verdict = { kind: "good", text: "Safe to purchase — runway holds or improves." };
    } else if (newRunway >= 8) {
      verdict = { kind: "warn", text: "Tightens runway but manageable — above 8 weeks." };
    } else if (newRunway >= 4) {
      verdict = { kind: "caution", text: "Cash-constrained — runway falls to 4-8 weeks." };
    } else {
      verdict = { kind: "bad", text: "Do not purchase — runway drops under 4 weeks." };
    }
  }

  const hasInputs = math.priceNum > 0 && math.monthsNum > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MoneyInput
          label="Purchase price"
          value={price}
          onChange={setPrice}
          help="Sticker price of the equipment before financing."
        />
        <MoneyInput
          label="Down payment"
          value={down}
          onChange={setDown}
          help="Cash paid up front. Reduces the amount financed and hits your cash immediately."
        />
        <NumberInput
          label="Interest rate APR"
          value={apr}
          onChange={setApr}
          suffix="%"
          step="decimal"
          help="Annual percentage rate on the loan. Typical equipment financing runs 6-10%."
        />
        <NumberInput
          label="Months financed"
          value={months}
          onChange={setMonths}
          suffix="mo"
          help="Loan term in months. Longer term = lower monthly payment but more total interest."
        />
      </div>

      {hasInputs && (
        <div className="bg-gray-50 rounded-md p-3">
          <OutputRow
            label="Amount financed"
            value={fmtMoneyFull(math.financed)}
            help="Purchase price minus the down payment."
          />
          <OutputRow
            label="Monthly payment"
            value={fmtMoneyFull(math.monthlyPayment)}
            emphasize
            help="Standard loan amortization formula: financed × (r(1+r)^n) / ((1+r)^n − 1), where r = APR/12 and n = months. Falls back to principal/months when APR is 0."
          />
          <OutputRow
            label="Weekly payment"
            value={`${fmtMoneyFull(math.weeklyPayment)}/wk`}
            help="Monthly payment divided by 4.33 weeks per month. Used to raise the weekly burn baseline."
          />
          <OutputRow
            label="Total interest over term"
            value={fmtMoneyFull(math.totalInterest)}
            help="Sum of every monthly payment minus the amount financed. This is pure cost of money."
          />
          <OutputRow
            label="Total cost (price + interest)"
            value={fmtMoneyFull(math.totalCost)}
            emphasize
          />

          <div className="border-t border-gray-300 my-3" />
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Scenario impact</div>
          <OutputRow label="New cash on hand" value={fmtMoneyShort(newCash)} valueColor="text-red-700" />
          <OutputRow label="New weekly burn" value={`${fmtMoneyShort(newBurn)}/wk`} valueColor="text-red-700" />
          <OutputRow
            label="New net weekly cash flow"
            value={`${newNet >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(newNet))}/wk`}
            valueColor={newNet >= 0 ? "text-green-700" : "text-red-700"}
          />
          <OutputRow label="New weeks of runway" value={fmtWeeks(newRunway)} emphasize />
          <OutputRow label="New coast number" value={`${fmtMoneyShort(newCoast)}/wk`} />
          <OutputRow label="New grow number (10%)" value={`${fmtMoneyShort(newGrow)}/wk`} />
          {verdict && <VerdictBadge kind={verdict.kind} text={verdict.text} />}
        </div>
      )}

      {hasInputs && (
        <WhatIfComparisonChart
          metrics={compareMetrics(baseline, scenario)}
          cashProjection={projectCash(baseline, scenario)}
        />
      )}
    </div>
  );
}

// ─── Job tab ─────────────────────────────────────────────────────────────────

// Margin floors — drive the verdict bands and the gauge tick marks.
const JOB_MARGIN_FLOORS = { thin: 0.10, residential: 0.15, strong: 0.20 };

function MarginGauge({ margin }: { margin: number | null }) {
  // 30% is the right edge of the gauge — typical construction ceiling.
  const max = 0.30;
  const clamped = Math.max(0, Math.min(max, margin ?? 0));
  const pct = (clamped / max) * 100;
  const bar = margin === null
    ? "#d1d5db"
    : margin >= JOB_MARGIN_FLOORS.strong      ? "#2F9E44"
    : margin >= JOB_MARGIN_FLOORS.residential ? "#B7791F"
    : margin >= JOB_MARGIN_FLOORS.thin        ? "#EA580C"
    : "#C00000";
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
        <span>0%</span>
        <span>10%</span>
        <span>15%</span>
        <span>20%</span>
        <span>30%</span>
      </div>
      <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: bar }}
        />
        {/* Threshold ticks at 10/15/20%. */}
        {[JOB_MARGIN_FLOORS.thin, JOB_MARGIN_FLOORS.residential, JOB_MARGIN_FLOORS.strong].map((t) => (
          <div
            key={t}
            className="absolute inset-y-0 w-px bg-gray-400"
            style={{ left: `${(t / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="text-xs text-gray-700 mt-1 font-semibold tabular-nums">
        Gross margin: {fmtPct((margin ?? 0) * 100)}
      </div>
    </div>
  );
}

function JobTab({ baseline }: { baseline: Baseline }) {
  const [contract, setContract] = useState("");
  const [duration, setDuration] = useState("");
  const [totalCost, setTotalCost] = useState("");

  const dContract = useDebounced(contract);
  const dDuration = useDebounced(duration);
  const dTotalCost = useDebounced(totalCost);

  const math = useMemo(() => {
    const c = parseFloat(dContract) || 0;
    const w = parseInt(dDuration, 10) || 0;
    const tc = parseFloat(dTotalCost) || 0;
    const weeklyRevenueAdded = w > 0 ? c / w : 0;
    const weeklyCostAdded    = w > 0 ? tc / w : 0;
    const weeklyMargin       = weeklyRevenueAdded - weeklyCostAdded;
    const totalGrossProfit   = c - tc;
    const grossMarginPct     = c > 0 ? (c - tc) / c : null;
    return { c, w, tc, weeklyRevenueAdded, weeklyCostAdded, weeklyMargin, totalGrossProfit, grossMarginPct };
  }, [dContract, dDuration, dTotalCost]);

  const scenario: Scenario = useMemo(() => ({
    new_collections: baseline.collections + math.weeklyRevenueAdded,
    new_burn:        baseline.burn        + math.weeklyCostAdded,
    cash_step:       0,
    revert_after_weeks: math.w,
  }), [baseline, math]);

  const newCollections = baseline.collections + math.weeklyRevenueAdded;
  const newBurn        = baseline.burn + math.weeklyCostAdded;
  const newNetWeekly   = newCollections - newBurn;
  const cashAtCompletion = baseline.cash + newNetWeekly * math.w;
  const newCoast = newBurn;
  const newGrow  = newCoast + baseline.growth_target_pct * (baseline.avg_weekly_revenue + math.weeklyRevenueAdded);

  let verdict: { kind: VerdictKind; text: string } | null = null;
  if (math.grossMarginPct !== null) {
    const m = math.grossMarginPct;
    if (m >= JOB_MARGIN_FLOORS.strong) {
      verdict = { kind: "good",    text: "Strong margin — take it." };
    } else if (m >= JOB_MARGIN_FLOORS.residential) {
      verdict = { kind: "warn",    text: "Acceptable — typical residential floor." };
    } else if (m >= JOB_MARGIN_FLOORS.thin) {
      verdict = { kind: "caution", text: "Thin — commercial floor only." };
    } else {
      verdict = { kind: "bad",     text: "Below floor — walk away." };
    }
  }

  const hasInputs = math.c > 0 && math.w > 0 && math.tc > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MoneyInput
          label="Contract value"
          value={contract}
          onChange={setContract}
          help="Total invoice-able value of the contract over the full duration."
        />
        <NumberInput
          label="Duration"
          value={duration}
          onChange={setDuration}
          suffix="wks"
          help="How many weeks of work the job covers. Revenue and cost are spread evenly across these weeks."
        />
        <MoneyInput
          label="Total estimated cost"
          value={totalCost}
          onChange={setTotalCost}
          help="All-in direct cost: labor + materials + subs + equipment. Not including overhead (overhead is already in your baseline burn)."
        />
      </div>

      {!hasInputs ? (
        <p className="text-xs text-gray-400 italic">Enter values to see impact.</p>
      ) : (
        <>
          <div className="bg-gray-50 rounded-md p-3">
            <OutputRow
              label="Weekly revenue added"
              value={`+${fmtMoneyShort(math.weeklyRevenueAdded)}/wk`}
              valueColor="text-green-700"
              help="Contract value ÷ duration."
            />
            <OutputRow
              label="Weekly cost added"
              value={`-${fmtMoneyShort(math.weeklyCostAdded)}/wk`}
              valueColor="text-red-700"
              help="Total estimated cost ÷ duration."
            />
            <OutputRow
              label="Weekly margin"
              value={`${math.weeklyMargin >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(math.weeklyMargin))}/wk`}
              valueColor={math.weeklyMargin >= 0 ? "text-green-700" : "text-red-700"}
              emphasize
              help="Weekly revenue added minus weekly cost added."
            />
            <OutputRow
              label="Total gross profit"
              value={fmtMoneyFull(math.totalGrossProfit)}
              valueColor={math.totalGrossProfit >= 0 ? "text-green-700" : "text-red-700"}
              help="Contract value minus total estimated cost, over the full duration."
            />

            <MarginGauge margin={math.grossMarginPct} />

            <div className="border-t border-gray-300 my-3" />
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Scenario impact (during job)</div>
            <OutputRow label="New weekly collections" value={`${fmtMoneyShort(newCollections)}/wk`} />
            <OutputRow label="New weekly burn"        value={`${fmtMoneyShort(newBurn)}/wk`} />
            <OutputRow
              label="New net weekly cash flow"
              value={`${newNetWeekly >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(newNetWeekly))}/wk`}
              valueColor={newNetWeekly >= 0 ? "text-green-700" : "text-red-700"}
              emphasize
            />
            <OutputRow
              label="Projected cash at completion"
              value={fmtMoneyFull(cashAtCompletion)}
              emphasize
              help="Current cash + (net weekly cash flow during job × duration). Assumes billings collect in pace with work; real-world collections lag."
            />
            <OutputRow label="New coast number (during job)" value={`${fmtMoneyShort(newCoast)}/wk`} />
            <OutputRow label="New grow number (during job)"  value={`${fmtMoneyShort(newGrow)}/wk`} />
            {verdict && <VerdictBadge kind={verdict.kind} text={verdict.text} />}
          </div>

          <WhatIfComparisonChart
            metrics={compareMetrics(baseline, scenario)}
            cashProjection={projectCash(baseline, scenario)}
          />
        </>
      )}
    </div>
  );
}

// ─── Debt Paydown tab ────────────────────────────────────────────────────────

function DebtPaydownTab({ baseline }: { baseline: Baseline }) {
  const [amount, setAmount] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [accounts, setAccounts] = useState<GlAccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Pull only Cat-3 (current debt) and Cat-5 (payroll liab) accounts —
  // the only liabilities it makes sense to target with a cash paydown.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gl-accounts?category=3,5")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: GlAccountRow[]) => {
        if (cancelled) return;
        const filtered = data.filter((a) => a.is_active);
        setAccounts(filtered);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dAmount = useDebounced(amount);
  const amountNum = parseFloat(dAmount) || 0;
  const target = accounts.find((a) => String(a.id) === targetId);
  // Stored liability balances are credit-normal → negative. Flip to positive
  // for display so "current balance" reads like a bill.
  const currentBalance = target?.latest_end_balance != null
    ? Math.abs(Number(target.latest_end_balance))
    : null;
  const newTargetBalance = currentBalance !== null
    ? Math.max(0, currentBalance - amountNum)
    : null;

  const newCash = baseline.cash - amountNum;
  const newBurn = baseline.burn; // one-time paydown leaves weekly burn alone
  const newRunway = newBurn > 0 ? newCash / newBurn : null;

  const scenario: Scenario = useMemo(() => ({
    new_collections: baseline.collections,
    new_burn: newBurn,
    cash_step: amountNum,
  }), [baseline, newBurn, amountNum]);

  let verdict: { kind: VerdictKind; text: string } | null = null;
  if (amountNum > 0 && targetId) {
    if (newCash <= 0 || newRunway === null) {
      verdict = { kind: "bad", text: "Cash-constrained — payment exceeds available cash." };
    } else if (newRunway >= 12) {
      verdict = { kind: "good", text: "Accretive — clears debt safely (≥12 weeks of runway)." };
    } else if (newRunway >= 6) {
      verdict = { kind: "warn", text: "Neutral — tightens runway but bearable (6-12 weeks)." };
    } else {
      verdict = { kind: "bad", text: "Cash-constrained — defer paydown (runway under 6 weeks)." };
    }
  }

  const hasInputs = amountNum > 0 && !!targetId;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MoneyInput
          label="Payment amount"
          value={amount}
          onChange={setAmount}
          help="Cash you'd send out to pay down the target liability. Exits cash immediately; no change to weekly burn."
        />
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            Target account
            <InfoTooltip text="Dropdown shows active Current Debt (category 3) and Payroll Liability (category 5) accounts. Each entry includes its most-recent end-of-week balance." />
          </span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={accountsLoading}
            className="select-field"
          >
            <option value="">— Select a liability —</option>
            {accounts.map((a) => {
              const bal = a.latest_end_balance != null
                ? fmtMoneyShort(Math.abs(Number(a.latest_end_balance)))
                : "—";
              return (
                <option key={a.id} value={a.id}>
                  {a.account_no} — {a.description} ({bal})
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {!hasInputs ? (
        <p className="text-xs text-gray-400 italic">
          {accountsLoading ? "Loading accounts…" : "Enter an amount and pick a target to see impact."}
        </p>
      ) : (
        <>
          <div className="bg-gray-50 rounded-md p-3">
            <OutputRow
              label="Cash reduction (immediate)"
              value={`-${fmtMoneyShort(amountNum)}`}
              valueColor="text-red-700"
            />
            <OutputRow
              label={`Debt reduction on ${target?.account_no ?? ""}`}
              value={`-${fmtMoneyShort(amountNum)}`}
              valueColor="text-green-700"
            />
            {currentBalance !== null && (
              <OutputRow
                label="New target account balance"
                value={fmtMoneyFull(newTargetBalance ?? 0)}
                help="Current balance on the target account minus your payment, floored at zero."
              />
            )}
            <OutputRow
              label="New cash on hand"
              value={fmtMoneyShort(newCash)}
              valueColor={newCash >= 0 ? "text-gray-900" : "text-red-700"}
            />
            <OutputRow label="New weekly burn" value={`${fmtMoneyShort(newBurn)}/wk`} help="Unchanged — a one-time paydown doesn't change your recurring obligations." />
            <OutputRow label="New weeks of runway" value={fmtWeeks(newRunway)} emphasize />
            <OutputRow label="Interest saved estimate" value="n/a" help="We don't store loan rates, so we can't estimate interest saved. Add a rate column to gl_accounts if this matters." />
            {verdict && <VerdictBadge kind={verdict.kind} text={verdict.text} />}
          </div>

          <WhatIfComparisonChart
            metrics={compareMetrics(baseline, scenario)}
            cashProjection={projectCash(baseline, scenario)}
          />
        </>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const TABS: Array<{ key: TabKey; label: string; help: string }> = [
  {
    key: "equipment",
    label: "New Equipment",
    help:
      "Models a financed equipment purchase. Down payment hits cash now; the monthly payment (prorated to weekly using 4.33 wk/mo) lifts your weekly burn for the loan term.",
  },
  {
    key: "job",
    label: "New Job",
    help:
      "Models a new contract with a total cost number. Weekly revenue = contract ÷ duration; weekly cost = total cost ÷ duration. Gross margin drives the verdict.",
  },
  {
    key: "debt",
    label: "Debt Paydown",
    help:
      "One-time payment against a Cat-3 or Cat-5 liability. Cash drops by the payment amount; weekly burn is unchanged.",
  },
];

export default function WhatIfCalculator({ runway }: { runway: RunwaySummary | null }) {
  const [tab, setTab] = useState<TabKey>("equipment");
  const activeTab = useMemo(() => TABS.find((t) => t.key === tab) ?? TABS[0], [tab]);
  const baseline = runway ? baselineFrom(runway) : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">What-If Calculator</h3>
        <InfoTooltip text={activeTab.help} />
      </div>
      <div className="border-b border-gray-200 px-2 flex gap-1">
        {TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                selected
                  ? "border-[#1B2A4A] text-[#1B2A4A]"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        {!baseline ? (
          <p className="text-xs text-gray-400 italic">Waiting for runway data…</p>
        ) : tab === "equipment" ? (
          <EquipmentTab baseline={baseline} />
        ) : tab === "job" ? (
          <JobTab baseline={baseline} />
        ) : (
          <DebtPaydownTab baseline={baseline} />
        )}
      </div>
    </div>
  );
}
