"use client";

import type { WeekMetric } from "@/app/api/metrics/route";
import type { CashBurnData } from "@/app/api/metrics/cash-burn/route";

// ─── Colours ────────────────────────────────────────────────────────────────

const COLORS = {
  cash:    "#548235",
  ar:      "#4472C4",
  ap:      "#C00000",
  payroll: "#ED7D31",
  net:     "#2E8B8B",
  backlog: "#1B2A4A",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtMoneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(n);
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function KPISkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
            <div className="h-6 w-28 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-16 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Single KPI Card ──────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  change,
  accentColor,
  inverseLogic = false,
  suffix = "",
}: {
  label: string;
  value: string;
  change: number | null;
  accentColor: string;
  /** If true, a decrease is green (good) and increase is red (bad). */
  inverseLogic?: boolean;
  suffix?: string;
}) {
  let changeColor = "text-gray-400";
  let ArrowIcon: React.ReactNode = null;

  if (change !== null && change !== 0) {
    const isPositive = change > 0;
    const isGood = inverseLogic ? !isPositive : isPositive;
    changeColor = isGood ? "text-green-600" : "text-red-600";
    ArrowIcon = isPositive ? (
      <svg className="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    );
  }

  const pct =
    change !== null && change !== 0
      ? fmtPct(change) // already formatted if dollar, but for % cards we skip
      : null;
  void pct;

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
        {label}
      </p>
      <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">
        {value}{suffix}
      </p>
      {change !== null ? (
        <p className={`text-xs font-medium flex items-center gap-0.5 ${changeColor}`}>
          {ArrowIcon}
          <span>{fmtMoneyShort(change)} WoW</span>
        </p>
      ) : (
        <p className="text-xs text-gray-400">No prior week</p>
      )}
    </div>
  );
}

// ─── Burn KPI Cards ───────────────────────────────────────────────────────────

function BurnCard({ data }: { data: CashBurnData }) {
  const burn   = data.weekly_burn.net_weekly_burn;
  const prior  = data.prior_net_weekly_burn;
  const change = prior !== null ? burn - prior : null;
  // burn increasing = bad (inverse: up arrow = red)
  const changeColor =
    change === null || change === 0 ? "text-gray-400" :
    change > 0 ? "text-red-600" : "text-green-600";

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: "4px solid #C00000" }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Weekly Cash Burn
      </p>
      <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">
        {fmtMoneyShort(burn)}
      </p>
      {change !== null ? (
        <p className={`text-xs font-medium flex items-center gap-0.5 ${changeColor}`}>
          <span>{change > 0 ? "↑" : "↓"}</span>
          <span>{fmtMoneyShort(Math.abs(change))} WoW</span>
        </p>
      ) : (
        <p className="text-xs text-gray-400">No prior data</p>
      )}
    </div>
  );
}

function RunwayCard({ data }: { data: CashBurnData }) {
  const r = data.runway_weeks;
  const display = r >= 999 ? "∞" : `${r.toFixed(1)} wks`;
  const color =
    r >= 8 ? "#548235" :
    r >= 4 ? "#ED7D31" : "#C00000";
  const nonCash    = data.weekly_burn.overhead_non_cash;
  const avgOverhead = data.weekly_burn.overhead_cash;

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Cash Runway
      </p>
      <p className="text-xl font-bold tabular-nums leading-tight" style={{ color }}>
        {display}
      </p>
      <p className="text-xs text-gray-400 leading-tight">
        Excl. {fmtMoneyShort(nonCash)}/wk non-cash · {fmtMoneyShort(avgOverhead)}/wk overhead
      </p>
    </div>
  );
}

function CriticalDateCard({ data }: { data: CashBurnData }) {
  const r = data.runway_weeks;
  const color =
    r >= 8 ? "#548235" :
    r >= 4 ? "#ED7D31" : "#C00000";

  const dateDisplay = data.critical_date
    ? new Date(data.critical_date + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
      })
    : "—";

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Critical Date
      </p>
      <p className="text-xl font-bold tabular-nums leading-tight" style={{ color }}>
        {dateDisplay}
      </p>
      <p className="text-xs text-gray-400">
        Need {fmtMoneyShort(data.required_weekly_ar)}/wk in AR to maintain
      </p>
    </div>
  );
}

// ─── KPI Cards Row ────────────────────────────────────────────────────────────

export default function KPICards({
  weeks,
  cashBurn,
}: {
  weeks: WeekMetric[];
  cashBurn?: CashBurnData;
}) {
  if (weeks.length === 0) return <KPISkeleton />;

  const latest = weeks[weeks.length - 1];

  // Trailing-4-week win rate (by count)
  const trail4 = weeks.slice(-4);
  const t4SubCount = trail4.reduce((s, w) => s + w.bids_submitted_count, 0);
  const t4WonCount = trail4.reduce((s, w) => s + w.bids_won_count, 0);
  const winRate = t4SubCount > 0 ? (t4WonCount / t4SubCount) * 100 : null;

  // Cumulative backlog (all-time bids_won_value)
  const backlog = weeks.reduce((s, w) => s + w.bids_won_value, 0);

  const cards = [
    {
      label: "Cash on Hand",
      value: fmtMoneyShort(latest.cash),
      change: latest.cash_change,
      accentColor: COLORS.cash,
      inverseLogic: false,
    },
    {
      label: "Accounts Receivable",
      value: fmtMoneyShort(latest.ar),
      change: latest.ar_change,
      accentColor: COLORS.ar,
      inverseLogic: false,
    },
    {
      label: "Accounts Payable",
      value: fmtMoneyShort(latest.ap),
      change: latest.ap_change,
      accentColor: COLORS.ap,
      inverseLogic: true,
    },
    {
      label: "Net Position",
      value: fmtMoneyShort(latest.net_position),
      change:
        latest.cash_change !== null
          ? latest.net_position -
            (latest.cash - (latest.cash_change ?? 0)) +
            (latest.ap_change ?? 0) +
            (latest.payroll_change ?? 0)
          : null,
      accentColor: COLORS.net,
      inverseLogic: false,
    },
    {
      label: "Backlog (Cumulative)",
      value: fmtMoneyShort(backlog),
      change: null as number | null,
      accentColor: COLORS.backlog,
      inverseLogic: false,
    },
    {
      label: "Win Rate (4-wk)",
      value: winRate !== null ? `${winRate.toFixed(1)}%` : "N/A",
      change: null as number | null,
      accentColor: COLORS.ar,
      inverseLogic: false,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((c) => (
          <KPICard key={c.label} {...c} />
        ))}
      </div>
      {cashBurn && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BurnCard    data={cashBurn} />
          <RunwayCard  data={cashBurn} />
          <CriticalDateCard data={cashBurn} />
        </div>
      )}
    </div>
  );
}
