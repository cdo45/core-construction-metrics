"use client";

import { useState } from "react";
import type { WeeklyReportData, ReportCategory, ReportRatios } from "@/app/api/weekly-report/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(n);
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function fmtRatio(v: number | null, decimals = 2): string {
  if (v === null || !isFinite(v)) return "N/A";
  return v.toFixed(decimals);
}

// ─── Executive Summary Narrative ─────────────────────────────────────────────

function buildNarrative(data: WeeklyReportData): string {
  const { categories, ratios, prior_ratios, prior_week_ending } = data;

  const catByName = (name: string) =>
    categories.find((c) => c.name === name);

  const cash    = catByName("Cash on Hand");
  const ar      = catByName("Who Owes Us");
  const ap      = catByName("Who We Owe");
  const payroll = catByName("Payroll Liabilities");

  const hasPrior = !!prior_week_ending;

  const parts: string[] = [];

  // Cash summary
  if (cash) {
    const dir = hasPrior && cash.change !== 0
      ? cash.change > 0 ? "increased" : "decreased"
      : null;
    const cashStr = `Cash on Hand closed at ${fmtMoneyShort(cash.current_total)}`;
    const deltaStr = dir
      ? `, ${dir} by ${fmtMoneyShort(Math.abs(cash.change))} (${fmtPct(cash.change_pct)}) from the prior week`
      : "";
    parts.push(`${cashStr}${deltaStr}.`);
  }

  // AR summary
  if (ar) {
    const dir = hasPrior && ar.change !== 0
      ? ar.change > 0 ? "grew" : "declined"
      : null;
    const arStr = `Accounts Receivable stands at ${fmtMoneyShort(ar.current_total)}`;
    const deltaStr = dir
      ? `, ${dir} by ${fmtMoneyShort(Math.abs(ar.change))} week-over-week`
      : "";
    parts.push(`${arStr}${deltaStr}.`);
  }

  // AP + Payroll summary
  if (ap || payroll) {
    const apVal = ap?.current_total ?? 0;
    const payVal = payroll?.current_total ?? 0;
    const totalObligations = apVal + payVal;
    parts.push(
      `Total obligations (AP + Payroll) are ${fmtMoneyShort(totalObligations)}, comprising ${fmtMoneyShort(apVal)} in payables and ${fmtMoneyShort(payVal)} in payroll liabilities.`
    );
  }

  // Net liquidity
  const net = ratios.net_liquidity;
  const netDir = net >= 0 ? "positive" : "negative";
  parts.push(
    `Net liquidity position is ${netDir} at ${fmtMoneyShort(net)}.`
  );

  // Cash coverage
  if (ratios.cash_coverage_weeks !== null) {
    const weeks = ratios.cash_coverage_weeks;
    const strength = weeks >= 12 ? "strong" : weeks >= 6 ? "moderate" : "tight";
    parts.push(
      `Cash coverage is ${strength} at ${weeks.toFixed(1)} weeks of AP runway.`
    );
  }

  // WoW comparison
  if (hasPrior && prior_ratios) {
    const netChange = ratios.net_liquidity - prior_ratios.net_liquidity;
    const netDirStr = netChange >= 0 ? "improved" : "declined";
    parts.push(
      `Compared to the prior week, the net liquidity position ${netDirStr} by ${fmtMoneyShort(Math.abs(netChange))}.`
    );
  }

  return parts.join(" ");
}

// ─── Section: Executive Summary ───────────────────────────────────────────────

function ExecutiveSummary({ data }: { data: WeeklyReportData }) {
  const narrative = buildNarrative(data);

  return (
    <div className="bg-[#1B2A4A] text-white rounded-lg p-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-200 mb-3">
        Executive Summary
      </h2>
      <p className="text-sm leading-relaxed text-blue-50">{narrative}</p>
    </div>
  );
}

// ─── Section: Category Movement Table ────────────────────────────────────────

function CategoryMovementTable({ cat, hasPrior }: { cat: ReportCategory; hasPrior: boolean }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Determine which accounts changed
  const changedAccounts = cat.accounts.filter((a) => a.change !== 0);
  const displayAccounts = showAll ? cat.accounts : changedAccounts;
  const hasChanges = changedAccounts.length > 0;

  // For "favorable" coloring: cash up = good; AR up = good; debt/payroll up = bad.
  // Cost categories by id: 3=Current Debt, 4=Long-Term Debt, 5=Payroll Liabilities,
  // 6=Payroll (Field), 7=Overhead, 9=Direct Job Costs.
  const COST_CATEGORY_IDS = new Set([3, 4, 5, 6, 7, 9]);
  const isCostCategory = COST_CATEGORY_IDS.has(cat.id);

  function changeColor(change: number): string {
    if (change === 0) return "text-gray-400";
    const isIncrease = change > 0;
    const isFavorable = isCostCategory ? !isIncrease : isIncrease;
    return isFavorable ? "text-green-600" : "text-red-600";
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: cat.color }}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm text-white">{cat.name}</span>
          {hasPrior && cat.change !== 0 && (
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white bg-opacity-20 ${
                changeColor(cat.change)
              } !text-white`}
            >
              {fmtPct(cat.change_pct)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-white">
            {fmtMoneyShort(cat.current_total)}
          </span>
          <svg
            className={`w-4 h-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="table-th w-24">Account #</th>
                  <th className="table-th">Description</th>
                  <th className="table-th text-right w-32">Beg Balance</th>
                  <th className="table-th text-right w-32">End Balance</th>
                  {hasPrior && <th className="table-th text-right w-44">Change (WoW)</th>}
                </tr>
              </thead>
              <tbody>
                {displayAccounts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={hasPrior ? 5 : 4}
                      className="px-4 py-6 text-center text-sm text-gray-400 italic"
                    >
                      No changes this week.
                    </td>
                  </tr>
                ) : (
                  displayAccounts.map((acct) => (
                    <tr key={acct.gl_account_id} className="hover:bg-gray-50">
                      <td className="table-td font-mono text-xs text-gray-500">
                        {acct.account_no}
                      </td>
                      <td className="table-td text-gray-800">{acct.description}</td>
                      <td className="table-td text-right text-gray-600">
                        {fmtMoney(acct.beg_balance)}
                      </td>
                      <td className="table-td text-right font-medium text-gray-900">
                        {fmtMoney(acct.end_balance)}
                      </td>
                      {hasPrior && (
                        <td className={`table-td text-right font-medium ${changeColor(acct.change)}`}>
                          {acct.change !== 0 ? (
                            <>
                              {fmtMoney(acct.change)}{" "}
                              <span className="text-xs opacity-70">
                                ({fmtPct(acct.change_pct)})
                              </span>
                            </>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}

                {/* Category total row */}
                <tr className="bg-gray-50">
                  <td
                    colSpan={2}
                    className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200"
                  >
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-gray-700 border-t border-gray-200">
                    {fmtMoney(cat.accounts.reduce((s, a) => s + a.beg_balance, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 border-t border-gray-200">
                    {fmtMoney(cat.current_total)}
                  </td>
                  {hasPrior && (
                    <td
                      className={`px-4 py-2.5 text-right text-sm font-semibold border-t border-gray-200 ${changeColor(cat.change)}`}
                    >
                      {cat.change !== 0 ? (
                        <>
                          {fmtMoney(cat.change)}{" "}
                          <span className="text-xs opacity-70">
                            ({fmtPct(cat.change_pct)})
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Toggle show all / changes only */}
          {hasChanges && cat.accounts.length > changedAccounts.length && (
            <div className="px-5 py-2 border-t border-gray-100">
              <button
                onClick={() => setShowAll((s) => !s)}
                className="text-xs text-[#1B2A4A] hover:underline font-medium"
              >
                {showAll
                  ? "Show changes only"
                  : `Show all ${cat.accounts.length} accounts`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Section: Financial Health Ratios ────────────────────────────────────────

interface RatioConfig {
  key: keyof ReportRatios;
  label: string;
  description: string;
  format: (v: number | null) => string;
  thresholds: {
    good: number;
    warn: number;
    /** higher is better when true, lower is better when false */
    higherIsBetter: boolean;
  } | null;
}

const RATIO_CONFIGS: RatioConfig[] = [
  {
    key: "net_liquidity",
    label: "Net Liquidity",
    description: "Cash − AP − Payroll",
    format: (v) => (v !== null ? fmtMoneyShort(v) : "N/A"),
    thresholds: { good: 0, warn: -50_000, higherIsBetter: true },
  },
  {
    key: "current_ratio",
    label: "Current Ratio",
    description: "(Cash + AR) ÷ (AP + Payroll)",
    format: (v) => fmtRatio(v),
    thresholds: { good: 1.5, warn: 1.0, higherIsBetter: true },
  },
  {
    key: "quick_ratio",
    label: "Quick Ratio",
    description: "Cash ÷ (AP + Payroll)",
    format: (v) => fmtRatio(v),
    thresholds: { good: 1.0, warn: 0.5, higherIsBetter: true },
  },
  {
    key: "ar_to_ap",
    label: "AR to AP",
    description: "AR ÷ AP",
    format: (v) => fmtRatio(v),
    thresholds: { good: 1.2, warn: 0.8, higherIsBetter: true },
  },
  {
    key: "cash_coverage_weeks",
    label: "Cash Coverage",
    description: "Weeks of AP covered by Cash",
    format: (v) => (v !== null ? `${v.toFixed(1)} wks` : "N/A"),
    thresholds: { good: 8, warn: 4, higherIsBetter: true },
  },
  {
    key: "payroll_coverage",
    label: "Payroll Runway",
    description: "Weeks of Payroll covered by Cash",
    format: (v) => (v !== null ? `${v.toFixed(1)} wks` : "N/A"),
    thresholds: { good: 8, warn: 4, higherIsBetter: true },
  },
];

function ratioStatusColor(
  current: number | null,
  config: RatioConfig
): string {
  if (current === null || config.thresholds === null) return "text-gray-600";
  const { good, warn, higherIsBetter } = config.thresholds;
  if (higherIsBetter) {
    if (current >= good) return "text-green-700";
    if (current >= warn) return "text-amber-600";
    return "text-red-600";
  } else {
    if (current <= good) return "text-green-700";
    if (current <= warn) return "text-amber-600";
    return "text-red-600";
  }
}

function RatioCard({
  config,
  current,
  prior,
}: {
  config: RatioConfig;
  current: number | null;
  prior: number | null | undefined;
}) {
  const colorClass = ratioStatusColor(current, config);
  const hasPrior = prior !== null && prior !== undefined;
  const direction =
    hasPrior && current !== null && prior !== null
      ? current > prior
        ? "up"
        : current < prior
        ? "down"
        : "flat"
      : null;

  const arrowColor =
    direction === null
      ? ""
      : config.thresholds === null
      ? "text-gray-400"
      : config.thresholds.higherIsBetter
      ? direction === "up"
        ? "text-green-600"
        : direction === "down"
        ? "text-red-600"
        : "text-gray-400"
      : direction === "up"
      ? "text-red-600"
      : direction === "down"
      ? "text-green-600"
      : "text-gray-400";

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {config.label}
      </p>
      <div className="flex items-end gap-2">
        <p className={`text-xl font-bold tabular-nums leading-tight ${colorClass}`}>
          {config.format(current)}
        </p>
        {direction && direction !== "flat" && (
          <span className={`mb-0.5 ${arrowColor}`}>
            {direction === "up" ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">{config.description}</p>
      {hasPrior && (
        <p className="text-xs text-gray-400 mt-0.5">
          Prior: {config.format(prior ?? null)}
        </p>
      )}
    </div>
  );
}

function FinancialRatios({
  ratios,
  prior_ratios,
}: {
  ratios: ReportRatios;
  prior_ratios: ReportRatios | null;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
        Financial Health Ratios
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {RATIO_CONFIGS.map((cfg) => (
          <RatioCard
            key={cfg.key}
            config={cfg}
            current={ratios[cfg.key] as number | null}
            prior={prior_ratios ? (prior_ratios[cfg.key] as number | null) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

async function exportPDF(data: WeeklyReportData) {
  // Dynamically import to avoid SSR issues
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const navy = [27, 42, 74] as [number, number, number];
  const lightGray = [245, 245, 245] as [number, number, number];
  const pageW = doc.internal.pageSize.getWidth();

  // ── Page 1: Header + Executive Summary + Ratios ───────────────────────────

  // Header bar
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Vance Corporation — Weekly Pulse Report", 14, 10);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Week Ending: ${fmtDate(data.week_ending)}`, 14, 17);
  if (data.prior_week_ending) {
    doc.text(`Prior Week: ${fmtDate(data.prior_week_ending)}`, pageW - 14, 17, { align: "right" });
  }

  // Executive Summary
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Executive Summary", 14, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const narrative = buildNarrative(data);
  const wrapped = doc.splitTextToSize(narrative, pageW - 28);
  doc.text(wrapped, 14, 39);

  // Ratios table
  const ratioY = 39 + wrapped.length * 5 + 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Financial Health Ratios", 14, ratioY);

  const ratioRows = RATIO_CONFIGS.map((cfg) => {
    const current = data.ratios[cfg.key] as number | null;
    const prior = data.prior_ratios
      ? (data.prior_ratios[cfg.key] as number | null)
      : null;
    return [
      cfg.label,
      cfg.description,
      cfg.format(current),
      prior !== null ? cfg.format(prior) : "—",
    ];
  });

  autoTable(doc, {
    startY: ratioY + 4,
    head: [["Ratio", "Description", "Current", "Prior Week"]],
    body: ratioRows,
    theme: "striped",
    headStyles: { fillColor: navy, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 38 },
      1: { cellWidth: 70 },
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 28 },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Page 2+: Category Tables ──────────────────────────────────────────────

  for (const cat of data.categories) {
    doc.addPage();

    // Category header bar
    const hexToRgb = (hex: string): [number, number, number] => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };
    const catColor = hexToRgb(cat.color);
    doc.setFillColor(...catColor);
    doc.rect(0, 0, pageW, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(cat.name, 14, 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Total: ${fmtMoney(cat.current_total)}`, pageW - 14, 10, { align: "right" });

    if (data.prior_week_ending) {
      const changeStr = `WoW: ${fmtMoney(cat.change)} (${fmtPct(cat.change_pct)})`;
      doc.text(changeStr, pageW - 14, 15, { align: "right" });
    }

    doc.setTextColor(30, 30, 30);

    const head = data.prior_week_ending
      ? [["Account #", "Description", "Beg Balance", "End Balance", "Change", "%"]]
      : [["Account #", "Description", "Beg Balance", "End Balance"]];

    const body = cat.accounts.map((a) => {
      const base = [
        String(a.account_no),
        a.description,
        fmtMoney(a.beg_balance),
        fmtMoney(a.end_balance),
      ];
      if (data.prior_week_ending) {
        base.push(fmtMoney(a.change), fmtPct(a.change_pct));
      }
      return base;
    });

    // Total row
    const totalBeg = cat.accounts.reduce((s, a) => s + a.beg_balance, 0);
    const totalRow = ["", "TOTAL", fmtMoney(totalBeg), fmtMoney(cat.current_total)];
    if (data.prior_week_ending) {
      totalRow.push(fmtMoney(cat.change), fmtPct(cat.change_pct));
    }

    autoTable(doc, {
      startY: 20,
      head,
      body: [...body, totalRow],
      theme: "striped",
      headStyles: { fillColor: navy, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      didParseCell: (hookData) => {
        // Bold the total row
        if (hookData.row.index === body.length) {
          hookData.cell.styles.fontStyle = "bold";
          hookData.cell.styles.fillColor = lightGray;
        }
      },
      columnStyles: {
        0: { cellWidth: 22 },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
      margin: { left: 14, right: 14 },
    });
  }

  const filename = `Vance_Weekly_Pulse_${data.week_ending}.pdf`;
  doc.save(filename);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeeklyReport({ data }: { data: WeeklyReportData }) {
  const [exporting, setExporting] = useState(false);
  const hasPrior = !!data.prior_week_ending;

  async function handleExport() {
    setExporting(true);
    try {
      await exportPDF(data);
    } catch (e) {
      console.error("PDF export failed:", e);
      alert("PDF export failed. See console for details.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Report header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Weekly Pulse Report
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Week ending {fmtDate(data.week_ending)}
            {hasPrior && ` · compared to ${fmtDate(data.prior_week_ending!)}`}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary flex items-center gap-2 disabled:opacity-60"
        >
          {exporting ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Generating PDF…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </>
          )}
        </button>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary data={data} />

      {/* Category Movement Tables */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
          Category Movement
        </h2>
        <div className="flex flex-col gap-4">
          {data.categories.map((cat) => (
            <CategoryMovementTable key={cat.name} cat={cat} hasPrior={hasPrior} />
          ))}
        </div>
      </div>

      {/* Financial Ratios */}
      <FinancialRatios ratios={data.ratios} prior_ratios={data.prior_ratios} />
    </div>
  );
}
