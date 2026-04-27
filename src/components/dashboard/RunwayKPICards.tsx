"use client";

import { useState } from "react";
import type {
  RunwaySummary,
  TrendSeries,
  TrendPoint,
  Benchmarks,
  WeekMetric,
  AccountSnapshot,
} from "@/app/api/metrics/route";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Sparkline, { type SparklineFormat } from "@/components/dashboard/Sparkline";
import { getKpiBreakdown, type KpiBreakdown } from "@/lib/kpi-breakdown";
import KpiBreakdownSections from "@/components/dashboard/KpiBreakdownSections";

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

// ─── Card ────────────────────────────────────────────────────────────────────

function RunwayCard({
  label,
  value,
  subtitle,
  help,
  accent,
  valueColor,
  badge,
  sparkline,
  onClick,
}: {
  label: string;
  value: string;
  subtitle: string;
  help: string;
  accent: string;
  valueColor?: string;
  /** Small inline tag rendered to the right of the value — used for the
   *  "+LOC" marker when undrawn LOC is folded into the Weeks of Runway
   *  number. */
  badge?: { label: string } | null;
  /** Optional Sparkline node rendered next to the value. */
  sparkline?: React.ReactNode;
  /** When set, the card becomes clickable and fires this on activation. */
  onClick?: () => void;
}) {
  // Same responsive layout rules as KPICard — prevent the sparkline from
  // collapsing the value at the sm breakpoint edge; stack vertically
  // below 640px.
  const valueRowLayout = sparkline
    ? "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2"
    : "flex items-center";
  const cardMinWidth = sparkline ? "min-w-[240px]" : "";

  const clickableCls = onClick
    ? "cursor-pointer hover:shadow-md hover:border-gray-300 transition-shadow"
    : "";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
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
      className={`bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1 ${cardMinWidth} ${clickableCls}`}
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
          {label}
        </p>
        <InfoTooltip text={help} />
      </div>
      <div className={valueRowLayout}>
        <p
          className={`text-2xl font-bold tabular-nums leading-tight flex items-baseline gap-2 min-w-0 ${valueColor ?? "text-gray-900"}`}
        >
          <span className="truncate">{value}</span>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-200 whitespace-nowrap">
              {badge.label}
            </span>
          )}
        </p>
        {sparkline && <div className="flex-shrink-0">{sparkline}</div>}
      </div>
      <p className="text-xs text-gray-400 truncate">{subtitle}</p>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const COLORS = {
  collections: "#2F9E44",
  burn:        "#C00000",
  net:         "#1F6FEB",
  runway:      "#6F42C1",
  coast:       "#2E8B8B",
  grow:        "#B7791F",
};

function seriesAvg(points: Array<{ value: number }> | undefined): number {
  if (!points || points.length === 0) return 0;
  let s = 0;
  for (const p of points) s += p.value;
  return s / points.length;
}

export default function RunwayKPICards({
  runway,
  includeLoc,
  locUndrawn,
  trendSeries,
  benchmarks,
  weeks,
  accountBreakdown,
}: {
  runway: RunwaySummary | null;
  /** When true, Weeks of Runway uses (cash + undrawn LOC) / burn. Owned
   *  by the parent dashboard page; mirror of the prop passed to KPICards. */
  includeLoc?: boolean;
  locUndrawn?: number;
  /** Time-series for inline sparklines — the runway-specific keys are
   *  populated alongside the other metrics in /api/metrics. */
  trendSeries?: TrendSeries | null;
  benchmarks?: Benchmarks | null;
  /** Latest WeekMetric snapshot — feeds the drilldown breakdown helper.
   *  Only used when getKpiBreakdown can produce a result for the active
   *  metric; runway-specific keys (weeks_of_runway, weekly_collections,
   *  etc.) fall back to the trend-only modal. */
  weeks?: WeekMetric[];
  accountBreakdown?: AccountSnapshot[];
}) {
  // Drilldown selection lives at the parent so the modal can render below
  // the grid. Hooks must run unconditionally — declared before the early
  // return for the loading skeleton.
  const [drill, setDrill] = useState<RunwayDrillSpec | null>(null);

  if (!runway) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 animate-pulse">
            <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
            <div className="h-7 w-32 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-40 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const netCashFlow = runway.avg_weekly_collections - runway.avg_weekly_burn;
  const netColor =
    netCashFlow > 0 ? "text-green-700" : netCashFlow < 0 ? "text-red-700" : "text-gray-900";

  const growthPctLabel = `${Math.round(runway.growth_target_pct * 100)}%`;

  // Weeks of Runway recomputed with LOC: (cash + loc_undrawn) / burn.
  // Direct formula because runway.avg_weekly_burn is exposed on the
  // summary — no scaling trick needed here.
  const locAmount = includeLoc ? (locUndrawn ?? 0) : 0;
  const weeksOfRunway =
    runway.avg_weekly_burn > 0
      ? (runway.current_cash + locAmount) / runway.avg_weekly_burn
      : runway.weeks_of_runway;
  const runwayBadge = includeLoc ? { label: "+LOC" } : null;

  function openDrill(
    key: keyof TrendSeries,
    title: string,
    format: SparklineFormat,
    color: string,
  ): (() => void) | undefined {
    if (!trendSeries) return undefined;
    const data = trendSeries[key];
    if (!data || data.length === 0) return undefined;
    return () => setDrill({ key, title, format, color });
  }

  // Sparkline helper — mirrors the one in KPICards. Returns null when the
  // trend_series isn't loaded yet so RunwayCard renders without the spark.
  function spark(
    key: keyof TrendSeries,
    opts: {
      format: SparklineFormat;
      color: string;
      reference?: "avg" | "benchmark";
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
      referenceLabel = "target";
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <RunwayCard
        label="Weekly Collections"
        value={fmtMoneyShort(runway.avg_weekly_collections)}
        subtitle="8-wk avg"
        accent={COLORS.collections}
        help="Average cash landing in operating accounts per week. Calculated from deposits to 1021/1027/1120 over the last 8 active weeks."
        sparkline={spark("weekly_collections", { format: "money", color: COLORS.collections, reference: "avg" })}
        onClick={openDrill("weekly_collections", "Weekly Collections", "money", COLORS.collections)}
      />
      <RunwayCard
        label="Weekly Burn"
        value={fmtMoneyShort(runway.avg_weekly_burn)}
        subtitle="8-wk avg"
        accent={COLORS.burn}
        help="How fast cash is leaving per week. Adds three 8-week averages: AP payments (bills paid to vendors) + payroll (labor + taxes + burden) + overhead (rent, utilities, etc.). Each is pre-summed across all divisions before averaging — a labor account that spans division 10, 20, and 99 contributes one whole-company weekly total to the average, not three slices. Example: $450K/wk burn means cash drops about $450K every week with no collections."
        sparkline={spark("weekly_burn", { format: "money", color: COLORS.burn, reference: "avg" })}
        onClick={openDrill("weekly_burn", "Weekly Burn", "money", COLORS.burn)}
      />
      <RunwayCard
        label="Net Cash Flow"
        value={`${netCashFlow >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(netCashFlow))}/wk`}
        subtitle="Collections − Burn"
        accent={COLORS.net}
        valueColor={netColor}
        help="Collections minus burn. Positive = building cash. Negative = draining cash."
        sparkline={spark("net_cash_flow", { format: "money", color: COLORS.net, reference: "avg" })}
        onClick={openDrill("net_cash_flow", "Net Cash Flow", "money", COLORS.net)}
      />
      <RunwayCard
        label="Weeks of Runway"
        value={fmtWeeks(weeksOfRunway)}
        subtitle={`At current burn • anchor ${runway.anchor_week_ending ?? "—"}`}
        accent={COLORS.runway}
        badge={runwayBadge}
        help="Worst case: if collections stopped tomorrow, how many weeks of cash until you're out. Current cash ÷ weekly burn. Example: $2M cash ÷ $500K/wk burn = 4 weeks. Reality is better because you'll keep collecting — this is the floor."
        sparkline={spark("weeks_of_runway", { format: "weeks", color: COLORS.runway, reference: "benchmark", benchmarkKey: "weeks_of_runway" })}
        onClick={openDrill("weeks_of_runway", "Weeks of Runway", "weeks", COLORS.runway)}
      />
      <RunwayCard
        label="Coast Number"
        value={`${fmtMoneyShort(runway.coast_weekly)}/wk`}
        subtitle="Collections needed to break even"
        accent={COLORS.coast}
        help="The weekly collection target to stay cash-flat. Equal to weekly burn. If you collect this much each week, cash stays where it is. Less → cash shrinks; more → cash grows. Example: $450K/wk burn means you need to collect $450K/wk to coast."
        sparkline={spark("coast_weekly", { format: "money", color: COLORS.coast, reference: "avg" })}
        onClick={openDrill("coast_weekly", "Coast Number", "money", COLORS.coast)}
      />
      <RunwayCard
        label="Grow Number"
        value={`${fmtMoneyShort(runway.grow_weekly)}/wk`}
        subtitle={`At ${growthPctLabel} growth target`}
        accent={COLORS.grow}
        help={`Weekly collection target to fund a ${growthPctLabel} revenue bump. Takes the coast number (break-even) and adds ${growthPctLabel} of average weekly revenue on top. Example at 10%: if weekly burn is $450K and weekly revenue averages $600K, grow number = $450K + ($60K) = $510K/wk. Adjust the target with the slider.`}
        sparkline={spark("grow_weekly", { format: "money", color: COLORS.grow, reference: "avg" })}
        onClick={openDrill("grow_weekly", "Grow Number", "money", COLORS.grow)}
      />

      {drill && trendSeries && (() => {
        const latest = weeks && weeks.length > 0 ? weeks[weeks.length - 1] : null;
        const breakdown = latest
          ? getKpiBreakdown(drill.key, latest, accountBreakdown ?? [])
          : null;
        return (
          <RunwayDrilldownModal
            spec={drill}
            points={trendSeries[drill.key] ?? []}
            breakdown={breakdown}
            onClose={() => setDrill(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Drilldown ───────────────────────────────────────────────────────────────

interface RunwayDrillSpec {
  key: keyof TrendSeries;
  title: string;
  format: SparklineFormat;
  color: string;
}

function fmtDrillValue(format: SparklineFormat, n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (format === "money") return fmtMoneyShort(n);
  if (format === "pct")   return `${n.toFixed(1)}%`;
  if (format === "weeks") return fmtWeeks(n);
  return n.toFixed(2);
}

function RunwayDrilldownModal({
  spec,
  points,
  breakdown,
  onClose,
}: {
  spec: RunwayDrillSpec;
  points: TrendPoint[];
  breakdown: KpiBreakdown | null;
  onClose: () => void;
}) {
  const rows = [...points].reverse();
  const headerValue =
    breakdown !== null
      ? breakdown.resultFormat === "ratio"
        ? breakdown.result.toFixed(3)
        : fmtMoneyShort(breakdown.result)
      : points.length > 0
        ? fmtDrillValue(spec.format, points[points.length - 1].value)
        : "—";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 col-span-full"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-gray-200"
          style={{ borderLeft: `4px solid ${spec.color}` }}
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{spec.title}</h3>
            <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight mt-0.5">
              {headerValue}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-auto">
          {breakdown && <KpiBreakdownSections breakdown={breakdown} />}
          <div className="px-6 pt-3 pb-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Per-week trend · {points.length} weeks
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
              <tr>
                <th className="px-6 py-2 text-left font-medium">Week</th>
                <th className="px-6 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-6 text-center text-xs text-gray-400">
                    No data.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.period_label}>
                    <td className="px-6 py-2 text-gray-700">{p.period_label}</td>
                    <td className="px-6 py-2 text-right tabular-nums text-gray-900">
                      {fmtDrillValue(spec.format, p.value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
