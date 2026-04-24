"use client";

import { useEffect } from "react";
import type {
  DrilldownData,
  DrilldownInput,
  DrilldownInputFormat,
  DrilldownBreakdownFormat,
} from "@/app/api/metrics/route";

// ─── Formatters ──────────────────────────────────────────────────────────────
//
// Modal-local formatters. Drilldown values are rendered exactly as the user
// expects to read them in a "show your work" context — full precision on
// money (no $1.2K abbreviation), 3 decimals on ratios so contributions
// don't round to identical-looking numbers, 2 decimals on weeks, 1 on pcts.

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMoneyCents(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtInputValue(input: DrilldownInput): string {
  switch (input.format) {
    case "money": return fmtMoney(input.value);
    case "ratio": return input.value.toFixed(3);
    case "pct":   return `${input.value.toFixed(1)}%`;
    case "weeks": return `${input.value.toFixed(2)} wks`;
    case "int":   return String(Math.round(input.value));
  }
}

function fmtBreakdownValue(value: number, format: DrilldownBreakdownFormat): string {
  if (format === "int") return String(Math.round(value));
  return fmtMoney(value);
}

// Headline result rendering. Picks a format-appropriate string from the
// inputs (when there's a single primary input we mirror its format) but
// falls back to the computation.result string the API supplied.
function fmtResult(d: DrilldownData): string {
  if (d.computation.result) return d.computation.result;
  // Best-effort fallback if API didn't precompute a string
  return fmtMoney(d.result);
}

// Pick a format hint for the headline number so it gets the right
// font / scale treatment. Defaults to money if not derivable from inputs.
function inferFormat(d: DrilldownData): DrilldownInputFormat {
  // The first non-note input's format usually matches the headline.
  const first = d.inputs[0];
  return first?.format ?? "money";
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export default function KpiDrilldownModal({
  isOpen,
  onClose,
  title,
  subtitle,
  drilldown,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  drilldown: DrilldownData | null;
}) {
  // Escape closes; lock body scroll while open so a long modal doesn't fight
  // the page underneath it.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !drilldown) return null;

  const headlineFmt = inferFormat(drilldown);
  const headlineText = fmtResult(drilldown);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center px-4 py-8 bg-black/50"
      onMouseDown={(e) => {
        // Close only when the click started on the overlay itself; otherwise
        // a drag-select inside the modal that releases on the overlay would
        // dismiss the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kpi-drilldown-title"
    >
      <div
        className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-[640px] max-h-[80vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-200">
          <div className="min-w-0">
            <h2 id="kpi-drilldown-title" className="text-base font-semibold text-gray-900 truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 -m-1 p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* RESULT */}
          <section>
            <SectionLabel>Result</SectionLabel>
            <p className="text-3xl font-bold text-gray-900 tabular-nums tracking-tight">
              {headlineText}
            </p>
            {/* When the headline is dimensionless ratio or pct, restate the raw
                input format so the unit context is unambiguous. */}
            {headlineFmt === "ratio" && (
              <p className="text-xs text-gray-400 mt-0.5">unitless ratio</p>
            )}
          </section>

          {/* FORMULA */}
          <section>
            <SectionLabel>Formula</SectionLabel>
            <p className="text-sm text-gray-700 leading-relaxed">
              {drilldown.formula_plain}
            </p>
            {drilldown.formula_latex && (
              <p className="text-xs text-gray-500 font-mono mt-1.5">
                {drilldown.formula_latex}
              </p>
            )}
          </section>

          {/* INPUTS */}
          {drilldown.inputs.length > 0 && (
            <section>
              <SectionLabel>Inputs</SectionLabel>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {drilldown.inputs.map((input, i) => (
                      <tr
                        key={i}
                        className={i > 0 ? "border-t border-gray-100" : ""}
                      >
                        <td className="px-3 py-2 text-gray-700 align-top">
                          <div>{input.label}</div>
                          {input.note && (
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              {input.note}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-medium whitespace-nowrap align-top">
                          {fmtInputValue(input)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* CALCULATION */}
          <section>
            <SectionLabel>Calculation</SectionLabel>
            <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2.5 font-mono text-xs text-gray-800 break-words">
              <div>{drilldown.computation.expression}</div>
              <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                <span className="text-gray-500">= </span>
                <span className="font-semibold text-gray-900">{drilldown.computation.result}</span>
              </div>
            </div>
          </section>

          {/* BREAKDOWN */}
          {drilldown.breakdown && (
            <section>
              <SectionLabel>{drilldown.breakdown.title}</SectionLabel>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Week
                      </th>
                      <th className="px-3 py-1.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown.breakdown.rows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-700 tabular-nums">
                          {row.label}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
                          {fmtBreakdownValue(row.value, row.format)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="px-3 py-1.5 font-semibold text-gray-700">
                        {drilldown.breakdown.aggregate_label}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">
                        {fmtMoney(drilldown.breakdown.aggregate_value)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {drilldown.breakdown.methodology_note && (
                <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                  <span className="font-semibold">Methodology:</span>{" "}
                  {drilldown.breakdown.methodology_note}
                </p>
              )}
            </section>
          )}

          {/* SOURCE ACCOUNTS */}
          {drilldown.account_sources && drilldown.account_sources.length > 0 && (
            <section>
              <SectionLabel>Source Accounts</SectionLabel>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Account
                      </th>
                      <th className="px-3 py-1.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-3 py-1.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                        Contribution
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown.account_sources.map((src, i) => (
                      <tr key={`${src.account_no}-${i}`} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 tabular-nums text-gray-700 whitespace-nowrap">
                          {src.account_no}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 truncate max-w-[260px]">
                          {src.description}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
                          {fmtMoneyCents(src.contribution)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td className="px-3 py-1.5 font-semibold text-gray-700" colSpan={2}>
                        Total
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">
                        {fmtMoneyCents(
                          drilldown.account_sources.reduce(
                            (s, src) => s + src.contribution,
                            0,
                          ),
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Contribution = end-of-week balance summed across all divisions for that account.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
      {children}
    </h3>
  );
}
