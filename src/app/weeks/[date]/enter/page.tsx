"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CSVImporter from "@/components/CSVImporter";
import OverheadCSVImporter from "@/components/OverheadCSVImporter";
import OverheadCategoryCard, { type OverheadRow } from "@/components/OverheadCategoryCard";

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

interface CategoryGroup {
  name: string;
  color: string;
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

/**
 * Format a value as a comma-separated dollar amount with exactly 2 decimal
 * places.  Accepts either a string (possibly already comma-formatted) or a
 * number — Neon may return NUMERIC columns as JS numbers in some driver
 * versions, so we normalise here.
 */
function formatDisplay(raw: string | number): string {
  const str = String(raw).replace(/,/g, "");
  const n = parseFloat(str);
  if (isNaN(n)) return String(raw);
  const neg = n < 0;
  const abs = Math.abs(n);
  // Use the original stripped string to avoid float→string precision bleed
  // (e.g. parseFloat("9987.74") === 9987.74 but String(9987.74) might differ
  // for edge-case values; toFixed(2) on the abs value is the canonical fix).
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + parts.join(".");
}

/**
 * Strip commas and parse to a float for submission.  Accepts string or number
 * so callers don't need to pre-convert API responses.
 */
function parseRaw(s: string | number): number {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

// ─── Money Input ─────────────────────────────────────────────────────────────

function MoneyInput({
  value,
  onChange,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFocus() {
    setFocused(true);
    // Show raw number (no commas) on focus
    const raw = value.replace(/,/g, "");
    onChange(raw);
    // Select all after paint
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function handleBlur() {
    setFocused(false);
    // Use the already-stripped string directly — avoids float→String(n) round-
    // trip which can introduce precision noise for certain decimal values.
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
      onChange={(e) => onChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className="input-field text-right tabular-nums"
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

// ─── Balance row state (keyed by gl_account_id) ───────────────────────────────

type BalanceMap = Record<number, { beg: string; end: string }>;

// ─── Category Section ─────────────────────────────────────────────────────────

function CategoryEnterSection({
  group,
  balanceMap,
  onBalanceChange,
}: {
  group: CategoryGroup;
  balanceMap: BalanceMap;
  onBalanceChange: (id: number, field: "beg" | "end", val: string) => void;
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
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th className="table-th w-24">Account #</th>
                <th className="table-th">Description</th>
                <th className="table-th w-40 text-right pr-4">Beg Balance</th>
                <th className="table-th w-40 text-right pr-4">End Balance</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const vals = balanceMap[row.gl_account_id] ?? { beg: "0.00", end: "0.00" };
                return (
                  <tr key={row.gl_account_id} className="hover:bg-gray-50">
                    <td className="table-td font-mono text-xs text-gray-500 align-middle">
                      {row.account_no}
                    </td>
                    <td className="table-td text-gray-800 align-middle">
                      {row.description}
                    </td>
                    <td className="table-td align-middle" style={{ width: 160 }}>
                      <MoneyInput
                        value={vals.beg}
                        onChange={(v) => onBalanceChange(row.gl_account_id, "beg", v)}
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
  const [overheadRows, setOverheadRows] = useState<OverheadRow[]>([]);
  const [overheadVersion, setOverheadVersion] = useState(0);

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

  // ── Load current week data + prior week end_balances ──────────────────────

  const buildGroups = useCallback((rows: BalanceRow[]) => {
    const groups: CategoryGroup[] = [];
    const seen = new Map<string, CategoryGroup>();
    for (const row of rows) {
      const name = row.category_name ?? "Uncategorized";
      const color = row.category_color ?? "#6B7280";
      if (!seen.has(name)) {
        const g: CategoryGroup = { name, color, rows: [] };
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
        const begFromPrior = priorEndMap[row.gl_account_id];
        // parseRaw handles both string ("9987.74") and number (9987.74) from Neon
        const hasCurrentData =
          parseRaw(row.beg_balance) !== 0 || parseRaw(row.end_balance) !== 0;

        map[row.gl_account_id] = {
          beg: hasCurrentData
            ? formatDisplay(row.beg_balance)
            : begFromPrior !== undefined
            ? formatDisplay(begFromPrior)
            : "0.00",
          end: formatDisplay(row.end_balance),
        };
      }
      return map;
    },
    []
  );

  const loadOverhead = useCallback(async () => {
    try {
      const res = await fetch(`/api/weekly-overhead?week_ending=${date}`);
      if (res.ok) {
        const data = await res.json() as { accounts?: OverheadRow[] };
        setOverheadRows(data.accounts ?? []);
        setOverheadVersion((v) => v + 1);
      }
    } catch {
      // silently ignore
    }
  }, [date]);

  const loadBalances = useCallback(async () => {
    try {
      const [curRes, priorRes, bidRes, noteRes, overheadRes] = await Promise.all([
        fetch(`/api/weekly-balances?week_ending=${date}`),
        fetch(`/api/weekly-balances?week_ending=${date}&prior=1`),
        fetch(`/api/bid-activity?week_ending=${date}`),
        fetch(`/api/weekly-notes?week_ending=${date}`),
        fetch(`/api/weekly-overhead?week_ending=${date}`),
      ]);

      const curData = curRes.ok ? await curRes.json() : { balances: [] };
      const priorData = priorRes.ok ? await priorRes.json() : { balances: [] };

      const rows: BalanceRow[] = curData.balances ?? [];
      const priorBalances: BalanceRow[] = priorData.balances ?? [];

      // Build prior end balance map for beg_balance auto-fill
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
            bids_won_count: String(bidData.bids_won_count ?? ""),
            bids_won_value: formatDisplay(String(bidData.bids_won_value ?? "0")),
            notes: bidData.notes ?? "",
          });
        }
      }

      if (noteRes.ok) {
        const noteData = await noteRes.json();
        if (noteData) {
          setNotes({ doc_link: noteData.doc_link ?? "", summary: noteData.summary ?? "" });
        }
      }

      if (overheadRes.ok) {
        const overheadData = await overheadRes.json() as { accounts?: OverheadRow[] };
        setOverheadRows(overheadData.accounts ?? []);
        setOverheadVersion((v) => v + 1);
      }
    } finally {
      setLoading(false);
    }
  }, [date, buildGroups, initBalanceMap]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // ── Copy Prior Week ───────────────────────────────────────────────────────

  async function handleCopyPrior() {
    try {
      const priorRes = await fetch(`/api/weekly-balances?week_ending=${date}&prior=1`);
      if (!priorRes.ok) return;
      const priorData = await priorRes.json();
      const priorBalances: BalanceRow[] = priorData.balances ?? [];

      setBalanceMap((prev) => {
        const next = { ...prev };
        for (const b of priorBalances) {
          next[b.gl_account_id] = {
            beg: formatDisplay(b.beg_balance),
            end: formatDisplay(b.end_balance),
          };
        }
        return next;
      });
    } catch {
      // silently ignore
    }
  }

  // ── Handle balance change ─────────────────────────────────────────────────

  function handleBalanceChange(id: number, field: "beg" | "end", val: string) {
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
        beg_balance: parseRaw(balanceMap[acc.gl_account_id]?.beg ?? "0"),
        end_balance: parseRaw(balanceMap[acc.gl_account_id]?.end ?? "0"),
      }));

      const [balRes, bidRes, noteRes] = await Promise.all([
        fetch("/api/weekly-balances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week_ending: date, balances: balancesPayload }),
        }),
        fetch("/api/bid-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            week_ending: date,
            bids_submitted_count: parseInt(bids.bids_submitted_count || "0", 10),
            bids_submitted_value: parseRaw(bids.bids_submitted_value),
            bids_won_count: parseInt(bids.bids_won_count || "0", 10),
            bids_won_value: parseRaw(bids.bids_won_value),
            notes: bids.notes || null,
          }),
        }),
        fetch("/api/weekly-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            week_ending: date,
            doc_link: notes.doc_link || null,
            summary: notes.summary || null,
          }),
        }),
      ]);

      const errors: string[] = [];
      if (!balRes.ok) errors.push("Balances: " + (await balRes.json()).error);
      if (!bidRes.ok) errors.push("Bids: " + (await bidRes.json()).error);
      if (!noteRes.ok) errors.push("Notes: " + (await noteRes.json()).error);

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
        <div className="flex gap-2">
          <button
            onClick={handleCopyPrior}
            className="btn-secondary flex items-center gap-2"
            title="Fill all fields from the most recent prior week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy Prior Week
          </button>
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
          {/* Full GL CSV Import */}
          <CSVImporter
            weekEnding={date}
            onImportComplete={() => {
              setLoading(true);
              loadBalances();
            }}
          />

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 whitespace-nowrap">Overhead (separate import)</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* DIV 99 Overhead GL Import */}
          <OverheadCSVImporter
            weekEnding={date}
            onImportComplete={() => {
              setLoading(true);
              loadBalances();
            }}
          />

          {/* Overhead manual entry */}
          <OverheadCategoryCard
            key={overheadVersion}
            rows={overheadRows}
            weekEnding={date}
            onSaveComplete={loadOverhead}
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
