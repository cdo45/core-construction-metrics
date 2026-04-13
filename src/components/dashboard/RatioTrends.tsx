"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import type { WeekMetric } from "@/app/api/metrics/route";

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  current:  "#4472C4",
  quick:    "#2E8B8B",
  cash:     "#548235",
  payroll:  "#ED7D31",
  ar_ap:    "#4472C4",
  good:     "#548235",
  warn:     "#F59E0B",
  bad:      "#C00000",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

function fmtRatio(v: number | null, decimals = 2): string {
  if (v === null || !isFinite(v)) return "N/A";
  return v.toFixed(decimals);
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── 4-week average helper ────────────────────────────────────────────────────

function avg4(weeks: WeekMetric[], key: keyof WeekMetric): number | null {
  const trail = weeks.slice(-4);
  const vals = trail
    .map((w) => w[key] as number | null)
    .filter((v): v is number => v !== null && isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function statusColor(
  v: number | null,
  good: number,
  warn: number,
  higherIsBetter = true
): string {
  if (v === null || !isFinite(v)) return "#9CA3AF";
  if (higherIsBetter) {
    if (v >= good) return C.good;
    if (v >= warn) return C.warn;
    return C.bad;
  } else {
    if (v <= good) return C.good;
    if (v <= warn) return C.warn;
    return C.bad;
  }
}

// ─── Trend arrow ─────────────────────────────────────────────────────────────

function TrendArrow({ current, prior }: { current: number | null; prior: number | null }) {
  if (current === null || prior === null) return <span className="text-gray-400">—</span>;
  if (current > prior) return <span className="text-green-600 text-sm">↑</span>;
  if (current < prior) return <span className="text-red-600 text-sm">↓</span>;
  return <span className="text-gray-400 text-sm">→</span>;
}

// ─── Chart 1: Liquidity Ratios ────────────────────────────────────────────────

function LiquidityChart({ weeks }: { weeks: WeekMetric[] }) {
  return (
    <ChartCard title="Liquidity Ratios">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={weeks} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => v.toFixed(1)}
            tick={{ fontSize: 11 }}
            width={38}
            domain={[0, "auto"]}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) =>
              [v !== null ? (v as number).toFixed(2) : "N/A", String(name ?? "")] as [string, string]
            }
            labelFormatter={(v) => `Week: ${v}`}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={1.0} stroke="#9CA3AF" strokeDasharray="4 2"
            label={{ value: "1.0 Min", position: "right", fontSize: 9, fill: "#9CA3AF" }} />
          <ReferenceLine y={0.5} stroke="#D1D5DB" strokeDasharray="2 2"
            label={{ value: "0.5", position: "right", fontSize: 9, fill: "#D1D5DB" }} />
          <Line
            type="monotone"
            dataKey="current_ratio"
            name="Current Ratio"
            stroke={C.current}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="quick_ratio"
            name="Quick Ratio"
            stroke={C.quick}
            strokeWidth={2}
            dot={{ r: 2 }}
            strokeDasharray="4 2"
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 2: Coverage Metrics ───────────────────────────────────────────────

function CoverageChart({ weeks }: { weeks: WeekMetric[] }) {
  return (
    <ChartCard title="Coverage Metrics (weeks)">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={weeks} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => `${v.toFixed(0)}w`}
            tick={{ fontSize: 11 }}
            width={38}
            domain={[0, "auto"]}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) =>
              [v !== null ? `${(v as number).toFixed(1)} wks` : "N/A", String(name ?? "")] as [string, string]
            }
            labelFormatter={(v) => `Week: ${v}`}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={4} stroke="#9CA3AF" strokeDasharray="4 2"
            label={{ value: "4-wk cushion", position: "right", fontSize: 9, fill: "#9CA3AF" }} />
          <Line
            type="monotone"
            dataKey="cash_coverage_weeks"
            name="Cash Coverage"
            stroke={C.cash}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="payroll_coverage"
            name="Payroll Coverage"
            stroke={C.payroll}
            strokeWidth={2}
            dot={{ r: 2 }}
            strokeDasharray="4 2"
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 3: AR-to-AP ───────────────────────────────────────────────────────

function ARtoAPChart({ weeks }: { weeks: WeekMetric[] }) {
  return (
    <ChartCard title="AR-to-AP Ratio">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={weeks} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gArAp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.ar_ap} stopOpacity={0.18} />
              <stop offset="95%" stopColor={C.ar_ap} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={fmtDate} tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => v.toFixed(1)}
            tick={{ fontSize: 11 }}
            width={38}
            domain={[0, "auto"]}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) =>
              [v !== null ? (v as number).toFixed(2) : "N/A", String(name ?? "")] as [string, string]
            }
            labelFormatter={(v) => `Week: ${v}`}
          />
          <ReferenceLine y={1.0} stroke="#548235" strokeDasharray="4 2"
            label={{ value: "Breakeven", position: "right", fontSize: 9, fill: "#548235" }} />
          <Area
            type="monotone"
            dataKey="ar_to_ap"
            name="AR / AP"
            stroke={C.ar_ap}
            fill="url(#gArAp)"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Summary Table ────────────────────────────────────────────────────────────

interface RatioRow {
  label: string;
  key: keyof WeekMetric;
  format: (v: number | null) => string;
  goodThreshold: number;
  warnThreshold: number;
  higherIsBetter: boolean;
}

const RATIO_ROWS: RatioRow[] = [
  {
    label: "Current Ratio",
    key: "current_ratio",
    format: fmtRatio,
    goodThreshold: 1.5, warnThreshold: 1.0, higherIsBetter: true,
  },
  {
    label: "Quick Ratio",
    key: "quick_ratio",
    format: fmtRatio,
    goodThreshold: 0.5, warnThreshold: 0.25, higherIsBetter: true,
  },
  {
    label: "AR / AP",
    key: "ar_to_ap",
    format: fmtRatio,
    goodThreshold: 1.2, warnThreshold: 0.8, higherIsBetter: true,
  },
  {
    label: "Cash Coverage",
    key: "cash_coverage_weeks",
    format: (v) => v !== null && isFinite(v) ? `${v.toFixed(1)} wks` : "N/A",
    goodThreshold: 8, warnThreshold: 4, higherIsBetter: true,
  },
  {
    label: "Payroll Coverage",
    key: "payroll_coverage",
    format: (v) => v !== null && isFinite(v) ? `${v.toFixed(1)} wks` : "N/A",
    goodThreshold: 8, warnThreshold: 4, higherIsBetter: true,
  },
  {
    label: "Net Liquidity",
    key: "net_liquidity",
    format: (v) => v !== null ? fmtMoney(v) : "N/A",
    goodThreshold: 0, warnThreshold: -50_000, higherIsBetter: true,
  },
];

function RatioTable({ weeks }: { weeks: WeekMetric[] }) {
  if (weeks.length === 0) return null;

  const latest = weeks[weeks.length - 1];
  const prior  = weeks.length >= 2 ? weeks[weeks.length - 2] : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">Ratio Snapshot</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr>
              <th className="table-th">Ratio</th>
              <th className="table-th text-right">Current</th>
              <th className="table-th text-right">Prior Week</th>
              <th className="table-th text-right">4-Week Avg</th>
              <th className="table-th text-center w-16">Trend</th>
              <th className="table-th text-center w-16">Status</th>
            </tr>
          </thead>
          <tbody>
            {RATIO_ROWS.map((row) => {
              const current   = latest[row.key] as number | null;
              const priorVal  = prior ? prior[row.key] as number | null : null;
              const avg4val   = avg4(weeks, row.key);
              const sc        = statusColor(current, row.goodThreshold, row.warnThreshold, row.higherIsBetter);

              return (
                <tr key={row.label} className="hover:bg-gray-50">
                  <td className="table-td font-medium text-gray-800">{row.label}</td>
                  <td className="table-td text-right tabular-nums font-semibold text-gray-900">
                    {row.format(current)}
                  </td>
                  <td className="table-td text-right tabular-nums text-gray-500">
                    {priorVal !== null ? row.format(priorVal) : "—"}
                  </td>
                  <td className="table-td text-right tabular-nums text-gray-500">
                    {avg4val !== null ? row.format(avg4val) : "—"}
                  </td>
                  <td className="table-td text-center">
                    <TrendArrow current={current} prior={priorVal} />
                  </td>
                  <td className="table-td text-center">
                    <StatusDot color={sc} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section export ───────────────────────────────────────────────────────────

export default function RatioTrends({ weeks }: { weeks: WeekMetric[] }) {
  if (weeks.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400 italic">
        No ratio data yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <LiquidityChart  weeks={weeks} />
        <CoverageChart   weeks={weeks} />
        <ARtoAPChart     weeks={weeks} />
      </div>
      <RatioTable weeks={weeks} />
    </div>
  );
}
