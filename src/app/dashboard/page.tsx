"use client";

import { useEffect, useState } from "react";
import type { MetricsResponse } from "@/app/api/metrics/route";
import KPICards, { KPISkeleton, fmtDate } from "@/components/dashboard/KPICards";
import WeeklyCharts from "@/components/dashboard/WeeklyCharts";
import BacklogCharts from "@/components/dashboard/BacklogCharts";
import MonthlySection from "@/components/dashboard/MonthlySection";

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/metrics")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MetricsResponse>;
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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
        {data && !loading && (
          <button
            onClick={() => {
              setLoading(true);
              setError("");
              fetch("/api/metrics")
                .then((r) => r.json())
                .then(setData)
                .catch((e) => setError(String(e)))
                .finally(() => setLoading(false));
            }}
            className="btn-secondary flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
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

      {/* Empty state — no data at all */}
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
        {/* 1 — KPI Cards */}
        <Section title="Key Metrics">
          {loading ? <KPISkeleton /> : <KPICards weeks={weeks} />}
        </Section>

        {/* 2 — Weekly Trends */}
        <Section title="Weekly Trends">
          {loading ? <ChartSkeletons /> : <WeeklyCharts weeks={weeks} />}
        </Section>

        {/* 3 — Backlog & Pipeline */}
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

        {/* 4 — Monthly Analysis */}
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
