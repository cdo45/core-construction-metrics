"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TrialBalanceImporter from "@/components/TrialBalanceImporter";

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

interface CategoryGroup {
  name: string;
  color: string;
  is_pl_flow: boolean;
  rows: BalanceRow[];
}

interface BidFormState {
  bids_submitted_count: string;
  bids_submitted_value: string;
  bids_won_count: string;
  bids_won_value: string;
  notes: string;
}

interface NotesFormState {
  doc_link: string;
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function formatDisplay(raw: string | number): string {
  const str = String(raw).replace(/,/g, "");
  const n = parseFloat(str);
  if (isNaN(n)) return String(raw);
  const neg = n < 0;
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + parts.join(".");
}

function parseRaw(s: string | number): number {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

// ─── Money Input ─────────────────────────────────────────────────────────────

function MoneyInput({
  value,
  onChange,
  readOnly = false,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFocus() {
    if (readOnly) return;
    setFocused(true);
    onChange(value.replace(/,/g, ""));
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function handleBlur() {
    if (readOnly) return;
    setFocused(false);
    const stripped = value.replace(/,/g, "");
    if (!isNaN(parseFloat(stripped))) {
      onChange(formatDisplay(stripped));
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={focused ? value.replace(/,/g, "") : formatDisplay(value)}
      onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`input-field text-right tabular-nums ${readOnly ? "bg-gray-50 text-gray-400 cursor-default" : ""}`}
    />
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#1B2A4A] text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium animate-fade-in">
      <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      {msg}
    </div>
  );
}

// ─── Balance row state ────────────────────────────────────────────────────────

type BalanceMap = Record<number, { beg: string; end: string; debit: string; credit: string }>;

// ─── Category Section ─────────────────────────────────────────────────────────

function CategoryEnterSection({
  group,
  balanceMap,
  onBalanceChange,
}: {
  group: CategoryGroup;
  balanceMap: BalanceMap;
  onBalanceChange: (id: number, field: "beg" | "end" | "debit" | "credit", val: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: group.color }}
      >
        <span className="font-semibold text-sm text-white">{group.name}</span>
        <svg
          className={`w-4 h-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="overflow-x-auto">
          {group.is_pl_flow ? (
            // P&L flow: Debit | Credit | Net Activity
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className="table-th w-28">Account</th>
                  <th className="table-th">Description</th>
                  <th className="table-th w-40 text-right pr-4">Period Debit</th>
                  <th className="table-th w-40 text-right pr-4">Period Credit</th>
                  <th className="table-th w-40 text-right pr-4">Net Activity</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const vals = balanceMap[row.gl_account_id] ?? { beg: "0.00", end: "0.00", debit: "0.00", credit: "0.00" };
                  const net = parseRaw(vals.debit) - parseRaw(vals.credit);
                  const acctLabel = row.division ? `${row.account_no}-${row.division}` : String(row.account_no);
                  return (
                    <tr key={row.gl_account_id} className="hover:bg-gray-50">
                      <td className="table-td font-mono text-xs text-gray-500 align-middle">{acctLabel}</td>
                      <td className="table-td text-gray-800 align-middle">{row.description}</td>
                      <td className="table-td align-middle" style={{ width: 160 }}>
                        <MoneyInput
                          value={vals.debit}
                          onChange={(v) => onBalanceChange(row.gl_account_id, "debit", v)}
                        />
                      </td>
                      <td className="table-td align-middle" style={{ width: 160 }}>
                        <MoneyInput
                          value={vals.credit}
                          onChange={(v) => onBalanceChange(row.gl_account_id, "credit", v)}
                        />
                      </td>
                      <td className="table-td align-middle" style={{ width: 160 }}>
                        <MoneyInput
                          value={formatDisplay(net)}
                          onChange={() => {}}
                          readOnly
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            // Balance-sheet: Beg Balance (read-only) | End Balance
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="table-th w-28">Account</th>
                  <th className="table-th">Description</th>
                  <th className="table-th w-40 text-right pr-4">Beg Balance</th>
                  <th className="table-th w-40 text-right pr-4">End Balance</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const vals = balanceMap[row.gl_account_id] ?? { beg: "0.00", end: "0.00", debit: "0.00", credit: "0.00" };
                  const acctLabel = row.division ? `${row.account_no}-${row.division}` : String(row.account_no);
                  return (
                    <tr key={row.gl_account_id} className="hover:bg-gray-50">
                      <td className="table-td font-mono text-xs text-gray-500 align-middle">{acctLabel}</td>
                      <td className="table-td text-gray-800 align-middle">{row.description}</td>
                      <td className="table-td align-middle" style={{ width: 160 }}>
                        <MoneyInput
                          value={vals.beg}
                          onChange={(v) => onBalanceChange(row.gl_account_id, "beg", v)}
                          readOnly
                        />
                      </td>
                      <td className="table-td align-middle" style={{ width: 160 }}>
                        <MoneyInput
                          value={vals.end}
                          onChange={(v) => onBalanceChange(row.gl_account_id, "end", v)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EnterWeekPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = use(params);
  const router = useRouter();

  const [accounts, setAccounts] = useState<BalanceRow[]>([]);
  const [balanceMap, setBalanceMap] = useState<BalanceMap>({});
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);

  const [bids, setBids] = useState<BidFormState>({
    bids_submitted_count: "",
    bids_submitted_value: "",
    bids_won_count: "",
    bids_won_value: "",
    notes: "",
  });

  const [notes, setNotes] = useState<NotesFormState>({ doc_link: "", summary: "" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [saveError, setSaveError] = useState("");

  // ── Helpers ───────────────────────────────────────────────────────────────

  const buildGroups = useCallback((rows: BalanceRow[]) => {
    const groups: CategoryGroup[] = [];
    const seen = new Map<string, CategoryGroup>();
    for (const row of rows) {
      const name = row.category_name ?? "Uncategorized";
      const color = row.category_color ?? "#6B7280";
      if (!seen.has(name)) {
        const g: CategoryGroup = { name, color, is_pl_flow: row.is_pl_flow, rows: [] };
        seen.set(name, g);
        groups.push(g);
      }
      seen.get(name)!.rows.push(row);
    }
    return groups;
  }, []);

  const initBalanceMap = useCallback(
    (rows: BalanceRow[], priorEndMap: Record<number, string>) => {
      const map: BalanceMap = {};
      for (const row of rows) {
        if (row.is_pl_flow) {
          map[row.gl_account_id] = {
            beg:    "0.00",
            end:    "0.00",
            debit:  formatDisplay(row.period_debit  ?? "0"),
            credit: formatDisplay(row.period_credit ?? "0"),
          };
        } else {
          const begFromPrior = priorEndMap[row.gl_account_id];
          const hasCurrentData =
            parseRaw(row.beg_balance) !== 0 || parseRaw(row.end_balance) !== 0;
          map[row.gl_account_id] = {
            beg: hasCurrentData
              ? formatDisplay(row.beg_balance)
              : begFromPrior !== undefined
              ? formatDisplay(begFromPrior)
              : "0.00",
            end:    formatDisplay(row.end_balance),
            debit:  "0.00",
            credit: "0.00",
          };
        }
      }
      return map;
    },
    [],
  );

  const loadBalances = useCallback(async () => {
    try {
      const [curRes, priorRes, bidRes, noteRes] = await Promise.all([
        fetch(`/api/weekly-balances?week_ending=${date}`),
        fetch(`/api/weekly-balances?week_ending=${date}&prior=1`),
        fetch(`/api/bid-activity?week_ending=${date}`),
        fetch(`/api/weekly-notes?week_ending=${date}`),
      ]);

      const curData   = curRes.ok   ? await curRes.json()   : { balances: [] };
      const priorData = priorRes.ok ? await priorRes.json() : { balances: [] };

      const rows: BalanceRow[]         = curData.balances   ?? [];
      const priorBalances: BalanceRow[] = priorData.balances ?? [];

      const priorEndMap: Record<number, string> = {};
      for (const b of priorBalances) {
        priorEndMap[b.gl_account_id] = b.end_balance;
      }

      setAccounts(rows);
      setCategoryGroups(buildGroups(rows));
      setBalanceMap(initBalanceMap(rows, priorEndMap));

      if (bidRes.ok) {
        const bidData = await bidRes.json();
        if (bidData) {
          setBids({
            bids_submitted_count: String(bidData.bids_submitted_count ?? ""),
            bids_submitted_value: formatDisplay(String(bidData.bids_submitted_value ?? "0")),
            bids_won_count:       String(bidData.bids_won_count ?? ""),
            bids_won_value:       formatDisplay(String(bidData.bids_won_value ?? "0")),
            notes:                bidData.notes ?? "",
          });
        }
      }

      if (noteRes.ok) {
        const noteData = await noteRes.json();
        if (noteData) {
          setNotes({ doc_link: noteData.doc_link ?? "", summary: noteData.summary ?? "" });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [date, buildGroups, initBalanceMap]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // ── Balance change ────────────────────────────────────────────────────────

  function handleBalanceChange(id: number, field: "beg" | "end" | "debit" | "credit", val: string) {
    setBalanceMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: val },
    }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const balancesPayload = accounts.map((acc) => ({
        gl_account_id: acc.gl_account_id,
        beg_balance:   parseRaw(balanceMap[acc.gl_account_id]?.beg    ?? "0"),
        end_balance:   parseRaw(balanceMap[acc.gl_account_id]?.end    ?? "0"),
        period_debit:  parseRaw(balanceMap[acc.gl_account_id]?.debit  ?? "0"),
        period_credit: parseRaw(balanceMap[acc.gl_account_id]?.credit ?? "0"),
      }));

      const [balRes, bidRes, noteRes] = await Promise.all([
        fetch("/api/weekly-balances", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ week_ending: date, balances: balancesPayload }),
        }),
        fetch("/api/bid-activity", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            week_ending:          date,
            bids_submitted_count: parseInt(bids.bids_submitted_count || "0", 10),
            bids_submitted_value: parseRaw(bids.bids_submitted_value),
            bids_won_count:       parseInt(bids.bids_won_count || "0", 10),
            bids_won_value:       parseRaw(bids.bids_won_value),
            notes:                bids.notes || null,
          }),
        }),
        fetch("/api/weekly-notes", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            week_ending: date,
            doc_link:    notes.doc_link  || null,
            summary:     notes.summary   || null,
          }),
        }),
      ]);

      const errors: string[] = [];
      if (!balRes.ok)  errors.push("Balances: " + (await balRes.json()).error);
      if (!bidRes.ok)  errors.push("Bids: "     + (await bidRes.json()).error);
      if (!noteRes.ok) errors.push("Notes: "    + (await noteRes.json()).error);

      if (errors.length > 0) {
        setSaveError(errors.join(" | "));
        return;
      }

      setToast("Week saved successfully!");
      setTimeout(() => router.push(`/weeks/${date}`), 1200);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

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
            <Link href={`/weeks/${date}`} className="hover:text-[#1B2A4A] hover:underline">
              {fmtDate(date)}
            </Link>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>Enter</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Enter Week: {fmtDate(date)}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Saving…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Save Week
            </>
          )}
        </button>
      </div>

      {saveError && (
        <div className="mb-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.293 4.293a1 1 0 011.414 0L21 13.586A2 2 0 0119.586 15H4.414A2 2 0 013 13.586l9.293-9.293z" />
          </svg>
          <span>{saveError}</span>
        </div>
      )}

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
      ) : (
        <div className="flex flex-col gap-5">
          {/* Trial Balance CSV Import */}
          <TrialBalanceImporter
            weekEnding={date}
            onImportComplete={() => {
              setLoading(true);
              loadBalances();
            }}
          />

          {/* Balance entry sections by category */}
          {categoryGroups.map((g) => (
            <CategoryEnterSection
              key={g.name}
              group={g}
              balanceMap={balanceMap}
              onBalanceChange={handleBalanceChange}
            />
          ))}

          {/* Bid Activity */}
          <div className="card">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Bid Activity</h2>
            </div>
            <div className="px-5 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Submitted Count</label>
                  <input
                    type="number"
                    min={0}
                    value={bids.bids_submitted_count}
                    onChange={(e) => setBids((b) => ({ ...b, bids_submitted_count: e.target.value }))}
                    placeholder="0"
                    className="input-field text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Submitted Value</label>
                  <MoneyInput
                    value={bids.bids_submitted_value}
                    onChange={(v) => setBids((b) => ({ ...b, bids_submitted_value: v }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Won Count</label>
                  <input
                    type="number"
                    min={0}
                    value={bids.bids_won_count}
                    onChange={(e) => setBids((b) => ({ ...b, bids_won_count: e.target.value }))}
                    placeholder="0"
                    className="input-field text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Won Value</label>
                  <MoneyInput
                    value={bids.bids_won_value}
                    onChange={(v) => setBids((b) => ({ ...b, bids_won_value: v }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Notes</label>
                <textarea
                  value={bids.notes}
                  onChange={(e) => setBids((b) => ({ ...b, notes: e.target.value }))}
                  placeholder="Optional bid activity notes…"
                  rows={3}
                  className="input-field resize-none"
                />
              </div>
            </div>
          </div>

          {/* Analysis Doc */}
          <div className="card">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Analysis Doc</h2>
            </div>
            <div className="px-5 py-5 flex flex-col gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Document URL</label>
                <input
                  type="url"
                  value={notes.doc_link}
                  onChange={(e) => setNotes((n) => ({ ...n, doc_link: e.target.value }))}
                  placeholder="https://docs.google.com/…"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Summary / Notes</label>
                <textarea
                  value={notes.summary}
                  onChange={(e) => setNotes((n) => ({ ...n, summary: e.target.value }))}
                  placeholder="Key observations, highlights, concerns for the week…"
                  rows={5}
                  className="input-field resize-y"
                />
              </div>
            </div>
          </div>

          {/* Bottom save bar */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-sm -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
            <Link href={`/weeks/${date}`} className="btn-secondary">
              Cancel
            </Link>
            <div className="flex items-center gap-3">
              {saveError && (
                <span className="text-xs text-red-600 max-w-xs truncate">{saveError}</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="btn-primary flex items-center gap-2"
              >
                {saving ? "Saving…" : "Save Week"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast("")} />}
    </div>
  );
}
