"use client";

import { useState, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OverheadRow {
  gl_account_id:             number;
  account_no:                number;
  description:               string;
  category_color:            string;
  weekly_debit:              string | number;
  weekly_credit:             string | number;
  net_activity:              string | number;
  excluded_ye_reclass_gross: string | number;
  has_data:                  boolean;
  source_file:               string | null;
}

interface EditEntry {
  debit:  string;
  credit: string;
}
type EditMap = Record<number, EditEntry>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDisplay(raw: string | number): string {
  const str = String(raw).replace(/,/g, "");
  const num = parseFloat(str);
  if (isNaN(num)) return "0.00";
  const neg  = num < 0;
  const abs  = Math.abs(num);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + parts.join(".");
}

function parseRaw(s: string | number): number {
  const num = parseFloat(String(s).replace(/,/g, ""));
  return isNaN(num) ? 0 : num;
}

function initEditMap(rows: OverheadRow[]): EditMap {
  const m: EditMap = {};
  for (const r of rows) {
    m[r.gl_account_id] = {
      debit:  formatDisplay(r.weekly_debit),
      credit: formatDisplay(r.weekly_credit),
    };
  }
  return m;
}

// ─── MoneyInput ───────────────────────────────────────────────────────────────

function MoneyInput({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={focused ? value.replace(/,/g, "") : formatDisplay(value)}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        setFocused(true);
        onChange(value.replace(/,/g, ""));
        setTimeout(() => ref.current?.select(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        const stripped = value.replace(/,/g, "");
        if (!isNaN(parseFloat(stripped))) onChange(formatDisplay(stripped));
      }}
      placeholder="0.00"
      className="input-field text-right tabular-nums"
    />
  );
}

// ─── Source Badge ─────────────────────────────────────────────────────────────

function SourceBadge({ sourceFile }: { sourceFile: string | null }) {
  if (!sourceFile) return null;
  if (sourceFile === "manual-entry") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
        Manual
      </span>
    );
  }
  return (
    <span
      title={sourceFile}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600 cursor-default"
    >
      CSV
    </span>
  );
}

// ─── OverheadCategoryCard ─────────────────────────────────────────────────────

const OVERHEAD_COLOR = "#7B3FA0";

export default function OverheadCategoryCard({
  rows,
  weekEnding,
  onSaveComplete,
}: {
  rows:           OverheadRow[];
  weekEnding:     string;
  onSaveComplete: () => void;
}) {
  const [open,      setOpen]      = useState(true);
  const [editMap,   setEditMap]   = useState<EditMap>(() => initEditMap(rows));
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved,     setSaved]     = useState(false);

  // Snapshot at mount for dirty detection
  const originalMap = useRef<EditMap>(initEditMap(rows));

  function handleChange(id: number, field: "debit" | "credit", val: string) {
    setEditMap((prev) => ({ ...prev, [id]: { ...prev[id], [field]: val } }));
    setSaved(false);
    setSaveError("");
  }

  async function handleSave() {
    const dirty = rows.filter((r) => {
      const cur  = editMap[r.gl_account_id];
      const orig = originalMap.current[r.gl_account_id];
      if (!cur || !orig) return false;
      return (
        parseRaw(cur.debit)  !== parseRaw(orig.debit) ||
        parseRaw(cur.credit) !== parseRaw(orig.credit)
      );
    });

    if (dirty.length === 0) {
      setSaved(true);
      onSaveComplete();
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaved(false);

    try {
      const res = await fetch("/api/weekly-overhead", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_ending: weekEnding,
          entries: dirty.map((r) => ({
            gl_account_id: r.gl_account_id,
            weekly_debit:  parseRaw(editMap[r.gl_account_id].debit),
            weekly_credit: parseRaw(editMap[r.gl_account_id].credit),
          })),
        }),
      });

      if (!res.ok) {
        const j = await res.json();
        setSaveError((j as { error?: string }).error ?? "Save failed");
        return;
      }

      setSaved(true);
      onSaveComplete();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const hasDataCount = rows.filter((r) => r.has_data).length;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none"
        style={{ backgroundColor: OVERHEAD_COLOR }}
      >
        <span className="font-semibold text-sm text-white">Overhead (Div 99)</span>
        <svg
          className={`w-4 h-4 text-white transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {rows.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-400 text-center">
              No overhead GL accounts found. Run the seed endpoint to populate them.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className="table-th w-24">Account #</th>
                    <th className="table-th">Description</th>
                    <th className="table-th w-40 text-right pr-4">Weekly Debit</th>
                    <th className="table-th w-40 text-right pr-4">Weekly Credit</th>
                    <th className="table-th w-40 text-right pr-4">Net Activity</th>
                    <th className="table-th w-20 text-center">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const entry = editMap[row.gl_account_id] ?? { debit: "0.00", credit: "0.00" };
                    const net   = parseRaw(entry.debit) - parseRaw(entry.credit);
                    return (
                      <tr key={row.gl_account_id} className="hover:bg-gray-50">
                        <td className="table-td font-mono text-xs text-gray-500 align-middle">
                          {row.account_no}
                        </td>
                        <td className="table-td text-gray-800 align-middle">
                          {row.description}
                        </td>
                        <td className="table-td align-middle" style={{ width: 160 }}>
                          <MoneyInput
                            value={entry.debit}
                            onChange={(v) => handleChange(row.gl_account_id, "debit", v)}
                          />
                        </td>
                        <td className="table-td align-middle" style={{ width: 160 }}>
                          <MoneyInput
                            value={entry.credit}
                            onChange={(v) => handleChange(row.gl_account_id, "credit", v)}
                          />
                        </td>
                        <td className="table-td text-right tabular-nums text-sm text-gray-700 align-middle pr-4">
                          {formatDisplay(net)}
                        </td>
                        <td className="table-td text-center align-middle">
                          {row.has_data && <SourceBadge sourceFile={row.source_file} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">
                {hasDataCount} of {rows.length} accounts have data this week
              </span>
              <div className="flex items-center gap-3">
                {saved && (
                  <span className="text-xs text-green-600 font-medium">Saved ✓</span>
                )}
                {saveError && (
                  <span className="text-xs text-red-600 max-w-xs truncate">{saveError}</span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    "Save Overhead"
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
