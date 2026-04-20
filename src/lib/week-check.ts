export interface WeekWindowResult {
  in_window:     number;
  total_dated:   number;
  pct_in_window: number;
  warning:       string | null;
}

/**
 * Check what fraction of transaction dates fall within weekEnding ± 3 days (UTC).
 * If <90% of dated rows are in-window, warning is set.
 */
export function checkWeekWindow(
  trxDates: (string | null)[],
  weekEnding: string,
): WeekWindowResult {
  const center = new Date(weekEnding + "T00:00:00Z");
  const lo = new Date(center); lo.setUTCDate(lo.getUTCDate() - 3);
  const hi = new Date(center); hi.setUTCDate(hi.getUTCDate() + 3);

  const dated = trxDates.filter((d): d is string => d !== null);
  const inWindow = dated.filter((d) => {
    const dt = new Date(d + "T00:00:00Z");
    return dt >= lo && dt <= hi;
  });

  const total_dated   = dated.length;
  const in_window     = inWindow.length;
  const pct_in_window = total_dated === 0 ? 1 : in_window / total_dated;

  const warning =
    pct_in_window < 0.9
      ? `Only ${Math.round(pct_in_window * 100)}% of transaction dates fall within the week ending ${weekEnding} window — verify you selected the right file.`
      : null;

  return { in_window, total_dated, pct_in_window, warning };
}
