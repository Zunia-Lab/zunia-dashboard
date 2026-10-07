"use client";

/**
 * AssetLogo, ChainLogo and LogoStack.
 *
 * Logos load lazily, without a referrer, and fall back to a monogram when
 * they fail; a broken image never shows.
 *
 * Catalog chain icons, token logos and keybase validator avatars come from
 * a few fixed hosts (logo-hosts.ts, the same list as `images.remotePatterns`
 * in next.config.ts), and those go through Next's image optimizer: the
 * registry ships logos up to 2500×2500 (btc.png is 98 KB for a 28px slot),
 * so /markets downloaded 1.2 MB of them; resized to the slot (1x/2x WebP) it
 * is under 100 KB. The browser then fetches them from our own origin, which
 * also keeps those hosts from seeing which tokens and validators a wallet
 * page shows. Anything else (another host or repository, an .svg, a URL
 * with a query) stays a plain image.
 */

import Image, { getImageProps } from "next/image";
import { useState, type CSSProperties, type ReactNode } from "react";
import { CHAINS, type ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { isOptimizableLogo } from "./logo-hosts";

/** Chain lookups by id, built once (findChain scans the whole catalog). */
let chainIndex: Map<string, ChainEntry> | null = null;

export function chainById(chainId: string): ChainEntry | undefined {
  if (!chainIndex) chainIndex = new Map(CHAINS.map((chain) => [chain.chainId, chain]));
  return chainIndex.get(chainId);
}

/**
 * Starts fetching a logo before its <img> exists, with exactly the request a
 * logo of `size` will make (the optimized URL and srcset for a registry
 * logo, the raw one otherwise), so the browser's cache answers it when the
 * logo renders: the landing page's chain marquee warms its chips before they
 * scroll in. Browser only.
 */
export function warmLogo(src: string, size: number): void {
  const { props } = getImageProps({ src, alt: "", width: size, height: size, unoptimized: !isOptimizableLogo(src) });
  // window.Image: the next/image import shadows the DOM constructor here.
  const image = new window.Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  if (props.srcSet) image.srcset = props.srcSet;
  image.src = props.src;
}

/** "ATOM" → "AT", "USDC.n" → "US", "ibc/27…" → "IB": two letters at most. */
function monogram(symbol: string): string {
  const letters = symbol.replace(/[^A-Za-z0-9]/g, "");
  return (letters || symbol || "?").slice(0, 2).toUpperCase();
}

/**
 * `lazy` (default) waits until the logo nears the viewport: a list of fifty
 * assets must not fetch fifty images up front. `eager` is for the few logos
 * that are the first thing on screen (a page's hero, an open picker).
 */
export type LogoLoading = "eager" | "lazy";

interface ImageOrMonogramProps {
  src?: string | null;
  label: string;
  size: number;
  loading?: LogoLoading;
  className?: string;
  style?: CSSProperties;
}

function ImageOrMonogram({ src, label, size, loading: loadingMode = "lazy", className, style }: ImageOrMonogramProps) {
  // Remember which src loaded / failed rather than booleans, so a new src
  // starts over without an effect resetting state.
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const showImage = Boolean(src) && failed !== src;
  const loading = showImage && loaded !== src;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        // A quiet disc while the image is on its way (no letters: they would
        // show through a transparent logo once it lands), the monogram on failure.
        (loading || !showImage) && "bg-[var(--d-glass-2)] shadow-[inset_0_0_0_1px_var(--d-hairline)]",
        !showImage && "text-fg-muted",
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      {showImage && src ? (
        <Image
          src={src}
          alt=""
          unoptimized={!isOptimizableLogo(src)}
          width={size}
          height={size}
          loading={loadingMode}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          // An image that settled before hydration fired its event before React
          // listened: read the outcome off the element instead.
          ref={(node) => {
            if (!node || !node.complete) return;
            if (node.naturalWidth === 0) setFailed(src);
            else setLoaded(src);
          }}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden className="font-semibold leading-none tracking-[-0.02em]" style={{ fontSize: Math.max(8, Math.round(size * 0.36)) }}>
          {monogram(label)}
        </span>
      )}
    </span>
  );
}

export interface AssetLogoProps {
  src?: string | null;
  /** Ticker: the monogram fallback and the accessible name. */
  symbol: string;
  /** Diameter in px (default 28). */
  size?: number;
  /** A small chain logo at the bottom-right (where the asset lives). */
  badgeSrc?: string | null;
  /** Name of the badge's chain, read with the symbol: "ATOM on Osmosis". */
  badgeLabel?: string;
  /** Hide from assistive tech when the ticker is written next to it. */
  decorative?: boolean;
  /** When to fetch the image (default `lazy`; the badge follows). */
  loading?: LogoLoading;
  className?: string;
}

export function AssetLogo({ src, symbol, size = 28, badgeSrc, badgeLabel, decorative = true, loading, className }: AssetLogoProps) {
  const badge = Math.max(10, Math.round(size * 0.44));
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : badgeLabel ? `${symbol} on ${badgeLabel}` : symbol}
      aria-hidden={decorative || undefined}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <ImageOrMonogram src={src} label={symbol} size={size} loading={loading} />
      {badgeSrc !== undefined ? (
        <ImageOrMonogram
          src={badgeSrc}
          label={badgeLabel ?? "?"}
          size={badge}
          loading={loading}
          className="absolute -bottom-[2px] -right-[3px] shadow-[0_0_0_2px_var(--d-logo-ring,var(--d-card))]"
        />
      ) : null}
    </span>
  );
}

export interface ChainLogoProps {
  /** A catalog chain id; ignored when `chain` is given. */
  chainId?: string;
  /** Explicit data, e.g. for a chain outside the slim catalog. */
  chain?: Pick<ChainEntry, "chainName" | "coinDenom"> & { iconUrl?: string | null };
  size?: number;
  /** The selected-scope ring (brand gradient, spec §1). */
  ring?: boolean;
  /** Expose the chain name to assistive tech (default: decorative). */
  labelled?: boolean;
  /** When to fetch the image (default `lazy`). */
  loading?: LogoLoading;
  className?: string;
}

export function ChainLogo({ chainId, chain, size = 24, ring, labelled, loading, className }: ChainLogoProps) {
  const entry = chain ?? (chainId ? chainById(chainId) : undefined);
  const name = entry?.chainName ?? chainId ?? "Unknown chain";
  const logo = <ImageOrMonogram src={entry?.iconUrl} label={entry?.coinDenom ?? name} size={size} loading={loading} />;
  return (
    <span
      role={labelled ? "img" : undefined}
      aria-label={labelled ? name : undefined}
      aria-hidden={labelled ? undefined : true}
      title={labelled ? name : undefined}
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        ring && "bg-[image:var(--z-accent-gradient)] p-[2px]",
        className,
      )}
    >
      {ring ? <span className="inline-flex rounded-full shadow-[0_0_0_2px_var(--d-logo-ring,var(--d-card))]">{logo}</span> : logo}
    </span>
  );
}

export interface LogoStackItem {
  src?: string | null;
  label: string;
}

export interface LogoStackProps {
  items: LogoStackItem[];
  size?: number;
  /** Logos shown before "+N" (default 4). */
  max?: number;
  className?: string;
  /** Accessible summary, e.g. "On 3 chains". */
  label?: string;
}

/** Overlapping logos (chains an asset sits on, validators used) with "+N". */
export function LogoStack({ items, size = 20, max = 4, className, label }: LogoStackProps): ReactNode {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const overlap = Math.round(size * 0.3);
  return (
    <span
      role="img"
      aria-label={label ?? items.map((item) => item.label).join(", ")}
      title={items.map((item) => item.label).join(", ")}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      {shown.map((item, index) => (
        <ImageOrMonogram
          key={`${item.label}-${index}`}
          src={item.src}
          label={item.label}
          size={size}
          className="shadow-[0_0_0_2px_var(--d-logo-ring,var(--d-card))]"
          style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: shown.length - index }}
        />
      ))}
      {rest > 0 ? (
        <span
          className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--d-glass-2)] font-medium tabular-nums text-fg-muted shadow-[0_0_0_2px_var(--d-logo-ring,var(--d-card))]"
          style={{ width: size, height: size, marginLeft: -overlap, fontSize: Math.max(9, Math.round(size * 0.42)) }}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
