"use client";

/**
 * The one filter row above everything it scopes (range first, then search,
 * then the type chips): the strip, the charts and the list all re-render
 * against the same slice, so their numbers always agree.
 *
 * Type chips filter the rows already loaded, never the server read: the
 * server's `kinds` filter has to walk a busy account's whole window to find a
 * rare kind, and the chips' counts need every kind anyway.
 */

import type { ReactNode } from "react";
import { AssetLogo, Chip, ChipGroup, SearchInput, Segmented } from "@/components/ui";
import { ACTIVITY_GROUPS, GROUP_LABELS, type ActivityGroup } from "@/lib/activity/analytics";
import { formatNumber } from "@/lib/format";
import { GroupSwatch } from "./KindIcon";
import { RANGE_KEYS, RANGE_LABELS, nextGroups, type ActivityFilters as Filters, type RangeKey } from "./view";

export interface ActivityFiltersProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Rows per group after the range and the search (the chips' own filter left out). */
  counts: Readonly<Record<ActivityGroup, number>> | null;
  /** Rows the "All" chip stands for. */
  total: number | null;
  /** Failed rows among the selected groups. */
  failed: number | null;
  /** The asset `filters.asset` narrows to, as its chip names it (null without one). */
  asset?: { ticker: string; logoUrl?: string } | null;
  /** Right side of the first row: provenance, partial-data badge. */
  end?: ReactNode;
}

const RANGE_OPTIONS = RANGE_KEYS.map((key) => ({
  value: key,
  label: RANGE_LABELS[key],
  ariaLabel: key === "all" ? "All time" : `Last ${key.replace("d", " days")}`,
}));

export function ActivityFilters({ filters, onChange, counts, total, failed, asset, end }: ActivityFiltersProps) {
  const count = (value: number | null | undefined) => (value === null || value === undefined ? undefined : formatNumber(value));
  const chipItems = [
    { value: "all", label: "All", count: count(total) },
    ...ACTIVITY_GROUPS.map((group) => ({
      value: group,
      label: GROUP_LABELS[group],
      count: count(counts?.[group]),
      leading: <GroupSwatch group={group} />,
      // Nothing to show: dimmed, unless the URL already selected it (it must
      // stay reachable to be cleared).
      disabled: counts !== null && counts[group] === 0 && !filters.groups.includes(group),
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<RangeKey>
          ariaLabel="Date range"
          mono
          size="md"
          value={filters.range}
          onChange={(range) => onChange({ ...filters, range })}
          options={RANGE_OPTIONS}
          className="max-sm:w-full max-sm:[&>button]:flex-1"
        />
        <SearchInput
          value={filters.query}
          onChange={(query) => onChange({ ...filters, query })}
          placeholder="Search hash, address, memo or token"
          aria-label="Search transactions"
          className="min-w-0 flex-1 sm:max-w-[26rem]"
        />
        {/* One asset only (an asset page linked here): said next to the
            search it narrows alongside, and removable like any filter. */}
        {filters.asset !== null && asset ? (
          <Chip
            size="md"
            leading={<AssetLogo src={asset.logoUrl} symbol={asset.ticker} size={16} />}
            onRemove={() => onChange({ ...filters, asset: null })}
            removeLabel={`Show every asset, not only ${asset.ticker}`}
          >
            {asset.ticker} only
          </Chip>
        ) : null}
        {/* Provenance takes its own line below lg, so the search keeps its width. */}
        {end ? <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 max-lg:w-full max-lg:justify-start">{end}</div> : null}
      </div>
      {/* One scrolling row on a phone, with the Failed chip pinned after it;
          from 640px the chips wrap instead, so a tablet never shows a chip
          cut in half at the edge. */}
      <div className="flex min-w-0 items-center gap-2 sm:items-start">
        <ChipGroup
          type="multi"
          ariaLabel="Transaction types"
          value={filters.groups.length === 0 ? ["all"] : filters.groups}
          onChange={(next) => onChange({ ...filters, groups: nextGroups(filters.groups, next) })}
          items={chipItems}
          scroll
          className="min-w-0 flex-initial sm:flex-wrap sm:overflow-visible sm:py-0"
        />
        <span aria-hidden className="h-5 w-px shrink-0 bg-[var(--d-hairline-strong)] sm:mt-1" />
        <Chip
          selected={filters.failedOnly}
          onClick={() => onChange({ ...filters, failedOnly: !filters.failedOnly })}
          icon="danger"
          count={count(failed)}
          className="shrink-0"
        >
          Failed
        </Chip>
      </div>
    </div>
  );
}
