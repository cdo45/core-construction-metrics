"use client";

import type { WeekMetric, MonthMetric } from "@/app/api/metrics/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(n);
}

function fmtPct(n: number, decimals = 1): string {
  if (!isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

function fmtRatio(v: number | null): string {
  if (v === null || !isFinite(v)) return "N/A";
  return v.toFixed(2);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function fmtMonth(ym: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [, m] = ym.split("-");
  return months[parseInt(m, 10) - 1] ?? ym;
}

// ─── Inline text helpers ──────────────────────────────────────────────────────

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold text-white">{children}</strong>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 bg-amber-400/20 text-amber-300 font-semibold px-1.5 py-0.5 rounded text-xs">
      ⚠ {children}
    </span>
  );
}

function Good({ children }: { children: React.ReactNode }) {
  return <span className="text-green-400 font-semibold">{children}</span>;
}

function Bad({ children }: { children: React.ReactNode }) {
  return <span className="text-red-400 font-semibold">{children}</span>;
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-white/10 my-3" />;
}

// ─── Paragraph ───────────────────────────────────────────────────────────────

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-blue-100">{children}</p>;
}

// ─── Payroll streak count ─────────────────────────────────────────────────────

function payrollStreak(weeks: WeekMetric[]): number {
  if (weeks.length < 2) return 0;
  let streak = 0;
  for (let i = weeks.length - 1; i > 0; i--) {
    if (weeks[i].payroll > weeks[i - 1].payroll) streak++;
    else break;
  }
  return streak;
}

// ─── Ratio status color ───────────────────────────────────────────────────────

function ratioColor(
  v: number | null,
  good: number,
  warn: number,
  higherIsBetter = true
): { color: string; label: string } {
  if (v === null || !isFinite(v)) return { color: "text-gray-400", label: "N/A" };
  if (higherIsBetter) {
    if (v >= good) return { color: "text-green-400", label: fmtRatio(v) };
    if (v >= warn) return { color: "text-amber-300", label: fmtRatio(v) };
    return { color: "text-red-400", label: fmtRatio(v) };
  } else {
    if (v <= good) return { color: "text-green-400", label: fmtRatio(v) };
    if (v <= warn) return { color: "text-amber-300", label: fmtRatio(v) };
    return { color: "text-red-400", label: fmtRatio(v) };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExecutiveSummary({
  weeks,
  months,
}: {
  weeks: WeekMetric[];
  months: MonthMetric[];
}) {
  if (weeks.length === 0) return null;

  const latest = weeks[weeks.length - 1];
  const prior  = weeks.length >= 2 ? weeks[weeks.length - 2] : null;

  const {
    cash, ar, ap, payroll,
    cash_change, ar_change, ap_change, payroll_change,
    current_ratio, quick_ratio, ar_to_ap, net_liquidity,
    cash_coverage_weeks,
  } = latest;

  const streak = payrollStreak(weeks);

  // ── Paragraph 1: Cash ─────────────────────────────────────────────────────

  const cashPct = prior && prior.cash !== 0
    ? ((cash - prior.cash) / Math.abs(prior.cash)) * 100
    : null;

  const p1: React.ReactNode[] = [];
  if (cash_change !== null && prior) {
    const dir = cash_change >= 0 ? "strengthened" : "declined";
    p1.push(
      <>
        Cash position <B>{dir}</B> by <B>{fmtMoneyShort(Math.abs(cash_change))}</B>
        {cashPct !== null ? <> (<B>{fmtPct(cashPct)}</B>)</> : null}
        {" "}to <B>{fmtMoney(cash)}</B>.
      </>
    );
  } else {
    p1.push(<>Cash on hand is <B>{fmtMoney(cash)}</B>.</>);
  }
  if (cash < 0) {
    p1.push(
      <>{" "}<Warn>Net cash position is negative at ({fmtMoney(Math.abs(cash))}).</Warn></>
    );
  }
  if (cash_coverage_weeks !== null) {
    p1.push(
      <>{" "}At the current burn rate, cash runway is approximately{" "}
      <B>{cash_coverage_weeks.toFixed(1)} weeks</B>.</>
    );
  }

  // ── Paragraph 2: AR & Collections ────────────────────────────────────────

  const p2: React.ReactNode[] = [];
  if (ar_change !== null && prior) {
    if (ar_change <= 0) {
      const collected = Math.abs(ar_change);
      const collectionRate = prior.ar > 0 ? (collected / prior.ar) * 100 : null;
      p2.push(
        <>
          Collected <B>{fmtMoneyShort(collected)}</B> from receivables this week
          {collectionRate !== null
            ? <> (a <B>{collectionRate.toFixed(1)}%</B> collection rate)</>
            : null}
          . Outstanding AR stands at <B>{fmtMoney(ar)}</B>.
        </>
      );
    } else {
      p2.push(
        <>
          Receivables grew by <B>{fmtMoneyShort(ar_change)}</B> to <B>{fmtMoney(ar)}</B>{" "}
          — billing outpaced collections this week.
        </>
      );
    }
  } else {
    p2.push(<>Accounts receivable is <B>{fmtMoney(ar)}</B>.</>);
  }

  if (ar_to_ap !== null) {
    const { color, label } = ratioColor(ar_to_ap, 1.2, 0.8);
    p2.push(
      <>{" "}AR-to-AP ratio is{" "}
      <span className={`font-bold ${color}`}>{label}</span>
      {ar_to_ap >= 1.0
        ? <Good> — receivables cover payables.</Good>
        : <Bad> — payables exceed receivables.</Bad>}
      </>
    );
  }

  // ── Paragraph 3: AP / Obligations ────────────────────────────────────────

  const p3: React.ReactNode[] = [];
  if (ap_change !== null && prior) {
    if (ap_change <= 0) {
      p3.push(
        <>
          Paid down <B>{fmtMoneyShort(Math.abs(ap_change))}</B> in trade payables,
          reducing total obligations to <B>{fmtMoney(ap)}</B>.
        </>
      );
    } else {
      p3.push(
        <>
          Trade payables grew by <B>{fmtMoneyShort(ap_change)}</B> to <B>{fmtMoney(ap)}</B>{" "}
          — new sub invoices exceeded payments.
        </>
      );
    }
  } else {
    p3.push(<>Trade payables (AP) are <B>{fmtMoney(ap)}</B>.</>);
  }
  p3.push(
    <>{" "}Total obligations (AP + Payroll): <B>{fmtMoney(ap + payroll)}</B>.</>
  );

  // ── Paragraph 4: Payroll ──────────────────────────────────────────────────

  const p4: React.ReactNode[] = [];
  if (payroll_change !== null && prior) {
    if (payroll_change <= 0) {
      p4.push(
        <>
          Payroll remittances of <B>{fmtMoneyShort(Math.abs(payroll_change))}</B>{" "}
          processed, reducing liabilities to <B>{fmtMoney(payroll)}</B>.
        </>
      );
    } else if (streak >= 3) {
      p4.push(
        <>
          <Warn>
            Payroll liabilities have grown for {streak} consecutive weeks to{" "}
            {fmtMoney(payroll)} — remittances may be falling behind.
          </Warn>
        </>
      );
    } else {
      p4.push(
        <>
          Payroll liabilities grew by <B>{fmtMoneyShort(payroll_change)}</B> to{" "}
          <B>{fmtMoney(payroll)}</B> — normal accrual between remittance cycles.
        </>
      );
    }
  } else {
    p4.push(<>Payroll liabilities stand at <B>{fmtMoney(payroll)}</B>.</>);
  }

  // ── Paragraph 5: Net Position & Ratios ───────────────────────────────────

  const crInfo  = ratioColor(current_ratio, 1.5, 1.0);
  const qrInfo  = ratioColor(quick_ratio,   0.5, 0.25);

  const p5: React.ReactNode[] = [
    <>
      Net liquidity (cash minus all obligations):{" "}
      {net_liquidity >= 0
        ? <Good>{fmtMoney(net_liquidity)}</Good>
        : <Bad>({fmtMoney(Math.abs(net_liquidity))})</Bad>
      }.{" "}
      Current ratio:{" "}
      <span className={`font-bold ${crInfo.color}`}>{crInfo.label}</span>
      {current_ratio !== null && current_ratio < 1.0
        ? <Warn>below healthy threshold</Warn>
        : null}
      .{" "}
      Quick ratio:{" "}
      <span className={`font-bold ${qrInfo.color}`}>{qrInfo.label}</span>
      {quick_ratio !== null && quick_ratio < 0.25
        ? <Warn>critically low</Warn>
        : null}
      .
    </>,
  ];

  // ── Paragraph 6: Month-over-month ─────────────────────────────────────────

  let p6: React.ReactNode | null = null;
  if (months.length >= 2) {
    const cur  = months[months.length - 1];
    const prev = months[months.length - 2];

    const pctChange = (c: number, p: number) =>
      p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null;

    const cashMoM    = pctChange(cur.avg_cash,    prev.avg_cash);
    const arMoM      = pctChange(cur.avg_ar,      prev.avg_ar);
    const apMoM      = pctChange(cur.avg_ap,      prev.avg_ap);

    const dir = (v: number | null) =>
      v === null ? "unchanged" : v > 0 ? "up" : "down";
    const colorDir = (v: number | null, inverse = false) => {
      if (v === null) return "text-blue-100";
      const positive = v > 0;
      const good = inverse ? !positive : positive;
      return good ? "text-green-400" : "text-red-400";
    };

    p6 = (
      <Para>
        Compared to <B>{fmtMonth(prev.month)}</B>, average cash is{" "}
        <span className={`font-bold ${colorDir(cashMoM)}`}>
          {dir(cashMoM)} {cashMoM !== null ? `${Math.abs(cashMoM).toFixed(1)}%` : ""}
        </span>
        , average AR is{" "}
        <span className={`font-bold ${colorDir(arMoM)}`}>
          {dir(arMoM)} {arMoM !== null ? `${Math.abs(arMoM).toFixed(1)}%` : ""}
        </span>
        , and average AP is{" "}
        <span className={`font-bold ${colorDir(apMoM, true)}`}>
          {dir(apMoM)} {apMoM !== null ? `${Math.abs(apMoM).toFixed(1)}%` : ""}
        </span>
        .
      </Para>
    );
  }

  return (
    <div
      className="rounded-xl shadow-lg p-6"
      style={{ backgroundColor: "#1B2A4A" }}
    >
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-blue-300 uppercase tracking-widest mb-0.5">
          Executive Summary
        </p>
        <h2 className="text-base font-bold text-white">
          Week Ending {fmtDate(latest.week_ending)}
        </h2>
        {prior && (
          <p className="text-xs text-blue-300 mt-0.5">
            Compared to week ending {fmtDate(prior.week_ending)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-0">
        <Para>{p1}</Para>

        <Divider />
        <Para>{p2}</Para>

        <Divider />
        <Para>{p3}</Para>

        <Divider />
        <Para>{p4}</Para>

        <Divider />
        <Para>{p5}</Para>

        {p6 && (
          <>
            <Divider />
            {p6}
          </>
        )}
      </div>
    </div>
  );
}
