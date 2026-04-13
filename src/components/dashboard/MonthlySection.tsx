"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { MonthMetric } from "@/app/api/metrics/route";
import { fmtMoney, fmtPct } from "./KPICards";

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  cash:    "#548235",
  ar:      "#4472C4",
  ap:      "#C00000",
  payroll: "#ED7D31",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortMoney(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtMonthLabel(ym: string) {
  // "2026-01" → "Jan '26"
  const [y, m] = ym.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

// ─── Chart 8: Monthly Grouped Bar Chart ──────────────────────────────────────

function MonthlyBarChart({ months }: { months: MonthMetric[] }) {
  const data = months.map((m) => ({
    month:       fmtMonthLabel(m.month),
    "Avg Cash":  m.avg_cash,
    "Avg AR":    m.avg_ar,
    "Avg AP":    m.avg_ap,
    "Avg Payroll": m.avg_payroll,
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">Monthly Averages</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => shortMoney(v)} tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [fmtMoney(v as number), String(name ?? "")] as [string, string]}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Avg Cash"    fill={C.cash}    maxBarSize={28} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Avg AR"      fill={C.ar}      maxBarSize={28} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Avg AP"      fill={C.ap}      maxBarSize={28} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Avg Payroll" fill={C.payroll} maxBarSize={28} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Monthly Summary Table ────────────────────────────────────────────────────

function MonthlyTable({ months }: { months: MonthMetric[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">Monthly Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="table-th">Month</th>
              <th className="table-th text-right">Avg Cash</th>
              <th className="table-th text-right">Avg AR</th>
              <th className="table-th text-right">Avg AP</th>
              <th className="table-th text-right">Avg Payroll</th>
              <th className="table-th text-right">Avg Net Position</th>
              <th className="table-th text-right">Bids Won</th>
              <th className="table-th text-right">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {months.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                  No monthly data yet.
                </td>
              </tr>
            ) : (
              months.map((m) => (
                <tr key={m.month} className="hover:bg-gray-50">
                  <td className="table-td font-medium text-gray-900">
                    {fmtMonthLabel(m.month)}
                  </td>
                  <td className="table-td text-right text-green-700 font-medium">
                    {fmtMoney(m.avg_cash)}
                  </td>
                  <td className="table-td text-right" style={{ color: C.ar }}>
                    {fmtMoney(m.avg_ar)}
                  </td>
                  <td className="table-td text-right text-red-600">
                    {fmtMoney(m.avg_ap)}
                  </td>
                  <td className="table-td text-right" style={{ color: C.payroll }}>
                    {fmtMoney(m.avg_payroll)}
                  </td>
                  <td
                    className="table-td text-right font-semibold"
                    style={{ color: m.avg_net_position >= 0 ? "#2E8B8B" : C.ap }}
                  >
                    {fmtMoney(m.avg_net_position)}
                  </td>
                  <td className="table-td text-right text-gray-700">
                    {fmtMoney(m.total_bids_won_value)}
                  </td>
                  <td className="table-td text-right">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                        m.win_rate_pct >= 50
                          ? "bg-green-50 text-green-700"
                          : m.win_rate_pct > 0
                          ? "bg-amber-50 text-amber-700"
                          : "bg-gray-50 text-gray-400"
                      }`}
                    >
                      {m.win_rate_pct > 0
                        ? `${m.win_rate_pct.toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Monthly Analysis Section ─────────────────────────────────────────────────

export default function MonthlySection({ months }: { months: MonthMetric[] }) {
  if (months.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400 italic">
        No monthly data available yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <MonthlyBarChart months={months} />
      <MonthlyTable    months={months} />
    </div>
  );
}
