"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MetricsResponse } from "@/app/api/metrics/route";
import type { PnlBreakdownResponse } from "@/app/api/pnl-breakdown/route";
import KPICards, { KPISkeleton, fmtDate } from "@/components/dashboard/KPICards";
import CashVsDebtChart from "@/components/dashboard/CashVsDebtChart";
import DebtPaydownChart from "@/components/dashboard/DebtPaydownChart";
import RevenueVsCostChart from "@/components/dashboard/RevenueVsCostChart";
import PnlBreakdownTable from "@/components/dashboard/PnlBreakdownTable";
import RunwayKPICards from "@/components/dashboard/RunwayKPICards";
import GrowthTargetSlider from "@/components/dashboard/GrowthTargetSlider";
import CashFlowTrendChart from "@/components/dashboard/CashFlowTrendChart";
import WhatIfCalculator from "@/components/dashboard/WhatIfCalculator";
import { lastActiveWeeks } from "@/lib/active-weeks";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeeksListRow {
  week_ending: string;
  fiscal_year: number;
  is_partial_week: boolean;
  balance_count: number;
  transaction_count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  // 2025-03 → "Mar 2025"
  const [y, m] = ym.split("-");
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  // useSearchParams forces client-side rendering — wrap in Suspense so the
  // build can pre-render the static shell. Inner component holds all state.
  return (
    <Suspense fallback={<DashboardShell />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardShell() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Loading…</p>
      </div>
      <KPISkeleton />
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL-scoped filter state (null means "not set yet — use default").
  const fyParam = searchParams.get("fy");
  const monthParam = searchParams.get("month");

  const [weeksList, setWeeksList] = useState<WeeksListRow[] | null>(null);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [pnlData, setPnlData] = useState<PnlBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [error, setError] = useState("");
  // Growth target for the "Grow Number" card. Not URL-persisted — the slider
  // is an exploratory knob; FY/month carry the link-shareable state.
  const [growthTarget, setGrowthTarget] = useState(0.10);

  // "Include LOC" toggle owned here so KPICards and RunwayKPICards observe
  // the same state. Default OFF; hydrated from localStorage after mount so
  // SSR and first client paint agree.
  const [includeLoc, setIncludeLoc] = useState(false);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined"
        ? window.localStorage.getItem("include_loc")
        : null;
      if (raw === "true") setIncludeLoc(true);
    } catch {
      // ignore
    }
  }, []);
  const onIncludeLocChange = useCallback((next: boolean) => {
    setIncludeLoc(next);
    try {
      window.localStorage.setItem("include_loc", String(next));
    } catch {
      // ignore
    }
  }, []);

  // 1) Load calendar so we know which FYs + months exist and which are "active".
  useEffect(() => {
    fetch("/api/weeks")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setWeeksList(d) : setWeeksList([]))
      .catch(() => setWeeksList([]));
  }, []);

  // Derive available FYs (DESC) and per-FY months with activity flags.
  const { fyOptions, monthsByFy, activeMonthSet } = useMemo(() => {
    const fySet = new Set<number>();
    const byFy = new Map<number, Set<string>>();
    const activeSet = new Set<string>(); // keys like "fy:month"
    for (const w of weeksList ?? []) {
      fySet.add(w.fiscal_year);
      const month = w.week_ending.slice(0, 7);
      if (!byFy.has(w.fiscal_year)) byFy.set(w.fiscal_year, new Set());
      byFy.get(w.fiscal_year)!.add(month);
      if (w.transaction_count > 0) activeSet.add(`${w.fiscal_year}:${month}`);
    }
    const fyOpts = Array.from(fySet).sort((a, b) => b - a);
    const monthsObj: Record<number, string[]> = {};
    for (const [fy, set] of byFy) monthsObj[fy] = Array.from(set).sort();
    return { fyOptions: fyOpts, monthsByFy: monthsObj, activeMonthSet: activeSet };
  }, [weeksList]);

  // 2) Resolve the effective FY: URL param wins; else latest FY with activity.
  const effectiveFy = useMemo<number | null>(() => {
    if (fyParam && /^\d{4}$/.test(fyParam)) return parseInt(fyParam, 10);
    if (fyOptions.length === 0) return null;
    // Pick the newest FY that has at least one active month
    for (const fy of fyOptions) {
      const months = monthsByFy[fy] ?? [];
      if (months.some((m) => activeMonthSet.has(`${fy}:${m}`))) return fy;
    }
    return fyOptions[0];
  }, [fyParam, fyOptions, monthsByFy, activeMonthSet]);

  const effectiveMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;

  // 3) Fetch metrics whenever the effective filter changes.
  const fetchMetrics = useCallback(
    async (fy: number | null, month: string | null, growthTargetPct: number) => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        if (fy !== null) qs.set("fiscal_year", String(fy));
        if (month !== null) qs.set("month", month);
        qs.set("growth_target_pct", growthTargetPct.toFixed(2));
        const url = qs.toString() ? `/api/metrics?${qs.toString()}` : "/api/metrics";
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as MetricsResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // P&L breakdown uses the same FY (required) + optional month. Fire in
  // parallel with /api/metrics so the page settles in one render cycle.
  const fetchPnl = useCallback(async (fy: number | null, month: string | null) => {
    if (fy === null) {
      setPnlData(null);
      return;
    }
    setPnlLoading(true);
    try {
      const qs = new URLSearchParams({ fiscal_year: String(fy) });
      if (month !== null) qs.set("month", month);
      const res = await fetch(`/api/pnl-breakdown?${qs.toString()}`);
      if (!res.ok) {
        setPnlData(null);
        return;
      }
      setPnlData((await res.json()) as PnlBreakdownResponse);
    } catch {
      setPnlData(null);
    } finally {
      setPnlLoading(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveFy === null) return; // wait for weeksList
    fetchMetrics(effectiveFy, effectiveMonth, growthTarget);
    fetchPnl(effectiveFy, effectiveMonth);
  }, [effectiveFy, effectiveMonth, growthTarget, fetchMetrics, fetchPnl]);

  // 4) Toggle handlers — update the URL; a router.replace keeps history clean.
  function updateUrl(nextFy: number | null, nextMonth: string | null) {
    const qs = new URLSearchParams();
    if (nextFy !== null) qs.set("fy", String(nextFy));
    if (nextMonth !== null) qs.set("month", nextMonth);
    const suffix = qs.toString();
    router.replace(suffix ? `/dashboard?${suffix}` : "/dashboard");
  }

  function selectFy(fy: number) {
    // Changing FY drops any month selection — months are scoped to the FY.
    updateUrl(fy, null);
  }

  function selectMonth(month: string | null) {
    updateUrl(effectiveFy, month);
  }

  // 5) Render helpers for toggle pills.
  const currentMonths = effectiveFy !== null ? (monthsByFy[effectiveFy] ?? []) : [];
  const weeks = data?.weeks ?? [];
  const [latestActive] = lastActiveWeeks(weeks, 1);
  const latest = latestActive ?? weeks[weeks.length - 1];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {latest
              ? `Latest active week: ${fmtDate(latest.week_ending)} · ${weeks.length} weeks in view`
              : loading
              ? "Loading…"
              : "No data in this period"}
          </p>
        </div>
        <button
          onClick={() => fetchMetrics(effectiveFy, effectiveMonth, growthTarget)}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 disabled:opacity-50"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* FY + Month toggles */}
      {fyOptions.length > 0 && (
        <div className="card px-4 py-3 mb-6 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Fiscal Yr</span>
            <div className="flex flex-wrap gap-2">
              {fyOptions.map((fy) => {
                const selected = fy === effectiveFy;
                return (
                  <button
                    key={fy}
                    onClick={() => selectFy(fy)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-[#1B2A4A] text-white border-[#1B2A4A]"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {fy}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Month</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => selectMonth(null)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  effectiveMonth === null
                    ? "bg-[#1B2A4A] text-white border-[#1B2A4A]"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                All
              </button>
              {currentMonths.map((m) => {
                const selected = effectiveMonth === m;
                const isActive = effectiveFy !== null && activeMonthSet.has(`${effectiveFy}:${m}`);
                return (
                  <button
                    key={m}
                    onClick={() => selectMonth(m)}
                    disabled={!isActive}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-[#1B2A4A] text-white border-[#1B2A4A]"
                        : !isActive
                        ? "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {monthLabel(m)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Failed to load metrics: {error}</span>
        </div>
      )}

      {!loading && !error && weeks.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-16 text-center mb-6">
          <p className="text-sm text-gray-500 mb-2 font-medium">No data in this period.</p>
          <p className="text-xs text-gray-400">
            Try a different fiscal year or month, or import a CSV on the{" "}
            <a href="/import" className="text-[#1B2A4A] underline">Import</a> page.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {loading ? (
          <KPISkeleton />
        ) : (
          <KPICards
            weeks={weeks}
            pnl={data?.pnl ?? null}
            includeLoc={includeLoc}
            onIncludeLocChange={onIncludeLocChange}
            locUndrawn={data?.loc_undrawn}
            trendSeries={data?.trend_series ?? null}
            benchmarks={data?.benchmarks ?? null}
            drilldowns={data?.drilldowns ?? null}
          />
        )}

        {/* LOC status line — informational, always visible when LOC data
            is loaded. Lives just below the KPI grid per spec. */}
        {!loading && data && (
          <LocStatusLine
            drawn={data.loc_drawn}
            limit={data.loc_limit}
            undrawn={data.loc_undrawn}
          />
        )}

        {!loading && weeks.length > 0 && (
          <>
            <SectionHeader>═══ CASH FLOW ═══</SectionHeader>
            <CashVsDebtChart weeks={weeks} />
            <DebtPaydownChart weeks={weeks} />

            <SectionHeader>═══ CASH RUNWAY &amp; GROWTH ═══</SectionHeader>
            <RunwayKPICards
              runway={data?.runway ?? null}
              includeLoc={includeLoc}
              locUndrawn={data?.loc_undrawn}
              trendSeries={data?.trend_series ?? null}
              benchmarks={data?.benchmarks ?? null}
              drilldowns={data?.drilldowns ?? null}
            />
            <GrowthTargetSlider value={growthTarget} onCommit={setGrowthTarget} />
            <CashFlowTrendChart weeks={weeks} runway={data?.runway ?? null} />
            <WhatIfCalculator runway={data?.runway ?? null} />

            <SectionHeader>═══ P&amp;L ═══</SectionHeader>
            <RevenueVsCostChart weeks={weeks} />
            <PnlBreakdownTable data={pnlData} loading={pnlLoading} />
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest text-center mt-2">
      {children}
    </h2>
  );
}

// Informational one-liner under the KPI grid. Always visible regardless
// of the "Include LOC" toggle — the toggle only controls whether the
// undrawn balance folds into liquidity math.
function LocStatusLine({
  drawn,
  limit,
  undrawn,
}: {
  drawn: number;
  limit: number;
  undrawn: number;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  return (
    <p className="text-xs text-gray-500 -mt-4">
      LOC: <span className="tabular-nums text-gray-700">{fmt(drawn)}</span> drawn
      {" / "}
      <span className="tabular-nums text-gray-700">{fmt(limit)}</span> limit
      {" · "}
      <span className="tabular-nums text-green-700">{fmt(undrawn)}</span> undrawn
    </p>
  );
}
