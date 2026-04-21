"use client";

import { useEffect, useState, use } from "react";
import type { WeeklyReportData, ReportCategory, ReportRatios } from "@/app/api/weekly-report/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
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

// ─── Print styles ─────────────────────────────────────────────────────────────

const printStyles = `
  @media print {
    @page { size: letter landscape; margin: 0.5in; }
    .no-print { display: none !important; }
    .page-break { break-before: page; }
    body { background: white !important; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    .print-table th {
      background: #f3f4f6; font-weight: 600; font-size: 8pt;
      text-transform: uppercase; letter-spacing: 0.05em;
      padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: left;
    }
    .print-table td { padding: 3px 8px; border-bottom: 1px solid #f3f4f6; }
    .print-table .total-row td { font-weight: 700; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .cat-header {
      color: white; font-weight: 600; font-size: 10pt;
      padding: 4px 8px; margin: 0;
    }
  }
  @media screen {
    .no-print { display: flex; }
  }
`;

// ─── Category table ───────────────────────────────────────────────────────────

function PrintCategoryTable({ cat, hasPrior }: { cat: ReportCategory; hasPrior: boolean }) {
  const isActivity = cat.type === "activity";
  return (
    <div className="page-break" style={{ marginTop: "16px" }}>
      <div className="cat-header" style={{ backgroundColor: cat.color }}>
        {cat.name}
        {hasPrior && cat.change !== 0 && (
          <span style={{ marginLeft: "12px", fontSize: "8pt", opacity: 0.9 }}>
            WoW: {fmtMoney(cat.change)} ({fmtPct(cat.change_pct)})
          </span>
        )}
        <span style={{ float: "right" }}>Total: {fmtMoney(cat.current_total)}</span>
      </div>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: "70px" }}>Acct</th>
            <th>Description</th>
            {isActivity ? (
              <>
                <th style={{ textAlign: "right", width: "100px" }}>Period Dr</th>
                <th style={{ textAlign: "right", width: "100px" }}>Period Cr</th>
                <th style={{ textAlign: "right", width: "100px" }}>Net Activity</th>
              </>
            ) : (
              <>
                <th style={{ textAlign: "right", width: "100px" }}>Beg</th>
                <th style={{ textAlign: "right", width: "100px" }}>End</th>
                <th style={{ textAlign: "right", width: "100px" }}>Change ($)</th>
                <th style={{ textAlign: "right", width: "80px" }}>Change (%)</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {cat.accounts.map((acct) => (
            <tr key={acct.gl_account_id}>
              <td style={{ fontFamily: "monospace", fontSize: "8pt", color: "#6b7280" }}>{acct.account_no}</td>
              <td>{acct.description}</td>
              {isActivity ? (
                <>
                  <td style={{ textAlign: "right" }}>{acct.period_debit > 0 ? fmtMoney(acct.period_debit) : ""}</td>
                  <td style={{ textAlign: "right" }}>{acct.period_credit > 0 ? fmtMoney(acct.period_credit) : ""}</td>
                  <td style={{ textAlign: "right" }}>
                    {(acct.period_debit - acct.period_credit) !== 0 ? fmtMoney(acct.period_debit - acct.period_credit) : ""}
                  </td>
                </>
              ) : (
                <>
                  <td style={{ textAlign: "right" }}>{fmtMoney(acct.beg_balance)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(acct.end_balance)}</td>
                  <td style={{ textAlign: "right", color: acct.change > 0 ? "#16a34a" : acct.change < 0 ? "#dc2626" : "#9ca3af" }}>
                    {acct.change !== 0 ? fmtMoney(acct.change) : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: acct.change > 0 ? "#16a34a" : acct.change < 0 ? "#dc2626" : "#9ca3af" }}>
                    {acct.change !== 0 ? fmtPct(acct.change_pct) : "—"}
                  </td>
                </>
              )}
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={2} style={{ textTransform: "uppercase", fontSize: "8pt", color: "#6b7280", letterSpacing: "0.05em" }}>Total</td>
            {isActivity ? (
              <>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.accounts.reduce((s, a) => s + a.period_debit, 0))}</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.accounts.reduce((s, a) => s + a.period_credit, 0))}</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.accounts.reduce((s, a) => s + (a.period_debit - a.period_credit), 0))}</td>
              </>
            ) : (
              <>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.accounts.reduce((s, a) => s + a.beg_balance, 0))}</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.current_total)}</td>
                <td style={{ textAlign: "right" }}>{fmtMoney(cat.change)}</td>
                <td style={{ textAlign: "right" }}>{fmtPct(cat.change_pct)}</td>
              </>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Ratios table ─────────────────────────────────────────────────────────────

const RATIO_KEYS: Array<{ key: keyof ReportRatios; label: string; desc: string; fmt: (v: number | null) => string }> = [
  { key: "net_liquidity",       label: "Net Liquidity",    desc: "Cash − AP − Payroll",             fmt: (v) => v !== null ? fmtMoney(v) : "N/A" },
  { key: "current_ratio",       label: "Current Ratio",    desc: "(Cash + AR) ÷ (AP + Payroll)",    fmt: (v) => fmtRatio(v) },
  { key: "quick_ratio",         label: "Quick Ratio",      desc: "Cash ÷ (AP + Payroll)",           fmt: (v) => fmtRatio(v) },
  { key: "ar_to_ap",            label: "AR to AP",         desc: "AR ÷ AP",                         fmt: (v) => fmtRatio(v) },
  { key: "cash_coverage_weeks", label: "Cash Coverage",    desc: "Weeks of AP covered by Cash",     fmt: (v) => v !== null ? `${v.toFixed(1)} wks` : "N/A" },
  { key: "payroll_coverage",    label: "Payroll Runway",   desc: "Weeks of Payroll covered by Cash", fmt: (v) => v !== null ? `${v.toFixed(1)} wks` : "N/A" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PrintPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/weekly-report?week_ending=${date}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setTimeout(() => window.print(), 500);
      })
      .catch((e) => setError(String(e)));
  }, [date]);

  return (
    <>
      <style>{printStyles}</style>

      {/* Screen-only toolbar */}
      <div
        className="no-print"
        style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
          backgroundColor: "#1B2A4A", color: "white",
          padding: "8px 16px", alignItems: "center", gap: "12px",
        }}
      >
        <button
          onClick={() => window.print()}
          style={{
            backgroundColor: "white", color: "#1B2A4A",
            padding: "4px 12px", borderRadius: "4px",
            fontWeight: 600, fontSize: "13px", cursor: "pointer",
          }}
        >
          Print / Save PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{
            backgroundColor: "transparent", color: "white",
            padding: "4px 12px", borderRadius: "4px",
            fontWeight: 500, fontSize: "13px", cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.4)",
          }}
        >
          Close
        </button>
        <span style={{ fontSize: "13px", opacity: 0.8 }}>
          {data ? `Week Ending: ${fmtDate(data.week_ending)}` : "Loading…"}
        </span>
      </div>

      {/* Print content */}
      <div style={{ padding: "64px 24px 24px", fontFamily: "Inter, sans-serif", fontSize: "10pt" }}>
        {error && <p style={{ color: "red" }}>{error}</p>}
        {!data && !error && <p>Loading report…</p>}
        {data && (
          <>
            {/* Header */}
            <div style={{ borderBottom: "2px solid #1B2A4A", paddingBottom: "6px", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <h1 style={{ fontSize: "14pt", fontWeight: 700, color: "#1B2A4A", margin: 0 }}>
                  Weekly Pulse Report
                </h1>
                <p style={{ fontSize: "9pt", color: "#6b7280", margin: "2px 0 0" }}>
                  Week Ending: {fmtDate(data.week_ending)}
                  {data.prior_week_ending && ` · Prior: ${fmtDate(data.prior_week_ending)}`}
                </p>
              </div>
            </div>

            {/* Category Totals */}
            <h2 style={{ fontSize: "10pt", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#374151", margin: "0 0 6px" }}>
              Category Totals
            </h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: "right" }}>End Balance</th>
                  <th style={{ textAlign: "right" }}>Change WoW ($)</th>
                  <th style={{ textAlign: "right" }}>Change WoW (%)</th>
                  <th style={{ textAlign: "right" }}>YTD Avg</th>
                  <th style={{ textAlign: "right" }}>vs YTD Avg (%)</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((cat) => {
                  const hasPrior = !!data.prior_week_ending;
                  const vsYtd = cat.ytd_avg !== 0
                    ? ((cat.current_total - cat.ytd_avg) / Math.abs(cat.ytd_avg)) * 100
                    : null;
                  return (
                    <tr key={cat.name}>
                      <td style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: cat.color, flexShrink: 0 }} />
                        {cat.name}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(cat.current_total)}</td>
                      <td style={{ textAlign: "right" }}>{hasPrior ? fmtMoney(cat.change) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{hasPrior ? fmtPct(cat.change_pct) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{cat.ytd_avg !== 0 ? fmtMoney(cat.ytd_avg) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{vsYtd !== null ? fmtPct(vsYtd) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Ratios */}
            <h2 style={{ fontSize: "10pt", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#374151", margin: "16px 0 6px" }}>
              Financial Health Ratios
            </h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Ratio</th>
                  <th>Description</th>
                  <th style={{ textAlign: "right" }}>Current</th>
                  <th style={{ textAlign: "right" }}>Prior Week</th>
                </tr>
              </thead>
              <tbody>
                {RATIO_KEYS.map((r) => (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 600 }}>{r.label}</td>
                    <td style={{ color: "#6b7280" }}>{r.desc}</td>
                    <td style={{ textAlign: "right" }}>{r.fmt(data.ratios[r.key] as number | null)}</td>
                    <td style={{ textAlign: "right" }}>
                      {data.prior_ratios ? r.fmt(data.prior_ratios[r.key] as number | null) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Per-category detail */}
            <h2 style={{ fontSize: "10pt", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#374151", margin: "16px 0 6px" }}>
              Category Detail
            </h2>
            {data.categories.map((cat) => (
              <PrintCategoryTable key={cat.name} cat={cat} hasPrior={!!data.prior_week_ending} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
