"use client";

import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type {
  PnlBreakdownResponse,
  PnlCategoryGroup,
  PnlAccount,
} from "@/app/api/pnl-breakdown/route";
import { useTableSort, type SortSpec } from "@/hooks/useTableSort";
import SortableHeader from "@/components/ui/SortableHeader";

const SORT_KEY_PREFIX = "tablesort:PnlBreakdownTable";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtSigned(n: number, showSign: "pos" | "neg"): string {
  // showSign: "pos" means cost lines → display with leading minus; "neg"
  // is unused today but kept for symmetry with future P&L additions.
  const abs = Math.abs(n);
  const base = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return showSign === "pos" ? `-${base}` : base;
}

// ─── Category row ────────────────────────────────────────────────────────────

function CategoryRow({
  label,
  group,
  display,
  storageSlug,
}: {
  label: string;
  group: PnlCategoryGroup;
  /** How to format the total: revenue stays positive; cost categories render
   *  with a leading minus so the math reads as subtraction. */
  display: "revenue" | "cost";
  /** Per-category storage key suffix so the 4 categories remember their
   *  sort independently. */
  storageSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const disabled = group.accounts.length === 0;

  const formattedTotal =
    display === "cost" ? fmtSigned(group.total, "pos") : fmtMoney(group.total);

  // Each category sorts independently. Default: account_no ASC → division ASC
  // (with NULLS FIRST for divisionless rows via the hook's comparator).
  const defaultSort = useMemo<SortSpec<PnlAccount>>(
    () => ({
      column: "account_no",
      direction: "asc",
      secondary: [{ column: "division", direction: "asc" }],
    }),
    [],
  );
  const { sortedData, sortBy, sortState } = useTableSort(
    group.accounts,
    defaultSort,
    `${SORT_KEY_PREFIX}:${storageSlug}`,
  );

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          disabled ? "cursor-default opacity-60" : "hover:bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          {disabled ? (
            <span className="w-4 h-4" />
          ) : open ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <span className="text-sm font-medium text-gray-900">{label}</span>
          {!disabled && (
            <span className="text-xs text-gray-400">
              ({group.accounts.length} acct{group.accounts.length === 1 ? "" : "s"})
            </span>
          )}
        </div>
        <span
          className={`text-sm font-semibold tabular-nums ${
            display === "cost" ? "text-red-700" : "text-gray-900"
          }`}
        >
          {formattedTotal}
        </span>
      </button>
      {open && !disabled && (
        <div className="bg-gray-50 border-t border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100/60 text-[10px] uppercase tracking-wider text-gray-500">
                <SortableHeader<PnlAccount> label="Account #"  column="account_no"  sortState={sortState} onSort={sortBy} className="w-24" />
                <SortableHeader<PnlAccount> label="Div"        column="division"    sortState={sortState} onSort={sortBy} className="w-16" />
                <SortableHeader<PnlAccount> label="Description" column="description" sortState={sortState} onSort={sortBy} />
                <SortableHeader<PnlAccount> label="Total"      column="total"       sortState={sortState} onSort={sortBy} className="w-28" align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedData.map((acct) => (
                <tr
                  key={`${acct.account_no}|${acct.division}`}
                  className="border-t border-gray-100 first:border-t-0"
                >
                  <td className="px-4 py-2 font-mono text-gray-500 w-24">{acct.account_no}</td>
                  <td className="px-2 py-2 font-mono text-gray-400 w-16">{acct.division}</td>
                  <td className="px-2 py-2 text-gray-700">{acct.description}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      display === "cost" ? "text-red-700" : "text-gray-900"
                    }`}
                  >
                    {display === "cost" ? fmtSigned(acct.total, "pos") : fmtMoney(acct.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function PnlBreakdownTable({
  data,
  loading,
}: {
  data: PnlBreakdownResponse | null;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">P&amp;L Breakdown</h3>
        <p className="text-xs text-gray-500">
          Account-level detail for the selected period. Click a row to expand.
        </p>
      </div>
      {loading ? (
        <div className="px-4 py-10 text-center text-xs text-gray-400 italic">Loading…</div>
      ) : !data ? (
        <div className="px-4 py-10 text-center text-xs text-gray-400 italic">
          No P&amp;L data for this period.
        </div>
      ) : (
        <>
          <CategoryRow label="Revenue"           group={data.revenue}          display="revenue" storageSlug="revenue" />
          <CategoryRow label="Direct Job Costs"  group={data.direct_job_costs} display="cost"    storageSlug="djc" />
          <CategoryRow label="Payroll (Field)"   group={data.payroll_field}    display="cost"    storageSlug="payroll_field" />
          <CategoryRow label="Overhead"          group={data.overhead}         display="cost"    storageSlug="overhead" />
          <div className="border-t-2 border-gray-300 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900">Operating Income</span>
            <span
              className={`text-base font-bold tabular-nums ${
                data.operating_income >= 0 ? "text-green-700" : "text-red-700"
              }`}
            >
              {fmtMoney(data.operating_income)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
