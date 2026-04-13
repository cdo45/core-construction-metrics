"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeekRow {
  week_ending: string;        // YYYY-MM-DD
  cash_total: string | null;
  ar_total: string | null;
  ap_total: string | null;
  payroll_total: string | null;
  bids_submitted_count: number | null;
  bids_submitted_value: string | null;
  bids_won_count: number | null;
  bids_won_value: string | null;
  bid_notes: string | null;
  doc_link: string | null;
  summary: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function fmtMoney(val: string | number | null) {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function MoneyCell({
  val,
  positive = true,
}: {
  val: string | number | null;
  positive?: boolean;
}) {
  const n = val === null ? null : parseFloat(String(val));
  const isNeg = n !== null && n < 0;
  const colorClass =
    positive
      ? isNeg ? "text-red-600" : "text-green-700"
      : isNeg ? "text-green-700" : "text-red-600";
  return (
    <span className={`font-medium ${n === null ? "text-gray-400" : colorClass}`}>
      {fmtMoney(val)}
    </span>
  );
}

// ─── Date picker modal ────────────────────────────────────────────────────────

function NewWeekModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(() => {
    // Default to most recent Friday
    const today = new Date();
    const day = today.getDay(); // 0=Sun 6=Sat
    const diff = day >= 5 ? day - 5 : day + 2; // days back to Friday
    today.setDate(today.getDate() - diff);
    return today.toISOString().split("T")[0];
  });
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleGo() {
    if (date) {
      router.push(`/weeks/${date}/enter`);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    >
      <div className="bg-white rounded-xl shadow-xl p-6 w-80">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Enter New Week</h2>
        <label className="block text-xs text-gray-600 mb-1">Week Ending Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input-field mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleGo} className="btn-primary">Go to Entry</button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeksPage() {
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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
            Weekly balance snapshots and bid activity history.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Enter New Week
        </button>
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
          <p className="text-gray-400 text-sm mb-4">No weekly data entered yet.</p>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            Enter First Week
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <th className="table-th">Week Ending</th>
                  <th className="table-th text-right">Cash on Hand</th>
                  <th className="table-th text-right">Who Owes Us</th>
                  <th className="table-th text-right">Who We Owe</th>
                  <th className="table-th text-right">Payroll</th>
                  <th className="table-th text-right">Bids Out</th>
                  <th className="table-th text-right">Bids Won</th>
                  <th className="table-th text-center">Analysis Doc</th>
                  <th className="table-th text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr
                    key={w.week_ending}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/weeks/${w.week_ending}`)}
                  >
                    <td className="table-td font-medium text-gray-900">
                      {fmtDate(w.week_ending)}
                    </td>

                    {/* Cash — green positive */}
                    <td className="table-td text-right">
                      <MoneyCell val={w.cash_total} positive={true} />
                    </td>

                    {/* AR — green positive */}
                    <td className="table-td text-right">
                      <MoneyCell val={w.ar_total} positive={true} />
                    </td>

                    {/* AP — red positive (it's a liability) */}
                    <td className="table-td text-right">
                      <MoneyCell val={w.ap_total} positive={false} />
                    </td>

                    {/* Payroll — red positive */}
                    <td className="table-td text-right">
                      <MoneyCell val={w.payroll_total} positive={false} />
                    </td>

                    {/* Bids submitted */}
                    <td className="table-td text-right">
                      {w.bids_submitted_count != null ? (
                        <span className="text-gray-700">
                          {w.bids_submitted_count}&nbsp;
                          <span className="text-gray-400 text-xs">
                            ({fmtMoney(w.bids_submitted_value)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Bids won */}
                    <td className="table-td text-right">
                      {w.bids_won_count != null ? (
                        <span className="text-gray-700">
                          {w.bids_won_count}&nbsp;
                          <span className="text-gray-400 text-xs">
                            ({fmtMoney(w.bids_won_value)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Analysis doc */}
                    <td className="table-td text-center" onClick={(e) => e.stopPropagation()}>
                      {w.doc_link ? (
                        <a
                          href={w.doc_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center text-[#1B2A4A] hover:text-blue-700"
                          title="Open analysis document"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="table-td text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => router.push(`/weeks/${w.week_ending}/enter`)}
                        className="text-xs text-[#1B2A4A] hover:underline font-medium"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && <NewWeekModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
