"use client";

import type { WeekMetric } from "@/app/api/metrics/route";
import { lastActiveWeeks } from "@/lib/active-weeks";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Cell,
} from "recharts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Card wrapper ────────────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <div style={{ width: "100%", height: 300 }}>{children}</div>
    </div>
  );
}

// ─── Tooltip content ─────────────────────────────────────────────────────────

type TooltipPayloadItem = { value?: number | string | null };
function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0].value);
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-1.5 shadow-sm text-xs">
      <div className="text-gray-500">{label}</div>
      <div className="font-semibold text-gray-900 tabular-nums">{fmtMoneyFull(v)}</div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TrendCharts({ weeks }: { weeks: WeekMetric[] }) {
  // Last 12 weeks WITH ACTIVITY. Empty trailing weeks would create misleading
  // flat lines at the end of every chart.
  const last12 = lastActiveWeeks(weeks, 12);
  const data = last12.map((w) => ({
    week: shortDate(w.week_ending),
    cash: w.cat_1_cash,
    net_liquidity: w.net_liquidity,
    revenue: w.cat_8_revenue,
    cash_change: w.cash_change ?? 0,
  }));

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400 italic">
        No data to chart yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <ChartCard title="Cash on Hand" subtitle="Last 12 weeks · end-of-week balance">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtMoneyShort(v)}
              width={70}
            />
            <Tooltip content={<MoneyTooltip />} />
            <Line type="monotone" dataKey="cash" stroke="#4472C4" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Net Liquidity" subtitle="Cash − current debt − payroll liabilities">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtMoneyShort(v)}
              width={70}
            />
            <Tooltip content={<MoneyTooltip />} />
            <ReferenceLine y={0} stroke="#C00000" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="net_liquidity" stroke="#2E8B8B" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Revenue Weekly" subtitle="Signed activity (credits − debits) per week">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtMoneyShort(v)}
              width={70}
            />
            <Tooltip content={<MoneyTooltip />} />
            <Bar dataKey="revenue" fill="#117864" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Weekly Cash Movement" subtitle="WoW cash change · green = inflow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtMoneyShort(v)}
              width={70}
            />
            <Tooltip content={<MoneyTooltip />} />
            <ReferenceLine y={0} stroke="#999" />
            <Bar dataKey="cash_change">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.cash_change >= 0 ? "#548235" : "#C00000"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
