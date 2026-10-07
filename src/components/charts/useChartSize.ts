"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/** Layout effect in the browser (measure before paint), plain effect on the server. */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ChartSize {
  width: number;
  height: number;
}

/**
 * The rendered size of a chart's container, kept current by a ResizeObserver.
 *
 * Every chart is as wide as its card, and the card's width is only known in
 * the browser. The size starts at `initialWidth` (0 unless the caller knows
 * better) on the server and on the hydrating render, so both produce the same
 * markup: an empty box of the final height, never a mis-sized SVG. The first
 * measurement happens in a layout effect, which React flushes before the
 * browser paints, so the chart appears at its real width on the first frame.
 *
 * The ref is a callback, so the observer follows the element: a chart that
 * swaps its root between states (skeleton, table, chart) keeps being
 * measured instead of reporting the size of a node that left the page.
 *
 * Sizes are floored to whole pixels: sub-pixel churn from a fluid grid would
 * otherwise re-render every chart on every resize frame for no visible change.
 */
export function useChartSize<T extends HTMLElement>(
  initialWidth = 0,
  enabled = true,
): [(node: T | null) => void, ChartSize] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: initialWidth, height: 0 });

  useIsomorphicLayoutEffect(() => {
    if (!node || !enabled) return;
    const apply = (width: number, height: number) => {
      const next = { width: Math.floor(width), height: Math.floor(height) };
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    const rect = node.getBoundingClientRect();
    apply(rect.width, rect.height);

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => apply(node.clientWidth, node.clientHeight);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled]);

  return [setNode, size];
}
