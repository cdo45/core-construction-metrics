"use client";

import type { WeekMetric, RunwaySummary } from "@/app/api/metrics/route";
import { lastActiveWeeks } from "@/lib/active-weeks";
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChartRow {
  week: string;
  collections: number;
  ap_neg: number;
  payroll_neg: number;
  overhead_neg: number;
  cash: number;
  _ap: number;
  _payroll: number;
  _overhead: number;
  _burn: number;
  _net: number;
}

function CashFlowTooltip({
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
  const netColor = p._net >= 0 ? "text-green-700" : "text-red-700";
  return (
    <div className="bg-white border border-gray-200 rounded px-3 py-2 shadow-sm text-xs space-y-0.5">
      <div className="text-gray-500 font-medium">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-green-700">Collections:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.collections)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-700">AP paid:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._ap)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-600">Payroll paid:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._payroll)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-red-500">Overhead paid:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._overhead)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
        <span className="text-gray-600">Total burn:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p._burn)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-700">Net:</span>
        <span className={`font-semibold tabular-nums ${netColor}`}>{fmtMoneyFull(p._net)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
        <span className="text-blue-700">Cash end:</span>
        <span className="font-semibold tabular-nums">{fmtMoneyFull(p.cash)}</span>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function CashFlowTrendChart({
  weeks,
  runway,
}: {
  weeks: WeekMetric[];
  runway: RunwaySummary | null;
}) {
  // Last 8 weeks with activity — matches the 8-wk window used for averages.
  const last8 = lastActiveWeeks(weeks, 8);

  const data: ChartRow[] = last8.map((w) => {
    const burn = w.weekly_ap_paid + w.weekly_payroll_paid + w.weekly_overhead_paid;
    const net = w.weekly_cash_collected - burn;
    return {
      week: shortDate(w.week_ending),
      collections: w.weekly_cash_collected,
      ap_neg: -w.weekly_ap_paid,
      payroll_neg: -w.weekly_payroll_paid,
      overhead_neg: -w.weekly_overhead_paid,
      cash: w.cat_1_cash,
      _ap: w.weekly_ap_paid,
      _payroll: w.weekly_payroll_paid,
      _overhead: w.weekly_overhead_paid,
      _burn: burn,
      _net: net,
    };
  });

  // Break-even reference line: horizontal dashed at the coast value on the
  // collections axis (positive side). Shown in dollars because that's what
  // "collections needed to stay flat" means.
  const coast = runway?.coast_weekly ?? 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Cash Flow Trend — Last 8 Weeks</h3>
        <p className="text-xs text-gray-500">
          Green = collections. Red stack = burn. Blue line = cash end balance. Dashed = break-even ({fmtMoneyShort(coast)}/wk).
        </p>
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
                yAxisId="flow"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => fmtMoneyShort(v)}
                width={70}
              />
              <YAxis
                yAxisId="cash"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => fmtMoneyShort(v)}
                width={70}
              />
              <Tooltip content={<CashFlowTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="flow" y={0} stroke="#9ca3af" />
              {coast > 0 && (
                <ReferenceLine
                  yAxisId="flow"
                  y={coast}
                  stroke="#6B7280"
                  strokeDasharray="4 4"
                  label={{ value: "Break-even", fontSize: 10, fill: "#6B7280", position: "insideTopRight" }}
                />
              )}
              <Bar yAxisId="flow" dataKey="collections" name="Collections" fill="#2F9E44" />
              <Bar yAxisId="flow" dataKey="ap_neg"      name="AP paid"       stackId="burn" fill="#8B0000" />
              <Bar yAxisId="flow" dataKey="payroll_neg" name="Payroll paid"  stackId="burn" fill="#C00000" />
              <Bar yAxisId="flow" dataKey="overhead_neg" name="Overhead paid" stackId="burn" fill="#E57373" />
              <Line
                yAxisId="cash"
                type="monotone"
                dataKey="cash"
                name="Cash end"
                stroke="#1F6FEB"
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
