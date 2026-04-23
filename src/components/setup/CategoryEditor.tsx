"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

const LS_KEY = "setup_category_editor_collapsed";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EditorCategory {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface EditorAccount {
  id: number;
  account_no: number;
  division?: string | null;
  description: string;
  normal_balance: "debit" | "credit";
  category_id: number | null;
  is_active: boolean;
}

interface Props {
  accounts: EditorAccount[];
  categories: EditorCategory[];
  onAccountUpdated: (updated: EditorAccount) => void;
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({
  msg,
  kind,
  onDone,
}: {
  msg: string;
  kind: "ok" | "err";
  onDone: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium ${
        kind === "ok" ? "bg-[#1B2A4A] text-white" : "bg-red-600 text-white"
      }`}
      onAnimationEnd={onDone}
      style={{ animation: "fadeOut 3s forwards" }}
    >
      {msg}
      <style jsx>{`
        @keyframes fadeOut {
          0%, 80% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function CategoryEditor({
  accounts,
  categories,
  onAccountUpdated,
}: Props) {
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState<number | "all">("all");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err"; n: number } | null>(null);
  // Default collapsed. Hydrated from localStorage after mount.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
      if (raw !== null) setCollapsed(raw === "true");
    } catch {
      // ignore
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LS_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Category pills counts
  const countByCat = useMemo(() => {
    const map = new Map<number | "null", number>();
    for (const a of accounts) {
      const k = (a.category_id ?? "null") as number | "null";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [accounts]);

  // Filter accounts
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return accounts.filter((a) => {
      if (catFilter !== "all") {
        const target = catFilter === -1 ? null : catFilter;
        if (a.category_id !== target) return false;
      }
      if (!q) return true;
      return (
        String(a.account_no).includes(q) ||
        (a.division ?? "").toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, catFilter]);

  async function saveCategory(acc: EditorAccount, newCatId: number | null) {
    setSavingId(acc.id);
    try {
      const res = await fetch(`/api/gl-accounts/${acc.id}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: newCatId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onAccountUpdated({
        ...acc,
        category_id: newCatId,
      });
      setToast({ msg: `Updated ${acc.account_no}`, kind: "ok", n: Date.now() });
    } catch (e) {
      setToast({ msg: `Failed to update ${acc.account_no}: ${e instanceof Error ? e.message : String(e)}`, kind: "err", n: Date.now() });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
        )}
        <h2 className="text-base font-semibold text-gray-900">
          Account Categorization ({accounts.length} account{accounts.length === 1 ? "" : "s"})
        </h2>
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ${
          collapsed ? "max-h-0 opacity-0" : "max-h-[20000px] opacity-100"
        }`}
      >
      <div className="px-6 pb-4 pt-3 border-t border-gray-200 flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Heads up:</strong> Changing an account&apos;s category retroactively reclassifies
        all historical data on dashboards and reports. This does not touch the underlying GL or
        Foundation data. Changes take effect on the next dashboard load.
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCatFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium border ${
            catFilter === "all"
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          All {accounts.length}
        </button>
        {categories
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((cat) => {
            const count = countByCat.get(cat.id) ?? 0;
            const selected = catFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCatFilter(cat.id)}
                className="px-3 py-1 rounded-full text-xs font-medium border text-white"
                style={{
                  backgroundColor: selected ? cat.color : "white",
                  color: selected ? "white" : cat.color,
                  borderColor: cat.color,
                }}
              >
                {cat.name} {count}
              </button>
            );
          })}
        {(countByCat.get("null") ?? 0) > 0 && (
          <button
            onClick={() => setCatFilter(-1)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              catFilter === -1
                ? "bg-gray-500 text-white border-gray-500"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            Uncategorized {countByCat.get("null") ?? 0}
          </button>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search account #, division, or description…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input-field max-w-md"
      />

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="table-th w-24">Account #</th>
              <th className="table-th w-20">Div</th>
              <th className="table-th">Description</th>
              <th className="table-th w-56">Category</th>
              <th className="table-th w-20">Normal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400 italic">
                  No accounts match.
                </td>
              </tr>
            ) : (
              filtered.map((acc) => (
                <tr key={acc.id} className="hover:bg-gray-50 border-t border-gray-100">
                  <td className="table-td font-mono text-xs text-gray-600">{acc.account_no}</td>
                  <td className="table-td font-mono text-xs text-gray-500">{acc.division ?? ""}</td>
                  <td className="table-td text-gray-800">{acc.description}</td>
                  <td className="table-td">
                    <div className="flex items-center gap-2">
                      <select
                        value={acc.category_id ?? ""}
                        disabled={savingId === acc.id}
                        onChange={(e) => {
                          const v = e.target.value;
                          saveCategory(acc, v === "" ? null : parseInt(v, 10));
                        }}
                        className="input-field text-sm py-1"
                      >
                        <option value="">Uncategorized</option>
                        {categories
                          .slice()
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      {savingId === acc.id && (
                        <svg className="animate-spin w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                      )}
                    </div>
                  </td>
                  <td className="table-td text-xs text-gray-500 uppercase">{acc.normal_balance}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
      </div>

      {toast && (
        <Toast
          key={toast.n}
          msg={toast.msg}
          kind={toast.kind}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
