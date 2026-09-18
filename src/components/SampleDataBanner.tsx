"use client";

import { Callout } from "@zunialab/ui";

/**
 * Honest label when /api/* answered with `source: "stub"`.
 * Stub payloads look like live data once they reach the browser — call this out.
 */
export function SampleDataBanner({
  show,
  reason,
}: {
  show: boolean;
  reason?: string;
}) {
  if (!show) return null;
  return (
    <Callout tone="warning" title="Sample data">
      {reason
        ? reason
        : "This page is showing a placeholder response from the API proxy. Upstream reads are unavailable, so numbers and rows are not live."}
    </Callout>
  );
}
