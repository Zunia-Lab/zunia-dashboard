/**
 * The Zunia mark in its product colours and the "zunia dashboard" lock-up.
 *
 * Drawn from zunia-brand `svg/zunia-mark-clean.svg`: two chevrons on a
 * 96 × 120 grid (24 stroke, round caps), the upper one red → amber, the lower
 * amber → yellow, and the stretch of the lower ribbon that crosses the upper
 * one cut out and painted in the darker crossing ramp.
 *
 * No hooks and no client APIs, so the same element renders in a server
 * component, a client component and an `ImageResponse` (Satori). SVG ids are
 * document-wide, which is why every instance passes its own `id`.
 */

import type { CSSProperties } from "react";

const UPPER = "M26 20 L70 46 L26 72";
const LOWER = "M26 48 L70 74 L26 100";

export interface ZuniaMarkProps {
  /** Unique per document: prefixes the gradient and mask ids. */
  id: string;
  /** Width in px; the height follows the 96 × 120 grid. */
  size?: number;
  /** Accessible name; decorative (aria-hidden) without one. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function ZuniaMark({ id, size = 24, title, className, style }: ZuniaMarkProps) {
  const upper = `${id}-upper`;
  const lower = `${id}-lower`;
  const crossing = `${id}-crossing`;
  const mask = `${id}-mask`;
  const stroke = { fill: "none", strokeWidth: 24, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg
      viewBox="0 0 96 120"
      width={size}
      height={(size * 120) / 96}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={upper} x1="0.1" y1="0" x2="0.95" y2="0.9">
          <stop offset="0" stopColor="#FF1B0C" />
          <stop offset="0.55" stopColor="#FF4E12" />
          <stop offset="1" stopColor="#FF8A17" />
        </linearGradient>
        <linearGradient id={lower} x1="0.1" y1="1" x2="0.95" y2="0.1">
          <stop offset="0" stopColor="#FF9A05" />
          <stop offset="0.55" stopColor="#FFBE14" />
          <stop offset="1" stopColor="#FFE05C" />
        </linearGradient>
        <linearGradient id={crossing} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D42800" />
          <stop offset="1" stopColor="#FF6A05" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="120">
          <path d={UPPER} stroke="#fff" {...stroke} />
        </mask>
      </defs>
      <path d={UPPER} stroke={`url(#${upper})`} {...stroke} />
      <path d={LOWER} stroke={`url(#${lower})`} {...stroke} />
      <g mask={`url(#${mask})`}>
        <path d={LOWER} stroke={`url(#${crossing})`} {...stroke} />
      </g>
    </svg>
  );
}

/**
 * Mark + "zunia" wordmark (Space Grotesk 700, −0.065em, brand rule) + a
 * quieter "dashboard", as in zunia-brand `subbrands/zunia-dashboard-*`.
 *
 * The gap between the words is drawn by the flex gap; the space between the
 * two spans is there for the text itself (it is not rendered in a flex
 * row), so copy, find-in-page and a link's name read "zunia dashboard", not
 * "zuniadashboard".
 */
export function ZuniaLockup({ id, size = 20, subbrand = true, className }: { id: string; size?: number; subbrand?: boolean; className?: string }) {
  return (
    <span className={["inline-flex items-center gap-2 text-fg", className].filter(Boolean).join(" ")}>
      <ZuniaMark id={id} size={size * 0.86} />
      <span className="flex items-baseline gap-[0.32em] leading-none" style={{ fontSize: size }}>
        <span className="font-bold tracking-[-0.065em]">zunia</span>
        {subbrand ? (
          <>
            {" "}
            <span className="font-normal tracking-[-0.03em] text-fg-dim">dashboard</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
