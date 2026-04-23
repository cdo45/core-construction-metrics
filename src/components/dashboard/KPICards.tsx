"use client";

import type { WeekMetric } from "@/app/api/metrics/route";

// ─── Formatters ──────────────────────────────────────────────────────────────

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
  return `${n.toFixed(decimals)}%`;
}

export function fmtWeeks(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(1)} wks`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

export function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 animate-pulse">
          <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
          <div className="h-7 w-32 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-40 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Card primitive ──────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  delta,
  subtitle,
  accent,
  inverseDelta = false,
}: {
  label: string;
  value: string;
  /** Optional raw-dollar delta; null = no delta display */
  delta?: number | null;
  subtitle: string;
  accent: string;
  /** If true, a decrease is favorable (green); e.g. for debt cards */
  inverseDelta?: boolean;
}) {
  let deltaColor = "text-gray-400";
  let ArrowIcon: React.ReactNode = null;
  if (delta !== undefined && delta !== null && delta !== 0) {
    const isPositive = delta > 0;
    const isGood = inverseDelta ? !isPositive : isPositive;
    deltaColor = isGood ? "text-green-600" : "text-red-600";
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

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">
        {value}
      </p>
      {delta !== undefined && delta !== null ? (
        <p className={`text-xs font-medium flex items-center gap-1 ${deltaColor}`}>
          {ArrowIcon}
          <span>{fmtMoneyShort(delta)} WoW</span>
        </p>
      ) : (
        <p className="text-xs text-gray-400 truncate">{subtitle}</p>
      )}
      {delta !== undefined && delta !== null && (
        <p className="text-xs text-gray-400 truncate">{subtitle}</p>
      )}
    </div>
  );
}

// ─── Section row ─────────────────────────────────────────────────────────────

function SectionRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

// ─── KPI grid ────────────────────────────────────────────────────────────────

const COLORS = {
  cash:      "#548235",
  netLiq:    "#2E8B8B",
  runway:    "#1F6FEB",
  ar:        "#4472C4",
  debt:      "#C00000",
  ratio:     "#6F42C1",
  revenue:   "#117864",
  margin:    "#B7791F",
  opMargin:  "#5D3A9B",
};

export default function KPICards({ weeks }: { weeks: WeekMetric[] }) {
  if (weeks.length === 0) return <KPISkeleton />;

  const latest = weeks[weeks.length - 1];

  // Rolling 4-week revenue (sum). Margins on the rolling window would be
  // more stable than the last single week, but the per-week metric is also
  // exposed so we can label clearly.
  const trail4 = weeks.slice(-4);
  const revenue4wk = trail4.reduce((s, w) => s + w.cat_8_revenue, 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionRow title="Liquidity">
        <KPICard
          label="Cash on Hand"
          value={fmtMoneyShort(latest.cat_1_cash)}
          delta={latest.cash_change}
          subtitle="Across all bank accounts"
          accent={COLORS.cash}
        />
        <KPICard
          label="Net Liquidity"
          value={fmtMoneyShort(latest.net_liquidity)}
          delta={latest.net_liquidity_change}
          subtitle="Cash minus current obligations"
          accent={COLORS.netLiq}
        />
        <KPICard
          label="Payroll Runway"
          value={fmtWeeks(latest.payroll_runway_wks)}
          subtitle="Cash ÷ weekly field payroll"
          accent={COLORS.runway}
        />
      </SectionRow>

      <SectionRow title="Working Capital">
        <KPICard
          label="What We're Owed"
          value={fmtMoneyShort(latest.cat_2_ar)}
          delta={latest.ar_change}
          subtitle="Total AR"
          accent={COLORS.ar}
        />
        <KPICard
          label="Current Debt"
          value={fmtMoneyShort(latest.cat_3_current_debt)}
          delta={latest.current_debt_change}
          subtitle="ST obligations"
          accent={COLORS.debt}
          inverseDelta={true}
        />
        <KPICard
          label="Current Ratio"
          value={latest.current_ratio !== null ? latest.current_ratio.toFixed(2) : "—"}
          subtitle="(Cash + AR) ÷ Current Liab"
          accent={COLORS.ratio}
        />
      </SectionRow>

      <SectionRow title="P&L (last 4 weeks)">
        <KPICard
          label="Revenue (last 4 wks)"
          value={fmtMoneyShort(revenue4wk)}
          subtitle="Rolling 4-week revenue"
          accent={COLORS.revenue}
        />
        <KPICard
          label="Gross Margin %"
          value={fmtPct(latest.gross_margin_pct)}
          subtitle="(Rev − DJC) ÷ Rev"
          accent={COLORS.margin}
        />
        <KPICard
          label="Operating Margin %"
          value={fmtPct(latest.operating_margin_pct)}
          subtitle="After overhead + field payroll"
          accent={COLORS.opMargin}
        />
      </SectionRow>
    </div>
  );
}
