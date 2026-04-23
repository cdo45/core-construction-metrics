"use client";

import {
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

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

function fmtWeeksNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(1)} wks`;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface WhatIfMetricPair {
  /** Metric label (e.g. "Weekly Burn"). */
  label: string;
  current: number;
  scenario: number;
  /** Display format; weeks render with " wks" suffix, $ otherwise. */
  unit?: "money" | "weeks";
  /** When true, higher = worse (e.g. burn). Colors the scenario bar red
   *  if it grew; green if it shrank. Defaults to false (higher = better). */
  higherIsWorse?: boolean;
}

export interface CashProjectionPoint {
  week: number;       // 0..12
  current: number;    // baseline cash
  scenario: number;   // with-scenario cash
}

// ─── Grouped bar chart ───────────────────────────────────────────────────────

interface BarRow {
  label: string;
  current: number;
  scenario: number;
  _unit: "money" | "weeks";
  _worseDir: boolean;
}

function BarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BarRow; dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  if (!p) return null;
  const fmt = p._unit === "weeks" ? fmtWeeksNumber : fmtMoneyFull;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 shadow-sm text-xs space-y-0.5">
      <div className="text-gray-500 font-medium">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-600">Current:</span>
        <span className="font-semibold tabular-nums">{fmt(p.current)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-900">Scenario:</span>
        <span className="font-semibold tabular-nums">{fmt(p.scenario)}</span>
      </div>
    </div>
  );
}

function bestColor(row: BarRow): string {
  const better = row._worseDir
    ? row.scenario <= row.current
    : row.scenario >= row.current;
  return better ? "#2F9E44" : "#C00000";
}

// ─── Line-chart tooltip ──────────────────────────────────────────────────────

function CashTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 shadow-sm text-xs space-y-0.5">
      <div className="text-gray-500 font-medium">Week {String(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>
            {p.dataKey === "current" ? "Current" : "Scenario"}:
          </span>
          <span className="font-semibold tabular-nums">{fmtMoneyFull(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function WhatIfComparisonChart({
  metrics,
  cashProjection,
}: {
  metrics: WhatIfMetricPair[];
  cashProjection: CashProjectionPoint[];
}) {
  const barData: BarRow[] = metrics.map((m) => ({
    label: m.label,
    current: m.current,
    scenario: m.scenario,
    _unit: m.unit ?? "money",
    _worseDir: Boolean(m.higherIsWorse),
  }));

  // Project is empty (e.g. scenario incomplete) → hide line chart cleanly.
  const hasProjection = cashProjection.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Current vs Scenario
        </h4>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => fmtMoneyShort(v)}
                width={70}
              />
              <Tooltip content={<BarTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="current" name="Current" fill="#94a3b8" />
              <Bar dataKey="scenario" name="Scenario">
                {barData.map((row, i) => (
                  <Cell key={i} fill={bestColor(row)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {hasProjection && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            12-Week Cash Projection
          </h4>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cashProjection} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => `w${v}`} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => fmtMoneyShort(v)}
                  width={70}
                />
                <Tooltip content={<CashTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#C00000" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="current"
                  name="Current trajectory"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="scenario"
                  name="With scenario"
                  stroke="#1F6FEB"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
