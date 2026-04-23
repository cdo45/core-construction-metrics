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

// ─── Placeholder tab ─────────────────────────────────────────────────────────
// Stubs the Job and Debt tabs while their final implementations land in the
// follow-up commits. Keeps the file compiling and the tab switcher wired.

function StubTab({ label }: { label: string }) {
  return (
    <div className="text-xs text-gray-400 italic py-10 text-center">
      {label} — coming in the next commit.
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
          <StubTab label="Job tab" />
        ) : (
          <StubTab label="Debt Paydown tab" />
        )}
      </div>
    </div>
  );
}
