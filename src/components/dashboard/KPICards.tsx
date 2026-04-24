"use client";

import { useState } from "react";
import type {
  WeekMetric,
  PnlSummary,
  TrendSeries,
  Benchmarks,
  DrilldownMap,
} from "@/app/api/metrics/route";
import { lastActiveWeeks } from "@/lib/active-weeks";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Sparkline, { type SparklineFormat, type SparklinePoint } from "@/components/dashboard/Sparkline";
import KpiDrilldownModal from "@/components/dashboard/KpiDrilldownModal";

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

export function KPICard({
  label,
  value,
  delta,
  subtitle,
  accent,
  inverseDelta = false,
  help,
  badge,
  extraLine,
  sparkline,
  onClick,
}: {
  label: string;
  value: string;
  /** Optional raw-dollar delta; null = no delta display */
  delta?: number | null;
  subtitle: string;
  accent: string;
  /** If true, a decrease is favorable (green); e.g. for debt cards */
  inverseDelta?: boolean;
  /** Optional plain-English explanation surfaced as a "?" icon next to
   *  the label. */
  help?: string;
  /** Small tag rendered to the right of the value. Used for the "+LOC"
   *  indicator when undrawn LOC is folded into a cash-based metric. */
  badge?: { label: string; tone?: "green" | "blue" } | null;
  /** Extra green sub-line rendered between value and subtitle. Used for
   *  the "+ $X,XXX,XXX undrawn LOC" hint under Cash on Hand. */
  extraLine?: string | null;
  /** Optional Sparkline slot rendered to the right of the value. */
  sparkline?: React.ReactNode;
  /** When provided, the card becomes click-to-drilldown — adds
   *  cursor-pointer, hover bg lightening, and keyboard activation. The
   *  parent owns the modal; the card just opens it. */
  onClick?: () => void;
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

  const badgeCls =
    badge?.tone === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-green-50 text-green-700 border-green-200";

  // Card layout adapts to viewport:
  //   ≥ sm (640px): value + sparkline on one row, sparkline right-aligned.
  //   < sm:         stack vertically (value on top, sparkline below).
  // min-w prevents the sparkline from squishing the value at the breakpoint
  // edge.
  const valueRowLayout = sparkline
    ? "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2"
    : "flex items-center";
  const cardMinWidth = sparkline ? "min-w-[240px]" : "";

  const interactiveCls = onClick
    ? "cursor-pointer hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 transition-colors"
    : "";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${label} — show formula` : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1 ${cardMinWidth} ${interactiveCls}`}
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate flex items-center gap-1">
        <span className="truncate">{label}</span>
        {help && <InfoTooltip text={help} />}
      </p>
      <div className={valueRowLayout}>
        <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight flex items-baseline gap-2 min-w-0">
          <span className="truncate">{value}</span>
          {badge && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badgeCls} whitespace-nowrap`}
            >
              {badge.label}
            </span>
          )}
        </p>
        {sparkline && <div className="flex-shrink-0">{sparkline}</div>}
      </div>
      {extraLine && (
        <p className="text-xs text-green-700 font-medium truncate">{extraLine}</p>
      )}
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

// Rolling mean of the `.value` field — used for the dotted reference line
// on $ and % sparklines. Returns 0 for empty arrays so the Sparkline
// component can render a flat ref line when there's only one point.
function seriesAvg(points: Array<{ value: number }> | undefined): number {
  if (!points || points.length === 0) return 0;
  let s = 0;
  for (const p of points) s += p.value;
  return s / points.length;
}

export default function KPICards({
  weeks,
  pnl,
  includeLoc,
  onIncludeLocChange,
  locUndrawn,
  trendSeries,
  benchmarks,
  drilldowns,
}: {
  weeks: WeekMetric[];
  /** Window-level P&L totals; when provided, the P&L row shows
   *  filter-window totals instead of per-week snapshots. */
  pnl?: PnlSummary | null;
  /** When true, cash-based Liquidity / Ratios / Payroll Runway cards fold
   *  undrawn LOC into cash. Controlled from the parent dashboard page so
   *  both KPICards and RunwayKPICards observe the same state. */
  includeLoc?: boolean;
  /** Fired when the user flips the Include-LOC pill. Wired to the
   *  dashboard's localStorage-backed state. */
  onIncludeLocChange?: (next: boolean) => void;
  /** $ amount of unused LOC capacity. Folded into cash-based metrics
   *  when includeLoc is true. */
  locUndrawn?: number;
  /** Per-metric time-series for inline sparklines. */
  trendSeries?: TrendSeries | null;
  /** Industry benchmark reference values for ratio / weeks metrics. */
  benchmarks?: Benchmarks | null;
  /** Click-to-expand backing data, keyed by metric_key (e.g. "cash",
   *  "current_ratio"). When provided, every card with a matching entry
   *  becomes click-to-drilldown. */
  drilldowns?: DrilldownMap | null;
}) {
  const [activeDrilldown, setActiveDrilldown] =
    useState<{ key: string; title: string; subtitle?: string } | null>(null);

  if (weeks.length === 0) return <KPISkeleton />;

  // Anchor on the last week WITH ACTIVITY — zero-activity future weeks are
  // configured but unimported and would otherwise blank out every metric.
  const activeTail = lastActiveWeeks(weeks, 4);
  const latest = activeTail[activeTail.length - 1] ?? weeks[weeks.length - 1];

  const fmtRatio = (v: number | null | undefined) =>
    v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(2);

  // Effective cash folds in undrawn LOC when the toggle is on. All six
  // cash-based metrics flow from this single number:
  //   cash' = cash + (includeLoc ? locUndrawn : 0)
  // Ratios are recomputed directly from the underlying AP + payroll
  // accruals (both on WeekMetric); coverage / runway are scaled by
  // (cash' / cash) rather than re-derived from the raw weekly burn, so
  // we don't need to plumb the burn inputs into this client.
  const locAmount = includeLoc ? (locUndrawn ?? 0) : 0;
  const baseCash = latest.cat_1_cash;
  const effectiveCash = baseCash + locAmount;
  const cashScale = baseCash > 0 ? effectiveCash / baseCash : 1;

  const liab = latest.ap + latest.payroll_accruals;

  const effNetLiquidity = latest.net_liquidity + locAmount;
  const effCurrentRatio =
    liab > 0 ? (effectiveCash + latest.cat_2_ar) / liab : null;
  const effQuickRatio = liab > 0 ? effectiveCash / liab : null;
  const effCashCoverage =
    latest.cash_coverage_weeks !== null
      ? latest.cash_coverage_weeks * cashScale
      : latest.cash_coverage_weeks;
  const effPayrollRunway =
    latest.payroll_runway_wks !== null
      ? latest.payroll_runway_wks * cashScale
      : latest.payroll_runway_wks;

  const locBadge = includeLoc ? { label: "+LOC", tone: "green" as const } : null;
  const undrawnExtra =
    includeLoc && (locUndrawn ?? 0) > 0
      ? `+ ${fmtMoneyShort(locUndrawn)} undrawn LOC`
      : null;

  // ─── Drilldown wiring ───────────────────────────────────────────────────
  // bind(...) returns an onClick handler that opens the drilldown modal for
  // the given metric_key. Returns undefined if the API hasn't surfaced a
  // drilldown for that key — prevents the card from showing as clickable
  // before the data loads.
  function bind(key: string, title: string, subtitle?: string): (() => void) | undefined {
    if (!drilldowns || !drilldowns[key]) return undefined;
    return () => setActiveDrilldown({ key, title, subtitle });
  }

  // ─── Sparkline helpers ──────────────────────────────────────────────────
  // `spark(...)` builds a Sparkline node for a given TrendSeries key with
  // the right format + reference line + colour. Returns undefined when no
  // trendSeries is loaded (skeleton), so <KPICard> falls back gracefully.
  function spark(
    key: keyof TrendSeries,
    opts: {
      format: SparklineFormat;
      color: string;
      /** "avg" → rolling mean of the series. "benchmark" → corresponding
       *  Benchmarks entry. undefined → no reference line. */
      reference?: "avg" | "benchmark" | undefined;
      benchmarkKey?: keyof Benchmarks;
    },
  ): React.ReactNode {
    if (!trendSeries) return null;
    const data = trendSeries[key];
    if (!data || data.length === 0) return null;
    let referenceValue: number | undefined;
    let referenceLabel: string | undefined;
    if (opts.reference === "avg") {
      referenceValue = seriesAvg(data);
      referenceLabel = "avg";
    } else if (opts.reference === "benchmark" && benchmarks && opts.benchmarkKey) {
      referenceValue = benchmarks[opts.benchmarkKey];
      referenceLabel = "healthy";
    }
    return (
      <Sparkline
        data={data.map((p) => ({ label: p.period_label, value: p.value }))}
        format={opts.format}
        color={opts.color}
        referenceValue={referenceValue}
        referenceLabel={referenceLabel}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* LOC toggle. Shown even when parent didn't wire onIncludeLocChange
          so the dashboard always gets a visible control; if no handler is
          passed the pill is inert. */}
      {typeof includeLoc === "boolean" && (
        <div className="flex items-center gap-2 -mb-2">
          <button
            type="button"
            onClick={() => onIncludeLocChange?.(!includeLoc)}
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
              includeLoc
                ? "bg-green-50 text-green-700 border-green-300"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
            aria-pressed={includeLoc}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                includeLoc ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            Include LOC ($2M facility)
          </button>
          <InfoTooltip
            align="left"
            text="Adds undrawn LOC capacity ($2M limit minus current drawn) to liquidity. Treats your unused borrowing power as available cash."
          />
        </div>
      )}

      <SectionRow title="Liquidity">
        <KPICard
          label="Cash on Hand"
          value={fmtMoneyShort(baseCash)}
          delta={latest.cash_change}
          subtitle="Across all bank accounts"
          accent={COLORS.cash}
          extraLine={undrawnExtra}
          sparkline={spark("cash", { format: "money", color: COLORS.cash, reference: "avg" })}
          onClick={bind("cash", "Cash on Hand", "Across all bank accounts")}
        />
        <KPICard
          label="Net Liquidity"
          value={fmtMoneyShort(effNetLiquidity)}
          delta={latest.net_liquidity_change}
          subtitle="Cash − AP − Payroll Accruals"
          accent={COLORS.netLiq}
          badge={locBadge}
          sparkline={spark("net_liquidity", { format: "money", color: COLORS.netLiq, reference: "avg" })}
          onClick={bind("net_liquidity", "Net Liquidity", "Cash − AP − Payroll Accruals")}
        />
        <KPICard
          label="Cash Coverage"
          value={fmtWeeks(effCashCoverage)}
          subtitle="Weeks of AP covered by Cash"
          accent={COLORS.runway}
          badge={locBadge}
          sparkline={spark("cash_coverage_weeks", { format: "weeks", color: COLORS.runway, reference: "benchmark", benchmarkKey: "cash_coverage_weeks" })}
          onClick={bind("cash_coverage_weeks", "Cash Coverage", "Weeks of AP covered by Cash")}
        />
      </SectionRow>

      <SectionRow title="Working Capital">
        <KPICard
          label="What We're Owed"
          value={fmtMoneyShort(latest.cat_2_ar)}
          delta={latest.ar_change}
          subtitle="Total AR"
          accent={COLORS.ar}
          sparkline={spark("ar", { format: "money", color: COLORS.ar, reference: "avg" })}
          onClick={bind("ar", "What We're Owed", "Total AR")}
        />
        <KPICard
          label="AP"
          value={fmtMoneyShort(latest.ap)}
          subtitle="Account 2005 A/P Trade"
          accent={COLORS.debt}
          inverseDelta={true}
          sparkline={spark("ap", { format: "money", color: COLORS.debt, reference: "avg" })}
          onClick={bind("ap", "AP", "Account 2005 A/P Trade")}
        />
        <KPICard
          label="Payroll Runway"
          value={fmtWeeks(effPayrollRunway)}
          subtitle="Weeks of Payroll covered by Cash"
          accent={COLORS.runway}
          badge={locBadge}
          sparkline={spark("payroll_runway_wks", { format: "weeks", color: COLORS.runway, reference: "benchmark", benchmarkKey: "payroll_runway_wks" })}
          onClick={bind("payroll_runway_wks", "Payroll Runway", "Weeks of Payroll covered by Cash")}
        />
      </SectionRow>

      <SectionRow title="Ratios">
        <KPICard
          label="Current Ratio"
          value={fmtRatio(effCurrentRatio)}
          subtitle="(Cash + AR) ÷ (AP + Payroll Accruals)"
          accent={COLORS.ratio}
          badge={locBadge}
          sparkline={spark("current_ratio", { format: "ratio", color: COLORS.ratio, reference: "benchmark", benchmarkKey: "current_ratio" })}
          onClick={bind("current_ratio", "Current Ratio", "(Cash + AR) ÷ (AP + Payroll Accruals)")}
        />
        <KPICard
          label="Quick Ratio"
          value={fmtRatio(effQuickRatio)}
          subtitle="Cash ÷ (AP + Payroll Accruals)"
          accent={COLORS.ratio}
          badge={locBadge}
          sparkline={spark("quick_ratio", { format: "ratio", color: COLORS.ratio, reference: "benchmark", benchmarkKey: "quick_ratio" })}
          onClick={bind("quick_ratio", "Quick Ratio", "Cash ÷ (AP + Payroll Accruals)")}
        />
        <KPICard
          label="AR to AP"
          value={fmtRatio(latest.ar_to_ap)}
          subtitle="AR ÷ AP"
          accent={COLORS.ratio}
          sparkline={spark("ar_to_ap", { format: "ratio", color: COLORS.ratio, reference: "benchmark", benchmarkKey: "ar_to_ap" })}
          onClick={bind("ar_to_ap", "AR to AP", "AR ÷ AP")}
        />
      </SectionRow>

      <SectionRow title="P&L (filter window)">
        <KPICard
          label="Revenue"
          value={fmtMoneyShort(pnl?.revenue ?? 0)}
          subtitle="Period activity in view"
          accent={COLORS.revenue}
          sparkline={spark("revenue", { format: "money", color: COLORS.revenue, reference: "avg" })}
          onClick={bind("revenue", "Revenue", "Period activity in view")}
        />
        <KPICard
          label="Gross Margin %"
          value={fmtPct(pnl?.gross_margin_pct)}
          subtitle="(Revenue − DJC) ÷ Revenue"
          accent={COLORS.margin}
          sparkline={spark("gross_margin_pct", { format: "pct", color: COLORS.margin, reference: "avg" })}
          onClick={bind("gross_margin_pct", "Gross Margin %", "(Revenue − DJC) ÷ Revenue")}
        />
        <KPICard
          label="Operating Margin %"
          value={fmtPct(pnl?.operating_margin_pct)}
          subtitle="Accrual basis — see P&L for cash split"
          accent={COLORS.opMargin}
          help="Accrual basis includes non-cash expenses like depreciation. See P&L Breakdown for cash-only view."
          sparkline={spark("operating_margin_pct", { format: "pct", color: COLORS.opMargin, reference: "avg" })}
          onClick={bind("operating_margin_pct", "Operating Margin %", "Accrual basis — see P&L for cash split")}
        />
      </SectionRow>

      <KpiDrilldownModal
        isOpen={activeDrilldown !== null}
        onClose={() => setActiveDrilldown(null)}
        title={activeDrilldown?.title ?? ""}
        subtitle={activeDrilldown?.subtitle}
        drilldown={activeDrilldown && drilldowns ? drilldowns[activeDrilldown.key] : null}
      />
    </div>
  );
}
