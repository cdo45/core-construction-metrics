// Week boundary math for Foundation GL CSV imports.
// Weeks run Sunday–Saturday. Year boundaries truncate to Jan 1 / Dec 31.

export interface WeekBounds {
  weekStart: Date;
  weekEnding: Date;
  fiscalYear: number;
  isPartial: boolean;
}

/**
 * DB-shaped week metadata keyed for INSERTs into the `weeks` table.
 * Returns ISO YYYY-MM-DD strings to avoid any Date<->string ambiguity at
 * the serialization boundary (Neon JS driver sends ISO-dates as text).
 *
 * Convention (confirmed against seeded production rows):
 *   - Normal week: Sunday → Saturday.
 *   - Year-end:   if the natural Saturday falls in the next year, the
 *                 week is capped at Dec 31 of the dateBooked year.
 *                 is_partial_week = true. fiscal_year = dateBooked year.
 *   - Year-start: if the natural Sunday falls in the prior year, the
 *                 week_start is capped at Jan 1 of the dateBooked year.
 *                 is_partial_week = true. fiscal_year = dateBooked year.
 *   - Mid-year month boundaries: NOT capped.
 *
 * Test cases (verified below in dev-only assertions):
 *   Dec 29, 2025 (Mon) → start 2025-12-28, end 2025-12-31, partial=true, fy=2025
 *   Jan  1, 2025 (Wed) → start 2025-01-01, end 2025-01-04, partial=true, fy=2025
 *   Jan 26, 2025 (Sun) → start 2025-01-26, end 2025-02-01, partial=false, fy=2025
 *   Mar 15, 2025 (Sat) → start 2025-03-09, end 2025-03-15, partial=false, fy=2025
 */
export interface WeekMetadata {
  week_start: string;      // ISO YYYY-MM-DD
  week_ending: string;     // ISO YYYY-MM-DD
  fiscal_year: number;
  is_partial_week: boolean;
}

export function computeWeekMetadata(dateBooked: Date): WeekMetadata {
  // Operate in local-date space. Callers supply Date objects that were
  // constructed from YYYY-MM-DD parts (local midnight); keeping the math
  // in local components avoids any UTC-offset drift.
  const y = dateBooked.getFullYear();
  const m = dateBooked.getMonth();
  const d = dateBooked.getDate();
  const base = new Date(y, m, d);        // strip any time-of-day
  const dow = base.getDay();             // 0=Sun … 6=Sat

  // Natural Saturday-ending, Sunday-starting week for this date.
  const naturalEnd = new Date(y, m, d + (6 - dow));
  const naturalStart = new Date(y, m, d - dow);

  let weekStart = naturalStart;
  let weekEnding = naturalEnd;
  let isPartial = false;
  let fiscalYear = y;

  // Year-end cap: natural Saturday spills into next year.
  if (naturalEnd.getFullYear() > y) {
    weekEnding = new Date(y, 11, 31);    // Dec 31 of booking year
    // weekStart stays natural (same year as dateBooked by definition)
    isPartial = true;
    fiscalYear = y;
  }
  // Year-start cap: natural Sunday was in prior year.
  else if (naturalStart.getFullYear() < y) {
    weekStart = new Date(y, 0, 1);       // Jan 1 of booking year
    // weekEnding stays natural (first Saturday of booking year)
    isPartial = true;
    fiscalYear = y;
  }

  return {
    week_start: toISO(weekStart),
    week_ending: toISO(weekEnding),
    fiscal_year: fiscalYear,
    is_partial_week: isPartial,
  };
}

export function computeWeekEnding(dateBooked: Date): WeekBounds {
  const fiscalYear = dateBooked.getFullYear();

  // Day of week: 0=Sun … 6=Sat
  const dow = dateBooked.getDay();

  // Natural Sunday start and Saturday end for this date
  const naturalStart = new Date(dateBooked);
  naturalStart.setDate(dateBooked.getDate() - dow);
  naturalStart.setHours(0, 0, 0, 0);

  const naturalEnd = new Date(naturalStart);
  naturalEnd.setDate(naturalStart.getDate() + 6);
  naturalEnd.setHours(0, 0, 0, 0);

  const yearStart = new Date(fiscalYear, 0, 1);   // Jan 1
  const yearEnd   = new Date(fiscalYear, 11, 31); // Dec 31

  let weekStart  = naturalStart;
  let weekEnding = naturalEnd;
  let isPartial  = false;

  // Sunday falls in prior year → truncate to Jan 1
  if (naturalStart.getFullYear() < fiscalYear) {
    weekStart = yearStart;
    isPartial = true;
  }

  // Saturday falls in next year → truncate to Dec 31
  if (naturalEnd.getFullYear() > fiscalYear) {
    weekEnding = yearEnd;
    isPartial  = true;
  }

  return { weekStart, weekEnding, fiscalYear, isPartial };
}

export function buildDedupeHash(
  weekEnding: string,
  basicAccountNo: number,
  division: string,
  auditNumber: string,
  debit: number,
  credit: number
): string {
  return `${weekEnding}|${basicAccountNo}|${division}|${auditNumber}|${debit}|${credit}`;
}

// ─── Inline verification (runs in dev / test environments) ───────────────────

function toISO(d: Date): string {
  // Use local-date parts; the Date objects we hand around are constructed
  // from YYYY-MM-DD (local midnight), so toISOString() would incorrectly
  // shift dates on non-UTC servers. Explicit formatting avoids the drift.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

if (process.env.NODE_ENV !== "production") {
  // 2025-01-03 (Friday) → week ending 2025-01-04 (Saturday), partial (Sun = Jan 1 still 2025, but check: natural Sun is 2024-12-29)
  const c1 = computeWeekEnding(new Date(2025, 0, 3)); // Jan 3 2025
  console.assert(toISO(c1.weekEnding) === "2025-01-04", `c1 weekEnding: ${toISO(c1.weekEnding)}`);
  console.assert(toISO(c1.weekStart)  === "2025-01-01", `c1 weekStart: ${toISO(c1.weekStart)}`);
  console.assert(c1.isPartial === true, "c1 isPartial");

  // 2025-01-08 (Wednesday) → week ending 2025-01-11 (Saturday), not partial
  const c2 = computeWeekEnding(new Date(2025, 0, 8)); // Jan 8 2025
  console.assert(toISO(c2.weekEnding) === "2025-01-11", `c2 weekEnding: ${toISO(c2.weekEnding)}`);
  console.assert(c2.isPartial === false, "c2 isPartial");

  // 2024-12-30 (Monday) → natural Saturday = 2025-01-04, truncated to 2024-12-31, partial
  const c3 = computeWeekEnding(new Date(2024, 11, 30)); // Dec 30 2024
  console.assert(toISO(c3.weekEnding) === "2024-12-31", `c3 weekEnding: ${toISO(c3.weekEnding)}`);
  console.assert(c3.isPartial === true, "c3 isPartial");

  // computeWeekMetadata test cases — the DB-shaped helper used by auto-create.
  const m1 = computeWeekMetadata(new Date(2025, 11, 29)); // Dec 29 2025, Mon
  console.assert(m1.week_start === "2025-12-28", `m1 week_start: ${m1.week_start}`);
  console.assert(m1.week_ending === "2025-12-31", `m1 week_ending: ${m1.week_ending}`);
  console.assert(m1.is_partial_week === true, "m1 is_partial_week");
  console.assert(m1.fiscal_year === 2025, `m1 fiscal_year: ${m1.fiscal_year}`);

  const m2 = computeWeekMetadata(new Date(2025, 0, 1));   // Jan 1 2025, Wed
  console.assert(m2.week_start === "2025-01-01", `m2 week_start: ${m2.week_start}`);
  console.assert(m2.week_ending === "2025-01-04", `m2 week_ending: ${m2.week_ending}`);
  console.assert(m2.is_partial_week === true, "m2 is_partial_week");
  console.assert(m2.fiscal_year === 2025, `m2 fiscal_year: ${m2.fiscal_year}`);

  const m3 = computeWeekMetadata(new Date(2025, 0, 26));  // Jan 26 2025, Sun — month boundary mid-year
  console.assert(m3.week_start === "2025-01-26", `m3 week_start: ${m3.week_start}`);
  console.assert(m3.week_ending === "2025-02-01", `m3 week_ending: ${m3.week_ending}`);
  console.assert(m3.is_partial_week === false, "m3 is_partial_week");
  console.assert(m3.fiscal_year === 2025, `m3 fiscal_year: ${m3.fiscal_year}`);

  const m4 = computeWeekMetadata(new Date(2025, 2, 15));  // Mar 15 2025, Sat
  console.assert(m4.week_start === "2025-03-09", `m4 week_start: ${m4.week_start}`);
  console.assert(m4.week_ending === "2025-03-15", `m4 week_ending: ${m4.week_ending}`);
  console.assert(m4.is_partial_week === false, "m4 is_partial_week");
  console.assert(m4.fiscal_year === 2025, `m4 fiscal_year: ${m4.fiscal_year}`);
}
