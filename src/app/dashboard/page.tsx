"use client";

import { useEffect, useState } from "react";
import type { MetricsResponse } from "@/app/api/metrics/route";
import KPICards, { KPISkeleton, fmtDate } from "@/components/dashboard/KPICards";
import type { CashBurnData } from "@/app/api/metrics/cash-burn/route";
import WeeklyCharts from "@/components/dashboard/WeeklyCharts";
import BacklogCharts from "@/components/dashboard/BacklogCharts";
import MonthlySection from "@/components/dashboard/MonthlySection";
import ExecutiveSummary from "@/components/dashboard/ExecutiveSummary";
import RatioTrends from "@/components/dashboard/RatioTrends";
import DashboardPDF from "@/components/dashboard/DashboardPDF";
import Projections from "@/components/dashboard/Projections";
import type { ProjectionsData } from "@/app/api/projections/route";

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

// ─── Skeleton for charts ──────────────────────────────────────────────────────

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm animate-pulse"
      style={{ height }}
    />
  );
}

function ChartSkeletons() {
  return (
    <div className="flex flex-col gap-5">
      <ChartSkeleton height={320} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartSkeleton height={260} />
        <ChartSkeleton height={260} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartSkeleton height={260} />
        <ChartSkeleton height={260} />
      </div>
    </div>
  );
}

function RatioSkeletons() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartSkeleton height={260} />
        <ChartSkeleton height={260} />
        <ChartSkeleton height={260} />
      </div>
      <ChartSkeleton height={220} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data,       setData]       = useState<MetricsResponse | null>(null);
  const [projData,   setProjData]   = useState<ProjectionsData | null>(null);
  const [projError,  setProjError]  = useState("");
  const [projLoading, setProjLoading] = useState(true);
  const [burnData,   setBurnData]   = useState<CashBurnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function fetchData() {
    setLoading(true);
    setError("");
    fetch("/api/metrics")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MetricsResponse>;
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  function fetchBurn() {
    fetch("/api/metrics/cash-burn")
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<CashBurnData>;
      })
      .then((d) => { if (d) setBurnData(d); })
      .catch(() => {}); // silent failure — column may not exist yet
  }

  function fetchProjections() {
    setProjLoading(true);
    setProjError("");
    fetch("/api/projections")
      .then(async (r) => {
        if (r.status === 422) {
          // not enough data — silently swallow
          const body = await r.json();
          setProjError(body.error ?? "Not enough data for projections.");
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProjectionsData>;
      })
      .then((d) => { if (d) setProjData(d); })
      .catch((e) => setProjError(String(e)))
      .finally(() => setProjLoading(false));
  }

  useEffect(() => {
    fetchData();
    fetchProjections();
    fetchBurn();
  }, []);

  const weeks  = data?.weeks  ?? [];
  const months = data?.months ?? [];
  const latest = weeks[weeks.length - 1];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {latest
              ? `Latest data: week ending ${fmtDate(latest.week_ending)} · ${weeks.length} week${weeks.length === 1 ? "" : "s"} on record`
              : "Weekly metrics overview"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && !loading && (
            <DashboardPDF weeks={weeks} months={months} />
          )}
          <button
            onClick={fetchData}
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
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Failed to load metrics: {error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && weeks.length === 0 && (
        <div className="card px-6 py-16 text-center mb-6">
          <p className="text-gray-500 text-sm mb-2 font-medium">No weekly data yet.</p>
          <p className="text-gray-400 text-xs">
            Head to{" "}
            <a href="/weeks" className="text-[#1B2A4A] underline">All Weeks</a>{" "}
            and enter at least one week to populate the dashboard.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-10">
        {/* 0 — Executive Summary */}
        {!loading && weeks.length > 0 && (
          <ExecutiveSummary weeks={weeks} months={months} />
        )}
        {loading && <ChartSkeleton height={260} />}

        {/* 1 — KPI Cards */}
        <Section title="Key Metrics">
          {loading ? <KPISkeleton /> : <KPICards weeks={weeks} cashBurn={burnData ?? undefined} />}
        </Section>

        {/* 2 — Weekly Trends */}
        <Section title="Weekly Trends">
          {loading ? <ChartSkeletons /> : <WeeklyCharts weeks={weeks} />}
        </Section>

        {/* 3 — Financial Health Ratios */}
        <Section title="Financial Health Ratios — Trending">
          {loading ? <RatioSkeletons /> : <RatioTrends weeks={weeks} />}
        </Section>

        {/* 4 — Backlog & Pipeline */}
        <Section title="Backlog & Pipeline">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ChartSkeleton height={300} />
              <ChartSkeleton height={260} />
            </div>
          ) : (
            <BacklogCharts weeks={weeks} />
          )}
        </Section>

        {/* 5 — 4-Week Projections */}
        <Section title="4-Week Projections">
          {projLoading ? (
            <div className="flex flex-col gap-5">
              <ChartSkeleton height={320} />
              <ChartSkeleton height={220} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <ChartSkeleton height={200} />
                <ChartSkeleton height={200} />
                <ChartSkeleton height={200} />
              </div>
            </div>
          ) : projError ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center">
              <p className="text-sm text-gray-400 italic">{projError}</p>
              {projError.toLowerCase().includes("weeks") && (
                <p className="text-xs text-gray-400 mt-2">
                  Need at least 4 weeks of historical data for projections.
                </p>
              )}
            </div>
          ) : projData ? (
            <Projections data={projData} />
          ) : null}
        </Section>

        {/* 6 — Monthly Analysis */}
        <Section title="Monthly Analysis">
          {loading ? (
            <div className="flex flex-col gap-5">
              <ChartSkeleton height={320} />
              <ChartSkeleton height={240} />
            </div>
          ) : (
            <MonthlySection months={months} />
          )}
        </Section>
      </div>
    </div>
  );
}
