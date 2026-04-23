"use client";

import { useEffect, useRef, useState } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

/**
 * Small slider for the revenue-growth target that drives the "Grow Number"
 * card. Value is a decimal (0..0.30) in steps of 0.05; UI shows it as a
 * percentage. 300ms debounce before notifying the parent so dragging the
 * thumb doesn't fire a fetch per frame.
 */
export default function GrowthTargetSlider({
  value,
  onCommit,
}: {
  /** Current committed value, as a decimal (e.g., 0.10 for 10%). */
  value: number;
  /** Fired 300ms after the user stops dragging. */
  onCommit: (next: number) => void;
}) {
  // Local state tracks the current slider position so the handle moves
  // smoothly; `onCommit` only fires after the debounce settles.
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from parent on external changes (e.g., URL param updates).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Clear pending debounce on unmount so the parent isn't called post-unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleChange(pctInt: number) {
    const next = pctInt / 100;
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), 300);
  }

  const pctDisplay = Math.round(local * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3 flex items-center gap-4">
      <label htmlFor="growth-target" className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 whitespace-nowrap">
        Revenue growth target: {pctDisplay}%
        <InfoTooltip text="Drives the Grow Number card. Higher targets raise the weekly collection bar. Step is 5%." />
      </label>
      <input
        id="growth-target"
        type="range"
        min={0}
        max={30}
        step={5}
        value={pctDisplay}
        onChange={(e) => handleChange(parseInt(e.target.value, 10))}
        className="flex-1 accent-[#1B2A4A]"
      />
      <span className="text-[10px] text-gray-400 w-10 text-right tabular-nums">
        {pctDisplay}%
      </span>
    </div>
  );
}
