/**
 * The hero's animated brand backdrop: two slow blooms in the brand ramp, a
 * chevron grid drifting one accent tile per cycle, and film grain.
 *
 * Pure CSS and one inline SVG, no script: it paints with the first HTML and
 * costs nothing to hydrate. Absolutely positioned behind the hero, so it can
 * never move the layout; still under prefers-reduced-motion (see the CSS).
 */

import styles from "./landing.module.css";

/** Base tile of the grid, px. The accent tile is three of them. */
const TILE = 56;
const ACCENT_TILE = TILE * 3;

export function HeroBackdrop() {
  return (
    <div aria-hidden className={styles.backdrop}>
      <div className={styles.bloom} />
      <div className={styles.bloomAlt} />
      <div className={styles.gridFade}>
        <svg className={styles.grid} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="zl-chevron" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FF1B0C" />
              <stop offset="0.5" stopColor="#FF6A10" />
              <stop offset="1" stopColor="#FFC414" />
            </linearGradient>
            {/* Hairline grid with a small chevron in every cell. */}
            <pattern id="zl-grid" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
              <path d={`M${TILE} 0.5H0.5V${TILE}`} fill="none" stroke="currentColor" strokeOpacity="0.07" />
              <path
                d="M25 23.5 31 28 25 32.5"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.11"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </pattern>
            {/* Sparse brand chevrons, the mark's double stroke, every third cell. */}
            <pattern id="zl-accent" width={ACCENT_TILE} height={ACCENT_TILE} patternUnits="userSpaceOnUse">
              <g
                transform={`translate(${TILE + 20} ${TILE + 16})`}
                fill="none"
                stroke="url(#zl-chevron)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.3"
              >
                <path d="M2 2 12 8 2 14" />
                <path d="M2 10 12 16 2 22" />
              </g>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#zl-grid)" />
          <rect width="100%" height="100%" fill="url(#zl-accent)" />
        </svg>
      </div>
      {/* The global gate grain (globals.css), reused rather than redrawn. */}
      <div className={`zunia-gate-grain ${styles.grain}`} />
    </div>
  );
}
