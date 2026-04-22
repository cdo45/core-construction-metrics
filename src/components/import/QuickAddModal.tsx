"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  color: string;
}

const ACCOUNT_TYPES = [
  { value: "balance",   label: "Balance Sheet" },
  { value: "revenue",   label: "Revenue" },
  { value: "labor",     label: "Labor" },
  { value: "materials", label: "Materials" },
  { value: "subs",      label: "Subcontractors" },
  { value: "equipment", label: "Equipment" },
  { value: "overhead",  label: "Overhead" },
  { value: "other",     label: "Other" },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface QuickAddModalProps {
  isOpen: boolean;
  accountNo: number;
  division: string;
  description: string;
  onClose: () => void;
  onAdded: (categoryName: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuickAddModal({
  isOpen,
  accountNo,
  division,
  description: initialDescription,
  onClose,
  onAdded,
}: QuickAddModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [desc, setDesc] = useState(initialDescription);
  const [normalBalance, setNormalBalance] = useState<"debit" | "credit">("debit");
  const [accountType, setAccountType] = useState<string>("other");
  const [categoryId, setCategoryId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset form when opened for a new row
  useEffect(() => {
    if (isOpen) {
      setDesc(initialDescription);
      setNormalBalance("debit");
      setAccountType("other");
      setCategoryId("");
      setError("");
    }
  }, [isOpen, initialDescription]);

  // Load categories once
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(() => {});
  }, []);

  if (!isOpen) return null;

  async function handleSave() {
    if (!categoryId) {
      setError("Please select a category.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/gl-accounts/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNo,
          division,
          description: desc.trim(),
          normalBalance,
          accountType,
          categoryId: parseInt(categoryId, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      const cat = categories.find((c) => c.id === parseInt(categoryId, 10));
      onAdded(cat?.name ?? "category");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Add to Category</h3>
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

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Read-only identifiers */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Account #</label>
              <div className="input-field bg-gray-50 text-gray-600 select-none">{accountNo}</div>
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-500 mb-1">Division</label>
              <div className="input-field bg-gray-50 text-gray-600 select-none">
                {division || "(blank)"}
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Description</label>
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="input-field"
              required
            />
          </div>

          {/* Normal Balance */}
          <div>
            <label className="block text-xs text-gray-600 mb-2">Normal Balance</label>
            <div className="flex items-center gap-6">
              {(["debit", "credit"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="normalBalance"
                    value={v}
                    checked={normalBalance === v}
                    onChange={() => setNormalBalance(v)}
                    className="accent-[#1B2A4A]"
                  />
                  <span className="text-sm text-gray-700 capitalize">{v}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Account Type */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Account Type</label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="select-field"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs text-gray-600 mb-1">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="select-field"
            >
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
