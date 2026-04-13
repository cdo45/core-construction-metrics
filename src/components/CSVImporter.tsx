"use client";

import { useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  account_no: number;
  full_account_no: string;
  trx_date: string | null;
  journal: string;
  audit_no: string;
  gl_trx_no: string;
  line: string;
  job: string;
  description: string;
  debit: number;
  credit: number;
  vendor_cust_no: string;
  trx_no: string;
}

interface ImportResult {
  imported_count: number;
  accounts_affected: number;
  skipped_accounts: number[];
  week_ending: string;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

// Summary/header row patterns to skip
const SKIP_PATTERNS = [
  "Account Totals:",
  "Beginning Balance:",
  "Current Period:",
  "Ending Balance:",
];

function parseMoney(raw: string): number {
  return parseFloat(raw.replace(/,/g, "").trim()) || 0;
}

/**
 * Parse a single CSV line respecting quoted fields.
 * Handles commas inside double-quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(text: string): ParsedTransaction[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedTransaction[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line).map((c) => c.trim());
    // Need at least 14 columns
    if (cols.length < 14) continue;

    const description = cols[9];

    // Skip summary/totals rows
    if (SKIP_PATTERNS.some((p) => description.includes(p))) continue;

    // Parse account number
    const account_no = parseInt(cols[0].replace(/\D/g, ""), 10);
    if (isNaN(account_no) || account_no === 0) continue;

    // Parse debit / credit
    const debit  = parseMoney(cols[10]);
    const credit = parseMoney(cols[11]);

    // Skip rows with no transaction date and no activity (summary spacers)
    const trx_date_raw = cols[3].trim();
    if (!trx_date_raw && debit === 0 && credit === 0) continue;

    // Normalise date: "MM/DD/YYYY" → "YYYY-MM-DD" or null
    let trx_date: string | null = null;
    if (trx_date_raw) {
      const parts = trx_date_raw.split("/");
      if (parts.length === 3) {
        const [m, d, y] = parts;
        trx_date = `${y.padStart(4, "20")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      } else {
        trx_date = trx_date_raw;
      }
    }

    results.push({
      account_no,
      full_account_no: cols[2].trim(),
      trx_date,
      journal:       cols[4].trim(),
      audit_no:      cols[5].trim(),
      gl_trx_no:     cols[6].trim(),
      line:          cols[7].trim(),
      job:           cols[8].trim(),
      description,
      debit,
      credit,
      vendor_cust_no: cols[12].trim(),
      trx_no:        cols[13].trim(),
    });
  }

  return results;
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  weekEnding: string;
  onImportComplete: () => void;
}

type Stage = "idle" | "parsed" | "importing" | "done";

export default function CSVImporter({ weekEnding, onImportComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [parseError, setParseError] = useState("");
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");

  // Unique account nos after parsing
  const uniqueAccounts = Array.from(
    new Set(transactions.map((t) => t.account_no))
  ).sort((a, b) => a - b);

  function handleFile(file: File) {
    setParseError("");
    setImportError("");
    setImportResult(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please select a CSV file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setParseError("No valid transaction rows found in this CSV.");
          return;
        }
        setTransactions(parsed);
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
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  async function handleImport() {
    setStage("importing");
    setImportError("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_ending: weekEnding, transactions }),
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
    setImportResult(null);
    setParseError("");
    setImportError("");
  }

  // ── Render: idle / error ──────────────────────────────────────────────────

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
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">
              Drop Foundation GL Activity CSV here
            </p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
        />
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
          <button onClick={handleReset} className="btn-secondary text-xs">
            Import another
          </button>
        </div>
        {importResult.skipped_accounts.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1">
              Skipped accounts (not in GL setup):
            </p>
            <p className="text-xs text-amber-700 font-mono">
              {importResult.skipped_accounts.join(", ")}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Render: parsed preview ────────────────────────────────────────────────

  const preview = transactions.slice(0, 20);
  const totalDebits  = transactions.reduce((s, t) => s + t.debit, 0);
  const totalCredits = transactions.reduce((s, t) => s + t.credit, 0);

  return (
    <div className="card overflow-hidden">
      {/* Preview header */}
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            CSV Preview
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {transactions.length} transactions · {uniqueAccounts.length} accounts found
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="btn-secondary text-xs">
            Clear
          </button>
          <button
            onClick={handleImport}
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

      {/* Stats row */}
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
                  {t.debit > 0 ? fmtMoney(t.debit) : ""}
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
