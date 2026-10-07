"use client";

/**
 * The transactions card: the newest rows grouped by day, the states a
 * history list can be in, and "Load more" at its foot.
 *
 * A wallet page, not an explorer (product decision, 2026-10-07): the list
 * opens on the ten latest and adds ten per "Load more", a button on purpose
 * (people choose to see more; nothing loads as they scroll), with no page
 * numbers and no "x of y" counts. Loaded rows are revealed first; an older
 * page is fetched only once every loaded row is on screen. The strip, the
 * charts, the comparison and the CSV above still read every row loaded for
 * the range: only what the list shows is stepped.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activityByDay, type PriceMap } from "@/lib/activity/analytics";
import type { ActivityItem } from "@/lib/activity/types";
import type { ApiError } from "@/lib/useApi";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  EmptyState,
  InlineError,
  Skeleton,
  Spinner,
  chainById,
  type IconSlot,
} from "@/components/ui";
import { ActivityRow } from "./ActivityRow";
import { LIST_STEP, dayHeading, listCaption, listFooter, txHref, type RangeKey } from "./view";

export interface ActivityListProps {
  /** The view's rows (filters applied), newest first. The list shows the newest of them. */
  rows: readonly ActivityItem[];
  prices: PriceMap;
  currency: string;
  now: number | null;
  /** First load: nothing to show yet. */
  loading: boolean;
  /** The rows belong to the previous scope while the new one loads. */
  pending: boolean;
  refreshing: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** The last older page failed to load. */
  moreError: ApiError | null;
  range: RangeKey;
  /** The loaded list reaches back past the range's start. */
  reachedSince: boolean;
  /** History older than the range is known to exist (`olderHistoryExists`). */
  olderExists: boolean;
  /**
   * Every network is read and complete for the view (`historyComplete`):
   * only then may the list's last line say it holds all of it.
   */
  complete: boolean;
  /** Switch the view to all time (the footer's next step once a range is all on screen). */
  onAllTime: () => void;
  /**
   * Changes when a new view starts (the filters, the range or the scope
   * changed): the list goes back to its newest ten. Stepping to all time from
   * the footer keeps it, so the list carries on where it was.
   */
  viewKey: string;
  filtered: boolean;
  onClearFilters: () => void;
  /** "the last 30 days" / "all loaded history". */
  rangePhrase: string;
  /** Offered when a range is empty: switch to all time. */
  onShowAll: (() => void) | null;
  onExport: () => void;
  /** Chains to look a pasted hash up on when the loaded rows do not hold it. */
  hashLookup: { hash: string; chainIds: readonly string[] } | null;
  /** Key parts of the wallet's own addresses, to mark transfers between them. */
  ownBodies: ReadonlySet<string>;
}

/**
 * Older pages one "Load more" may fetch to find its ten rows. A page holds
 * fifty transactions, and under a narrow filter it can hold none of the
 * matching kind: a button that spins and adds nothing reads as broken. The
 * bound keeps a filter that matches nothing from walking a whole history on
 * one click; the next click carries on.
 */
const MAX_PAGES_PER_STEP = 4;

const SKELETON_WIDTHS = [62, 48, 70, 55, 66, 44];

function RowSkeletons() {
  return (
    <ul aria-hidden className="flex flex-col">
      {SKELETON_WIDTHS.map((width, index) => (
        <li key={index} className="grid min-h-[60px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-[var(--d-pad)] py-2.5 lg:grid-cols-[4.25rem_32px_minmax(0,1fr)_auto]">
          <Skeleton className="hidden h-3 w-12 lg:block" />
          <Skeleton className="size-8 rounded-[10px]" />
          <span className="flex flex-col gap-2">
            <Skeleton className="h-3" width={`${width}%`} />
            <Skeleton className="h-2.5" width={`${Math.round(width * 0.45)}%`} />
          </span>
          <Skeleton className="h-3 w-20" />
        </li>
      ))}
    </ul>
  );
}

function HashLookup({ hash, chainIds }: { hash: string; chainIds: readonly string[] }) {
  return (
    <div className="flex flex-col gap-3 px-[var(--d-pad)] py-5">
      <div>
        <p className="text-[15px] font-medium text-fg">Not in the loaded history</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-dim">
          That looks like a transaction hash. Open it on the network it was sent on; the page reads it straight from that chain.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {chainIds.map((chainId) => (
          <li key={chainId}>
            <Button size="sm" variant="secondary" href={txHref(chainId, hash)} iconLeft={<ChainLogo chainId={chainId} size={16} />}>
              {chainById(chainId)?.chainName ?? chainId}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivityList(props: ActivityListProps) {
  const { rows, prices, currency, now, loading, pending, refreshing, hasMore, loadingMore, loadMore, moreError, viewKey } = props;

  // How many rows the user asked to see, for one view. A new view (another
  // key) reads the first step again without a reset effect: the stale entry
  // is simply not this view's.
  const [step, setStep] = useState({ key: viewKey, visible: LIST_STEP });
  const visible = step.key === viewKey ? step.visible : LIST_STEP;
  const shown = Math.min(visible, rows.length);
  const shownRows = useMemo(() => rows.slice(0, shown), [rows, shown]);
  const days = useMemo(() => activityByDay(shownRows, "local"), [shownRows]);

  const ranged = props.range !== "all";
  const rangeDone = ranged && props.reachedSince;
  const footer = listFooter({ shown, total: rows.length, hasMore, rangeDone, olderExists: props.olderExists });
  const fetching = footer.kind === "more" && footer.fetch;
  // More rows were asked for than are loaded: an older page is on its way,
  // or will be once the user asks again.
  const wanting = visible > rows.length;
  const busy = fetching && wanting && loadingMore;
  const canFetch = hasMore && !rangeDone;

  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  /** Index of the first row a "Load more" revealed, to move focus to once it is on screen. */
  const focusFrom = useRef<number | null>(null);
  /** Older pages the current "Load more" may still fetch on its own. */
  const pagesLeft = useRef(0);

  // A new view forgets the last step's pending focus and page budget: rows
  // arriving for it were not asked for by a click.
  useEffect(() => {
    focusFrom.current = null;
    pagesLeft.current = 0;
  }, [viewKey]);

  const showMore = () => {
    if (busy) return;
    // Keyboard (and screen reader) users carry on reading at the first new
    // row instead of staying on a button that has moved below them. Only
    // when the click left focus in the footer: a mouse click in Safari
    // focuses nothing, and focus must never be pulled from elsewhere.
    const active = document.activeElement;
    focusFrom.current = active instanceof HTMLElement && footerRef.current?.contains(active) ? shown : null;
    setStep({ key: viewKey, visible: shown + LIST_STEP });
    if (fetching) {
      pagesLeft.current = MAX_PAGES_PER_STEP - 1;
      loadMore();
    }
  };

  // All time keeps the rows on screen (at least the first ten): the older
  // ones it adds come with the next "Load more", not by themselves (the last
  // step may have asked for more rows than the range held).
  const stepToAllTime = () => {
    const active = document.activeElement;
    focusFrom.current = active instanceof HTMLElement && footerRef.current?.contains(active) ? shown : null;
    setStep({ key: viewKey, visible: Math.max(shown, LIST_STEP) });
    props.onAllTime();
  };

  // Keep fetching older pages for this step until its rows are in, the
  // history ends, a page fails or the step's budget is spent. `loadMore` is
  // a no-op while a page is in flight, so the range walk the activity hook
  // runs on its own never doubles a read.
  useEffect(() => {
    if (pagesLeft.current <= 0) return;
    if (!wanting || !canFetch || moreError) {
      pagesLeft.current = 0;
      return;
    }
    if (loadingMore) return;
    pagesLeft.current -= 1;
    loadMore();
  }, [wanting, canFetch, loadingMore, moreError, loadMore]);

  // Focus the first revealed row once it renders (at once, or when its page
  // lands), unless the user has moved on to something else meanwhile. When
  // the step found nothing and the list ended, its button is gone: focus goes
  // to the line that says so (or, in an empty view, to its next action)
  // rather than falling back to the top of the page. A step that settles
  // with nothing new leaves focus on its button.
  const footerKind = footer.kind;
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    const revealed = shown > from;
    const ended = !revealed && footerKind === "end";
    const settled = !loadingMore && pagesLeft.current === 0;
    if (!revealed && !ended && !settled) return;
    focusFrom.current = null;
    if (!revealed && !ended) return;
    const active = document.activeElement;
    if (active && active !== document.body && !footerRef.current?.contains(active)) return;
    const target = revealed
      ? listRef.current?.querySelectorAll<HTMLAnchorElement>("li > a:first-child")[from]
      : (noteRef.current ?? bodyRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])"));
    target?.focus({ preventScroll: true });
  }, [shown, footerKind, loadingMore]);

  const subtitle = loading ? "Reading your networks…" : listCaption(props.range, props.filtered);

  let body: ReactNode;
  if (loading) {
    body = <RowSkeletons />;
  } else if (rows.length === 0) {
    if (props.hashLookup && props.hashLookup.chainIds.length > 0) {
      body = <HashLookup hash={props.hashLookup.hash} chainIds={props.hashLookup.chainIds} />;
    } else if (props.filtered) {
      body = (
        <EmptyState
          icon="filter"
          title="No transactions match"
          body={`Nothing in ${props.rangePhrase} matches these filters${canFetch ? " yet: older transactions are not loaded" : ""}.`}
          action={
            <Button size="sm" variant="secondary" onClick={props.onClearFilters}>
              Clear filters
            </Button>
          }
        />
      );
    } else if (props.onShowAll) {
      body = (
        <EmptyState
          icon="calendar"
          title={`Nothing in ${props.rangePhrase}`}
          body="No transaction of yours was found in this window. Older history may exist."
          action={
            <Button size="sm" variant="secondary" onClick={props.onShowAll}>
              Show all time
            </Button>
          }
        />
      );
    } else {
      body = (
        <EmptyState
          icon="activity"
          title="No transactions yet"
          body="Nothing on your networks so far. Transfers, swaps, stakes and votes show up here as soon as a chain records them."
          action={
            <Button size="sm" variant="primary" href="/receive" iconLeft="receive">
              Receive
            </Button>
          }
        />
      );
    }
  } else {
    body = (
      <div ref={listRef} className="flex flex-col">
        {days.map((day) => {
          // Counted from the rows on screen, so the heading never disagrees
          // with what is under it while a day is only partly shown.
          const failed = day.items.filter((item) => !item.success).length;
          const id = `activity-day-${day.label}`;
          return (
            <section key={day.label} aria-labelledby={id} className="border-t border-[var(--d-hairline)] first:border-t-0">
              {/* Sticks under the top bar while its day scrolls by (the frame
                  sets --d-sticky-top). Opaque, so rows pass beneath it. */}
              <div className="sticky top-[var(--d-sticky-top)] z-[2] flex items-baseline justify-between gap-3 border-b border-[var(--d-hairline)] bg-[color-mix(in_srgb,var(--d-card-2)_45%,var(--d-card))] px-[var(--d-pad)] pb-1.5 pt-2.5">
                <h3 id={id} className="d-label" suppressHydrationWarning>
                  {dayHeading(day.start, now)}
                </h3>
                {failed > 0 ? <p className="text-[12px] tabular-nums text-[var(--z-danger)]">{failed} failed</p> : null}
              </div>
              <ul className="flex flex-col">
                {day.items.map((item) => (
                  <ActivityRow
                    key={`${item.chainId}:${item.address}:${item.hash}`}
                    item={item}
                    prices={prices}
                    currency={currency}
                    now={now}
                    ownBodies={props.ownBodies}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  // An empty view already says why in its empty state (and offers all time
  // when that is the way out): the footer stays only to search older pages,
  // or to step to all time from a filtered view.
  const empty = rows.length === 0;
  const footerShown = !loading && !(empty && (footer.kind === "end" || (footer.kind === "all-time" && props.onShowAll !== null)));

  // Where the list ends, claiming completeness only when the banner above
  // does: a node's retention or a failed search means "all it returned".
  const note: string | null = empty
    ? null
    : footer.kind === "all-time" || (footer.kind === "end" && ranged)
      ? props.complete
        ? `That's all of ${props.rangePhrase}.`
        : `That's everything your networks returned for ${props.rangePhrase}.`
      : footer.kind === "end"
        ? props.complete
          ? "That's your whole history on these networks."
          : "That's everything your networks returned."
        : null;

  // One button for every step, so focus stays on it when "Show all time"
  // turns into "Load more".
  const action: { label: string; icon: IconSlot } | null =
    footer.kind === "more"
      ? { label: fetching && moreError ? "Retry" : "Load more", icon: busy ? <Spinner size={12} /> : fetching && moreError ? "refresh" : "arrowDown" }
      : footer.kind === "all-time"
        ? { label: "Show all time", icon: "calendar" }
        : null;

  return (
    <Card padding="none" pending={pending} as="section" aria-labelledby="activity-list-title">
      <div className="px-[var(--d-pad)] pt-[var(--d-pad)]">
        <CardHeader
          id="activity-list-title"
          title="Transactions"
          subtitle={subtitle}
          refreshing={refreshing && !pending}
          actions={
            // Failed chains are badged once, at the top of the page, for every figure.
            <Button size="sm" variant="secondary" iconLeft="download" onClick={props.onExport} disabled={loading || rows.length === 0}>
              Export CSV
            </Button>
          }
        />
      </div>
      <CardBody ref={bodyRef} className="mt-2">
        {body}
        {footerShown ? (
          <div ref={footerRef} className="flex flex-col items-center gap-3 border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-4 text-center">
            {fetching && moreError ? (
              <InlineError className="w-full text-left" title="Couldn't load older transactions" message={moreError.message} />
            ) : null}
            {/* The live region the footer's news is read from: a page on its
                way (spoken only), then where the list ends. */}
            <p ref={noteRef} tabIndex={-1} aria-live="polite" className={cn("text-[13px] leading-snug text-fg-dim", note === null && "sr-only")}>
              {busy ? "Loading older transactions…" : note}
            </p>
            {action ? (
              <Button
                variant="secondary"
                iconLeft={action.icon}
                // Busy stays focusable (a disabled button would drop focus
                // to the page): it says so and ignores a second click.
                aria-busy={busy || undefined}
                onClick={footer.kind === "all-time" ? stepToAllTime : showMore}
                className="max-sm:w-full sm:min-w-[10rem]"
              >
                {action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
