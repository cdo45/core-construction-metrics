"use client";

import { useEffect, useState, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";
import CategoryEditor from "@/components/setup/CategoryEditor";
import ExcludedAccountsTable from "@/components/setup/ExcludedAccountsTable";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  sort_order: number;
  color: string;
}

interface GlAccount {
  id: number;
  account_no: number;
  description: string;
  normal_balance: "debit" | "credit";
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  is_active: boolean;
  balance_count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ColorBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {name}
    </span>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

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

// ─── Category edit modal ──────────────────────────────────────────────────────

function CategoryEditModal({
  cat,
  onClose,
  onSaved,
}: {
  cat: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [sortOrder, setSortOrder] = useState(String(cat.sort_order));
  const [color, setColor] = useState(cat.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sort_order: sortOrder ? parseInt(sortOrder, 10) : 0,
          color,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed.");
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit Category" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Sort Order</label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="input-field"
            min={0}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-9 h-9 cursor-pointer rounded border border-gray-300 p-0.5 bg-white"
            />
            <span className="text-xs font-mono text-gray-500">{color}</span>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── GL account edit modal ────────────────────────────────────────────────────

function GlAccountEditModal({
  acc,
  categories,
  balanceWeeks,
  onClose,
  onSaved,
}: {
  acc: GlAccount;
  categories: Category[];
  balanceWeeks: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountNo, setAccountNo] = useState(String(acc.account_no));
  const [description, setDescription] = useState(acc.description);
  const [normalBalance, setNormalBalance] = useState<"debit" | "credit">(acc.normal_balance);
  const [categoryId, setCategoryId] = useState(acc.category_id ? String(acc.category_id) : "");
  const [isActive, setIsActive] = useState(acc.is_active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const accountNoLocked = balanceWeeks > 0;

  async function handleSave() {
    if (!description.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        description: description.trim(),
        normal_balance: normalBalance,
        category_id: categoryId ? parseInt(categoryId, 10) : null,
        is_active: isActive,
      };
      if (!accountNoLocked) {
        body.account_no = parseInt(accountNo, 10);
      }
      const res = await fetch(`/api/gl-accounts/${acc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed.");
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit GL Account" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Account #</label>
          <input
            type="number"
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value)}
            className="input-field"
            disabled={accountNoLocked}
          />
          {accountNoLocked && (
            <p className="mt-1 text-xs text-amber-600">
              Account # locked — {balanceWeeks} week{balanceWeeks === 1 ? "" : "s"} of data reference this account.
            </p>
          )}
        </div>
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
          <label className="block text-xs text-gray-600 mb-1">Normal Balance</label>
          <select
            value={normalBalance}
            onChange={(e) => setNormalBalance(e.target.value as "debit" | "credit")}
            className="select-field"
          >
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="select-field"
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="edit-is-active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="edit-is-active" className="text-sm text-gray-700">
            Active
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Categories Section ───────────────────────────────────────────────────────

function CategoriesSection({
  categories,
  onRefresh,
}: {
  categories: Category[];
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4472C4");
  const [sortOrder, setSortOrder] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Edit modal state
  const [editTarget, setEditTarget] = useState<Category | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          color,
          sort_order: sortOrder ? parseInt(sortOrder, 10) : 0,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to add category.");
      } else {
        setName("");
        setSortOrder("");
        setColor("#4472C4");
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cat: Category) {
    if (!window.confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "Delete failed.");
    } else {
      onRefresh();
    }
  }

  return (
    <>
      {editTarget && (
        <CategoryEditModal
          cat={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={onRefresh}
        />
      )}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Categories</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            GL account groupings shown on the dashboard.
          </p>
        </div>

        {/* Category table */}
        <div className="overflow-x-auto">
          {categories.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-400 italic">
              No categories yet. Add one using the form below.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th w-16">Order</th>
                  <th className="table-th">Name</th>
                  <th className="table-th w-24">Color</th>
                  <th className="table-th w-24 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.id} className="group">
                    <td className="table-td text-gray-500 text-sm">{cat.sort_order}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                        <ColorDot color={cat.color} />
                        <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                      </div>
                    </td>
                    <td className="table-td font-mono text-xs text-gray-500">{cat.color}</td>
                    <td className="table-td">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditTarget(cat)}
                          title="Edit"
                          className="text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(cat)}
                          title="Delete"
                          className="text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add category form */}
        <div className="px-6 pb-6 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Add Category
          </p>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-600 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Equipment"
                className="input-field"
                required
              />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-600 mb-1">Sort Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="0"
                className="input-field"
                min={0}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="block text-xs text-gray-600">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-9 h-9 cursor-pointer rounded border border-gray-300 p-0.5 bg-white"
                />
                <span className="text-xs font-mono text-gray-500">{color}</span>
              </div>
            </div>
            <div>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? "Adding…" : "Add Category"}
              </button>
            </div>
          </form>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </>
  );
}

// ─── GL Accounts Section ──────────────────────────────────────────────────────

function GlAccountsSection({
  accounts,
  categories,
  onRefresh,
}: {
  accounts: GlAccount[];
  categories: Category[];
  onRefresh: () => void;
}) {
  // Add account form state
  const [formAccountNo, setFormAccountNo] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formBalance, setFormBalance] = useState<"debit" | "credit">("debit");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Edit modal state
  const [editTarget, setEditTarget] = useState<GlAccount | null>(null);
  const [editBalanceWeeks, setEditBalanceWeeks] = useState(0);

  function openEdit(acc: GlAccount) {
    setEditBalanceWeeks(acc.balance_count);
    setEditTarget(acc);
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/gl-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_no: parseInt(formAccountNo, 10),
          description: formDesc.trim(),
          normal_balance: formBalance,
          category_id: formCategoryId ? parseInt(formCategoryId, 10) : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error ?? "Failed to add account.");
      } else {
        setFormAccountNo("");
        setFormDesc("");
        setFormBalance("debit");
        setFormCategoryId("");
        onRefresh();
      }
    } catch (e) {
      setFormError(String(e));
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(acc: GlAccount) {
    if (!window.confirm(`Delete "${acc.description}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/gl-accounts/${acc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "Delete failed.");
    } else {
      onRefresh();
    }
  }

  async function toggleActive(acc: GlAccount) {
    try {
      await fetch(`/api/gl-accounts/${acc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: acc.description,
          normal_balance: acc.normal_balance,
          category_id: acc.category_id,
          is_active: !acc.is_active,
        }),
      });
      onRefresh();
    } catch {
      // ignore
    }
  }

  return (
    <>
      {editTarget && (
        <GlAccountEditModal
          acc={editTarget}
          categories={categories}
          balanceWeeks={editBalanceWeeks}
          onClose={() => setEditTarget(null)}
          onSaved={onRefresh}
        />
      )}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">GL Accounts</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage chart of accounts, normal balances, and category assignments.
          </p>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className="table-th w-24">Account #</th>
                <th className="table-th">Description</th>
                <th className="table-th w-28">Normal Balance</th>
                <th className="table-th w-44">Category</th>
                <th className="table-th w-20 text-center">Active</th>
                <th className="table-th w-24 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400 italic">
                    No GL accounts yet. Add one using the form below.
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
                  <tr key={acc.id} className={`group ${!acc.is_active ? "opacity-50" : ""}`}>
                    <td className="table-td font-mono font-medium text-gray-900">
                      {acc.account_no}
                    </td>
                    <td className="table-td">{acc.description}</td>
                    <td className="table-td">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          acc.normal_balance === "debit"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {acc.normal_balance}
                      </span>
                    </td>
                    <td className="table-td">
                      {acc.category_name ? (
                        <ColorBadge
                          name={acc.category_name}
                          color={acc.category_color ?? "#666"}
                        />
                      ) : (
                        <span className="text-gray-400 text-xs italic">Unassigned</span>
                      )}
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => toggleActive(acc)}
                        title={acc.is_active ? "Deactivate" : "Activate"}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          acc.is_active ? "bg-[#1B2A4A]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            acc.is_active ? "translate-x-4" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="table-td">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(acc)}
                          title="Edit"
                          className="text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(acc)}
                          title="Delete"
                          className="text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Add Account Form */}
        <div className="px-6 pb-6 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Add GL Account
          </p>
          <form onSubmit={handleAddAccount} className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <label className="block text-xs text-gray-600 mb-1">Account #</label>
              <input
                type="number"
                value={formAccountNo}
                onChange={(e) => setFormAccountNo(e.target.value)}
                placeholder="1010"
                className="input-field"
                required
                min={1}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <input
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="e.g. Checking Account"
                className="input-field"
                required
              />
            </div>
            <div className="w-36">
              <label className="block text-xs text-gray-600 mb-1">Normal Balance</label>
              <select
                value={formBalance}
                onChange={(e) => setFormBalance(e.target.value as "debit" | "credit")}
                className="select-field"
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <div className="w-44">
              <label className="block text-xs text-gray-600 mb-1">Category</label>
              <select
                value={formCategoryId}
                onChange={(e) => setFormCategoryId(e.target.value)}
                className="select-field"
              >
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button type="submit" disabled={formSaving} className="btn-primary">
                {formSaving ? "Adding…" : "Add Account"}
              </button>
            </div>
          </form>
          {formError && <p className="mt-2 text-xs text-red-600">{formError}</p>}
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [catRes, accRes] = await Promise.all([
        fetch("/api/categories"),
        fetch("/api/gl-accounts"),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (accRes.ok) setAccounts(await accRes.json());
    } catch {
      // errors surfaced per-section
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure categories and GL accounts for weekly reporting.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span className="text-sm">Loading…</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <ExcludedAccountsTable onActivated={fetchData} />
          <CategoryEditor
            accounts={accounts}
            categories={categories}
            onAccountUpdated={(u) =>
              setAccounts((prev) =>
                prev.map((a) => (a.id === u.id ? { ...a, category_id: u.category_id } : a))
              )
            }
          />
          <CategoriesSection categories={categories} onRefresh={fetchData} />
          <GlAccountsSection
            accounts={accounts}
            categories={categories}
            onRefresh={fetchData}
          />
        </div>
      )}
    </div>
  );
}
