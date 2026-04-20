"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import WeeklyReport from "@/components/WeeklyReport";
import type { WeeklyReportData } from "@/app/api/weekly-report/route";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BalanceRow {
  gl_account_id: number;
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_sort_order: number | null;
  beg_balance: string;
  end_balance: string;
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
  rows: BalanceRow[];
}

interface OverheadRow {
  gl_account_id:             number;
  account_no:                number;
  description:               string;
  category_color:            string;
  weekly_debit:              string | number;
  weekly_credit:             string | number;
  net_activity:              string | number;
  excluded_ye_reclass_gross: string | number;
  has_data:                  boolean;
  source_file:               string | null;
}

interface TrxRow {
  id: number;
  trx_date: string | null;
  journal: string | null;
  audit_no: string | null;
  gl_trx_no: string | null;
  line: string | null;
  job: string | null;
  description: string | null;
  debit: number;
  credit: number;
  vendor_cust_no: string | null;
  trx_no: string | null;
}

interface TrxSummary {
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  beg_balance: number | null;
  end_balance: number | null;
  total_debits: number;
  total_credits: number;
  net_activity: number;
  account_type?: "overhead" | "balance_sheet";
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

function ChangeCell({ beg, end }: { beg: string; end: string }) {
  const b = parseFloat(beg);
  const e = parseFloat(end);
  const change = e - b;
  const pct = b !== 0 ? (change / Math.abs(b)) * 100 : 0;
  const color =
    change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-gray-400";
  return (
    <span className={`font-medium ${color}`}>
      {fmtMoney(change)}{" "}
      <span className="text-xs opacity-70">({fmtPct(pct)})</span>
    </span>
  );
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TransactionModal({
  weekEnding,
  accountNo,
  categoryColor,
  onClose,
}: {
  weekEnding: string;
  accountNo: number;
  categoryColor: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TrxSummary | null>(null);
  const [transactions, setTransactions] = useState<TrxRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/transactions?week_ending=${weekEnding}&account_no=${accountNo}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSummary(data.summary);
        setTransactions(data.transactions ?? []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [weekEnding, accountNo]);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-10 pb-6 px-4 overflow-y-auto"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-5 py-4 rounded-t-xl flex-shrink-0"
          style={{ backgroundColor: categoryColor }}
        >
          <div>
            <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">
              Account {accountNo}
            </p>
            <p className="text-sm font-bold text-white">
              {summary ? summary.description : "Loading…"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-center text-sm text-red-600">{error}</div>
        ) : (
          <>
            {/* Balance / activity summary */}
            {summary && (
              summary.account_type === "overhead" ? (
                <div className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-gray-200 flex-shrink-0">
                  <div>
                    <p className="text-xs text-gray-500">Total Debits</p>
                    <p className="text-sm font-semibold tabular-nums text-gray-700">{fmtMoney(summary.total_debits)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Credits</p>
                    <p className="text-sm font-semibold tabular-nums text-gray-700">{fmtMoney(summary.total_credits)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Period Activity</p>
                    <p className={`text-sm font-semibold tabular-nums ${summary.net_activity >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmtMoney(summary.net_activity)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 px-5 py-4 border-b border-gray-200 flex-shrink-0">
                  {[
                    { label: "Beg Balance", value: fmtMoney(summary.beg_balance) },
                    { label: "Total Debits", value: fmtMoney(summary.total_debits) },
                    { label: "Total Credits", value: fmtMoney(summary.total_credits) },
                    {
                      label: "Net Activity",
                      value: fmtMoney(summary.net_activity),
                      colored: true,
                      positive: summary.net_activity >= 0,
                    },
                    { label: "End Balance", value: fmtMoney(summary.end_balance), bold: true },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          item.bold
                            ? "text-gray-900"
                            : item.colored
                            ? item.positive
                              ? "text-green-700"
                              : "text-red-600"
                            : "text-gray-700"
                        }`}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Transaction table */}
            {transactions.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400 italic">
                No transactions imported for this account.
              </div>
            ) : (
              <div className="overflow-auto flex-1">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr>
                      <th className="table-th">Date</th>
                      <th className="table-th">Journal</th>
                      <th className="table-th">Audit #</th>
                      <th className="table-th">Job</th>
                      <th className="table-th">Description</th>
                      <th className="table-th text-right">Debit</th>
                      <th className="table-th text-right">Credit</th>
                      <th className="table-th">Vnd/Cust</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="table-td text-gray-600 whitespace-nowrap">{t.trx_date ?? "—"}</td>
                        <td className="table-td text-gray-500">{t.journal}</td>
                        <td className="table-td font-mono text-gray-500">{t.audit_no}</td>
                        <td className="table-td text-gray-500">{t.job}</td>
                        <td className="table-td text-gray-800 max-w-[180px] truncate">{t.description}</td>
                        <td className="table-td text-right tabular-nums text-gray-700">
                          {t.debit > 0 ? fmtMoney(t.debit) : ""}
                        </td>
                        <td className="table-td text-right tabular-nums text-gray-700">
                          {t.credit > 0 ? fmtMoney(t.credit) : ""}
                        </td>
                        <td className="table-td text-gray-500">{t.vendor_cust_no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Overhead Summary Section (read-only) ─────────────────────────────────────

const OVERHEAD_COLOR = "#7B3FA0";

function OverheadSummarySection({
  rows,
  onAccountClick,
}: {
  rows: OverheadRow[];
  onAccountClick: (accountNo: number, color: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const toNum = (v: string | number) => {
    const p = parseFloat(String(v));
    return isFinite(p) ? p : 0;
  };
  const totalDebit  = rows.reduce((s, r) => s + toNum(r.weekly_debit),  0);
  const totalCredit = rows.reduce((s, r) => s + toNum(r.weekly_credit), 0);
  const totalNet    = rows.reduce((s, r) => s + toNum(r.net_activity),  0);
  const hasActivity = rows.some((r) => r.has_data);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: OVERHEAD_COLOR }}
      >
        <span className="font-semibold text-sm text-white">Overhead (Div 99)</span>
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-white">{fmtMoney(totalNet)}</span>
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
          {!hasActivity ? (
            <div className="px-5 py-6 text-sm text-gray-400 italic text-center">
              No overhead activity recorded for this week.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="table-th w-24">Account #</th>
                    <th className="table-th">Description</th>
                    <th className="table-th text-right w-36">Weekly Debit</th>
                    <th className="table-th text-right w-36">Weekly Credit</th>
                    <th className="table-th text-right w-36">Net Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.gl_account_id}
                      className="hover:bg-gray-50 cursor-pointer group"
                      onClick={() => onAccountClick(row.account_no, OVERHEAD_COLOR)}
                      title="Click to view transactions"
                    >
                      <td className="table-td font-mono text-xs text-gray-500">
                        {row.account_no}
                      </td>
                      <td className="table-td text-gray-800 group-hover:text-[#1B2A4A] group-hover:underline">
                        {row.description}
                      </td>
                      <td className="table-td text-right tabular-nums text-gray-600">
                        {fmtMoney(row.weekly_debit)}
                      </td>
                      <td className="table-td text-right tabular-nums text-gray-600">
                        {fmtMoney(row.weekly_credit)}
                      </td>
                      <td className="table-td text-right tabular-nums font-medium text-gray-900">
                        {fmtMoney(row.net_activity)}
                      </td>
                    </tr>
                  ))}

                  {/* Category total row */}
                  <tr className="bg-gray-50">
                    <td
                      colSpan={2}
                      className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200"
                    >
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
        </>
      )}
    </div>
  );
}

// ─── Collapsible Category Section ─────────────────────────────────────────────

function CategorySection({
  group,
  onAccountClick,
}: {
  group: CategoryGroup;
  onAccountClick: (accountNo: number, color: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const totalBeg = group.rows.reduce((s, r) => s + parseFloat(r.beg_balance), 0);
  const totalEnd = group.rows.reduce((s, r) => s + parseFloat(r.end_balance), 0);
  const totalChange = totalEnd - totalBeg;
  const totalPct = totalBeg !== 0 ? (totalChange / Math.abs(totalBeg)) * 100 : 0;

  const headerTextColor = "text-white";

  return (
    <div className="card overflow-hidden">
      {/* Category header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: group.color }}
      >
        <span className={`font-semibold text-sm ${headerTextColor}`}>
          {group.name}
        </span>
        <div className="flex items-center gap-4">
          <span className={`text-sm font-bold ${headerTextColor}`}>
            {fmtMoney(totalEnd)}
          </span>
          <svg
            className={`w-4 h-4 ${headerTextColor} transition-transform ${open ? "rotate-180" : ""}`}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="table-th w-24">Account #</th>
                <th className="table-th">Description</th>
                <th className="table-th text-right w-32">Beg Balance</th>
                <th className="table-th text-right w-32">End Balance</th>
                <th className="table-th text-right w-44">Change</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr
                  key={row.gl_account_id}
                  className="hover:bg-gray-50 cursor-pointer group"
                  onClick={() => onAccountClick(row.account_no, group.color)}
                  title="Click to view transactions"
                >
                  <td className="table-td font-mono text-xs text-gray-500">
                    {row.account_no}
                  </td>
                  <td className="table-td text-gray-800 group-hover:text-[#1B2A4A] group-hover:underline">
                    {row.description}
                  </td>
                  <td className="table-td text-right text-gray-600">
                    {fmtMoney(row.beg_balance)}
                  </td>
                  <td className="table-td text-right font-medium text-gray-900">
                    {fmtMoney(row.end_balance)}
                  </td>
                  <td className="table-td text-right">
                    <ChangeCell beg={row.beg_balance} end={row.end_balance} />
                  </td>
                </tr>
              ))}

              {/* Category total row */}
              <tr className="bg-gray-50">
                <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-200">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold text-gray-700 border-t border-gray-200">
                  {fmtMoney(totalBeg)}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 border-t border-gray-200">
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
  const [overheadRows, setOverheadRows] = useState<OverheadRow[]>([]);
  const [bids, setBids] = useState<BidActivity | null>(null);
  const [notes, setNotes] = useState<WeeklyNote | null>(null);
  const [report, setReport] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalAccount, setModalAccount] = useState<{ accountNo: number; color: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [balRes, overheadRes, bidRes, noteRes, reportRes] = await Promise.all([
          fetch(`/api/weekly-balances?week_ending=${date}`),
          fetch(`/api/weekly-overhead?week_ending=${date}`),
          fetch(`/api/bid-activity?week_ending=${date}`),
          fetch(`/api/weekly-notes?week_ending=${date}`),
          fetch(`/api/weekly-report?week_ending=${date}`),
        ]);

        if (!balRes.ok) throw new Error("Failed to load balances");
        const balData = await balRes.json();
        setBalances(balData.balances ?? []);

        if (overheadRes.ok) {
          const overheadData = await overheadRes.json() as { accounts?: OverheadRow[] };
          setOverheadRows(overheadData.accounts ?? []);
        }
        if (bidRes.ok) setBids(await bidRes.json());
        if (noteRes.ok) setNotes(await noteRes.json());
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
    const name = row.category_name ?? "Uncategorized";
    const color = row.category_color ?? "#6B7280";
    if (!seen.has(name)) {
      const g: CategoryGroup = { name, color, rows: [] };
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
        <Link href={`/weeks/${date}/enter`} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </Link>
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
          {/* Category sections */}
          {categoryGroups.map((g) => (
            <CategorySection
              key={g.name}
              group={g}
              onAccountClick={(accountNo, color) =>
                setModalAccount({ accountNo, color })
              }
            />
          ))}

          {/* Overhead (Div 99) */}
          {overheadRows.length > 0 && (
            <OverheadSummarySection
              rows={overheadRows}
              onAccountClick={(accountNo, color) => setModalAccount({ accountNo, color })}
            />
          )}

          {/* Bid Activity card */}
          <div className="card">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Bid Activity</h2>
            </div>
            <div className="px-5 py-4">
              {bids ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Submitted</p>
                    <p className="text-lg font-bold text-gray-900">
                      {bids.bids_submitted_count}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(parseFloat(bids.bids_submitted_value))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Won</p>
                    <p className="text-lg font-bold text-green-700">
                      {bids.bids_won_count}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(parseFloat(bids.bids_won_value))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                    <p
                      className={`text-lg font-bold ${
                        winRate !== null && winRate >= 50
                          ? "text-green-600"
                          : "text-amber-600"
                      }`}
                    >
                      {winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
                    </p>
                  </div>
                  {bids.notes && (
                    <div className="sm:col-span-1">
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

          {/* Analysis doc card */}
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
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {notes.summary}
                    </p>
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

      {/* Transaction detail modal */}
      {modalAccount && (
        <TransactionModal
          weekEnding={date}
          accountNo={modalAccount.accountNo}
          categoryColor={modalAccount.color}
          onClose={() => setModalAccount(null)}
        />
      )}
    </div>
  );
}
