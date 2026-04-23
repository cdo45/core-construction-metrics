"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExcludedAccount {
  basic_account_no: string;
  division: string;
  description: string;
  tx_count: number;
  total_dr: number;
  total_cr: number;
  first_seen: string;
  last_seen: string;
  weeks_affected: number;
  sources: string[];
}

interface Category {
  id: number;
  name: string;
  sort_order: number;
  color: string;
}

interface Props {
  onActivated?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

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
      style={{ animation: "fadeOut 4s forwards" }}
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

// ─── Modal shell ──────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Activate Modal ───────────────────────────────────────────────────────────

function ActivateModal({
  acct,
  categories,
  onClose,
  onActivated,
}: {
  acct: ExcludedAccount;
  categories: Category[];
  onClose: () => void;
  onActivated: (msg: string) => void;
}) {
  const [description, setDescription] = useState(acct.description);
  const [categoryId, setCategoryId] = useState<string>("");
  const [normalBalance, setNormalBalance] = useState<"debit" | "credit">("debit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (!categoryId) {
      setError("Category is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/excluded-accounts/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basic_account_no: acct.basic_account_no,
          division: acct.division,
          category_id: parseInt(categoryId, 10),
          normal_balance: normalBalance,
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      onActivated(
        `Account activated. ${data.transactions_moved} transactions moved across ${data.weeks_backfilled} weeks.`
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const title = `Activate Account: ${acct.basic_account_no}${
    acct.division ? " / " + acct.division : ""
  } ${acct.description ? "— " + acct.description : ""}`;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="select-field"
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-2">Normal Balance</label>
          <div className="flex gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                value="debit"
                checked={normalBalance === "debit"}
                onChange={() => setNormalBalance("debit")}
              />
              Debit
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                value="credit"
                checked={normalBalance === "credit"}
                onChange={() => setNormalBalance("credit")}
              />
              Credit
            </label>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600">
          Will move <span className="font-semibold text-gray-900">{acct.tx_count}</span>{" "}
          transaction{acct.tx_count === 1 ? "" : "s"} and backfill{" "}
          <span className="font-semibold text-gray-900">{acct.weeks_affected}</span>{" "}
          week{acct.weeks_affected === 1 ? "" : "s"} of history (plus any later weeks).
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary">
            {saving ? "Activating…" : "Activate & Backfill"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

export default function ExcludedAccountsTable({ onActivated }: Props) {
  const [rows, setRows] = useState<ExcludedAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTarget, setModalTarget] = useState<ExcludedAccount | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err"; n: number } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [excRes, catRes] = await Promise.all([
        fetch("/api/excluded-accounts"),
        fetch("/api/categories"),
      ]);
      if (excRes.ok) setRows(await excRes.json());
      if (catRes.ok) setCategories(await catRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleActivated(msg: string) {
    setToast({ msg, kind: "ok", n: Date.now() });
    fetchData();
    onActivated?.();
  }

  if (loading) {
    return (
      <div className="card">
        <div className="px-6 py-10 text-center text-sm text-gray-500">Loading excluded accounts…</div>
      </div>
    );
  }

  return (
    <>
      {modalTarget && (
        <ActivateModal
          acct={modalTarget}
          categories={categories}
          onClose={() => setModalTarget(null)}
          onActivated={handleActivated}
        />
      )}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            Excluded Accounts ({rows.length} row{rows.length === 1 ? "" : "s"})
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Accounts that have appeared in imports but aren&apos;t tracked. Activate to start
            including them on dashboards. Activation backfills all historical weeks.
          </p>
        </div>

        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="px-6 py-6 text-sm text-gray-400 italic">
              No excluded accounts. Every imported row matched a tracked account.
            </p>
          ) : (
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr>
                  <th className="table-th w-24">Account #</th>
                  <th className="table-th w-16">Div</th>
                  <th className="table-th">Description</th>
                  <th className="table-th w-16 text-right">Tx</th>
                  <th className="table-th w-28 text-right">Total DR</th>
                  <th className="table-th w-28 text-right">Total CR</th>
                  <th className="table-th w-28">First Seen</th>
                  <th className="table-th w-28">Last Seen</th>
                  <th className="table-th w-16 text-right">Weeks</th>
                  <th className="table-th">Sources</th>
                  <th className="table-th w-28 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.basic_account_no}|${r.division}`} className="hover:bg-gray-50 border-t border-gray-100">
                    <td className="table-td font-mono text-xs text-gray-700">{r.basic_account_no}</td>
                    <td className="table-td font-mono text-xs text-gray-500">{r.division}</td>
                    <td className="table-td text-gray-800">{r.description || <span className="text-gray-400 italic">—</span>}</td>
                    <td className="table-td text-right tabular-nums">{r.tx_count}</td>
                    <td className="table-td text-right tabular-nums">{fmtMoney(r.total_dr)}</td>
                    <td className="table-td text-right tabular-nums">{fmtMoney(r.total_cr)}</td>
                    <td className="table-td text-xs text-gray-600">{fmtDate(r.first_seen)}</td>
                    <td className="table-td text-xs text-gray-600">{fmtDate(r.last_seen)}</td>
                    <td className="table-td text-right tabular-nums">{r.weeks_affected}</td>
                    <td className="table-td text-xs text-gray-500 truncate max-w-[200px]" title={r.sources.join(", ")}>
                      {r.sources.join(", ")}
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setModalTarget(r)}
                        className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-[#1B2A4A] text-white hover:bg-[#2a3d65] transition-colors"
                      >
                        + Activate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && (
        <Toast key={toast.n} msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />
      )}
    </>
  );
}
