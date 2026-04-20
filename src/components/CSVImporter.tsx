"use client";

import { useRef, useState } from "react";
import {
  type ParsedTransaction,
  type FilterStats,
  parseCSV,
  parseCSVLine,
  validateFoundationHeaders,
} from "@/lib/csv-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportResult {
  imported_count:    number;
  accounts_affected: number;
  skipped_accounts:  number[];
  week_ending:       string;
  warnings:          string[];
}

interface OverwriteInfo {
  row_count:   number;
  total_debit: number;
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style:                 "currency",
    currency:              "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  weekEnding:       string;
  onImportComplete: () => void;
}

type Stage = "idle" | "parsed" | "importing" | "done";

export default function CSVImporter({ weekEnding, onImportComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging,        setDragging]        = useState(false);
  const [stage,           setStage]           = useState<Stage>("idle");
  const [parseError,      setParseError]      = useState("");
  const [transactions,    setTransactions]    = useState<ParsedTransaction[]>([]);
  const [filterStats,     setFilterStats]     = useState<FilterStats | null>(null);
  const [sourceFile,      setSourceFile]      = useState("");
  const [importResult,    setImportResult]    = useState<ImportResult | null>(null);
  const [importError,     setImportError]     = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState<OverwriteInfo | null>(null);

  const uniqueAccounts = Array.from(
    new Set(transactions.map((t) => t.account_no)),
  ).sort((a, b) => a - b);

  // ── File handling ─────────────────────────────────────────────────────────

  function handleFile(file: File) {
    setParseError("");
    setImportError("");
    setImportResult(null);
    setConfirmOverwrite(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please select a CSV file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;

        // Validate header row before parsing
        const lines      = text.split(/\r?\n/);
        const headerLine = lines[0]?.trim() ?? "";
        if (headerLine) {
          const headerCols = parseCSVLine(headerLine).map((c) => c.trim());
          const headerErr  = validateFoundationHeaders(headerCols);
          if (headerErr) {
            setParseError(headerErr);
            return;
          }
        }

        const { transactions: parsed, filter_stats } = parseCSV(text);
        if (parsed.length === 0) {
          setParseError("No valid transaction rows found in this CSV.");
          return;
        }
        setTransactions(parsed);
        setFilterStats(filter_stats);
        setSourceFile(file.name);
        setStage("parsed");
      } catch (err) {
        setParseError(`Parse error: ${String(err)}`);
      }
    };
    reader.onerror = () => setParseError("Failed to read file.");
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  // ── Import flow ───────────────────────────────────────────────────────────

  // Called from the preview header button; checks for existing data first.
  async function handleCheckAndImport() {
    try {
      const res  = await fetch(`/api/weeks/${weekEnding}/import-status?type=full_gl`);
      const data = await res.json();
      if (data.exists) {
        setConfirmOverwrite({ row_count: data.row_count, total_debit: data.total_debit });
        return;
      }
    } catch {
      // If the status check fails, proceed with import anyway.
    }
    await handleImport();
  }

  // Fires the actual POST. Can be called directly (after overwrite confirm) or
  // via handleCheckAndImport.
  async function handleImport() {
    setConfirmOverwrite(null);
    setStage("importing");
    setImportError("");
    try {
      const res = await fetch("/api/import", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          week_ending:  weekEnding,
          transactions,
          source_file:  sourceFile || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
        setStage("parsed");
        return;
      }
      setImportResult(data as ImportResult);
      setStage("done");
      onImportComplete();
    } catch (err) {
      setImportError(String(err));
      setStage("parsed");
    }
  }

  function handleReset() {
    setStage("idle");
    setTransactions([]);
    setFilterStats(null);
    setSourceFile("");
    setImportResult(null);
    setParseError("");
    setImportError("");
    setConfirmOverwrite(null);
  }

  // ── Render: idle ──────────────────────────────────────────────────────────

  if (stage === "idle") {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Import Foundation GL CSV</h2>
          <span className="text-xs text-gray-400">Optional — or enter balances manually below</span>
        </div>

        {parseError && (
          <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {parseError}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
            cursor-pointer py-10 transition-colors select-none
            ${dragging
              ? "border-[#1B2A4A] bg-blue-50"
              : "border-gray-300 bg-gray-50 hover:border-[#1B2A4A] hover:bg-blue-50"}
          `}
        >
          <svg
            className={`w-10 h-10 ${dragging ? "text-[#1B2A4A]" : "text-gray-400"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Drop Foundation GL Activity CSV here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
          </div>
        </div>

        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
      </div>
    );
  }

  // ── Render: done ──────────────────────────────────────────────────────────

  if (stage === "done" && importResult) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Import complete</p>
              <p className="text-xs text-gray-500">
                {importResult.imported_count} transactions · {importResult.accounts_affected} accounts updated
                {importResult.skipped_accounts.length > 0
                  ? ` · ${importResult.skipped_accounts.length} accounts skipped`
                  : ""}
              </p>
            </div>
          </div>
          <button onClick={handleReset} className="btn-secondary text-xs">Import another</button>
        </div>

        {importResult.skipped_accounts.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1">Skipped accounts (not in GL setup):</p>
            <p className="text-xs text-amber-700 font-mono">{importResult.skipped_accounts.join(", ")}</p>
          </div>
        )}

        {importResult.warnings && importResult.warnings.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1.5">Warnings:</p>
            <ul className="flex flex-col gap-1">
              {importResult.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                  <span className="mt-0.5 flex-shrink-0">•</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── Render: parsed / importing ────────────────────────────────────────────

  const preview      = transactions.slice(0, 20);
  const totalDebits  = transactions.reduce((s, t) => s + t.debit,  0);
  const totalCredits = transactions.reduce((s, t) => s + t.credit, 0);
  const netActivity  = totalDebits - totalCredits;

  return (
    <div className="card overflow-hidden relative">

      {/* ── Overwrite confirmation modal ─────────────────────────────────── */}
      {confirmOverwrite && (
        <div className="absolute inset-0 z-10 bg-white/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-xl border border-amber-300 shadow-lg max-w-sm w-full p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Replace existing data?</p>
                <p className="text-xs text-gray-600 mt-1">
                  This week already has{" "}
                  <span className="font-medium">{confirmOverwrite.row_count.toLocaleString()} imported transactions</span>{" "}
                  totaling{" "}
                  <span className="font-medium">{fmtMoney(confirmOverwrite.total_debit)}</span>.
                  Re-importing will replace them.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmOverwrite(null)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="btn-primary text-xs"
              >
                Confirm replacement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview header */}
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">CSV Preview</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {transactions.length} transactions · {uniqueAccounts.length} accounts found
            {sourceFile ? ` · ${sourceFile}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="btn-secondary text-xs">Clear</button>
          <button
            onClick={handleCheckAndImport}
            disabled={stage === "importing"}
            className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-60"
          >
            {stage === "importing" ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Importing…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import {transactions.length} rows
              </>
            )}
          </button>
        </div>
      </div>

      {importError && (
        <div className="mx-5 mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {importError}
        </div>
      )}

      {/* Filter breakdown */}
      {filterStats && (
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs">
          <p className="font-medium text-gray-700 mb-1.5">Parse breakdown</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-1 text-gray-500">
            <span>Parsed: <span className="font-medium text-gray-800">{filterStats.parsed}</span></span>
            <span>Skipped (subtotals): <span className="font-medium text-gray-800">{filterStats.skipped_subtotals}</span></span>
            <span>Skipped (blanks): <span className="font-medium text-gray-800">{filterStats.skipped_blank_spacers}</span></span>
            <span>Skipped (bad acct): <span className="font-medium text-gray-800">{filterStats.skipped_bad_account}</span></span>
            <span className="text-[#1B2A4A] font-medium">
              Will import: {transactions.length} rows totaling {fmtMoney(netActivity)} net
            </span>
          </div>
        </div>
      )}

      {/* Totals row */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-3 gap-4 text-xs">
        <div>
          <p className="text-gray-500">Total Debits</p>
          <p className="font-semibold text-gray-900 tabular-nums">{fmtMoney(totalDebits)}</p>
        </div>
        <div>
          <p className="text-gray-500">Total Credits</p>
          <p className="font-semibold text-gray-900 tabular-nums">{fmtMoney(totalCredits)}</p>
        </div>
        <div>
          <p className="text-gray-500">Accounts</p>
          <p className="font-semibold text-gray-900">{uniqueAccounts.join(", ")}</p>
        </div>
      </div>

      {/* Transaction preview table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr>
              <th className="table-th">Account</th>
              <th className="table-th">Date</th>
              <th className="table-th">Jrnl</th>
              <th className="table-th">Job</th>
              <th className="table-th">Description</th>
              <th className="table-th text-right">Debit</th>
              <th className="table-th text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((t, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="table-td font-mono text-gray-500">{t.account_no}</td>
                <td className="table-td text-gray-600">{t.trx_date ?? "—"}</td>
                <td className="table-td text-gray-500">{t.journal}</td>
                <td className="table-td text-gray-500">{t.job}</td>
                <td className="table-td text-gray-800 max-w-[200px] truncate">{t.description}</td>
                <td className="table-td text-right tabular-nums text-gray-700">
                  {t.debit  > 0 ? fmtMoney(t.debit)  : ""}
                </td>
                <td className="table-td text-right tabular-nums text-gray-700">
                  {t.credit > 0 ? fmtMoney(t.credit) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {transactions.length > 20 && (
        <div className="px-5 py-2 border-t border-gray-100 text-xs text-gray-400 italic">
          Showing first 20 of {transactions.length} transactions
        </div>
      )}
    </div>
  );
}
