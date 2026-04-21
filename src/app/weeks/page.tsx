"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeekRow {
  week_ending: string;
  week_start: string;
  fiscal_year: number;
  is_partial_week: boolean;
  is_confirmed: boolean;
  confirmed_at: string | null;
  balance_count: number;
  transaction_count: number;
  status: "Empty" | "In Progress" | "Confirmed";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function StatusBadge({ status }: { status: WeekRow["status"] }) {
  const styles = {
    Empty:       "bg-gray-100 text-gray-500",
    "In Progress": "bg-amber-100 text-amber-700",
    Confirmed:   "bg-green-100 text-green-700",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeksPage() {
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/weeks")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setWeeks(data);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Weeks</h1>
          <p className="text-sm text-gray-500 mt-1">
            Weekly balance snapshots and activity history.
          </p>
        </div>
        <div title="Coming soon — use CSV import.">
          <button
            disabled
            className="btn-primary opacity-50 cursor-not-allowed flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Enter New Week
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm">Loading…</span>
          </div>
        </div>
      ) : weeks.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <p className="text-gray-400 text-sm">
            Calendar not initialized. Contact admin.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Week Ending</th>
                  <th className="table-th">Status</th>
                  <th className="table-th w-8" />
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr
                    key={w.week_ending}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/weeks/${w.week_ending}`)}
                  >
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {fmtDate(w.week_ending)}
                        </span>
                        {w.is_partial_week && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600">
                            Partial
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-td">
                      <StatusBadge status={w.status} />
                    </td>
                    <td className="table-td text-right text-gray-400">
                      <svg className="w-4 h-4 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
