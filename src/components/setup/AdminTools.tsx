"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

const LS_KEY = "setup_admin_tools_collapsed";

type JsonValue = unknown;

function ResultPanel({ title, value }: { title: string; value: JsonValue }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-gray-500 mb-1">{title}</div>
      <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-80">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ReseedCard() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JsonValue>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csv_text = await file.text();
      const res = await fetch("/api/admin/reseed-yearend-2024", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_text }),
      });
      const json = await res.json();
      setResult(json);
      if (!res.ok) setError(`HTTP ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Re-seed 12/31/24 Baseline
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Upload the authoritative Foundation BS CSV. Overwrites
        weekly_balances.end_balance for week_ending 2024-12-31. Signed-storage
        sign convention applied (debit-normal positive, credit-normal negative).
      </p>
      <div className="flex flex-col gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="text-sm"
        />
        <div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !file}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? "Re-seeding…" : "Upload + Re-seed"}
          </button>
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <ResultPanel title="Response" value={result} />
      </div>
    </div>
  );
}

function WipeRangeCard() {
  const [startDate, setStartDate] = useState("2025-01-04");
  const [endDate, setEndDate] = useState("2026-04-18");
  const [confirmText, setConfirmText] = useState("");
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyCommit, setBusyCommit] = useState(false);
  const [previewResult, setPreviewResult] = useState<JsonValue>(null);
  const [commitResult, setCommitResult] = useState<JsonValue>(null);
  const [error, setError] = useState<string | null>(null);

  async function postWipe(confirm: boolean) {
    setError(null);
    if (confirm) {
      setBusyCommit(true);
      setCommitResult(null);
    } else {
      setBusyPreview(true);
      setPreviewResult(null);
    }
    try {
      const res = await fetch("/api/admin/wipe-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          confirm,
        }),
      });
      const json = await res.json();
      if (confirm) setCommitResult(json);
      else setPreviewResult(json);
      if (!res.ok) setError(`HTTP ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyPreview(false);
      setBusyCommit(false);
    }
  }

  const commitEnabled = confirmText === "WIPE" && !busyCommit;

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Wipe Date Range
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Deletes weekly_transactions in range and zeros period_debit /
        period_credit on weekly_balances rows in range. Does NOT touch
        end_balance — run cascade after import to rebuild the chain.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col text-xs text-gray-700">
            <span className="mb-1">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-700">
            <span className="mb-1">End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </label>
        </div>

        <div>
          <button
            type="button"
            onClick={() => postWipe(false)}
            disabled={busyPreview}
            className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {busyPreview ? "Previewing…" : "Preview"}
          </button>
        </div>
        <ResultPanel title="Preview response" value={previewResult} />

        <div className="border-t border-gray-200 pt-3 mt-1">
          <div className="text-xs text-gray-700 mb-2">
            Type <span className="font-mono font-bold">WIPE</span> to enable
            commit:
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="WIPE"
              className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-32"
            />
            <button
              type="button"
              onClick={() => postWipe(true)}
              disabled={!commitEnabled}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-30"
            >
              {busyCommit ? "Wiping…" : "Commit Wipe"}
            </button>
          </div>
        </div>
        <ResultPanel title="Commit response" value={commitResult} />

        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}

function CascadeCard() {
  const [startDate, setStartDate] = useState("2025-01-04");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JsonValue>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cascade-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate }),
      });
      const json = await res.json();
      setResult(json);
      if (!res.ok) setError(`HTTP ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Cascade Balances
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Rewrites beg_balance / end_balance for every week from start_date
        forward using the signed-storage formula end = beg + period_debit -
        period_credit. P&amp;L categories (6,7,8,9) reset to 0 at fiscal-year
        boundaries.
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col text-xs text-gray-700">
          <span className="mb-1">Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <div>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? "Cascading…" : "Run Cascade"}
          </button>
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <ResultPanel title="Response" value={result} />
      </div>
    </div>
  );
}

export default function AdminTools() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(LS_KEY) !== "false";
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY, next ? "true" : "false");
      }
      return next;
    });
  }

  return (
    <section className="card">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-200 text-left"
      >
        <div>
          <h2 className="text-base font-semibold text-gray-900">Admin Tools</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Destructive recovery operations. Use with care.
          </p>
        </div>
        {collapsed ? (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {!collapsed && (
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <ReseedCard />
          <WipeRangeCard />
          <CascadeCard />
        </div>
      )}
    </section>
  );
}
