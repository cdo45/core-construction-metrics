"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from "recharts";
import type { WeekMetric } from "@/app/api/metrics/route";
import { fmtMoney, fmtDate } from "./KPICards";

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  cash:    "#548235",
  ar:      "#4472C4",
  ap:      "#C00000",
  payroll: "#ED7D31",
  net:     "#2E8B8B",
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function shortMoney(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Shared axis / tooltip formatters ────────────────────────────────────────

const xTickFmt = (iso: string) => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
};

const yTickFmt = (v: number) => shortMoney(v);

// Recharts Formatter<ValueType, NameType> allows name to be undefined, so we
// use `any` and coerce to avoid unsatisfiable generic constraints.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moneyTooltipFmt = (value: any, name: any) =>
  [fmtMoney(value as number), String(name ?? "")] as [string, string];

// ─── Chart 1: Category Balances ───────────────────────────────────────────────

export function CategoryBalancesChart({ weeks }: { weeks: WeekMetric[] }) {
  return (
    <ChartCard title="Category Balances">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={weeks} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gCash"    x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.cash}    stopOpacity={0.15} />
              <stop offset="95%" stopColor={C.cash}    stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gAR"      x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.ar}      stopOpacity={0.15} />
              <stop offset="95%" stopColor={C.ar}      stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gAP"      x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.ap}      stopOpacity={0.15} />
              <stop offset="95%" stopColor={C.ap}      stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gPayroll" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.payroll} stopOpacity={0.15} />
              <stop offset="95%" stopColor={C.payroll} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTickFmt} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={moneyTooltipFmt} labelFormatter={(v) => `Week: ${fmtDate(String(v))}`} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="cash"    name="Cash"    stroke={C.cash}    fill="url(#gCash)"    strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="ar"      name="AR"      stroke={C.ar}      fill="url(#gAR)"      strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="ap"      name="AP"      stroke={C.ap}      fill="url(#gAP)"      strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="payroll" name="Payroll" stroke={C.payroll} fill="url(#gPayroll)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 2: Net Liquidity Position ─────────────────────────────────────────

export function NetPositionChart({ weeks }: { weeks: WeekMetric[] }) {
  return (
    <ChartCard title="Net Liquidity Position (Cash − AP − Payroll)">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={weeks} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gNetPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.net} stopOpacity={0.25} />
              <stop offset="95%" stopColor={C.net} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gNetNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.ap}  stopOpacity={0.02} />
              <stop offset="95%" stopColor={C.ap}  stopOpacity={0.25} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTickFmt} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={moneyTooltipFmt} labelFormatter={(v) => `Week: ${fmtDate(String(v))}`} />
          <ReferenceLine y={0} stroke="#666" strokeDasharray="4 2" />
          <Area
            type="monotone"
            dataKey="net_position"
            name="Net Position"
            stroke={C.net}
            fill="url(#gNetPos)"
            strokeWidth={2.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 3: Cash Flow Movement ─────────────────────────────────────────────

export function CashFlowChart({ weeks }: { weeks: WeekMetric[] }) {
  // Compute cumulative cash for the line overlay
  const data = weeks.map((w) => ({
    ...w,
    cash_change_val: w.cash_change ?? 0,
  }));

  return (
    <ChartCard title="Cash Flow Movement (Week-over-Week)">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTickFmt} tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [fmtMoney(v as number), String(name ?? "")] as [string, string]}
            labelFormatter={(v) => `Week: ${fmtDate(String(v))}`}
          />
          <ReferenceLine y={0} stroke="#999" />
          <Bar dataKey="cash_change_val" name="Cash Change" maxBarSize={40} radius={[2, 2, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.cash_change_val >= 0 ? C.cash : C.ap}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="cash"
            name="Cash Balance"
            stroke={C.cash}
            strokeWidth={2}
            dot={false}
            yAxisId={0}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 4: AR vs AP Movement ───────────────────────────────────────────────

export function ARvsAPChart({ weeks }: { weeks: WeekMetric[] }) {
  const data = weeks.map((w) => ({
    week_ending: w.week_ending,
    ar_collected: w.ar_collected !== null ? Math.max(0, w.ar_collected) : 0,
    ap_paid:      w.ap_paid      !== null ? Math.max(0, w.ap_paid)      : 0,
  }));

  return (
    <ChartCard title="AR Collected vs AP Paid Down (WoW)">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTickFmt} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={moneyTooltipFmt} labelFormatter={(v) => `Week: ${fmtDate(String(v))}`} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="ar_collected" name="AR Collected" fill={C.ar}  fillOpacity={0.85} maxBarSize={30} radius={[2, 2, 0, 0]} />
          <Bar dataKey="ap_paid"      name="AP Paid Down" fill={C.net} fillOpacity={0.85} maxBarSize={30} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Chart 5: Payroll Liability Trend ────────────────────────────────────────

export function PayrollTrendChart({ weeks }: { weeks: WeekMetric[] }) {
  // Detect consecutive growth streaks (3+ weeks up without decrease)
  const data = weeks.map((w, i) => {
    let streak = 0;
    if (i > 0) {
      for (let j = i; j > 0; j--) {
        if (weeks[j].payroll > weeks[j - 1].payroll) streak++;
        else break;
      }
    }
    return { ...w, warning: streak >= 2 }; // flag when 3rd+ consecutive week up
  });

  return (
    <ChartCard title="Payroll Liability Trend">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gPayrollTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C.payroll} stopOpacity={0.3} />
              <stop offset="95%" stopColor={C.payroll} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week_ending" tickFormatter={xTickFmt} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTickFmt} tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [fmtMoney(v as number), String(name ?? "")] as [string, string]}
            labelFormatter={(v) => `Week: ${fmtDate(String(v))}`}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                  <p className="font-semibold text-gray-700 mb-1">{`Week: ${fmtDate(String(label))}`}</p>
                  <p style={{ color: C.payroll }}>{`Payroll: ${fmtMoney(d.payroll)}`}</p>
                  {d.warning && (
                    <p className="text-red-600 font-semibold mt-1">⚠ 3+ week growth streak</p>
                  )}
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="payroll"
            name="Payroll"
            stroke={C.payroll}
            fill="url(#gPayrollTrend)"
            strokeWidth={2.5}
            dot={(props) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: (typeof data)[0] };
              if (!payload.warning) return <g key={`dot-${cx}-${cy}`} />;
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill="#fff"
                  stroke={C.ap}
                  strokeWidth={2}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 mt-2">
        Red dots indicate 3+ consecutive weeks of payroll growth (warning signal).
      </p>
    </ChartCard>
  );
}

// ─── Weekly Trends Section ────────────────────────────────────────────────────

export default function WeeklyCharts({ weeks }: { weeks: WeekMetric[] }) {
  if (weeks.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-sm text-gray-400 italic">
        No weekly data yet. Enter at least one week to see trends.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <CategoryBalancesChart weeks={weeks} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <NetPositionChart weeks={weeks} />
        <CashFlowChart   weeks={weeks} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ARvsAPChart     weeks={weeks} />
        <PayrollTrendChart weeks={weeks} />
      </div>
    </div>
  );
}
