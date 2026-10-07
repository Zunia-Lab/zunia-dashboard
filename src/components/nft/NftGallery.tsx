"use client";

/**
 * NFT artwork, cards and the gallery grid, in the dashboard kit.
 *
 * Ported from zunia-ui packages/ui/src/nft/Nft.tsx (NftMedia, NftCard,
 * NftGrid), keeping the one behaviour that matters: the `<img>` is mounted
 * only when artwork is on. A hidden image still issues its request, and the
 * request is the privacy leak (the host learns this device's address and
 * which tokens it holds), so "off" must mean no element at all. Underneath
 * there is always a placeholder derived from the token id (the same art the
 * extension and the phone draw), so a slow, blocked or missing image degrades
 * to a coloured tile, never to a broken-image glyph.
 */

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { NFT_MEDIA_PRIVACY_NOTE, nftPlaceholder, nftTitle } from "@zunialab/ui";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";

type MediaState = "off" | "absent" | "loading" | "loaded" | "error";

/**
 * Chrome over the artwork: a fixed dark scrim with light text in both themes,
 * because what sits underneath is a stranger's image, not a Zunia surface.
 */
const SCRIM = "bg-[color-mix(in_srgb,#0b0a09_82%,transparent)] text-[#f1f0ee]";

export interface NftMediaProps {
  tokenId: string;
  /** Resolved http(s) URL, or null. */
  imageUrl: string | null;
  /** Artwork on: only then is the image element mounted. */
  loadMedia: boolean;
  /** Offered over the placeholder when artwork is off (null when it cannot be turned on). */
  onRequestMedia?: (() => void) | null;
  alt: string;
  className?: string;
  /** Monogram size relative to the frame: "card" or a large "detail" frame. */
  size?: "card" | "detail";
}

export function NftMedia({ tokenId, imageUrl, loadMedia, onRequestMedia, alt, className, size = "card" }: NftMediaProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const placeholder = nftPlaceholder(tokenId);
  const state: MediaState = !loadMedia
    ? "off"
    : !imageUrl
      ? "absent"
      : failedUrl === imageUrl
        ? "error"
        : loadedUrl === imageUrl
          ? "loaded"
          : "loading";
  const caption =
    state === "loading" ? "Loading…" : state === "error" ? "Artwork unavailable" : state === "absent" ? "No artwork on this token" : null;

  return (
    <div
      className={cn("relative aspect-square w-full overflow-hidden rounded-[var(--d-radius-inner)]", className)}
      style={{ background: `linear-gradient(150deg, ${placeholder.from}, ${placeholder.to})`, containerType: "inline-size" } as CSSProperties}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-center font-mono font-bold mix-blend-luminosity",
          size === "detail" ? "text-[clamp(28px,16cqw,96px)]" : "text-[clamp(18px,20cqw,46px)]",
        )}
        style={{ color: placeholder.accent }}
      >
        {placeholder.monogram}
      </span>
      {loadMedia && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party artwork, loaded only on request, never proxied or optimised
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(imageUrl)}
          onError={() => setFailedUrl(imageUrl)}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", state === "loaded" ? "opacity-100" : "opacity-0")}
        />
      ) : null}
      {caption ? (
        <span className={cn("absolute inset-x-0 bottom-0 truncate px-2 py-1 text-center font-mono text-[10.5px]", SCRIM)}>{caption}</span>
      ) : null}
      {state === "off" && onRequestMedia ? (
        // On a grid of placeholders, one "Load artwork" bar per tile is a
        // wall of the same words: with a mouse it shows on the tile pointed
        // at (or focused); on touch screens, where nothing hovers, it stays.
        <button
          type="button"
          onClick={onRequestMedia}
          title={NFT_MEDIA_PRIVACY_NOTE}
          className={cn(
            "absolute inset-x-0 bottom-0 z-[1] h-9 truncate px-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-opacity duration-[160ms] hover:opacity-90 focus-visible:opacity-100",
            size === "card" && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
            SCRIM,
          )}
        >
          Load artwork
        </button>
      ) : null}
    </div>
  );
}

export interface NftCardItem {
  tokenId: string;
  name: string | null;
  collectionName: string | null;
  collectionAddress: string;
  imageUrl: string | null;
  /** The per-token read failed: shown by id only, with this on hover. */
  error?: string | null;
}

/**
 * One token: artwork frame, name, collection and id. The card opens the
 * token through a link laid over it, so the "Load artwork" button can sit
 * above the link instead of inside it (no control nested in a link).
 */
export function NftCard({ item, href, loadMedia, onRequestMedia }: { item: NftCardItem; href: string; loadMedia: boolean; onRequestMedia?: (() => void) | null }) {
  const title = nftTitle(item.tokenId, item.name);
  const collection = item.collectionName?.trim() || shortenAddress(item.collectionAddress, 10, 4);
  const shortId = item.tokenId.length > 14 ? `${item.tokenId.slice(0, 14)}…` : item.tokenId;
  // The card sits inside its collection's card, which names the collection:
  // the second line is the token's id (or says it has no name on chain).
  const named = Boolean(item.name?.trim());
  return (
    <div className="group relative flex min-w-0 flex-col gap-2 rounded-[var(--d-radius-card)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] p-2 transition-[border-color,box-shadow] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
      <NftMedia tokenId={item.tokenId} imageUrl={item.imageUrl} loadMedia={loadMedia} onRequestMedia={onRequestMedia} alt={title} />
      <span className="min-w-0 px-1 pb-0.5">
        <span className="block truncate text-[13.5px] font-medium text-fg" title={title}>
          {title}
        </span>
        {item.error ? (
          // The read failed: the name is unknown, not absent.
          <span className="mt-0.5 block truncate text-[11.5px] text-[var(--z-warning)]" title={item.error}>
            Read failed · shown by id
          </span>
        ) : (
          <span className="mt-0.5 block truncate text-[11.5px] text-fg-dim" title={item.tokenId}>
            {named ? <span className="font-mono">#{shortId}</span> : "No name on chain"}
          </span>
        )}
      </span>
      <Link href={href} aria-label={`${title}, ${collection}`} className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-offset-2" />
    </div>
  );
}

/** The responsive grid: two columns on a phone, as many 150px+ columns as fit elsewhere. */
export function NftGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-[var(--d-gap)] sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]", className)}>{children}</div>;
}

export function NftGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <NftGrid>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="flex flex-col gap-2 rounded-[var(--d-radius-card)] border border-[var(--d-hairline)] p-2">
          <Skeleton className="aspect-square h-auto w-full rounded-[var(--d-radius-inner)]" />
          <Skeleton className="mx-1 h-3 w-2/3" />
          <Skeleton className="mx-1 mb-1 h-2.5 w-1/2" />
        </div>
      ))}
    </NftGrid>
  );
}
