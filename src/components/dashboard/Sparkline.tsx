"use client";

import {
  LineChart,
  Line,
  Dot,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

export type SparklineFormat = "money" | "ratio" | "pct" | "weeks";

export interface SparklinePoint {
  label: string;
  value: number;
}

interface Props {
  data: SparklinePoint[];
  /** Dotted horizontal line — rolling avg for $ metrics, benchmark for
   *  ratios/weeks. Included in the Y-domain so the line is always on-chart. */
  referenceValue?: number;
  /** Optional label (e.g. "avg", "healthy") surfaced in the tooltip. */
  referenceLabel?: string;
  /** Line color. Falls back to blue. */
  color?: string;
  height?: number;
  width?: number;
  format?: SparklineFormat;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtMoneyShort(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtValue(n: number, format?: SparklineFormat): string {
  if (!isFinite(n)) return "—";
  switch (format) {
    case "ratio":
      return n.toFixed(2);
    case "pct":
      return `${n.toFixed(1)}%`;
    case "weeks":
      return `${n.toFixed(1)} wks`;
    case "money":
    default:
      return fmtMoneyShort(n);
  }
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function SparkTooltip({
  active,
  payload,
  label,
  format,
  referenceValue,
  referenceLabel,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: SparklinePoint }>;
  label?: string;
  format?: SparklineFormat;
  referenceValue?: number;
  referenceLabel?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0].value);
  return (
    <div className="bg-white border border-gray-200 rounded px-2 py-1 shadow-sm text-[10px] space-y-0.5">
      <div className="text-gray-500">{label}</div>
      <div className="font-semibold text-gray-900 tabular-nums">
        {fmtValue(v, format)}
      </div>
      {referenceValue !== undefined && isFinite(referenceValue) && (
        <div className="text-gray-400">
          {referenceLabel ?? "ref"}: <span className="tabular-nums">{fmtValue(referenceValue, format)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Active dot (last point emphasised) ──────────────────────────────────────

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  color: string;
  lastIndex: number;
}

function LastPointDot(props: DotProps) {
  const { cx, cy, index, color, lastIndex } = props;
  if (cx === undefined || cy === undefined) return null;
  const isLast = index === lastIndex;
  return (
    <Dot
      cx={cx}
      cy={cy}
      r={isLast ? 3 : 0}
      fill={color}
      stroke="#fff"
      strokeWidth={isLast ? 1 : 0}
    />
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function Sparkline({
  data,
  referenceValue,
  referenceLabel,
  color = "#1F6FEB",
  height = 40,
  width = 120,
  format = "money",
}: Props) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[9px] text-gray-300 italic"
      >
        no data
      </div>
    );
  }

  // Map to recharts-shaped rows. Keep the label for the tooltip + x-axis
  // (hidden) domain.
  const chartData = data.map((p, i) => ({
    label: p.label,
    value: p.value,
    _i: i,
  }));

  const lastIndex = chartData.length - 1;

  // Extend Y-domain to include the reference line so it's always visible.
  const values = chartData.map((d) => d.value);
  if (referenceValue !== undefined && isFinite(referenceValue)) {
    values.push(referenceValue);
  }
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  // Add a small pad so the line doesn't clip the top/bottom edge. Avoid
  // zero-pad when everything is flat — use 1 as a floor pad.
  const pad = Math.max((yMax - yMin) * 0.15, 1);
  const domain: [number, number] = [yMin - pad, yMax + pad];

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <XAxis dataKey="label" hide />
          <YAxis domain={domain} hide />
          <Tooltip
            cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }}
            content={(p: unknown) => {
              const props = p as {
                active?: boolean;
                payload?: Array<{ value?: number; payload?: SparklinePoint }>;
                label?: string;
              };
              return (
                <SparkTooltip
                  {...props}
                  format={format}
                  referenceValue={referenceValue}
                  referenceLabel={referenceLabel}
                />
              );
            }}
          />
          {referenceValue !== undefined && isFinite(referenceValue) && (
            <ReferenceLine
              y={referenceValue}
              stroke="#9ca3af"
              strokeDasharray="2 2"
              strokeWidth={1}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={(dotProps: unknown) => {
              const p = dotProps as { cx?: number; cy?: number; index?: number };
              return (
                <LastPointDot
                  cx={p.cx}
                  cy={p.cy}
                  index={p.index}
                  color={color}
                  lastIndex={lastIndex}
                />
              );
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
