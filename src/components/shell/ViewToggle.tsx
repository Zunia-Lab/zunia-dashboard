"use client";

/**
 * Lite | Pro: how much of the dashboard to show.
 *
 * Pro, the default, is the full analytical dashboard. Lite keeps what a
 * holder needs to see and act (balances, send, receive, swap, bridge,
 * staking, votes, activity) and folds the analysis away: concentration and
 * yield maps, validator-set economics, cost breakdowns, history charts.
 * Every page stays reachable by its address and from search in both.
 *
 * Named "Lite", not "Light", because Light is a theme here.
 *
 * The stored value is only known after hydration (`useStoredValue` serves
 * its fallback to the server render), so the control shows a placeholder of
 * the same width until then: a Lite reader never sees the thumb jump from Pro.
 */

import { useSyncExternalStore } from "react";
import { Segmented, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePrefs, type ViewMode } from "@/providers/PrefsProvider";

const OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "lite", label: "Lite" },
  { value: "pro", label: "Pro" },
];

const noSubscription = () => () => {};

export function ViewToggle({ size = "sm", fullWidth, className }: { size?: "sm" | "md"; fullWidth?: boolean; className?: string }) {
  const { viewMode, setViewMode } = usePrefs();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!hydrated) {
    return <Skeleton aria-hidden className={cn("rounded-[10px]", size === "sm" ? "h-8 w-[104px]" : "h-9 w-[120px]", fullWidth && "w-full", className)} />;
  }
  return <Segmented<ViewMode> ariaLabel="Dashboard view" size={size} value={viewMode} onChange={setViewMode} options={OPTIONS} fullWidth={fullWidth} className={className} />;
}
