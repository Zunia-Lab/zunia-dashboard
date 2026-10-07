"use client";

/**
 * Lazy boundary for the hero's live preview.
 *
 * The preview's code (charts, d3 scales, the market and chain hooks) is split
 * into its own chunk and fetched after hydration, so the landing page's first
 * bundle carries none of it (Lighthouse: no heavy client JS on first paint).
 * Until it lands, the server-rendered skeleton holds the exact space it will
 * take. `ssr: false` because the numbers are live reads of the browser's
 * session cache and the public API; nothing about them belongs in the HTML.
 */

import dynamic from "next/dynamic";
import { LivePreviewSkeleton } from "./LivePreviewSkeleton";

const LivePreview = dynamic(() => import("./LivePreview"), {
  ssr: false,
  loading: () => <LivePreviewSkeleton />,
});

export function LivePreviewIsland() {
  return <LivePreview />;
}
