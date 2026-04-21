"use client";

import { useRef, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  categoryName: string;
  periodDebit: number;
  periodCredit: number;
  netChange: number;
}

interface WeekPreview {
  weekEnding: string;
  isPartial: boolean;
  isNew: boolean;
  rowsNew: number;
  rowsDuplicate: number;
  categoryTotals: CategoryTotal[];
}

interface OutOfScopeAccount {
  accountNo: number;
  division: string;
  description: string;
  rowCount: number;
}

interface ImportPreview {
  sessionId: string;
  filename: string;
  dateRange: { min: string; max: string };
  weeksAffected: WeekPreview[];
  outOfScope: { rowCount: number; uniqueAccounts: OutOfScopeAccount[] };
  errors: string[];
}

interface ConfirmResult {
  success: boolean;
  rowsImported: number;
  rowsSkipped: number;
  weeksCommitted: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl px-8 py-16 cursor-pointer transition-colors ${
        dragging ? "border-[#1B2A4A] bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400"
      }`}
    >
      <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-700">Drop Foundation GL CSV here</p>
        <p className="text-xs text-gray-400 mt-1">or click to browse</p>
      </div>
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

// ─── Preview display ──────────────────────────────────────────────────────────

function PreviewView({
  preview,
  onCancel,
  onConfirm,
  confirming,
}: {
  preview: ImportPreview;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const [oosOpen, setOosOpen] = useState(false);

  const totalNew = preview.weeksAffected.reduce((s, w) => s + w.rowsNew, 0);
  const totalDup = preview.weeksAffected.reduce((s, w) => s + w.rowsDuplicate, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header summary */}
      <div className="card px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{preview.filename}</h2>
        <p className="text-xs text-gray-500">
          Date range: {fmtDate(preview.dateRange.min)} – {fmtDate(preview.dateRange.max)}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          {[
            { label: "Weeks affected",   value: preview.weeksAffected.length },
            { label: "New rows",         value: totalNew },
            { label: "Duplicate rows",   value: totalDup,                      sub: "will be skipped" },
            { label: "Out-of-scope rows",value: preview.outOfScope.rowCount,   sub: "no matching GL account" },
          ].map((m) => (
            <div key={m.label}>
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className="text-xl font-bold text-gray-900">{m.value.toLocaleString()}</p>
              {m.sub && <p className="text-xs text-gray-400">{m.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Per-week cards */}
      {preview.weeksAffected.map((w) => (
        <div key={w.weekEnding} className="card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 bg-gray-50">
            <span className="font-semibold text-gray-900 text-sm">{fmtDate(w.weekEnding)}</span>
            {w.isPartial && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600">Partial</span>
            )}
            {w.isNew ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">New week</span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Updating existing</span>
            )}
            <span className="ml-auto text-xs text-gray-400">
              {w.rowsNew} new · {w.rowsDuplicate} duplicate
            </span>
          </div>
          {w.categoryTotals.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Category</th>
                  <th className="table-th text-right">Period Dr</th>
                  <th className="table-th text-right">Period Cr</th>
                  <th className="table-th text-right">Net Change</th>
                </tr>
              </thead>
              <tbody>
                {w.categoryTotals.map((c) => (
                  <tr key={c.categoryName}>
                    <td className="table-td text-gray-700">{c.categoryName}</td>
                    <td className="table-td text-right font-mono text-gray-700">{fmtMoney(c.periodDebit)}</td>
                    <td className="table-td text-right font-mono text-gray-700">{fmtMoney(c.periodCredit)}</td>
                    <td className={`table-td text-right font-mono font-semibold ${c.netChange >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmtMoney(c.netChange)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* Out-of-scope section */}
      {preview.outOfScope.rowCount > 0 && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setOosOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-3 text-left bg-gray-50 border-b border-gray-200"
          >
            <span className="text-sm font-semibold text-gray-700">
              Out-of-scope accounts ({preview.outOfScope.uniqueAccounts.length} unique, {preview.outOfScope.rowCount} rows — will be skipped)
            </span>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${oosOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {oosOpen && (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Account #</th>
                  <th className="table-th">Division</th>
                  <th className="table-th">Description</th>
                  <th className="table-th text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {preview.outOfScope.uniqueAccounts.map((a) => (
                  <tr key={`${a.accountNo}|${a.division}`}>
                    <td className="table-td font-mono text-gray-700">{a.accountNo}</td>
                    <td className="table-td text-gray-500">{a.division || "—"}</td>
                    <td className="table-td text-gray-700">{a.description}</td>
                    <td className="table-td text-right text-gray-500">{a.rowCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Errors */}
      {preview.errors.length > 0 && (
        <div className="card px-5 py-4 border border-red-200 bg-red-50">
          <p className="text-sm font-semibold text-red-700 mb-2">Parse warnings</p>
          {preview.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pb-4">
        <button onClick={onCancel} className="btn-secondary" disabled={confirming}>
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={confirming || totalNew === 0}
          className="btn-primary"
        >
          {confirming ? "Saving…" : `Confirm & save ${totalNew.toLocaleString()} rows`}
        </button>
      </div>
    </div>
  );
}

// ─── Success state ────────────────────────────────────────────────────────────

function SuccessView({ result }: { result: ConfirmResult }) {
  return (
    <div className="card px-6 py-12 text-center flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900">Import complete</p>
        <p className="text-sm text-gray-500 mt-1">
          {result.rowsImported.toLocaleString()} rows saved across{" "}
          {result.weeksCommitted.length} week{result.weeksCommitted.length !== 1 ? "s" : ""}.
          {result.rowsSkipped > 0 && ` ${result.rowsSkipped.toLocaleString()} duplicate rows skipped.`}
        </p>
      </div>
      <Link href="/weeks" className="btn-primary mt-2">
        View Weeks
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [state, setState] = useState<"idle" | "uploading" | "preview" | "confirming" | "done">("idle");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  async function handleFile(file: File) {
    setState("uploading");
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(data);
      setState("preview");
    } catch (e) {
      setUploadError(String(e));
      setState("idle");
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setState("confirming");
    try {
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: preview.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
      setState("done");
    } catch (e) {
      setUploadError(String(e));
      setState("preview");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Import Foundation GL</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a Foundation GL CSV export. Preview changes before committing.
        </p>
      </div>

      {state === "idle" && (
        <div className="flex flex-col gap-4">
          <DropZone onFile={handleFile} />
          {uploadError && (
            <p className="text-sm text-red-600 px-1">{uploadError}</p>
          )}
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm">Parsing and analyzing file…</span>
        </div>
      )}

      {(state === "preview" || state === "confirming") && preview && (
        <PreviewView
          preview={preview}
          onCancel={() => { setState("idle"); setPreview(null); }}
          onConfirm={handleConfirm}
          confirming={state === "confirming"}
        />
      )}

      {state === "done" && result && <SuccessView result={result} />}
    </div>
  );
}
