"use client";

import type { WeekMetric } from "@/app/api/metrics/route";
import { isActiveWeek } from "@/lib/active-weeks";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

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

interface ChartRow {
  week: string;
  paydown: number;
  running: number;
}

function PaydownTooltip({
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
        <span className="text-gray-700">This week:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.paydown)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
        <span className="text-gray-500">Running total:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.running)}</span>
      </div>
    </div>
  );
}

export default function DebtPaydownChart({ weeks }: { weeks: WeekMetric[] }) {
  const active = weeks.filter(isActiveWeek);

  let running = 0;
  const data: ChartRow[] = active.map((w) => {
    const paydown = w.cat_3_debt_paydown ?? 0;
    running += paydown;
    return {
      week: shortDate(w.week_ending),
      paydown,
      running,
    };
  });

  const periodTotal = running; // after loop, running = total
  const activeCount = active.length;
  const weeklyAvg = activeCount > 0 ? periodTotal / activeCount : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Weekly Debt Paydown</h3>
          <p className="text-xs text-gray-500">
            Debit posts to Current Debt accounts (cat 3) each week.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">
            Avg / Total
          </p>
          <p className="text-xs font-semibold tabular-nums text-gray-700">
            {fmtMoneyShort(weeklyAvg)}/wk&nbsp;·&nbsp;{fmtMoneyShort(periodTotal)}
          </p>
        </div>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 italic">
            No active weeks in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => fmtMoneyShort(v)}
                width={70}
              />
              <Tooltip content={<PaydownTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Bar dataKey="paydown" name="Paydown">
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.paydown > 0 ? "#2F9E44" : "#D1D5DB"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
