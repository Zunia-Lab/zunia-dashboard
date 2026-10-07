"use client";

/**
 * "Built for the interchain": two rows of chain chips drifting in opposite
 * directions.
 *
 * Each row is rendered twice side by side and moved by half its width, so
 * the loop has no seam; the second copy is hidden from assistive tech, and
 * the first is a real list of names. Motion stops on hover, on keyboard
 * focus and with the Pause button (WCAG 2.2.2: anything moving for more
 * than five seconds can be paused). Under prefers-reduced-motion nothing
 * moves at all: the chains render as one static, centred list (the CSS
 * stops the rows too, for the moment before hydration).
 *
 * Logos load lazily, and a lazy image clipped by the strip only starts
 * loading once it slides into view, so chips would arrive as empty discs.
 * When the strip comes near the viewport its logos are fetched once ahead
 * of time; by the time a chip enters, its image is in the cache.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ChainLogo, useReducedMotion } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FeaturedChain } from "./content";
import styles from "./landing.module.css";

function Chip({ chain }: { chain: FeaturedChain }) {
  return (
    <span className="flex h-10 shrink-0 items-center gap-2.5 rounded-full border border-[var(--d-hairline)] bg-[var(--d-card)] py-1 pl-1.5 pr-4 text-[13.5px] text-fg-muted">
      <ChainLogo chain={chain} size={28} />
      <span className="whitespace-nowrap">{chain.chainName}</span>
    </span>
  );
}

function PauseGlyph({ paused }: { paused: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      {paused ? <path d="M8 5.5v13l10.5-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
    </svg>
  );
}

/** Fetch the strip's logos once, when it is about to scroll into view. */
function useWarmLogos(urls: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || urls.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        for (const url of urls) {
          const image = new Image();
          image.decoding = "async";
          // Same request as the chip's <img> (ChainLogo sends no referrer).
          image.referrerPolicy = "no-referrer";
          image.src = url;
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [urls]);
  return ref;
}

const CONTAINER = "mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8";

export function ChainMarquee({ rows, total }: { rows: FeaturedChain[][]; total: number }) {
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  // Each chain once, in row order (the rows are disjoint today; this keeps it so).
  const all = useMemo(() => [...new Map(rows.flat().map((chain) => [chain.chainId, chain])).values()], [rows]);
  const urls = useMemo(() => [...new Set(all.map((chain) => chain.iconUrl))], [all]);
  const stripRef = useWarmLogos(urls);
  const caption = (
    <p className="font-mono text-[11px] leading-[1.5] tracking-[0.02em] text-fg-dim">
      {all.length} of {total} networks shown · logos from the Cosmos chain registry
    </p>
  );

  if (reduced) {
    return (
      <div className="flex flex-col gap-4">
        <ul aria-label="Supported networks" className={cn(CONTAINER, "flex flex-wrap justify-center gap-2.5")}>
          {all.map((chain) => (
            <li key={chain.chainId}>
              <Chip chain={chain} />
            </li>
          ))}
        </ul>
        <div className={cn(CONTAINER, "flex justify-center")}>{caption}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div ref={stripRef} className={cn(styles.marquee, "flex flex-col gap-3")}>
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn(styles.track, index % 2 === 1 && styles.trackReverse)}
            style={paused ? { animationPlayState: "paused" } : undefined}
          >
            <ul className={styles.copy} aria-label={index === 0 ? "Supported networks" : "More supported networks"}>
              {row.map((chain) => (
                <li key={chain.chainId}>
                  <Chip chain={chain} />
                </li>
              ))}
            </ul>
            <div aria-hidden className={cn(styles.copy, styles.trackDuplicate)}>
              {row.map((chain) => (
                <Chip key={chain.chainId} chain={chain} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={cn(CONTAINER, "flex items-center justify-between gap-4")}>
        {caption}
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<PauseGlyph paused={paused} />}
          className="-mr-3 motion-reduce:hidden"
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? "Play" : "Pause"}
          <span className="sr-only"> the network ticker</span>
        </Button>
      </div>
    </div>
  );
}
