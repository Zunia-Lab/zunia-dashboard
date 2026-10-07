/**
 * Glyphs the transfer pages need that the shared set (`@/components/icons`)
 * does not have yet: same family (24-unit grid, 1.5 stroke, round caps), same
 * rendering, decorative unless titled. Candidates to move into `icons.tsx`.
 */

import type { SVGProps } from "react";

const GLYPHS = {
  /** Address book. */
  book: ["M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z", "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M8.5 16c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8", "M3.5 7.5H5M3.5 12H5M3.5 16.5H5"],
  /** Scan a code (camera frame). */
  scan: ["M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2", "M4 12h16"],
  share: ["M12 4v11", "M8 7.5 12 3.5l4 4", "M6.5 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-.5"],
  /** Flip two sides (from ⇄ to), vertical arrows. */
  flip: ["M8 4v14m0 0-3.5-3.5M8 18l3.5-3.5", "M16 20V6m0 0-3.5 3.5M16 6l3.5 3.5"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5"],
  route: ["M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M18 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M8 17.5h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"],
  key: ["M14.5 9.5a4 4 0 1 0-3.9 4.9l1.4 1.4H14v2h2v2h3.5v-3.5l-5-5Z", "M8.5 8.5h.01"],
} as const;

export type GlyphName = keyof typeof GLYPHS;

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
  title?: string;
}

export function Glyph({ name, size = 18, strokeWidth = 1.5, title, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
