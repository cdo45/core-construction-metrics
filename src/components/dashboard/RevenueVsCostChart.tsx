"use client";

import type { WeekMetric } from "@/app/api/metrics/route";
import { isActiveWeek } from "@/lib/active-weeks";
import {
  ComposedChart,
  Bar,
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

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtMoneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
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

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface ChartRow {
  week: string;
  // Revenue (positive green bar)
  revenue: number;
  // Cost stack: djc → payroll → overhead, plotted as NEGATIVE values so they
  // sit below the zero axis. Recharts stacks them together via stackId.
  djc_neg: number;
  payroll_neg: number;
  overhead_neg: number;
  // Line overlay
  op_income: number;
  // Tooltip-only fields
  _djc: number;
  _payroll: number;
  _overhead: number;
  _op_margin: number | null;
}

function RevCostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 shadow-sm text-xs space-y-0.5">
      <div className="text-gray-500 font-medium">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-green-700">Revenue:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.revenue)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-700">DJC:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._djc)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-600">Payroll (Field):</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._payroll)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-500">Overhead:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._overhead)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
        <span className="text-gray-700">Operating Income:</span>
        <span
          className={`font-semibold tabular-nums ${p.op_income >= 0 ? "text-green-700" : "text-red-700"}`}
        >
          {fmtMoneyFull(p.op_income)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Op Margin:</span>
        <span className="font-semibold tabular-nums">{fmtPct(p._op_margin)}</span>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function RevenueVsCostChart({ weeks }: { weeks: WeekMetric[] }) {
  const active = weeks.filter(isActiveWeek);

  const data: ChartRow[] = active.map((w) => {
    const rev = w.cat_8_revenue;
    const djc = w.cat_9_djc;
    const payroll = w.cat_6_payroll_field;
    const overhead = w.cat_7_overhead;
    const op_income = rev - djc - payroll - overhead;
    const op_margin = rev !== 0 ? (op_income / rev) * 100 : null;
    return {
      week: shortDate(w.week_ending),
      revenue: rev,
      djc_neg: -djc,
      payroll_neg: -payroll,
      overhead_neg: -overhead,
      op_income,
      _djc: djc,
      _payroll: payroll,
      _overhead: overhead,
      _op_margin: op_margin,
    };
  });

  // Average op margin over active weeks, weighted by revenue (so zero-rev
  // weeks don't distort). Falls back to simple mean if revenue is 0.
  let revTotal = 0;
  let opTotal = 0;
  for (const r of data) {
    revTotal += r.revenue;
    opTotal += r.op_income;
  }
  const avgOpMargin = revTotal !== 0 ? (opTotal / revTotal) * 100 : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Revenue vs Total Cost (weekly)</h3>
          <p className="text-xs text-gray-500">
            Green = revenue. Red stack = DJC + field payroll + overhead. Line = operating income.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Op Margin</p>
          <p
            className={`text-base font-bold tabular-nums ${
              avgOpMargin !== null && avgOpMargin < 0 ? "text-red-700" : "text-green-700"
            }`}
          >
            {fmtPct(avgOpMargin)}
            <span className="text-xs font-normal text-gray-400 ml-1">
              over {data.length} wk{data.length === 1 ? "" : "s"}
            </span>
          </p>
        </div>
      </div>
      <div style={{ width: "100%", height: 340 }}>
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 italic">
            No active weeks in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => fmtMoneyShort(v)}
                width={70}
              />
              <Tooltip content={<RevCostTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#9ca3af" />
              <Bar dataKey="revenue" name="Revenue" fill="#2F9E44" />
              <Bar dataKey="djc_neg"      name="DJC"             stackId="cost" fill="#8B0000" />
              <Bar dataKey="payroll_neg"  name="Payroll (Field)" stackId="cost" fill="#C00000" />
              <Bar dataKey="overhead_neg" name="Overhead"        stackId="cost" fill="#E57373" />
              <Line
                type="monotone"
                dataKey="op_income"
                name="Operating Income"
                stroke="#1B2A4A"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
