"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** Offline QR renderer — single SVG path, no external image fetch. */
export function QrCode({
  value,
  size = 168,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const modules = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: modules };
  }, [value]);

  return (
    <svg
      viewBox={`-1 -1 ${count + 2} ${count + 2}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Address QR code"
      className={className}
    >
      <rect
        x={-1}
        y={-1}
        width={count + 2}
        height={count + 2}
        fill="var(--z-fg)"
      />
      <path d={path} fill="var(--z-bg)" />
    </svg>
  );
}
