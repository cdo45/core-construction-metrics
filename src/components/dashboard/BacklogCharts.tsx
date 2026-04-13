"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import type { WeekMetric } from "@/app/api/metrics/route";
import { fmtMoney, fmtDate } from "./KPICards";

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  submitted: "#93C5FD",   // light blue
  won:       "#1B2A4A",   // dark navy
  winRate:   "#4472C4",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const xTickFmt = (iso: string) => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
};

function shortMoney(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Chart 6: Bid Activity (submitted vs won + cumulative backlog line) ───────

export function BidActivityChart({ weeks }: { weeks: WeekMetric[] }) {
  // Build cumulative backlog
  let cumBacklog = 0;
  const data = weeks.map((w) => {
    cumBacklog += w.bids_won_value;
    return {
      week_ending: w.week_ending,
      submitted:   w.bids_submitted_value,
      won:         w.bids_won_value,
      backlog:     cumBacklog,
    };
  });

  return (
    <ChartCard title="Bid Activity — Submitted vs Won">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="bars"
            tickFormatter={(v) => shortMoney(v)}
            tick={{ fontSize: 11 }}
            width={56}
          />
          <YAxis
            yAxisId="line"
            orientation="right"
            tickFormatter={(v) => shortMoney(v)}
            tick={{ fontSize: 11 }}
            width={60}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [fmtMoney(v as number), String(name ?? "")]}
            labelFormatter={(v) => `Week: ${fmtDate(String(v))}`}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="bars"
            dataKey="submitted"
            name="Submitted"
            fill={C.submitted}
            maxBarSize={30}
            radius={[2, 2, 0, 0]}
          />
          <Bar
            yAxisId="bars"
            dataKey="won"
            name="Won"
            fill={C.won}
            maxBarSize={30}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="line"
            type="monotone"
            dataKey="backlog"
            name="Cumulative Backlog"
            stroke="#ED7D31"
            strokeWidth={2}
            dot={false}
            strokeDasharray="5 3"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 7: Win Rate Trend ──────────────────────────────────────────────────

export function WinRateChart({ weeks }: { weeks: WeekMetric[] }) {
  const data = weeks.map((w) => ({
    week_ending: w.week_ending,
    win_rate:
      w.bids_submitted_value > 0
        ? (w.bids_won_value / w.bids_submitted_value) * 100
        : null,
    count_rate:
      w.bids_submitted_count > 0
        ? (w.bids_won_count / w.bids_submitted_count) * 100
        : null,
  }));

  return (
    <ChartCard title="Win Rate Trend (by Dollar Value)">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            tick={{ fontSize: 11 }}
            width={44}
            domain={[0, 100]}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) =>
              v !== null ? [`${(v as number).toFixed(1)}%`, String(name ?? "")] : ["N/A", String(name ?? "")]
            }
            labelFormatter={(v) => `Week: ${fmtDate(String(v))}`}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={50} stroke="#ccc" strokeDasharray="4 2" label={{ value: "50%", position: "right", fontSize: 10, fill: "#999" }} />
          <Line
            type="monotone"
            dataKey="win_rate"
            name="Win Rate (value)"
            stroke={C.winRate}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="count_rate"
            name="Win Rate (count)"
            stroke="#9CA3AF"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Backlog & Pipeline Section ───────────────────────────────────────────────

export default function BacklogCharts({ weeks }: { weeks: WeekMetric[] }) {
  const hasBids = weeks.some(
    (w) => w.bids_submitted_count > 0 || w.bids_submitted_value > 0
  );

  if (!hasBids) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400 italic">
        No bid activity recorded yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <BidActivityChart weeks={weeks} />
      <WinRateChart     weeks={weeks} />
    </div>
  );
}
