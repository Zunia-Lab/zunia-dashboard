"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * Offline QR renderer — one SVG path, no external image fetch.
 *
 * Always dark modules on white with a four-module quiet zone, in both themes.
 * The old version drew the theme's foreground as the background (white modules
 * on near-black in dark mode, a one-module margin): inverted codes and thin
 * margins are exactly what phone scanners fail on first, and a pairing code
 * that does not scan is a pairing that never happens.
 *
 * Horizontal runs of dark modules are merged into one rectangle each, which
 * keeps a version-9 pairing code (53×53) to a few hundred path commands.
 *
 * A value too long for any QR version (the generator throws) renders an
 * empty white square with the reason as its accessible name, not a crashed
 * subtree.
 */

const QUIET_ZONE = 4;
const DARK = "#111111";
const LIGHT = "#ffffff";

export function QrCode({
  value,
  size = 168,
  className,
  label = "QR code",
}: {
  value: string;
  size?: number;
  className?: string;
  /** Accessible name (e.g. "Pairing code for Zunia Mobile"). */
  label?: string;
}) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    try {
      qr.addData(value);
      qr.make();
    } catch {
      return { path: null, count: 21 };
    }
    const modules = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < modules; row++) {
      let col = 0;
      while (col < modules) {
        if (!qr.isDark(row, col)) {
          col += 1;
          continue;
        }
        let run = 1;
        while (col + run < modules && qr.isDark(row, col + run)) run += 1;
        d += `M${col} ${row}h${run}v1h-${run}z`;
        col += run;
      }
    }
    return { path: d, count: modules };
  }, [value]);

  const span = count + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${span} ${span}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={path === null ? `${label} (too long to show as a QR code)` : label}
      className={className}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={span} height={span} fill={LIGHT} />
      {path === null ? null : <path d={path} fill={DARK} />}
    </svg>
  );
}
