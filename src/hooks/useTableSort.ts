"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SortDirection = "asc" | "desc";

export interface SortTier<T> {
  column: keyof T;
  direction: SortDirection;
}

export interface SortSpec<T> extends SortTier<T> {
  /** Tiebreakers applied after the primary. Used for "account_no then
   *  division" default behavior. */
  secondary?: Array<SortTier<T>>;
}

export type SortState<T> = SortTier<T> | null;

// ─── Comparator ──────────────────────────────────────────────────────────────
// Order rules:
//   null / undefined / ""   → NULLS FIRST (asc) / NULLS LAST (desc, via inversion)
//   number vs number        → numeric
//   boolean vs boolean      → false < true
//   everything else         → string via localeCompare({ numeric: true })
//                              (natural-sort-aware: "20" < "99" < "100")

function compareAsc(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;

  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────
//
// Click cycle per column:
//   (default) → click col → asc on col → click again → desc on col
//             → click again → back to default (null state)
//
// When a user-selected sort is active, the default spec's tiers are still
// applied as tiebreakers after the user's column (excluding duplicates).
// storageKey should be stable per-table: "tablesort:<ComponentName>".

export function useTableSort<T extends object>(
  data: T[],
  defaultSort: SortSpec<T>,
  storageKey: string,
) {
  const [sortState, setSortState] = useState<SortState<T>>(null);

  // Hydrate from localStorage after mount. Skipped at SSR time so the
  // client and server render agree; the first client paint uses the
  // default sort until hydration runs.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey)
        : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "column" in parsed &&
        "direction" in parsed &&
        (parsed as { direction: unknown }).direction !== undefined
      ) {
        const dir = (parsed as { direction: unknown }).direction;
        if (dir === "asc" || dir === "desc") {
          setSortState({
            column: (parsed as { column: keyof T }).column,
            direction: dir,
          });
        }
      }
    } catch {
      // ignore corrupt stored state
    }
  }, [storageKey]);

  const sortBy = useCallback(
    (column: keyof T) => {
      setSortState((prev) => {
        let next: SortState<T>;
        if (!prev || prev.column !== column) {
          next = { column, direction: "asc" };
        } else if (prev.direction === "asc") {
          next = { column, direction: "desc" };
        } else {
          next = null; // revert to default
        }
        try {
          if (next) {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } else {
            window.localStorage.removeItem(storageKey);
          }
        } catch {
          // ignore storage errors (private browsing, quota)
        }
        return next;
      });
    },
    [storageKey],
  );

  const sortedData = useMemo(() => {
    const defaultTiers: SortTier<T>[] = [
      { column: defaultSort.column, direction: defaultSort.direction },
      ...(defaultSort.secondary ?? []),
    ];
    const tiers: SortTier<T>[] = sortState
      ? [
          { column: sortState.column, direction: sortState.direction },
          ...defaultTiers.filter((t) => t.column !== sortState.column),
        ]
      : defaultTiers;

    const arr = data.slice();
    arr.sort((a, b) => {
      for (const tier of tiers) {
        const av = (a as Record<string, unknown>)[tier.column as string];
        const bv = (b as Record<string, unknown>)[tier.column as string];
        const cmp = compareAsc(av, bv);
        if (cmp !== 0) return tier.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
  }, [data, sortState, defaultSort]);

  return { sortedData, sortBy, sortState };
}
