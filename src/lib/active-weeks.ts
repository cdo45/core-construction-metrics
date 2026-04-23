// Helper: "last N weeks WITH ACTIVITY" selector.
//
// Dashboards and rolling calcs should skip zero-activity weeks (weeks that
// are set up in the `weeks` table but have no imported GL data yet), or
// they silently zero out metrics. Activity = any of cat_1_cash (carry-
// forward snapshot nonzero), revenue, field payroll, overhead, or DJC != 0.
//
// Used by:
//   - /api/metrics/route.ts  (rolling windows for payroll_runway, burn_rate;
//                             monthly averages)
//   - KPICards.tsx            (latest-week snapshot + revenue last-4-weeks)
//   - TrendCharts.tsx         (last-12-weeks trend line)
//   - dashboard/page.tsx      (header "Latest week" display)
//
// NOT used for:
//   - /weeks list view, /weeks/[date] detail, /weekly-report       (users
//     still want to see every configured week, empty or not)
//   - WoW deltas inside /api/metrics                               (delta
//     is strictly calendar-adjacent; consumer picks the latest via this
//     helper)

export interface WeekActivityShape {
  cat_1_cash: number;
  cat_6_payroll_field: number;
  cat_7_overhead: number;
  cat_8_revenue: number;
  cat_9_djc: number;
}

export function isActiveWeek(w: WeekActivityShape): boolean {
  return (
    w.cat_1_cash !== 0 ||
    w.cat_6_payroll_field !== 0 ||
    w.cat_7_overhead !== 0 ||
    w.cat_8_revenue !== 0 ||
    w.cat_9_djc !== 0
  );
}

export function lastActiveWeeks<T extends WeekActivityShape>(allWeeks: T[], n: number): T[] {
  return allWeeks.filter(isActiveWeek).slice(-n);
}
