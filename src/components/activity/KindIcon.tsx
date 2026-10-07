/**
 * What a transaction was, as a glyph: one icon per kind, tinted with its
 * chart group's colour so the list, the stacked bars and the type legend
 * agree ("IBC" is the same blue in all three).
 *
 * Group colours are categorical slots handed out in a fixed order (spec §8):
 * transfers, IBC, swaps, staking, governance, then the neutral grey for
 * "Other". They follow the group, never its rank, so filtering never
 * repaints a survivor. The icon is a mark, not the label: every place that
 * shows one also writes the kind in words.
 */

import type { CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import { ACTIVITY_GROUPS, groupOf, type ActivityGroup } from "@/lib/activity/analytics";
import type { ActivityKind } from "@/lib/activity/types";
import { cn } from "@/lib/cn";

export const KIND_ICONS: Readonly<Record<ActivityKind, IconName>> = {
  send: "send",
  receive: "receive",
  "ibc-out": "bridge",
  "ibc-in": "bridge",
  swap: "swap",
  delegate: "staking",
  undelegate: "hourglass",
  redelegate: "refresh",
  claim: "sparkle",
  vote: "governance",
  contract: "extension",
  authz: "shield",
  other: "dots",
};

export const GROUP_ICONS: Readonly<Record<ActivityGroup, IconName>> = {
  transfers: "send",
  ibc: "bridge",
  swaps: "swap",
  staking: "staking",
  governance: "governance",
  other: "dots",
};

/** Chart colour per group (CSS variables from viz.css, both themes). */
export const GROUP_COLORS: Readonly<Record<ActivityGroup, string>> = {
  transfers: "var(--viz-1)",
  ibc: "var(--viz-2)",
  swaps: "var(--viz-3)",
  staking: "var(--viz-4)",
  governance: "var(--viz-5)",
  other: "var(--viz-other)",
};

/** The same colours as a map, for the chart kit's `colors` props. */
export const GROUP_COLOR_MAP: ReadonlyMap<string, string> = new Map(ACTIVITY_GROUPS.map((group) => [group, GROUP_COLORS[group]]));

export interface KindIconProps {
  kind: ActivityKind;
  /** A failed transaction: the danger tint, whatever its kind. */
  failed?: boolean;
  /** Tile size in px (default 32). */
  size?: number;
  className?: string;
}

export function KindIcon({ kind, failed, size = 32, className }: KindIconProps) {
  const color = failed ? "var(--z-danger)" : GROUP_COLORS[groupOf(kind)];
  const style: CSSProperties = {
    width: size,
    height: size,
    color,
    background: `color-mix(in srgb, ${color} ${failed ? 14 : 13}%, transparent)`,
  };
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-[10px]", className)} style={style}>
      <Icon name={KIND_ICONS[kind]} size={Math.round(size * 0.5)} strokeWidth={1.7} />
    </span>
  );
}

/** A small square swatch in a group's colour (legends written by hand). */
export function GroupSwatch({ group, className }: { group: ActivityGroup; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-[2px]", className)} style={{ background: GROUP_COLORS[group] }} />;
}
