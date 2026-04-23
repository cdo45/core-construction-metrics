"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunwaySummary } from "@/app/api/metrics/route";
import InfoTooltip from "@/components/ui/InfoTooltip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GlAccountRow {
  id: number;
  account_no: number;
  description: string;
  category_id: number | null;
  is_active: boolean;
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

function fmtWeeks(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(1)} wks`;
}

// Average weeks per month (52/12) — used to prorate monthly payments into the
// weekly burn baseline.
const WEEKS_PER_MONTH = 52 / 12;

// ─── Output rows ─────────────────────────────────────────────────────────────

function OutputRow({
  label,
  value,
  valueColor,
  emphasize,
}: {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-t border-gray-100 first:border-t-0">
      <span className="text-xs text-gray-600">{label}</span>
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

function VerdictBadge({
  kind,
  text,
}: {
  kind: "good" | "warn" | "bad";
  text: string;
}) {
  const styles = {
    good: "bg-green-50 text-green-700 border-green-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    bad:  "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <div className={`mt-2 px-3 py-2 rounded-md border text-xs font-medium ${styles[kind]}`}>
      {text}
    </div>
  );
}

// ─── Input field ─────────────────────────────────────────────────────────────

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      <span>{label}</span>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      <span>{label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
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

// ─── Equipment tab ───────────────────────────────────────────────────────────

function EquipmentTab({ runway }: { runway: RunwaySummary }) {
  const [price, setPrice] = useState("");
  const [down, setDown] = useState("");
  const [monthly, setMonthly] = useState("");
  const [months, setMonths] = useState("");

  const downNum = parseFloat(down) || 0;
  const monthlyNum = parseFloat(monthly) || 0;
  const priceNum = parseFloat(price) || 0;
  const monthsNum = parseInt(months, 10) || 0;
  void priceNum; void monthsNum;

  const weeklyFromFinance = monthlyNum / WEEKS_PER_MONTH;
  const newWeeklyBurn = runway.avg_weekly_burn + weeklyFromFinance;
  const newCash = runway.current_cash - downNum;
  const newRunwayWks = newWeeklyBurn > 0 ? newCash / newWeeklyBurn : null;
  const baselineRunway = runway.weeks_of_runway ?? Infinity;
  const runwayDrop =
    baselineRunway > 0 && newRunwayWks !== null
      ? (baselineRunway - newRunwayWks) / baselineRunway
      : 0;

  let verdict: { kind: "good" | "warn" | "bad"; text: string };
  if (newCash <= 0) {
    verdict = { kind: "bad", text: "Cash negative — down payment exceeds available cash." };
  } else if (newRunwayWks !== null && newRunwayWks < 0) {
    verdict = { kind: "bad", text: "Cash negative — runway collapses after purchase." };
  } else if (runwayDrop > 0.30) {
    verdict = { kind: "bad", text: "Cash negative — runway drops more than 30%." };
  } else if (runwayDrop > 0.10) {
    verdict = { kind: "warn", text: "Tightens runway — meaningful but manageable cash hit." };
  } else {
    verdict = { kind: "good", text: "Safe to purchase — minimal runway impact." };
  }

  const showOutputs = downNum > 0 || monthlyNum > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput label="Purchase price" value={price} onChange={setPrice} />
        <MoneyInput label="Down payment" value={down} onChange={setDown} />
        <MoneyInput label="Monthly payment" value={monthly} onChange={setMonthly} />
        <NumberInput label="Months financed" value={months} onChange={setMonths} suffix="mo" />
      </div>
      {showOutputs && (
        <div className="bg-gray-50 rounded-md p-3">
          <OutputRow label="Immediate cash impact (down payment)" value={`-${fmtMoneyShort(downNum)}`} valueColor="text-red-700" />
          <OutputRow label="New weekly burn" value={`${fmtMoneyShort(newWeeklyBurn)}/wk`} />
          <OutputRow label="New weeks of runway" value={fmtWeeks(newRunwayWks)} emphasize />
          <OutputRow label="New coast number" value={`${fmtMoneyShort(newWeeklyBurn)}/wk`} />
          <VerdictBadge kind={verdict.kind} text={verdict.text} />
        </div>
      )}
    </div>
  );
}

// ─── New Job tab ─────────────────────────────────────────────────────────────

function NewJobTab({ runway }: { runway: RunwaySummary }) {
  const [contract, setContract] = useState("");
  const [durationWks, setDurationWks] = useState("");
  const [weeklyCost, setWeeklyCost] = useState("");

  const contractNum = parseFloat(contract) || 0;
  const duration = parseInt(durationWks, 10) || 0;
  const weeklyCostNum = parseFloat(weeklyCost) || 0;

  const weeklyRevAdded = duration > 0 ? contractNum / duration : 0;
  const netWeekly = weeklyRevAdded - weeklyCostNum;
  const newCoast = runway.avg_weekly_burn + weeklyCostNum;
  const newGrow =
    newCoast + runway.growth_target_pct * (runway.avg_weekly_revenue + weeklyRevAdded);
  const expectedCashGain = contractNum - duration * weeklyCostNum;

  const showOutputs = contractNum > 0 && duration > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <MoneyInput label="Contract value" value={contract} onChange={setContract} />
        <NumberInput label="Duration" value={durationWks} onChange={setDurationWks} suffix="wks" />
        <MoneyInput label="Est. weekly cost" value={weeklyCost} onChange={setWeeklyCost} />
      </div>
      {showOutputs && (
        <div className="bg-gray-50 rounded-md p-3">
          <OutputRow label="Weekly revenue added" value={`+${fmtMoneyShort(weeklyRevAdded)}/wk`} valueColor="text-green-700" />
          <OutputRow label="Weekly cost added" value={`-${fmtMoneyShort(weeklyCostNum)}/wk`} valueColor="text-red-700" />
          <OutputRow
            label="Net weekly impact during job"
            value={`${netWeekly >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(netWeekly))}/wk`}
            valueColor={netWeekly >= 0 ? "text-green-700" : "text-red-700"}
            emphasize
          />
          <OutputRow label="New coast number (during job)" value={`${fmtMoneyShort(newCoast)}/wk`} />
          <OutputRow label="New grow number (during job)" value={`${fmtMoneyShort(newGrow)}/wk`} />
          <OutputRow
            label="Expected cash gain at completion"
            value={`${expectedCashGain >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(expectedCashGain))}`}
            valueColor={expectedCashGain >= 0 ? "text-green-700" : "text-red-700"}
            emphasize
          />
        </div>
      )}
    </div>
  );
}

// ─── Debt Paydown tab ────────────────────────────────────────────────────────

function DebtPaydownTab({
  runway,
  accounts,
  accountsLoading,
}: {
  runway: RunwaySummary;
  accounts: GlAccountRow[];
  accountsLoading: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [targetId, setTargetId] = useState<string>("");

  const amountNum = parseFloat(amount) || 0;
  const target = accounts.find((a) => String(a.id) === targetId);

  const newCash = runway.current_cash - amountNum;
  const newRunwayWks = runway.avg_weekly_burn > 0 ? newCash / runway.avg_weekly_burn : null;

  let verdict: { kind: "good" | "warn" | "bad"; text: string } | null = null;
  if (amountNum > 0 && targetId) {
    if (newCash <= 0) {
      verdict = { kind: "bad", text: "Cash-constrained — payment exceeds available cash." };
    } else if (newRunwayWks !== null && newRunwayWks >= 12) {
      verdict = { kind: "good", text: "Accretive — runway stays healthy (≥12 weeks)." };
    } else if (newRunwayWks !== null && newRunwayWks >= 6) {
      verdict = { kind: "warn", text: "Neutral — runway tightens but survivable (6-12 weeks)." };
    } else {
      verdict = { kind: "bad", text: "Cash-constrained — runway drops below 6 weeks." };
    }
  }

  const showOutputs = amountNum > 0 && !!targetId;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput label="Payment amount" value={amount} onChange={setAmount} />
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          <span>Target account</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={accountsLoading}
            className="select-field"
          >
            <option value="">— Select a liability —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_no} — {a.description}
              </option>
            ))}
          </select>
        </label>
      </div>
      {showOutputs && (
        <div className="bg-gray-50 rounded-md p-3">
          <OutputRow label="Cash reduction (immediate)" value={`-${fmtMoneyShort(amountNum)}`} valueColor="text-red-700" />
          <OutputRow label={`Debt reduction on ${target?.account_no ?? ""}`} value={`-${fmtMoneyShort(amountNum)}`} valueColor="text-green-700" />
          <OutputRow label="New weeks of runway" value={fmtWeeks(newRunwayWks)} emphasize />
          <OutputRow label="Interest saved estimate" value="n/a — no rate data" />
          {verdict && <VerdictBadge kind={verdict.kind} text={verdict.text} />}
        </div>
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
      "Models a one-time down payment (hits cash now) plus a monthly finance payment (raises weekly burn). Monthly payment is prorated to weekly using 52/12 ≈ 4.33 weeks per month.",
  },
  {
    key: "job",
    label: "New Job",
    help:
      "Contract value spread evenly over the duration gives weekly revenue; weekly cost you enter directly. Expected cash gain = contract − (duration × weekly cost). Assumes billings collect in pace with work; real collections lag.",
  },
  {
    key: "debt",
    label: "Debt Paydown",
    help:
      "One-time payment from cash against a liability account. Runway recomputed at current burn. Interest-saved is omitted because we don't store loan rates.",
  },
];

export default function WhatIfCalculator({ runway }: { runway: RunwaySummary | null }) {
  const [tab, setTab] = useState<TabKey>("equipment");
  const [accounts, setAccounts] = useState<GlAccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Load liability accounts (cat 3 + cat 5) for the debt-paydown dropdown.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gl-accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: GlAccountRow[]) => {
        if (cancelled) return;
        const filtered = data.filter(
          (a) => a.is_active && (a.category_id === 3 || a.category_id === 5)
        );
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

  const activeTab = useMemo(() => TABS.find((t) => t.key === tab) ?? TABS[0], [tab]);

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
        {!runway ? (
          <p className="text-xs text-gray-400 italic">
            Waiting for runway data…
          </p>
        ) : tab === "equipment" ? (
          <EquipmentTab runway={runway} />
        ) : tab === "job" ? (
          <NewJobTab runway={runway} />
        ) : (
          <DebtPaydownTab runway={runway} accounts={accounts} accountsLoading={accountsLoading} />
        )}
      </div>
    </div>
  );
}
