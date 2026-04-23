"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { computeWeekMetadata } from "@/lib/week-math";

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
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err"; n: number } | null>(null);
  const router = useRouter();

  const fetchWeeks = useCallback(async () => {
    const r = await fetch("/api/weeks");
    const data = await r.json();
    if (Array.isArray(data)) setWeeks(data);
  }, []);

  useEffect(() => {
    fetchWeeks().finally(() => setLoading(false));
  }, [fetchWeeks]);

  async function addNextWeek() {
    if (weeks.length === 0 || adding) return;
    setAdding(true);
    try {
      // weeks[] is sorted DESC by week_ending (see GET /api/weeks), so [0] is latest.
      const latestIso = weeks[0].week_ending;
      // Parse the ISO as local midnight + 1 day to seed the next week's
      // dateBooked. computeWeekMetadata then decides the partial-week caps.
      const [ly, lm, ld] = latestIso.split("-").map((s) => parseInt(s, 10));
      const nextSeed = new Date(ly, lm - 1, ld + 1);
      const meta = computeWeekMetadata(nextSeed);

      const res = await fetch("/api/weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ msg: data?.error ?? `HTTP ${res.status}`, kind: "err", n: Date.now() });
        return;
      }
      setToast({
        msg: `Week added: ${meta.week_start} to ${meta.week_ending}`,
        kind: "ok",
        n: Date.now(),
      });
      await fetchWeeks();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : String(e), kind: "err", n: Date.now() });
    } finally {
      setAdding(false);
    }
  }

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
        <>
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
          <div className="mt-4 flex justify-center">
            <button
              onClick={addNextWeek}
              disabled={adding}
              className="btn-primary flex items-center gap-2 disabled:opacity-60"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {adding ? "Adding…" : "Add Next Week"}
            </button>
          </div>
        </>
      )}

      {toast && (
        <div
          key={toast.n}
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium ${
            toast.kind === "ok" ? "bg-[#1B2A4A] text-white" : "bg-red-600 text-white"
          }`}
          onAnimationEnd={() => setToast(null)}
          style={{ animation: "fadeOut 4s forwards" }}
        >
          {toast.msg}
          <style jsx>{`
            @keyframes fadeOut {
              0%, 80% { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
