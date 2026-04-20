"use client";

import { useEffect, useRef, useState } from "react";
import { parseTBCsv, type ParsedTBRow } from "@/lib/trial-balance-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScopeAccount {
  account_no:     number;
  division:       string;
  description:    string;
  category_name:  string | null;
  category_color: string | null;
  is_pl_flow:     boolean;
}

interface ImportResult {
  imported_count:     number;
  active_accounts:    number;
  totals_by_category: Record<string, number>;
  unknown_accounts:   Array<{ account_no: number; division: string; debit: number; credit: number }>;
  warnings:           string[];
}

interface OverwriteInfo {
  row_count:    number;
  total_debit:  number;
  total_credit: number;
}

interface Props {
  weekEnding:       string;
  onImportComplete: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function acctKey(row: { account_no: number; division: string }): string {
  return `${row.account_no}-${row.division}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Stage = "idle" | "parsed" | "importing" | "done";

export default function TrialBalanceImporter({ weekEnding, onImportComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging,     setDragging]     = useState(false);
  const [stage,        setStage]        = useState<Stage>("idle");
  const [parseError,   setParseError]   = useState("");
  const [importError,  setImportError]  = useState("");
  const [rows,         setRows]         = useState<ParsedTBRow[]>([]);
  const [sourceFile,   setSourceFile]   = useState("");
  const [result,       setResult]       = useState<ImportResult | null>(null);
  const [overwrite,    setOverwrite]    = useState<OverwriteInfo | null>(null);
  const [scopeAccounts, setScopeAccounts] = useState<ScopeAccount[]>([]);

  useEffect(() => {
    fetch("/api/gl-accounts/scope")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.accounts) setScopeAccounts(d.accounts); })
      .catch(() => {});
  }, []);

  // ── Computed preview values ──────────────────────────────────────────────

  const scopeSet = new Set(scopeAccounts.map((a) => acctKey(a)));
  const scopeLoaded = scopeAccounts.length > 0;

  const inScopeRows    = scopeLoaded ? rows.filter((r) => scopeSet.has(acctKey(r)))  : rows;
  const outOfScopeRows = scopeLoaded ? rows.filter((r) => !scopeSet.has(acctKey(r))) : [];

  const totalDebit  = rows.reduce((s, r) => s + r.debit,  0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const balanced    = Math.abs(totalDebit - totalCredit) <= 1.0;

  // Per-category breakdown for preview
  const categoryMap = new Map<string, { color: string; debit: number; credit: number; count: number }>();
  if (scopeLoaded) {
    const acctLookup = new Map(scopeAccounts.map((a) => [acctKey(a), a]));
    for (const row of inScopeRows) {
      const acct = acctLookup.get(acctKey(row));
      const cat  = acct?.category_name ?? "Other";
      const col  = acct?.category_color ?? "#6B7280";
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.debit  += row.debit;
        existing.credit += row.credit;
        existing.count  += 1;
      } else {
        categoryMap.set(cat, { color: col, debit: row.debit, credit: row.credit, count: 1 });
      }
    }
  }

  // ── File handling ────────────────────────────────────────────────────────

  function handleFile(file: File) {
    setParseError("");
    setImportError("");
    setResult(null);
    setOverwrite(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please select a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text   = e.target?.result as string;
        const parsed = parseTBCsv(text);
        if (parsed.rows.length === 0) {
          setParseError("No account rows found in this file. Check the CSV format.");
          return;
        }
        setRows(parsed.rows);
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

  // ── Import flow ──────────────────────────────────────────────────────────

  async function handleCheckAndImport() {
    if (!balanced) {
      setImportError(
        `Trial balance does not balance: debits ${fmtMoney(totalDebit)} ≠ credits ${fmtMoney(totalCredit)}`
      );
      return;
    }
    try {
      const res  = await fetch(`/api/weeks/${weekEnding}/import-status`);
      const data = await res.json();
      if (data.exists) {
        setOverwrite({ row_count: data.row_count, total_debit: data.total_debit, total_credit: data.total_credit });
        return;
      }
    } catch {
      // status check failed — proceed with import anyway
    }
    await doImport();
  }

  async function doImport() {
    setOverwrite(null);
    setStage("importing");
    setImportError("");
    try {
      const payload = inScopeRows.map((r) => ({
        account_no: r.account_no,
        division:   r.division,
        debit:      r.debit,
        credit:     r.credit,
      }));

      const res = await fetch("/api/import-trial-balance", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ week_ending: weekEnding, parsed_rows: payload, source_file: sourceFile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
        setStage("parsed");
        return;
      }
      setResult(data as ImportResult);
      setStage("done");
      onImportComplete();
    } catch (err) {
      setImportError(String(err));
      setStage("parsed");
    }
  }

  function handleReset() {
    setStage("idle");
    setRows([]);
    setSourceFile("");
    setResult(null);
    setParseError("");
    setImportError("");
    setOverwrite(null);
  }

  // ── Render: idle ─────────────────────────────────────────────────────────

  if (stage === "idle") {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Trial Balance Import</h2>
          <span className="text-xs text-gray-400">Drop the Foundation GL Trial Balance CSV</span>
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
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed cursor-pointer py-10 transition-colors select-none
            ${dragging ? "border-[#1B2A4A] bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-[#1B2A4A] hover:bg-blue-50"}`}
        >
          <svg className={`w-10 h-10 ${dragging ? "text-[#1B2A4A]" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Drop Trial Balance CSV here</p>
            <p className="text-xs text-gray-400 mt-1">Format: Account No, Description, Debits, Credits</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
      </div>
    );
  }

  // ── Render: done ─────────────────────────────────────────────────────────

  if (stage === "done" && result) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Trial balance imported</p>
              <p className="text-xs text-gray-500">
                {result.imported_count} accounts seeded · {result.active_accounts} with activity
              </p>
            </div>
          </div>
          <button onClick={handleReset} className="btn-secondary text-xs">Import another</button>
        </div>

        {/* Category totals */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {Object.entries(result.totals_by_category).map(([cat, total]) => (
            <div key={cat} className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 truncate">{cat}</p>
              <p className="text-sm font-semibold tabular-nums text-gray-900">{fmtMoney(total)}</p>
            </div>
          ))}
        </div>

        {result.unknown_accounts.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1">
              {result.unknown_accounts.length} account{result.unknown_accounts.length === 1 ? "" : "s"} not in Setup (skipped):
            </p>
            <p className="text-xs font-mono text-amber-700">
              {result.unknown_accounts.slice(0, 20).map((a) =>
                a.division ? `${a.account_no}-${a.division}` : String(a.account_no)
              ).join(", ")}
              {result.unknown_accounts.length > 20 && ` … +${result.unknown_accounts.length - 20} more`}
            </p>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">• {w}</p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render: parsed / importing ────────────────────────────────────────────

  return (
    <div className="card overflow-hidden relative">
      {/* Overwrite confirmation */}
      {overwrite && (
        <div className="absolute inset-0 z-10 bg-white/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white rounded-xl border border-amber-300 shadow-lg max-w-sm w-full p-5">
            <p className="text-sm font-semibold text-gray-900 mb-2">Replace existing week data?</p>
            <p className="text-xs text-gray-600 mb-4">
              This week already has {overwrite.row_count} accounts imported.
              Re-importing will replace all balance and activity data. Continue?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOverwrite(null)} className="btn-secondary text-xs">Cancel</button>
              <button onClick={doImport}                 className="btn-primary  text-xs">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Trial Balance — CSV Preview</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {rows.length.toLocaleString()} rows · {inScopeRows.length} in-scope
            {outOfScopeRows.length > 0 && (
              <span className="text-amber-600"> · {outOfScopeRows.length} out-of-scope (skipped)</span>
            )}
            {!balanced && (
              <span className="text-red-600 font-medium"> · ⚠ UNBALANCED</span>
            )}
            {sourceFile ? ` · ${sourceFile}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset} className="btn-secondary text-xs">Clear</button>
          <button
            onClick={handleCheckAndImport}
            disabled={stage === "importing" || !balanced}
            className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-60"
          >
            {stage === "importing" ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path  className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Importing…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                Import {inScopeRows.length.toLocaleString()} rows
              </>
            )}
          </button>
        </div>
      </div>

      {importError && (
        <div className="mx-5 mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          {importError}
        </div>
      )}

      {/* Balance check */}
      <div className={`px-5 py-2.5 text-xs border-b border-gray-100 flex items-center justify-between ${balanced ? "bg-green-50" : "bg-red-50"}`}>
        <span className={balanced ? "text-green-700" : "text-red-700 font-medium"}>
          {balanced ? "✓ Balanced" : "⚠ Does not balance — cannot import"}
        </span>
        <span className="tabular-nums text-gray-600">
          Debits {fmtMoney(totalDebit)} · Credits {fmtMoney(totalCredit)}
          {!balanced && ` · Diff ${fmtMoney(Math.abs(totalDebit - totalCredit))}`}
        </span>
      </div>

      {/* Per-category breakdown */}
      {scopeLoaded && categoryMap.size > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-600 mb-2">By category</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {Array.from(categoryMap.entries()).map(([cat, data]) => (
              <div key={cat} className="text-xs">
                <div className="flex items-center gap-1 mb-0.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: data.color }} />
                  <span className="text-gray-500 truncate">{cat}</span>
                </div>
                <p className="font-semibold tabular-nums text-gray-800">
                  {fmtMoney(Math.abs(data.debit - data.credit))} net
                </p>
                <p className="text-gray-400">{data.count} accts</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Out-of-scope summary */}
      {outOfScopeRows.length > 0 && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          Out of scope (will skip): {outOfScopeRows.slice(0, 15).map((r) =>
            r.division ? `${r.account_no}-${r.division}` : String(r.account_no)
          ).join(", ")}
          {outOfScopeRows.length > 15 && ` … +${outOfScopeRows.length - 15} more`}
        </div>
      )}

      {/* Preview table — first 20 rows */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-xs">
          <thead>
            <tr>
              <th className="table-th w-28">Account</th>
              <th className="table-th">Description</th>
              <th className="table-th text-right w-32">Debit</th>
              <th className="table-th text-right w-32">Credit</th>
              <th className="table-th w-32">Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => {
              const key   = acctKey(r);
              const acct  = scopeAccounts.find((a) => acctKey(a) === key);
              const inScope = !scopeLoaded || !!acct;
              return (
                <tr key={i} className={`hover:bg-gray-50 ${!inScope ? "opacity-40" : ""}`}>
                  <td className="table-td font-mono text-gray-500">
                    {r.division ? `${r.account_no}-${r.division}` : r.account_no}
                  </td>
                  <td className="table-td text-gray-800 max-w-[200px] truncate">{r.description}</td>
                  <td className="table-td text-right tabular-nums text-gray-700">
                    {r.debit > 0 ? fmtMoney(r.debit) : ""}
                  </td>
                  <td className="table-td text-right tabular-nums text-gray-700">
                    {r.credit > 0 ? fmtMoney(r.credit) : ""}
                  </td>
                  <td className="table-td text-gray-500 truncate">
                    {acct?.category_name ?? (scopeLoaded ? "—" : "")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 20 && (
        <div className="px-5 py-2 border-t border-gray-100 text-xs text-gray-400 italic">
          Showing first 20 of {rows.length} rows
        </div>
      )}
    </div>
  );
}
