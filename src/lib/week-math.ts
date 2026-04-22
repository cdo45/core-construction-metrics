// Week boundary math for Foundation GL CSV imports.
// Weeks run Sunday–Saturday. Year boundaries truncate to Jan 1 / Dec 31.

export interface WeekBounds {
  weekStart: Date;
  weekEnding: Date;
  fiscalYear: number;
  isPartial: boolean;
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
  return d.toISOString().slice(0, 10);
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
}
