// Fiscal year week helpers for Core Construction Metrics.
//
// Week layout:
//   Week 1  : Jan 1 → first Saturday (inclusive). If Jan 1 IS Saturday, 1-day week.
//   Mid weeks: Sunday → Saturday
//   Final week: last Sunday → Dec 31 (week_ending = Dec 31, even if not Saturday)

export interface FiscalWeek {
  week_num:    number;
  start:       Date;     // UTC midnight
  end:         Date;     // UTC midnight
  week_ending: string;   // YYYY-MM-DD
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function isoOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function getFiscalWeeks(year: number): FiscalWeek[] {
  const weeks: FiscalWeek[] = [];
  const jan1   = utc(year, 0, 1);
  const dec31  = utc(year, 11, 31);

  // 0=Sun … 6=Sat
  const jan1Day   = jan1.getUTCDay();
  const daysToSat = jan1Day === 6 ? 0 : (6 - jan1Day);

  let start = jan1;
  let end   = new Date(Date.UTC(year, 0, 1 + daysToSat)); // first Saturday

  let weekNum = 1;

  while (start <= dec31) {
    // Never go past Dec 31
    const cappedEnd = end > dec31 ? dec31 : end;
    weeks.push({
      week_num:    weekNum,
      start:       new Date(start),
      end:         new Date(cappedEnd),
      week_ending: isoOf(cappedEnd),
    });
    weekNum++;

    // Advance: next week starts the day after cappedEnd
    const nextStart = new Date(cappedEnd);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    start = nextStart;
    if (start > dec31) break;

    // Next Saturday from nextStart
    const nextDay   = nextStart.getUTCDay();
    const toNextSat = nextDay === 6 ? 0 : (6 - nextDay);
    end = new Date(nextStart);
    end.setUTCDate(nextStart.getUTCDate() + toNextSat);
  }

  return weeks;
}

export function currentFiscalWeekEnding(today: Date): string {
  const year  = today.getUTCFullYear();
  const todayT = today.getTime();
  const weeks = getFiscalWeeks(year);
  for (const w of weeks) {
    if (todayT >= w.start.getTime() && todayT <= w.end.getTime()) {
      return w.week_ending;
    }
  }
  // If today is somehow outside (shouldn't happen), return last week's ending.
  return weeks[weeks.length - 1].week_ending;
}

/** Returns true if the date string (YYYY-MM-DD) is a valid fiscal week ending. */
export function isValidWeekEnding(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  const year  = d.getUTCFullYear();
  const weeks = getFiscalWeeks(year);
  return weeks.some((w) => w.week_ending === dateStr);
}
