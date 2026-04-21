"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import WeeklyReport from "@/components/WeeklyReport";
import type { WeeklyReportData } from "@/app/api/weekly-report/route";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BalanceRow {
  gl_account_id: number;
  account_no: number;
  division: string;
  description: string;
  normal_balance: "debit" | "credit";
  is_pl_flow: boolean;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_sort_order: number | null;
  beg_balance: string;
  end_balance: string;
  period_debit: string;
  period_credit: string;
}

interface BidActivity {
  bids_submitted_count: number;
  bids_submitted_value: string;
  bids_won_count: number;
  bids_won_value: string;
  notes: string | null;
}

interface WeeklyNote {
  doc_link: string | null;
  summary: string | null;
}

interface CategoryGroup {
  name: string;
  color: string;
  is_pl_flow: boolean;
  rows: BalanceRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function fmtMoney(val: string | number | null | undefined) {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number) {
  if (!isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function p(v: string | number | null | undefined): number {
  const f = parseFloat(String(v ?? "0"));
  return isFinite(f) ? f : 0;
}

// ─── Category Section ─────────────────────────────────────────────────────────

function CategorySection({ group }: { group: CategoryGroup }) {
  const [open, setOpen] = useState(true);

  if (group.is_pl_flow) {
    const totalDebit  = group.rows.reduce((s, r) => s + p(r.period_debit),  0);
    const totalCredit = group.rows.reduce((s, r) => s + p(r.period_credit), 0);
    const totalNet    = totalDebit - totalCredit;

    return (
      <div className="card overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
          style={{ backgroundColor: group.color }}
        >
          <span className="font-semibold text-sm text-white">{group.name}</span>
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-white">{fmtMoney(totalNet)} net</span>
            <svg
              className={`w-4 h-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {open && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="table-th w-28">Account</th>
                  <th className="table-th">Description</th>
                  <th className="table-th text-right w-36">Period Debit</th>
                  <th className="table-th text-right w-36">Period Credit</th>
                  <th className="table-th text-right w-36">Net Activity</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const net = p(row.period_debit) - p(row.period_credit);
                  const acctLabel = row.division ? `${row.account_no}-${row.division}` : String(row.account_no);
                  return (
                    <tr key={row.gl_account_id} className="hover:bg-gray-50">
                      <td className="table-td font-mono text-xs text-gray-500">{acctLabel}</td>
                      <td className="table-td text-gray-800">{row.description}</td>
                      <td className="table-td text-right tabular-nums text-gray-600">
                        {p(row.period_debit) > 0 ? fmtMoney(row.period_debit) : ""}
                      </td>
                      <td className="table-td text-right tabular-nums text-gray-600">
                        {p(row.period_credit) > 0 ? fmtMoney(row.period_credit) : ""}
                      </td>
                      <td className="table-td text-right tabular-nums font-medium text-gray-900">
                        {net !== 0 ? fmtMoney(net) : ""}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50">
                  <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-gray-700 border-t border-gray-200 tabular-nums">
                    {fmtMoney(totalDebit)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-gray-700 border-t border-gray-200 tabular-nums">
                    {fmtMoney(totalCredit)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 border-t border-gray-200 tabular-nums">
                    {fmtMoney(totalNet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Balance-sheet view
  const totalBeg    = group.rows.reduce((s, r) => s + p(r.beg_balance), 0);
  const totalEnd    = group.rows.reduce((s, r) => s + p(r.end_balance), 0);
  const totalChange = totalEnd - totalBeg;
  const totalPct    = totalBeg !== 0 ? (totalChange / Math.abs(totalBeg)) * 100 : 0;

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: group.color }}
      >
        <span className="font-semibold text-sm text-white">{group.name}</span>
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-white">{fmtMoney(totalEnd)}</span>
          <svg
            className={`w-4 h-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="table-th w-28">Account</th>
                <th className="table-th">Description</th>
                <th className="table-th text-right w-36">Beg Balance</th>
                <th className="table-th text-right w-36">End Balance</th>
                <th className="table-th text-right w-44">Change</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const change = p(row.end_balance) - p(row.beg_balance);
                const pct    = p(row.beg_balance) !== 0
                  ? (change / Math.abs(p(row.beg_balance))) * 100
                  : 0;
                const acctLabel = row.division ? `${row.account_no}-${row.division}` : String(row.account_no);
                return (
                  <tr key={row.gl_account_id} className="hover:bg-gray-50">
                    <td className="table-td font-mono text-xs text-gray-500">{acctLabel}</td>
                    <td className="table-td text-gray-800">{row.description}</td>
                    <td className="table-td text-right tabular-nums text-gray-600">
                      {fmtMoney(row.beg_balance)}
                    </td>
                    <td className="table-td text-right tabular-nums font-medium text-gray-900">
                      {fmtMoney(row.end_balance)}
                    </td>
                    <td className="table-td text-right">
                      <span className={`font-medium ${change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-gray-400"}`}>
                        {fmtMoney(change)}{" "}
                        <span className="text-xs opacity-70">({fmtPct(pct)})</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50">
                <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold text-gray-700 border-t border-gray-200 tabular-nums">
                  {fmtMoney(totalBeg)}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 border-t border-gray-200 tabular-nums">
                  {fmtMoney(totalEnd)}
                </td>
                <td className="px-4 py-2.5 text-right text-sm border-t border-gray-200">
                  <span className={`font-semibold ${totalChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmtMoney(totalChange)}{" "}
                    <span className="text-xs opacity-70">({fmtPct(totalPct)})</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeekDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = use(params);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [bids, setBids]   = useState<BidActivity | null>(null);
  const [notes, setNotes] = useState<WeeklyNote | null>(null);
  const [report, setReport] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [balRes, bidRes, noteRes, reportRes] = await Promise.all([
          fetch(`/api/weekly-balances?week_ending=${date}`),
          fetch(`/api/bid-activity?week_ending=${date}`),
          fetch(`/api/weekly-notes?week_ending=${date}`),
          fetch(`/api/weekly-report?week_ending=${date}`),
        ]);

        if (!balRes.ok) throw new Error("Failed to load balances");
        const balData = await balRes.json();
        setBalances(balData.balances ?? []);

        if (bidRes.ok)    setBids(await bidRes.json());
        if (noteRes.ok)   setNotes(await noteRes.json());
        if (reportRes.ok) setReport(await reportRes.json());
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [date]);

  // Group balances by category
  const categoryGroups: CategoryGroup[] = [];
  const seen = new Map<string, CategoryGroup>();
  for (const row of balances) {
    const name  = row.category_name  ?? "Uncategorized";
    const color = row.category_color ?? "#6B7280";
    if (!seen.has(name)) {
      const g: CategoryGroup = { name, color, is_pl_flow: row.is_pl_flow, rows: [] };
      seen.set(name, g);
      categoryGroups.push(g);
    }
    seen.get(name)!.rows.push(row);
  }

  const winRate =
    bids && bids.bids_submitted_count > 0
      ? (bids.bids_won_count / bids.bids_submitted_count) * 100
      : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/weeks" className="hover:text-[#1B2A4A] hover:underline">
              All Weeks
            </Link>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>{fmtDate(date)}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Week Ending: {fmtDate(date)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const w = window.open(`/weeks/${date}/summary/print`, "_blank");
              if (w) w.focus();
            }}
            className="btn-primary flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Export PDF
          </button>
          <Link href={`/weeks/${date}/enter`} className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm">Loading…</span>
          </div>
        </div>
      ) : error ? (
        <div className="card px-6 py-10 text-center text-red-600 text-sm">{error}</div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 6 category sections */}
          {categoryGroups.map((g) => (
            <CategorySection key={g.name} group={g} />
          ))}

          {/* Bid Activity */}
          <div className="card">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Bid Activity</h2>
            </div>
            <div className="px-5 py-4">
              {bids ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Submitted</p>
                    <p className="text-lg font-bold text-gray-900">{bids.bids_submitted_count}</p>
                    <p className="text-xs text-gray-500">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        .format(parseFloat(bids.bids_submitted_value))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Won</p>
                    <p className="text-lg font-bold text-green-700">{bids.bids_won_count}</p>
                    <p className="text-xs text-gray-500">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        .format(parseFloat(bids.bids_won_value))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                    <p className={`text-lg font-bold ${winRate !== null && winRate >= 50 ? "text-green-600" : "text-amber-600"}`}>
                      {winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
                    </p>
                  </div>
                  {bids.notes && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Notes</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{bids.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No bid activity recorded for this week.</p>
              )}
            </div>
          </div>

          {/* Analysis doc */}
          <div className="card">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Analysis</h2>
            </div>
            <div className="px-5 py-4">
              {notes ? (
                <div className="flex flex-col gap-3">
                  {notes.doc_link && (
                    <a
                      href={notes.doc_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-[#1B2A4A] hover:underline font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open Analysis Document
                    </a>
                  )}
                  {notes.summary && (
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{notes.summary}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No analysis notes recorded for this week.</p>
              )}
            </div>
          </div>

          {/* Weekly Pulse Report */}
          {report && (
            <div className="card px-5 py-5">
              <WeeklyReport data={report} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
