"use client";

import type { RunwaySummary, TrendSeries, Benchmarks } from "@/app/api/metrics/route";
import InfoTooltip from "@/components/ui/InfoTooltip";
import Sparkline, { type SparklineFormat } from "@/components/dashboard/Sparkline";

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
}) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
          {label}
        </p>
        <InfoTooltip text={help} />
      </div>
      <div className="flex items-center justify-between gap-2">
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
}) {
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
      />
      <RunwayCard
        label="Weekly Burn"
        value={fmtMoneyShort(runway.avg_weekly_burn)}
        subtitle="8-wk avg"
        accent={COLORS.burn}
        help="How fast cash is leaving per week. Adds three 8-week averages: AP payments (bills paid to vendors) + payroll (labor + taxes + burden) + overhead (rent, utilities, etc.). Each is pre-summed across all divisions before averaging — a labor account that spans division 10, 20, and 99 contributes one whole-company weekly total to the average, not three slices. Example: $450K/wk burn means cash drops about $450K every week with no collections."
        sparkline={spark("weekly_burn", { format: "money", color: COLORS.burn, reference: "avg" })}
      />
      <RunwayCard
        label="Net Cash Flow"
        value={`${netCashFlow >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(netCashFlow))}/wk`}
        subtitle="Collections − Burn"
        accent={COLORS.net}
        valueColor={netColor}
        help="Collections minus burn. Positive = building cash. Negative = draining cash."
        sparkline={spark("net_cash_flow", { format: "money", color: COLORS.net, reference: "avg" })}
      />
      <RunwayCard
        label="Weeks of Runway"
        value={fmtWeeks(weeksOfRunway)}
        subtitle={`At current burn • anchor ${runway.anchor_week_ending ?? "—"}`}
        accent={COLORS.runway}
        badge={runwayBadge}
        help="Worst case: if collections stopped tomorrow, how many weeks of cash until you're out. Current cash ÷ weekly burn. Example: $2M cash ÷ $500K/wk burn = 4 weeks. Reality is better because you'll keep collecting — this is the floor."
        sparkline={spark("weeks_of_runway", { format: "weeks", color: COLORS.runway, reference: "benchmark", benchmarkKey: "weeks_of_runway" })}
      />
      <RunwayCard
        label="Coast Number"
        value={`${fmtMoneyShort(runway.coast_weekly)}/wk`}
        subtitle="Collections needed to break even"
        accent={COLORS.coast}
        help="The weekly collection target to stay cash-flat. Equal to weekly burn. If you collect this much each week, cash stays where it is. Less → cash shrinks; more → cash grows. Example: $450K/wk burn means you need to collect $450K/wk to coast."
        sparkline={spark("coast_weekly", { format: "money", color: COLORS.coast, reference: "avg" })}
      />
      <RunwayCard
        label="Grow Number"
        value={`${fmtMoneyShort(runway.grow_weekly)}/wk`}
        subtitle={`At ${growthPctLabel} growth target`}
        accent={COLORS.grow}
        help={`Weekly collection target to fund a ${growthPctLabel} revenue bump. Takes the coast number (break-even) and adds ${growthPctLabel} of average weekly revenue on top. Example at 10%: if weekly burn is $450K and weekly revenue averages $600K, grow number = $450K + ($60K) = $510K/wk. Adjust the target with the slider.`}
        sparkline={spark("grow_weekly", { format: "money", color: COLORS.grow, reference: "avg" })}
      />
    </div>
  );
}
