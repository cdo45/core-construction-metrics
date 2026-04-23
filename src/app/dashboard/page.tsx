"use client";

import { useEffect, useState } from "react";
import type { MetricsResponse } from "@/app/api/metrics/route";

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {loading ? "Loading…" : data ? `${data.weeks.length} weeks on record` : "—"}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* KPI cards and trend charts will be rendered here in chunks 2 and 3. */}
    </div>
  );
}
