"use client";

import { useEffect, useState } from "react";
import type { MetricsResponse } from "@/app/api/metrics/route";
import KPICards, { KPISkeleton, fmtDate } from "@/components/dashboard/KPICards";
import TrendCharts from "@/components/dashboard/TrendCharts";

export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse | null>(null);
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

  useEffect(() => {
    fetchData();
  }, []);

  const weeks = data?.weeks ?? [];
  const latest = weeks[weeks.length - 1];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {latest
              ? `Latest week: ${fmtDate(latest.week_ending)} · ${weeks.length} weeks on record`
              : loading
              ? "Loading…"
              : "No data yet"}
          </p>
        </div>
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
          <p className="text-sm text-gray-500 mb-2 font-medium">No weekly data yet.</p>
          <p className="text-xs text-gray-400">
            Head to{" "}
            <a href="/weeks" className="text-[#1B2A4A] underline">All Weeks</a>{" "}
            and enter at least one week to populate the dashboard.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {loading ? <KPISkeleton /> : <KPICards weeks={weeks} />}
        {!loading && weeks.length > 0 && <TrendCharts weeks={weeks} />}
      </div>
    </div>
  );
}
