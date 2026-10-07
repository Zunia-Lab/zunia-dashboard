"use client";

/**
 * Inline text helpers: CopyButton, AddressText, ExternalLink, RelativeTime,
 * SourceTag, and the FilterBar row.
 */

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { NO_VALUE, formatDate, formatRelativeTime, shortenAddress } from "@/lib/format";
import { useNow } from "./hooks";
import { Tooltip } from "./Overlay";
import { isAppPath, isSafeExternalHref } from "./safe-href";

/* ------------------------------------------------------------------ copy */

export interface CopyButtonProps {
  value: string;
  /** What is copied, for the accessible name: "address", "transaction hash". */
  label?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const COPY_SIZE = { xs: "size-6", sm: "size-7", md: "size-8" } as const;

/** Copies `value`; confirms with a check, a tooltip and a live message. */
export function CopyButton({ value, label = "value", size = "xs", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (insecure context, permissions): nothing to confirm.
      setCopied(false);
    }
  };

  return (
    // Controlled for its whole life (React warns on a switch): open on hover
    // or focus as usual, and held open while "Copied" shows.
    <Tooltip content={copied ? "Copied" : `Copy ${label}`} open={copied || hovered} onOpenChange={setHovered}>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        data-row-action=""
        onClick={() => void copy()}
        className={cn(
          "d-hit inline-flex shrink-0 items-center justify-center rounded-[6px] text-fg-dim transition-colors duration-[160ms]",
          "hover:bg-[var(--d-glass-2)] hover:text-fg focus-visible:outline-offset-0",
          copied && "text-[var(--d-pos)] hover:text-[var(--d-pos)]",
          COPY_SIZE[size],
          className,
        )}
      >
        <Icon name={copied ? "check" : "copy"} size={size === "md" ? 16 : 14} />
        <span className="sr-only" aria-live="polite">
          {copied ? "Copied" : ""}
        </span>
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ address */

export interface AddressTextProps {
  address: string;
  /** Minimum leading characters (the bech32 prefix is always kept whole). */
  head?: number;
  tail?: number;
  /** Show a copy button (default true). */
  copy?: boolean;
  /**
   * Make the address a link: an http(s) URL (explorer) opens in a new tab,
   * an app path ("/validators/…") navigates in place.
   */
  href?: string;
  /** Show it whole, wrapping where needed (detail pages). */
  full?: boolean;
  className?: string;
}

/** A mono address, shortened ("cosmos1gv86…vy4f") with the full value on hover. */
export function AddressText({ address, head = 8, tail = 4, copy = true, href, full, className }: AddressTextProps) {
  const text = full ? address : shortenAddress(address, head, tail);
  const body = (
    <span className={cn("font-mono text-[12.5px] tracking-[-0.01em]", full && "break-all")} title={full ? undefined : address}>
      {text}
    </span>
  );
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle text-fg-muted", className)}>
      {isSafeExternalHref(href) ? (
        <ExternalLink href={href} showIcon={false} className="text-inherit hover:text-fg">
          {body}
        </ExternalLink>
      ) : isAppPath(href) ? (
        <Link href={href} data-row-action="" className="text-inherit underline-offset-[3px] transition-colors duration-[160ms] hover:text-fg hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
      {copy ? <CopyButton value={address} label="address" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ external link */

export interface ExternalLinkProps {
  href: string;
  children: ReactNode;
  /** Trailing ↗ (default true). */
  showIcon?: boolean;
  /**
   * The href is someone else's claim, not ours: chain data anyone can set (a
   * validator's website, a proposal's metadata link) or user content. Adds
   * `nofollow ugc`, so an indexable page never passes its standing to a scam
   * validator's site; the markdown in proposal descriptions does the same.
   */
  ugc?: boolean;
  className?: string;
}

/**
 * A link that leaves the dashboard: new tab, no referrer, a ↗ that says so.
 * An href that is not an absolute http(s) URL or a mailto: renders as plain
 * text instead of a link (hrefs from chain data can be `javascript:`; see
 * safe-href.ts).
 */
export function ExternalLink({ href, children, showIcon = true, ugc, className }: ExternalLinkProps) {
  if (!isSafeExternalHref(href)) return <span className={cn("inline-flex items-center gap-0.5", className)}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel={ugc ? "noopener noreferrer nofollow ugc" : "noopener noreferrer"}
      data-row-action=""
      className={cn(
        "inline-flex items-center gap-0.5 text-[var(--d-accent-text)] underline-offset-[3px] transition-colors duration-[160ms] hover:underline",
        className,
      )}
    >
      {children}
      {showIcon ? <Icon name="arrowUpRight" size={13} className="shrink-0 opacity-80" /> : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/* ------------------------------------------------------------------ relative time */

export interface RelativeTimeProps {
  /** Epoch ms. */
  at: number | null | undefined;
  /** Text before the time: "Updated", "Ends". */
  prefix?: string;
  /**
   * The time is still ahead by nature (a vote's end, an unbonding release):
   * keep "in under a minute" for the last minute before it. Without it, a
   * time less than a minute ahead reads "just now" (see below).
   */
  upcoming?: boolean;
  className?: string;
}

/** How far ahead of the shared clock a past event may land: one 30 s tick plus clock skew. */
const CLOCK_SLACK_MS = 60_000;

/**
 * "2 min ago" / "in 3 h", refreshed every 30 s by one shared clock, with the
 * exact date on hover. Before hydration it shows the date (the server cannot
 * know the viewer's "now").
 *
 * The shared clock can be up to 30 s behind, and a device clock a little
 * slow, so a fresh read time or a transaction just made can land in the
 * "future": that reads "just now", not "in under a minute". Real deadlines
 * pass `upcoming`.
 */
export function RelativeTime({ at, prefix, upcoming, className }: RelativeTimeProps) {
  const now = useNow();
  if (at === null || at === undefined || !Number.isFinite(at)) return <span className={className}>{NO_VALUE}</span>;
  const shown = !upcoming && now !== null && at > now && at - now < CLOCK_SLACK_MS ? now : at;
  const text = now === null ? formatDate(at, "short") : formatRelativeTime(shown, now);
  return (
    <time dateTime={new Date(at).toISOString()} title={formatDate(at, "datetime")} className={className} suppressHydrationWarning>
      {prefix ? `${prefix} ` : null}
      {text}
    </time>
  );
}

/* ------------------------------------------------------------------ source tag */

export interface SourceTagProps {
  /** Where the figure comes from: "Numia", "Coinstore SAF/USDT", "Chain LCD". */
  source: string;
  /** When it was read (epoch ms): adds "· 2 min ago". */
  at?: number | null;
  /** Flags an estimate: "est." before the source. */
  estimate?: boolean;
  className?: string;
}

/** "Numia · 2 min ago": provenance and age of a market number (spec §8). */
export function SourceTag({ source, at, estimate, className }: SourceTagProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] tracking-[0.02em] text-fg-dim", className)}>
      {estimate ? <span className="rounded-[4px] bg-[var(--d-glass-2)] px-1 text-fg-muted">est.</span> : null}
      <span>{source}</span>
      {at ? (
        <>
          <span aria-hidden>·</span>
          <RelativeTime at={at} />
        </>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ filter bar */

export interface FilterBarProps {
  /** Left side: search, chips, selects. */
  children: ReactNode;
  /** Right side: toggles, view switches, export. */
  end?: ReactNode;
  className?: string;
}

/**
 * The one row of filters above a table or list. Wraps on narrow screens:
 * a search input given `className="w-full sm:w-64"` takes its own line on
 * phones.
 */
export function FilterBar({ children, end, className }: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {end ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-between">{end}</div> : null}
    </div>
  );
}
