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
import InfoTooltip from "@/components/ui/InfoTooltip";

const SORT_KEY_PREFIX = "tablesort:PnlBreakdownTable";

const DEPRECIATION_HELP =
  "True non-cash expenses (depreciation, amortization, accruals). They reduce reported profit but don't reduce actual cash — so they're added back to get Cash from Operations.";

const ALLOCATION_HELP =
  "Internal cost transfers (e.g. allocating shop equipment costs to field jobs). The underlying cash was already spent elsewhere, so these are shown for transparency but do NOT add back to cash.";

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

// ─── Account row ─────────────────────────────────────────────────────────────
// Shared render for cash / depreciation / allocation subgroups.
//   tone = "normal"     → cash rows, full colour
//   tone = "muted"      → depreciation rows, italic grey
//   tone = "very-muted" → allocation rows, lighter grey italic + smaller font

function AccountRow({
  acct,
  display,
  tone,
}: {
  acct: PnlAccount;
  display: "revenue" | "cost";
  tone: "normal" | "muted" | "very-muted";
}) {
  const muted = tone !== "normal";
  const sizeCls = tone === "very-muted" ? "text-[10px]" : "text-xs";
  const italicCls = muted ? "italic" : "";

  const acctColor =
    tone === "very-muted" ? "text-gray-300"
    : tone === "muted"    ? "text-gray-400"
    :                        "text-gray-500";
  const divColor =
    tone === "very-muted" ? "text-gray-200"
    : tone === "muted"    ? "text-gray-300"
    :                        "text-gray-400";
  const descColor =
    tone === "very-muted" ? "text-gray-400"
    : tone === "muted"    ? "text-gray-500"
    :                        "text-gray-700";
  const amountCls = muted
    ? (tone === "very-muted" ? "text-gray-400 italic" : "text-gray-500 italic")
    : display === "cost" ? "text-red-700"
    : "text-gray-900";

  return (
    <tr className={`border-t border-gray-100 first:border-t-0 ${sizeCls}`}>
      <td className={`px-4 py-2 font-mono w-24 ${acctColor}`}>{acct.account_no}</td>
      <td className={`px-2 py-2 font-mono w-16 ${divColor}`}>{acct.division}</td>
      <td className={`px-2 py-2 ${descColor} ${italicCls}`}>{acct.description}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${amountCls}`}>
        {display === "cost" ? fmtSigned(acct.total, "pos") : fmtMoney(acct.total)}
      </td>
    </tr>
  );
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

  // Split the sorted list into cash / depreciation / allocation buckets.
  // Preserves the user's chosen ordering within each subgroup. The table
  // only splits visually when at least one non-cash line exists.
  const hasNonCash = group.non_cash_total !== 0;
  const hasDepreciation = group.depreciation_total !== 0;
  const hasAllocation = group.allocation_total !== 0;
  const cashRows = useMemo(
    () => sortedData.filter((a) => !a.is_non_cash),
    [sortedData],
  );
  const depreciationRows = useMemo(
    () => sortedData.filter((a) => a.is_non_cash && !a.is_allocation),
    [sortedData],
  );
  const allocationRows = useMemo(
    () => sortedData.filter((a) => a.is_non_cash && a.is_allocation),
    [sortedData],
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
              {hasNonCash ? (
                <>
                  {/* Cash subgroup header — only shown when we're splitting,
                      so the UI stays quiet for categories without non-cash. */}
                  <tr className="bg-gray-100/40 border-t border-gray-200">
                    <td colSpan={3} className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Cash Expenses
                    </td>
                    <td className={`px-4 py-1.5 text-right tabular-nums text-[11px] font-semibold ${
                      display === "cost" ? "text-red-700" : "text-gray-900"
                    }`}>
                      {display === "cost" ? fmtSigned(group.cash_total, "pos") : fmtMoney(group.cash_total)}
                    </td>
                  </tr>
                  {cashRows.map((acct) => (
                    <AccountRow key={`cash-${acct.account_no}|${acct.division}`} acct={acct} display={display} tone="normal" />
                  ))}

                  {hasDepreciation && (
                    <>
                      <tr className="bg-gray-100/40 border-t border-gray-200">
                        <td colSpan={3} className="px-4 py-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold italic">
                            Non-Cash Expenses (add-back eligible)
                            <InfoTooltip text={DEPRECIATION_HELP} align="left" />
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-[11px] font-semibold text-gray-500 italic">
                          {display === "cost" ? fmtSigned(group.depreciation_total, "pos") : fmtMoney(group.depreciation_total)}
                        </td>
                      </tr>
                      {depreciationRows.map((acct) => (
                        <AccountRow key={`dep-${acct.account_no}|${acct.division}`} acct={acct} display={display} tone="muted" />
                      ))}
                    </>
                  )}

                  {hasAllocation && (
                    <>
                      <tr className="bg-gray-100/30 border-t border-gray-200">
                        <td colSpan={3} className="px-4 py-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold italic">
                            Internal Allocations (display only)
                            <InfoTooltip text={ALLOCATION_HELP} align="left" />
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-[11px] font-semibold text-gray-400 italic">
                          {display === "cost" ? fmtSigned(group.allocation_total, "pos") : fmtMoney(group.allocation_total)}
                        </td>
                      </tr>
                      {allocationRows.map((acct) => (
                        <AccountRow key={`alloc-${acct.account_no}|${acct.division}`} acct={acct} display={display} tone="very-muted" />
                      ))}
                    </>
                  )}
                </>
              ) : (
                sortedData.map((acct) => (
                  <AccountRow key={`${acct.account_no}|${acct.division}`} acct={acct} display={display} tone="normal" />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Bottom summary ──────────────────────────────────────────────────────────
// Shows accrual operating income, the DEPRECIATION add-back (only true
// non-cash — allocations are excluded because their underlying cash was
// already spent elsewhere), and the resulting cash-from-operations.
// Matches cash_operating_income from the API within a penny. When a
// category has allocations, they're surfaced as a footnote so the reader
// sees why they're not in the add-back.

function BottomSummary({ data }: { data: PnlBreakdownResponse }) {
  const depreciationAddBack =
    data.direct_job_costs.depreciation_total +
    data.payroll_field.depreciation_total +
    data.overhead.depreciation_total;

  const allocationNote =
    data.direct_job_costs.allocation_total +
    data.payroll_field.allocation_total +
    data.overhead.allocation_total;

  const opIncomeColor =
    data.operating_income >= 0 ? "text-green-700" : "text-red-700";
  const cashOpColor =
    data.cash_operating_income >= 0 ? "text-green-700" : "text-red-700";

  return (
    <div className="border-t-2 border-gray-300 px-4 py-3 flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-gray-900">Operating Income (accrual)</span>
        <span className={`font-semibold tabular-nums ${opIncomeColor}`}>
          {fmtMoney(data.operating_income)}
        </span>
      </div>
      <div className="flex items-center justify-between text-gray-600">
        <span className="inline-flex items-center gap-1">
          + Depreciation add-back
          <InfoTooltip
            text="Adding true non-cash expenses (depreciation, amortization) back to accrual income to approximate cash impact. Internal allocations are NOT added back because their underlying cash was already spent through other accounts."
            align="left"
          />
        </span>
        <span className="font-semibold tabular-nums">
          {depreciationAddBack === 0 ? fmtMoney(0) : `+${fmtMoney(depreciationAddBack)}`}
        </span>
      </div>
      <div className="border-t border-gray-200 mt-1 pt-1 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Cash from Operations</span>
        <span className={`text-base font-bold tabular-nums ${cashOpColor}`}>
          {fmtMoney(data.cash_operating_income)}
        </span>
      </div>
      {allocationNote !== 0 && (
        <p className="text-[11px] text-gray-400 italic mt-1">
          Internal allocations ({fmtMoney(allocationNote)}) are shown in the breakdown for reference but are not added back.
        </p>
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
          <BottomSummary data={data} />
        </>
      )}
    </div>
  );
}
