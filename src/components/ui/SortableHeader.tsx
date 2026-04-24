"use client";

import type { SortState } from "@/hooks/useTableSort";

// Clickable <th> with an ASC/DESC indicator. One arrow next to the label
// on the active column; no arrow on inactive columns (the default-sort
// hint lives in the component using the hook, if any).

interface Props<T> {
  label: React.ReactNode;
  column: keyof T;
  sortState: SortState<T>;
  onSort: (column: keyof T) => void;
  /** Tailwind extras — width, text-align, etc. Merged after base classes. */
  className?: string;
  align?: "left" | "right" | "center";
}

export default function SortableHeader<T>({
  label,
  column,
  sortState,
  onSort,
  className = "",
  align = "left",
}: Props<T>) {
  const active = sortState !== null && sortState.column === column;
  const arrow = active ? (sortState!.direction === "asc" ? "▲" : "▼") : null;
  const alignCls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "";
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "";
  return (
    <th
      onClick={() => onSort(column)}
      className={`table-th cursor-pointer select-none hover:bg-gray-100 transition-colors ${alignCls} ${className}`}
      aria-sort={active ? (sortState!.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        <span>{label}</span>
        {arrow && <span className="text-[10px] text-gray-500">{arrow}</span>}
      </span>
    </th>
  );
}
