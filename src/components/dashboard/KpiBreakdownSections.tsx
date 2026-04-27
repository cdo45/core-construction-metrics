"use client";

import type { KpiBreakdown, KpiInput } from "@/lib/kpi-breakdown";

// Currency formatter that handles negatives with a leading minus rather
// than the parenthesized accounting style — easier to scan in a modal.
function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtRatioValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toFixed(3);
}

// Match the helper's display contract: KpiInput.value is always a money
// number (signed) for our current metric set. If a future metric needs
// non-money inputs we can extend this.
function fmtInputValue(input: KpiInput): string {
  return fmtMoney(input.value);
}

export default function KpiBreakdownSections({ breakdown }: { breakdown: KpiBreakdown }) {
  return (
    <div className="flex flex-col gap-4 px-6 py-4 border-b border-gray-200">
      {/* ── Formula ─────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Formula
        </h4>
        <pre className="bg-zinc-50 border border-zinc-200 rounded px-3 py-2 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words">
          {breakdown.formula}
        </pre>
      </section>

      {/* ── Inputs ──────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Inputs
        </h4>
        {breakdown.inputs.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No input rows.</p>
        ) : (
          <table className="w-full text-xs border border-zinc-200 rounded overflow-hidden">
            <tbody className="divide-y divide-zinc-100">
              {breakdown.inputs.map((row, i) => {
                const zebra = i % 2 === 1 ? "bg-zinc-50" : "bg-white";
                const emphasis = row.emphasis
                  ? "font-semibold text-gray-900 border-t-2 border-zinc-300"
                  : "text-gray-700";
                return (
                  <tr key={`${row.label}-${i}`} className={`${zebra} ${emphasis}`}>
                    <td className="px-3 py-1.5 align-top">
                      <div className="truncate">{row.label}</div>
                      {row.detail && (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {row.detail}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap align-top">
                      {fmtInputValue(row)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Computation ─────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Computation
        </h4>
        <pre className="bg-zinc-50 border border-zinc-200 rounded px-3 py-2 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words">
          {breakdown.computation}
        </pre>
        <p className="text-xs text-gray-500 mt-1.5">
          Result:{" "}
          <span className="font-semibold tabular-nums text-gray-900">
            {breakdown.resultFormat === "ratio"
              ? fmtRatioValue(breakdown.result)
              : fmtMoney(breakdown.result)}
          </span>
        </p>
      </section>
    </div>
  );
}
