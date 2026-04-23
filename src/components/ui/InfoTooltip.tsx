"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reusable "?" info icon.
 *
 * Hover (desktop) OR click/tap (mobile) opens a plain-English explanation.
 * Click outside or Escape closes. Keep `text` copy non-accountant-friendly —
 * no un-defined jargon, examples over formulas when possible.
 */
export default function InfoTooltip({
  text,
  align = "right",
}: {
  text: string;
  /** Anchors the tooltip's horizontal edge to the icon. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Click-outside / Escape close, but only while open to avoid dead listeners.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-gray-400"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute z-30 top-full mt-2 w-64 ${
            align === "left" ? "left-0" : "right-0"
          } bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs leading-relaxed text-gray-700`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
