"use client";

/**
 * The Overview's insights: up to six cards from `useInsights`, most severe
 * first, in one row that scrolls sideways with snap points (a swipe on
 * phones, arrows or the keyboard on desktop). "All insights" opens the full
 * list on the Insights page.
 *
 * Opening a card's action, or its close button, hides that insight; "Clear
 * all" hides every one shown. Hidden ones return when they become more
 * urgent, or a week later if they still hold (`lib/insights/dismissals.ts`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, IconButton, PageSection, PartialDataBadge, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { InsightsState } from "@/lib/insights";
import { InsightCard } from "./InsightCard";
import { pickInsights } from "./model";

/**
 * Each card starts at 312px (86 % of a phone's row, so the next one peeks
 * in) and never shrinks; when the row has room to spare (three insights on a
 * wide screen), the cards share it instead of stopping short of the grid's
 * right edge, up to a readable measure.
 */
const CARD = "shrink-0 grow basis-[min(86%,312px)] max-w-[30rem] snap-start";

export function InsightsRow({ insights }: { insights: InsightsState }) {
  // One per kind first: six chain-status warnings would hide the claimable
  // rewards ranked right after them. The Insights page lists everything.
  const items = pickInsights(insights.items, 6, 1);
  const idsKey = items.map((insight) => insight.id).join("|");
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, idsKey]);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const step = card.offsetWidth + parseFloat(getComputedStyle(el).columnGap || "16");
    el.scrollBy({ left: direction * step, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const total = insights.items.length;
  const errors = insights.errors.map((message) => ({ scope: "Insights", message }));

  return (
    <PageSection
      title={
        <span className="inline-flex items-center gap-2">
          Insights
          {total > 0 ? (
            <Badge size="sm" tone="neutral" className="tabular-nums">
              {total}
            </Badge>
          ) : null}
        </span>
      }
      actions={
        <>
          <PartialDataBadge errors={errors} />
          {!edges.start || !edges.end ? (
            <span className="hidden items-center gap-1 sm:flex">
              <IconButton label="Previous insights" icon="chevronLeft" size="sm" variant="ghost" disabled={edges.start} onClick={() => page(-1)} />
              <IconButton label="Next insights" icon="chevronRight" size="sm" variant="ghost" disabled={edges.end} onClick={() => page(1)} />
            </span>
          ) : null}
          {items.length > 0 ? (
            <Button size="sm" variant="ghost" iconLeft="check" onClick={insights.clearAll}>
              Clear all
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" href="/insights" iconRight="arrowRight">
            All insights
          </Button>
        </>
      }
    >
      {insights.loading && items.length === 0 ? (
        <div className="flex gap-[var(--d-gap)] overflow-hidden" aria-busy="true" aria-label="Loading insights">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cn("d-card flex h-[236px] flex-col gap-3 p-[var(--d-pad)]", CARD)}>
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-[10px]" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="mt-auto h-7 w-24 self-end" />
            </div>
          ))}
        </div>
      ) : items.length === 0 && insights.hiddenItems.length > 0 ? (
        // Cleared, not absent: "nothing needs your attention" would claim a
        // measurement the reader's own clearing made.
        <div className="d-card px-[var(--d-pad)]">
          <EmptyState
            inline
            icon="success"
            title="All caught up"
            body={`${insights.hiddenItems.length} ${insights.hiddenItems.length === 1 ? "insight is" : "insights are"} hidden. Each comes back if it becomes more urgent, or in a week if it still holds.`}
            action={
              <Button size="sm" variant="ghost" iconLeft="eye" onClick={insights.restore}>
                Show them again
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="d-card px-[var(--d-pad)]">
          <EmptyState
            inline
            icon="success"
            title="Nothing needs your attention"
            body="No rewards past the claim fee, votes waiting on you, unlocks this week or risks found on the chains in scope."
          />
        </div>
      ) : (
        <div
          // A card arriving late (a slower read) lands before the one snapped
          // into view, and Chrome keeps that one snapped: the row would open
          // scrolled. A new set of cards starts again from the first.
          key={idsKey}
          ref={scroller}
          role="region"
          aria-label="Insights, scroll sideways for more"
          tabIndex={0}
          onScroll={measure}
          className={cn(
            "d-no-scrollbar -mx-1 flex snap-x snap-mandatory items-stretch gap-[var(--d-gap)] overflow-x-auto scroll-px-1 px-1 pb-1 focus-visible:outline-offset-0",
            insights.refreshing && "opacity-80 transition-opacity",
            !edges.end && !edges.start && "[mask-image:linear-gradient(to_right,transparent,#000_20px,#000_calc(100%-36px),transparent)]",
            edges.start && !edges.end && "[mask-image:linear-gradient(to_right,#000_calc(100%-36px),transparent)]",
            !edges.start && edges.end && "[mask-image:linear-gradient(to_right,transparent,#000_20px)]",
          )}
        >
          {items.map((insight) => (
            <InsightCard key={insight.id} insight={insight} onDismiss={() => insights.dismiss([insight])} className={CARD} />
          ))}
        </div>
      )}
    </PageSection>
  );
}
