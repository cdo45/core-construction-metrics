"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import type { ProjectionsData, ProjectedWeek } from "@/app/api/projections/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtMoneyShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(v);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

function fmtPct(v: number): string {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

// ─── Colours ─────────────────────────────────────────────────────────────────

const COLORS = {
  ideal:    "#548235",
  realistic:"#4472C4",
  survival: "#C00000",
  navy:     "#1B2A4A",
};

// ─── 1. Combined Area Chart ───────────────────────────────────────────────────

function ProjectionChart({ data }: { data: ProjectionsData }) {
  const { historical_weeks, scenarios } = data;

  // Build unified data array: last historical weeks + 4 projected
  // Historical weeks all share the same cash value across scenarios (actual)
  // The last historical point is included in all scenario series to create a
  // visual connection into the projections.
  const histLen = historical_weeks.length;

  const historicalPoints = historical_weeks.map((w, i) => ({
    week_ending: w.week_ending,
    type:        "historical" as const,
    actual:      w.cash,
    // Only carry scenario values on the very last historical point so
    // the areas visually "branch" from there
    ideal:       i === histLen - 1 ? w.cash : undefined,
    realistic:   i === histLen - 1 ? w.cash : undefined,
    survival:    i === histLen - 1 ? w.cash : undefined,
  }));

  const projectedPoints = scenarios.ideal.weeks.map((_, i) => ({
    week_ending: scenarios.ideal.weeks[i].week_ending,
    type:        "projected" as const,
    actual:      undefined,
    ideal:       scenarios.ideal.weeks[i].cash,
    realistic:   scenarios.realistic.weeks[i].cash,
    survival:    scenarios.survival.weeks[i].cash,
  }));

  const chartData = [...historicalPoints, ...projectedPoints];

  // Mark where projections begin (index of first projected point)
  const projStartWeek = historical_weeks[histLen - 1]?.week_ending ?? "";

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">
          Projected Cash Position — 3 Scenarios
        </h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5 bg-gray-400" />
            Historical
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 border-t-2 border-dashed border-gray-400" />
            Projected
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="gIdeal"    x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={COLORS.ideal}    stopOpacity={0.2} />
              <stop offset="95%" stopColor={COLORS.ideal}    stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gRealistic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={COLORS.realistic} stopOpacity={0.15} />
              <stop offset="95%" stopColor={COLORS.realistic} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gSurvival" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={COLORS.survival} stopOpacity={0.15} />
              <stop offset="95%" stopColor={COLORS.survival} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="week_ending"
            tickFormatter={fmtDateShort}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v) => fmtMoneyShort(v)}
            tick={{ fontSize: 11 }}
            width={64}
          />
          <Tooltip
            labelFormatter={(v) => `Week: ${fmtDate(String(v))}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) =>
              [v !== null && v !== undefined ? fmtMoney(v as number) : "—", String(name ?? "")] as [string, string]
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />

          {/* Reference line at projection start */}
          {projStartWeek && (
            <ReferenceLine
              x={projStartWeek}
              stroke="#D1D5DB"
              strokeDasharray="4 2"
              label={{ value: "Now", position: "insideTopLeft", fontSize: 10, fill: "#9CA3AF" }}
            />
          )}
          <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 2" />

          {/* Historical actual cash — solid line */}
          <Line
            dataKey="actual"
            name="Actual"
            stroke="#374151"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            legendType="plainline"
          />

          {/* Scenario areas + lines — dashed, branch from last historical */}
          <Area
            dataKey="ideal"
            name="Ideal"
            stroke={COLORS.ideal}
            fill="url(#gIdeal)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls={false}
            legendType="plainline"
          />
          <Area
            dataKey="realistic"
            name="Realistic"
            stroke={COLORS.realistic}
            fill="url(#gRealistic)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls={false}
            legendType="plainline"
          />
          <Area
            dataKey="survival"
            name="Survival"
            stroke={COLORS.survival}
            fill="url(#gSurvival)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls={false}
            legendType="plainline"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── 2. Scenario Comparison Table ────────────────────────────────────────────

function dirArrow(change: number): { icon: string; cls: string } {
  if (change > 0) return { icon: "↑", cls: "text-green-600" };
  if (change < 0) return { icon: "↓", cls: "text-red-600" };
  return { icon: "→", cls: "text-gray-400" };
}

function CashCell({
  value,
  change,
  colorWhenNeg = "text-red-700",
}: {
  value: number;
  change?: number;
  colorWhenNeg?: string;
}) {
  const isNeg = value < 0;
  const { icon, cls } = change !== undefined ? dirArrow(change) : { icon: "", cls: "" };
  return (
    <div className={`tabular-nums ${isNeg ? `font-bold ${colorWhenNeg}` : "text-gray-900"}`}>
      {fmtMoneyShort(value)}
      {change !== undefined && (
        <span className={`ml-1 text-xs ${cls}`}>{icon}</span>
      )}
    </div>
  );
}

function ScenarioTable({ data }: { data: ProjectionsData }) {
  const { scenarios } = data;

  const rows = scenarios.ideal.weeks.map((_, i) => ({
    label:          `Week +${i + 1}`,
    date:           scenarios.ideal.weeks[i].week_ending,
    ideal_cash:     scenarios.ideal.weeks[i].cash,
    ideal_net:      scenarios.ideal.weeks[i].net_position,
    ideal_cc:       scenarios.ideal.weeks[i].cash_change,
    realistic_cash: scenarios.realistic.weeks[i].cash,
    realistic_net:  scenarios.realistic.weeks[i].net_position,
    realistic_cc:   scenarios.realistic.weeks[i].cash_change,
    survival_cash:  scenarios.survival.weeks[i].cash,
    survival_net:   scenarios.survival.weeks[i].net_position,
    survival_cc:    scenarios.survival.weeks[i].cash_change,
    notes: [
      ...scenarios.ideal.weeks[i].notes.map((n) => `Ideal: ${n}`),
      ...scenarios.survival.weeks[i].notes
        .filter((n) => n.startsWith("⚠"))
        .map((n) => n),
    ],
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">Scenario Comparison</h3>
        <p className="text-xs text-gray-400 mt-0.5">Cash / Net Position per week</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="table-th w-20">Week</th>
              <th className="table-th w-24">Date</th>
              <th className="table-th text-right" style={{ color: COLORS.ideal }}>Ideal Cash</th>
              <th className="table-th text-right" style={{ color: COLORS.ideal }}>Ideal Net</th>
              <th className="table-th text-right" style={{ color: COLORS.realistic }}>Realistic Cash</th>
              <th className="table-th text-right" style={{ color: COLORS.realistic }}>Realistic Net</th>
              <th className="table-th text-right" style={{ color: COLORS.survival }}>Survival Cash</th>
              <th className="table-th text-right" style={{ color: COLORS.survival }}>Survival Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <>
                <tr key={row.label} className="hover:bg-gray-50">
                  <td className="table-td font-semibold text-gray-700">{row.label}</td>
                  <td className="table-td text-gray-500 text-xs">{fmtDate(row.date)}</td>
                  <td className="table-td text-right"><CashCell value={row.ideal_cash}     change={row.ideal_cc}    /></td>
                  <td className="table-td text-right"><CashCell value={row.ideal_net}                               /></td>
                  <td className="table-td text-right"><CashCell value={row.realistic_cash} change={row.realistic_cc} /></td>
                  <td className="table-td text-right"><CashCell value={row.realistic_net}                           /></td>
                  <td className="table-td text-right"><CashCell value={row.survival_cash}  change={row.survival_cc}  /></td>
                  <td className="table-td text-right"><CashCell value={row.survival_net}                            /></td>
                </tr>
                {row.notes.length > 0 && (
                  <tr key={`${row.label}-notes`} className="bg-amber-50/60">
                    <td />
                    <td colSpan={7} className="px-4 py-1">
                      {row.notes.map((note, ni) => (
                        <span key={ni} className="text-xs text-amber-800 mr-4">{note}</span>
                      ))}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 3. Scenario Cards (Week +4 breakdown) ────────────────────────────────────

function DeltaRow({
  label,
  current,
  projected,
  inverseGood = false,
}: {
  label: string;
  current: number;
  projected: number;
  inverseGood?: boolean;
}) {
  const delta = projected - current;
  const isPos = delta >= 0;
  const isGood = inverseGood ? !isPos : isPos;
  const deltaColor = delta === 0 ? "text-gray-400" : isGood ? "text-green-700" : "text-red-600";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-600">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-semibold tabular-nums ${projected < 0 ? "text-red-700 font-bold" : "text-gray-900"}`}>
          {fmtMoneyShort(projected)}
        </span>
        {delta !== 0 && (
          <span className={`ml-2 text-xs ${deltaColor}`}>
            {delta > 0 ? "↑" : "↓"} {fmtMoneyShort(Math.abs(delta))}
          </span>
        )}
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  latest,
  color,
  overheadBurn,
}: {
  scenario: { label: string; weeks: ProjectedWeek[] };
  latest: { cash: number; ar: number; ap: number; payroll: number; net_position: number };
  color: string;
  overheadBurn: number;
}) {
  const w4 = scenario.weeks[3];
  if (!w4) return null;

  const allNotes = scenario.weeks.flatMap((w, i) =>
    w.notes.map((note) => `W+${i + 1}: ${note}`)
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div
        className="px-4 py-3 text-white text-sm font-semibold"
        style={{ backgroundColor: color }}
      >
        {scenario.label}
        <div className="text-xs font-normal opacity-80 mt-0.5">
          Week +4 ({fmtDate(w4.week_ending)})
        </div>
      </div>
      <div className="px-4 py-3">
        <DeltaRow label="Cash"         current={latest.cash}         projected={w4.cash}     />
        <DeltaRow label="Accounts Rec." current={latest.ar}           projected={w4.ar}        />
        <DeltaRow label="Accounts Pay." current={latest.ap}           projected={w4.ap}        inverseGood />
        <DeltaRow label="Payroll Liab." current={latest.payroll}      projected={w4.payroll}   inverseGood />
        {overheadBurn > 0 && (
          <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
            <span className="text-xs text-gray-600">Weekly Overhead Drain</span>
            <span className="text-sm font-semibold tabular-nums text-red-600">
              -{fmtMoneyShort(overheadBurn)}
            </span>
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-gray-200">
          <DeltaRow label="Net Position" current={latest.net_position} projected={w4.net_position} />
        </div>
      </div>
      {allNotes.length > 0 && (
        <div className="px-4 pb-3">
          {allNotes.map((note, i) => (
            <p key={i} className="text-xs text-amber-700 mt-0.5">{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioCards({ data }: { data: ProjectionsData }) {
  const latest = {
    cash:         data.historical_weeks[data.historical_weeks.length - 1]?.cash ?? 0,
    ar:           data.historical_weeks[data.historical_weeks.length - 1]?.ar ?? 0,
    ap:           data.historical_weeks[data.historical_weeks.length - 1]?.ap ?? 0,
    payroll:      data.historical_weeks[data.historical_weeks.length - 1]?.payroll ?? 0,
    net_position: data.historical_weeks[data.historical_weeks.length - 1]?.net_position ?? 0,
  };

  const overheadBurn = data.baseline_rates.avg_overhead_cash_burn;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <ScenarioCard scenario={data.scenarios.ideal}    latest={latest} color={COLORS.ideal}    overheadBurn={overheadBurn} />
      <ScenarioCard scenario={data.scenarios.realistic} latest={latest} color={COLORS.realistic} overheadBurn={overheadBurn} />
      <ScenarioCard scenario={data.scenarios.survival}  latest={latest} color={COLORS.survival}  overheadBurn={overheadBurn} />
    </div>
  );
}

// ─── 4. Baseline Rates Panel ──────────────────────────────────────────────────

function RateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-600">{label}</span>
      <span className="text-xs font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function BaselineRatesPanel({ data }: { data: ProjectionsData }) {
  const [open, setOpen] = useState(false);
  const r = data.baseline_rates;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <span className="text-sm font-semibold text-gray-800">Projection Assumptions</span>
          <span className="text-xs text-gray-400 ml-2">
            computed from {r.historical_weeks_count} weeks of data
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3">
              AR / Collections
            </p>
            <RateRow label="Avg Weekly Collection Rate" value={`${(r.avg_collection_rate * 100).toFixed(1)}% of AR`} />
            <RateRow label="Avg Weekly AR Billing"      value={fmtMoney(r.avg_weekly_ar_billing)} />
            <RateRow label="Avg Weekly AR Collection"   value={fmtMoney(r.avg_weekly_ar_collection)} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3">
              AP / Payables
            </p>
            <RateRow label="Avg Weekly New Invoices" value={fmtMoney(r.avg_weekly_ap_new_invoices)} />
            <RateRow label="Avg Weekly AP Payments"  value={fmtMoney(r.avg_weekly_ap_payments)} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3">
              Payroll
            </p>
            <RateRow label="Avg Weekly Accrual"      value={fmtMoney(r.avg_weekly_payroll_accrual)} />
            <RateRow label="Avg Remittance Amount"   value={fmtMoney(r.avg_weekly_payroll_remittance)} />
            <RateRow label="Remittance Cycle"        value={`Every ${r.payroll_remittance_frequency} weeks`} />
            <RateRow label="Weeks Since Last Remit"  value={String(r.weeks_since_last_payroll_remittance)} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3">
              Fixed Obligations
            </p>
            {r.insurance_payment_amount > 0 ? (
              <>
                <RateRow label="Insurance Payment"    value={fmtMoney(r.insurance_payment_amount)} />
                <RateRow label="Insurance Frequency"  value={`Every ${r.insurance_payment_frequency} weeks`} />
              </>
            ) : (
              <p className="text-xs text-gray-400 italic">No insurance accounts detected</p>
            )}
            {r.weeks_since_last_union_remittance > 0 && (
              <RateRow label="Weeks Since Last Union Remit" value={String(r.weeks_since_last_union_remittance)} />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3">
              Overhead
            </p>
            {r.avg_overhead_cash_burn > 0 || r.avg_overhead_non_cash > 0 ? (
              <>
                <RateRow label="Avg Weekly Cash Overhead"  value={fmtMoney(r.avg_overhead_cash_burn)} />
                <RateRow label="Non-Cash (Depreciation)"   value={fmtMoney(r.avg_overhead_non_cash)} />
              </>
            ) : (
              <p className="text-xs text-gray-400 italic">No overhead data available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 5. Action Items Card ─────────────────────────────────────────────────────

function ActionItemsCard({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: COLORS.navy }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 bg-white/15 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold text-blue-300 uppercase tracking-widest">Action Items</p>
          <p className="text-sm font-bold text-white">Recommendations based on projection analysis</p>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-blue-100 leading-relaxed">
            <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function Projections({ data }: { data: ProjectionsData }) {
  const projStart = data.scenarios.ideal.weeks[0]?.week_ending;
  const projEnd   = data.scenarios.ideal.weeks[3]?.week_ending;

  return (
    <div className="flex flex-col gap-5">
      {/* Section subtitle */}
      {projStart && projEnd && (
        <p className="text-sm text-gray-500 -mt-2">
          Projection period: {fmtDate(projStart)} – {fmtDate(projEnd)}
          {" · "}Based on {data.baseline_rates.historical_weeks_count} weeks of historical data
        </p>
      )}

      {/* Chart */}
      <ProjectionChart data={data} />

      {/* Comparison table */}
      <ScenarioTable data={data} />

      {/* Week +4 breakdown cards */}
      <ScenarioCards data={data} />

      {/* Baseline rates (collapsible) */}
      <BaselineRatesPanel data={data} />

      {/* Action items */}
      <ActionItemsCard items={data.action_items} />
    </div>
  );
}
