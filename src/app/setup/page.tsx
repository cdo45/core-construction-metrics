"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Cash Safety Floor Section ────────────────────────────────────────────────

function CashSafetyFloorSection() {
  const [value,  setValue]  = useState("");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  useEffect(() => {
    fetch("/api/app-settings?key=cash_safety_floor")
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json() as { key: string; value: string };
          setValue(d.value ?? "500000");
        } else {
          setValue("500000");
        }
      })
      .catch(() => setValue("500000"));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cash_safety_floor", value }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Failed to save.");
      } else {
        setSaved(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Cash Safety Floor</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Minimum cash to maintain — runway calculations stop here, not zero.
        </p>
      </div>
      <div className="px-6 py-4">
        <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className="block text-xs text-gray-600 mb-1">Safety Floor ($)</label>
            <input
              type="number"
              value={value}
              onChange={(e) => { setValue(e.target.value); setSaved(false); }}
              placeholder="500000"
              className="input-field"
              min={0}
              step={1000}
              required
            />
          </div>
          <div>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {saved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </form>
      </div>
    </div>
  );
}

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

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Categories</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          GL account groupings shown on the dashboard.
        </p>
      </div>

      {/* Category list */}
      <div className="px-6 py-4">
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No categories yet. Add one using the form below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
              >
                <ColorDot color={cat.color} />
                <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                <ColorBadge name={`#${cat.id}`} color={cat.color} />
              </div>
            ))}
          </div>
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

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string>("");
  const [editDesc, setEditDesc] = useState("");
  const [editBalance, setEditBalance] = useState<"debit" | "credit">("debit");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

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

  function startEdit(acc: GlAccount) {
    setEditingId(acc.id);
    setEditCategoryId(acc.category_id ? String(acc.category_id) : "");
    setEditDesc(acc.description);
    setEditBalance(acc.normal_balance);
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }

  async function saveEdit(id: number) {
    setEditSaving(true);
    setEditError("");
    try {
      const res = await fetch("/api/gl-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          description: editDesc.trim(),
          normal_balance: editBalance,
          category_id: editCategoryId ? parseInt(editCategoryId, 10) : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setEditError(d.error ?? "Update failed.");
      } else {
        setEditingId(null);
        onRefresh();
      }
    } catch (e) {
      setEditError(String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(acc: GlAccount) {
    try {
      await fetch("/api/gl-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: acc.id, is_active: !acc.is_active }),
      });
      onRefresh();
    } catch {
      // ignore
    }
  }

  return (
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
              accounts.map((acc) => {
                const isEditing = editingId === acc.id;
                return (
                  <tr key={acc.id} className={`group ${!acc.is_active ? "opacity-50" : ""}`}>
                    {/* Account # */}
                    <td className="table-td font-mono font-medium text-gray-900">
                      {acc.account_no}
                    </td>

                    {/* Description */}
                    <td className="table-td">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="input-field"
                        />
                      ) : (
                        <span>{acc.description}</span>
                      )}
                    </td>

                    {/* Normal Balance */}
                    <td className="table-td">
                      {isEditing ? (
                        <select
                          value={editBalance}
                          onChange={(e) =>
                            setEditBalance(e.target.value as "debit" | "credit")
                          }
                          className="select-field"
                        >
                          <option value="debit">Debit</option>
                          <option value="credit">Credit</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            acc.normal_balance === "debit"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-purple-50 text-purple-700"
                          }`}
                        >
                          {acc.normal_balance}
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="table-td">
                      {isEditing ? (
                        <select
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className="select-field"
                        >
                          <option value="">— None —</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : acc.category_name ? (
                        <ColorBadge
                          name={acc.category_name}
                          color={acc.category_color ?? "#666"}
                        />
                      ) : (
                        <span className="text-gray-400 text-xs italic">Unassigned</span>
                      )}
                    </td>

                    {/* Active toggle */}
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

                    {/* Actions */}
                    <td className="table-td text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => saveEdit(acc.id)}
                            disabled={editSaving}
                            className="text-xs btn-primary py-1 px-2"
                          >
                            {editSaving ? "…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs btn-secondary py-1 px-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(acc)}
                          className="text-xs text-[#1B2A4A] hover:underline font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editError && (
        <p className="px-6 py-2 text-xs text-red-600">{editError}</p>
      )}

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
      {/* Page header */}
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
          <CashSafetyFloorSection />
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
