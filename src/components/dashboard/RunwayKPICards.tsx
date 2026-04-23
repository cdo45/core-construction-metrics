"use client";

import type { RunwaySummary } from "@/app/api/metrics/route";
import InfoTooltip from "@/components/ui/InfoTooltip";

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
}: {
  label: string;
  value: string;
  subtitle: string;
  help: string;
  accent: string;
  valueColor?: string;
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
      <p
        className={`text-2xl font-bold tabular-nums leading-tight ${valueColor ?? "text-gray-900"}`}
      >
        {value}
      </p>
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

export default function RunwayKPICards({ runway }: { runway: RunwaySummary | null }) {
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <RunwayCard
        label="Weekly Collections"
        value={fmtMoneyShort(runway.avg_weekly_collections)}
        subtitle="8-wk avg"
        accent={COLORS.collections}
        help="Average cash landing in operating accounts per week. Calculated from deposits to 1021/1027/1120 over the last 8 active weeks."
      />
      <RunwayCard
        label="Weekly Burn"
        value={fmtMoneyShort(runway.avg_weekly_burn)}
        subtitle="8-wk avg"
        accent={COLORS.burn}
        help="Cash leaving per week. Weekly payroll (current week) + 8-wk avg of AP payments + 8-wk avg of overhead bills. Payroll is weekly reality; AP/OH are smoothed because they're bursty."
      />
      <RunwayCard
        label="Net Cash Flow"
        value={`${netCashFlow >= 0 ? "+" : "-"}${fmtMoneyShort(Math.abs(netCashFlow))}/wk`}
        subtitle="Collections − Burn"
        accent={COLORS.net}
        valueColor={netColor}
        help="Collections minus burn. Positive = building cash. Negative = draining cash."
      />
      <RunwayCard
        label="Weeks of Runway"
        value={fmtWeeks(runway.weeks_of_runway)}
        subtitle={`At current burn • anchor ${runway.anchor_week_ending ?? "—"}`}
        accent={COLORS.runway}
        help="At current burn rate, how long before cash runs out assuming zero collections. Formula: current cash / weekly burn. Reality: you'll collect more, so this is worst-case."
      />
      <RunwayCard
        label="Coast Number"
        value={`${fmtMoneyShort(runway.coast_weekly)}/wk`}
        subtitle="Collections needed to break even"
        accent={COLORS.coast}
        help="Collections needed per week to break even. Equal to weekly burn. Below this = draining cash."
      />
      <RunwayCard
        label="Grow Number"
        value={`${fmtMoneyShort(runway.grow_weekly)}/wk`}
        subtitle={`At ${growthPctLabel} growth target`}
        accent={COLORS.grow}
        help={`Collections needed per week to grow revenue by ${growthPctLabel} YoY. Formula: coast + (${growthPctLabel} × avg weekly revenue). Adjust target with the slider.`}
      />
    </div>
  );
}
