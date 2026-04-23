"use client";

import type { WeekMetric } from "@/app/api/metrics/route";
import { isActiveWeek } from "@/lib/active-weeks";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
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

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipRow {
  cash: number;
  debt: number;
  gap: number;
}

function CashDebtTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TooltipRow }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 shadow-sm text-xs space-y-0.5">
      <div className="text-gray-500 font-medium">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-blue-700">Cash:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.cash)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-700">Debt:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.debt)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
        <span className="text-gray-700">Gap (Cash − Debt):</span>
        <span
          className={`font-semibold tabular-nums ${p.gap >= 0 ? "text-green-700" : "text-red-700"}`}
        >
          {fmtMoneyFull(p.gap)}
        </span>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function CashVsDebtChart({ weeks }: { weeks: WeekMetric[] }) {
  // Only plot weeks with actual activity — the filter window may include
  // configured-but-unimported week rows (cash = 0, debt = 0) which would
  // drag the lines to zero at the tail.
  const active = weeks.filter(isActiveWeek);

  const data = active.map((w) => {
    const gap = w.cat_1_cash - w.cat_3_current_debt;
    // `gap` series is used to render a translucent area between the two
    // lines (simple "net position" band). Positive gap = cash above debt.
    return {
      week_ending: w.week_ending,
      week: shortDate(w.week_ending),
      cash: w.cat_1_cash,
      debt: w.cat_3_current_debt,
      gap,
    };
  });

  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Cash on Hand vs Current Debt</h3>
          <p className="text-xs text-gray-500">
            Weekly end-of-week balances for categories 1 and 3.
          </p>
        </div>
        {latest && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Net Position</p>
            <p
              className={`text-base font-bold tabular-nums ${
                latest.gap >= 0 ? "text-green-700" : "text-red-700"
              }`}
            >
              {fmtMoneyShort(latest.gap)}
            </p>
          </div>
        )}
      </div>
      <div style={{ width: "100%", height: 320 }}>
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
              <Tooltip content={<CashDebtTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {/* Translucent area behind the lines showing the gap size.
                  Rendered FIRST so lines draw on top. */}
              <Area
                type="monotone"
                dataKey="gap"
                stroke="none"
                fill="#2E8B8B"
                fillOpacity={0.08}
                name="Gap"
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="cash"
                name="Cash"
                stroke="#4472C4"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="debt"
                name="Current Debt"
                stroke="#C00000"
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
