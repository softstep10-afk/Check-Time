"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin 3px route-change progress bar fixed to the very top of the
 * viewport. Fires on every pathname change: animates from 0 → 80%
 * over 500ms, then when the new page actually renders (detected by
 * the pathname effect re-firing / cleanup), jumps to 100% and fades.
 *
 * Intentionally lightweight — no external dep; no global state.
 * Works anywhere inside the App Router shell since usePathname is
 * the trigger.
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    // Deferred chain: all state flips happen on timers so the effect
    // body returns before any setState runs. That keeps
    // react-hooks/set-state-in-effect happy AND avoids fighting the
    // browser's paint cycle for the initial 0% → 80% ramp.
    const start = setTimeout(() => {
      setOpacity(1);
      setWidth(80);
    }, 0);
    const peak = setTimeout(() => setWidth(100), 520);
    const fade = setTimeout(() => setOpacity(0), 640);
    const reset = setTimeout(() => setWidth(0), 860);

    return () => {
      clearTimeout(start);
      clearTimeout(peak);
      clearTimeout(fade);
      clearTimeout(reset);
    };
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 top-0 z-50"
      style={{ height: 3, opacity, transition: "opacity 220ms" }}
    >
      <div
        style={{
          height: "100%",
          width: `${width}%`,
          background: "#f59e0b",
          transition: width === 100 ? "width 120ms ease-out" : "width 500ms ease-out",
          boxShadow: "0 0 6px rgba(245, 158, 11, 0.6)",
        }}
      />
    </div>
  );
}
