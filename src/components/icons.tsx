/**
 * The dashboard's icon set: one family, 24-unit grid, 1.5 stroke, round caps.
 *
 * Every glyph is a path list rendered by the same `<Icon>` wrapper, so size,
 * stroke and accessibility are decided once. Icons are decorative by default
 * (`aria-hidden`); pass `title` when an icon carries meaning on its own.
 */

import type { SVGProps } from "react";

const PATHS = {
  overview: ["M3.5 4.5h7v7h-7zM13.5 4.5h7v4h-7zM13.5 11.5h7v8h-7zM3.5 14.5h7v5h-7z"],
  assets: ["M12 3.5 20 8l-8 4.5L4 8z", "M4 12l8 4.5 8-4.5", "M4 16l8 4.5 8-4.5"],
  activity: ["M3 12h4l2.5-6 5 12 2.5-6H21"],
  swap: ["M4 8h13l-3.5-3.5", "M20 16H7l3.5 3.5"],
  bridge: ["M3 16c3-6 15-6 18 0", "M3 16h18", "M7.5 12.2V16M12 11v5M16.5 12.2V16"],
  send: ["M20 4 3.5 10.2l6.4 2.4M20 4l-6.2 16-2.6-6.6M20 4 9.9 12.6"],
  receive: ["M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 19.5h14"],
  staking: ["M12 3l8 9-8 9-8-9z", "M12 3v18"],
  validators: ["M12 3.5l7 3v5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9v-5z", "M8.8 12l2.2 2.2 4.2-4.4"],
  governance: ["M4 9.5 12 4l8 5.5", "M5.5 10v7.5M9.5 10v7.5M14.5 10v7.5M18.5 10v7.5", "M3.5 20h17"],
  insights: ["M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5v-.5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3.5Z", "M9.5 20h5"],
  compare: ["M8 4v16M16 4v16", "M4 8h4M4 14h4M16 10h4M16 16h4"],
  markets: ["M4 19.5h16", "M6.5 16v-4M10.5 16V8M14.5 16v-6M18.5 16V5"],
  chains: ["M9.2 14.8l5.6-5.6", "M10.6 6.6l1.6-1.6a4 4 0 0 1 5.7 5.7l-1.6 1.6", "M13.4 17.4l-1.6 1.6a4 4 0 0 1-5.7-5.7l1.6-1.6"],
  nfts: ["M3.5 6a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z", "M4 16l4.2-4.2a1.5 1.5 0 0 1 2.1 0L14 15.5m-1.2-1.2 1.9-1.9a1.5 1.5 0 0 1 2.1 0L20 15.5", "M9 7.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"],
  missions: ["M5 20.5V4", "M5 4.5h11l-2 3.5 2 3.5H5"],
  apps: ["M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"],
  mobile: ["M7 3.5h10A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z", "M10.5 17.5h3"],
  qr: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z", "M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h1.5M18.5 14H20"],
  notifications: ["M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z", "M13.7 18.5a2 2 0 0 1-3.4 0"],
  settings: ["M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z", "M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"],
  networks: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z", "M3.5 12h17", "M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5Z"],
  search: ["M11 4.75a6.25 6.25 0 1 1 0 12.5 6.25 6.25 0 0 1 0-12.5Z", "m15.6 15.6 3.9 3.9"],
  eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", "M12 9.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Z"],
  eyeOff: ["M4 4.5 20 19.5", "M9.6 6.1A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.3 8.2A17.5 17.5 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"],
  sun: ["M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z", "M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"],
  moon: ["M19.5 14.2A7.5 7.5 0 1 1 9.8 4.5a6.2 6.2 0 0 0 9.7 9.7Z"],
  menu: ["M4 7h16M4 12h16M4 17h10"],
  live: ["M4 14v4M9 10v8M14 6v12M19 12v6"],
  disconnect: ["M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17", "M14 12H4m0 0 2.5-2.5M4 12l2.5 2.5"],
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  close: ["M6 6l12 12M18 6 6 18"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronUp: ["m6 15 6-6 6 6"],
  chevronRight: ["m9 6 6 6-6 6"],
  chevronLeft: ["m15 6-6 6 6 6"],
  arrowUp: ["M12 19V5m0 0-6 6m6-6 6 6"],
  arrowDown: ["M12 5v14m0 0 6-6m-6 6-6-6"],
  arrowRight: ["M5 12h14m0 0-6-6m6 6-6 6"],
  arrowUpRight: ["M7 17 17 7M8 7h9v9"],
  copy: ["M9 9h10.5v10.5H9z", "M15 9V4.5H4.5V15H9"],
  external: ["M14 4.5h5.5V10", "M19.5 4.5 11 13", "M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5"],
  info: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z", "M12 11v5.5M12 7.6v.2"],
  warning: ["M12 4 21 19.5H3z", "M12 10v4.5M12 17.2v.2"],
  danger: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z", "M9 9l6 6M15 9l-6 6"],
  success: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z", "M8.5 12.2l2.3 2.3 4.7-4.8"],
  refresh: ["M19.5 12a7.5 7.5 0 1 1-2.2-5.3", "M19.5 4.5v4h-4"],
  filter: ["M4 6h16M7 12h10M10 18h4"],
  sort: ["M8 5v14m0-14L5 8m3-3 3 3", "M16 19V5m0 14-3-3m3 3 3-3"],
  star: ["M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"],
  download: ["M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5", "M5 19.5h14"],
  clock: ["M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z", "M12 7.5V12l3 2"],
  wallet: ["M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z", "M15.5 12h4.5v3h-4.5a1.5 1.5 0 0 1 0-3Z"],
  extension: ["M9 4.5h3a1.5 1.5 0 0 1 3 0h3v4.5a1.5 1.5 0 0 1 0 3V19H15a1.5 1.5 0 0 0-3 0H9v-4.5a1.5 1.5 0 0 0 0-3z"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  sparkle: ["M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z", "M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
  lock: ["M6.5 10.5h11v9h-11z", "M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"],
  shield: ["M12 3.5l7 3v5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9v-5z"],
  calendar: ["M4.5 6.5h15v13h-15z", "M4.5 10.5h15M8.5 4v4M15.5 4v4"],
  dots: ["M6 12h.01M12 12h.01M18 12h.01"],
  pulse: ["M3 12h4l2-4 4 8 2-4h6"],
  // UI kit additions (src/components/ui).
  arrowLeft: ["M19 12H5m0 0 6-6m-6 6 6 6"],
  arrowDownRight: ["M7 7l10 10M17 8v9H8"],
  chevronsUpDown: ["m8 9.5 4-4 4 4", "m16 14.5-4 4-4-4"],
  /** Solid carets for deltas and sort marks: render with fill="currentColor". */
  triUp: ["M12 7.5 17.5 15.5h-11z"],
  triDown: ["M12 16.5 6.5 8.5h11z"],
  inbox: ["M3.5 13.5 6.2 5.5h11.6l2.7 8", "M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5l-1.2 2.2H9.7l-1.2-2.2z"],
  help: [
    "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Z",
    "M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4",
    "M12 16.9v.2",
  ],
  trendingUp: ["M3.5 16.5 9 11l4 4 7.5-7.5", "M15 7.5h5.5V13"],
  trendingDown: ["M3.5 7.5 9 13l4-4 7.5 7.5", "M15 16.5h5.5V11"],
  hourglass: ["M6.5 3.5h11M6.5 20.5h11", "M8 3.5c0 4.2 8 4.3 8 8.5s-8 4.3-8 8.5M16 3.5c0 4.2-8 4.3-8 8.5s8 4.3 8 8.5"],
  layers: ["M12 4 20.5 8.5 12 13 3.5 8.5z", "M3.5 12.5 12 17l8.5-4.5"],
  grid: ["M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
  list: ["M9 6.5h11M9 12h11M9 17.5h11", "M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"],
  // Transfer additions (moved from src/components/transfer/glyphs.tsx, same
  // names and paths, so `<Glyph name=…>` becomes `<Icon name=…>` as is).
  /** Address book. */
  book: [
    "M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z",
    "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M8.5 16c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8",
    "M3.5 7.5H5M3.5 12H5M3.5 16.5H5",
  ],
  /** Scan a code (camera frame). */
  scan: ["M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2", "M4 12h16"],
  share: ["M12 4v11", "M8 7.5 12 3.5l4 4", "M6.5 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-.5"],
  /** Flip two sides (from ⇄ to), vertical arrows. */
  flip: ["M8 4v14m0 0-3.5-3.5M8 18l3.5-3.5", "M16 20V6m0 0-3.5 3.5M16 6l3.5 3.5"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5"],
  route: [
    "M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M18 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M8 17.5h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16",
  ],
  key: ["M14.5 9.5a4 4 0 1 0-3.9 4.9l1.4 1.4H14v2h2v2h3.5v-3.5l-5-5Z", "M8.5 8.5h.01"],
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Accessible name; when omitted the icon is decorative. */
  title?: string;
}

export function Icon({ name, size = 18, strokeWidth = 1.5, title, ...rest }: IconProps) {
  const paths = PATHS[name];
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
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
