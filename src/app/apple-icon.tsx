import { ImageResponse } from "next/og";
import { ZuniaMark } from "@/components/landing/ZuniaMark";
import { BRAND_BG } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Home-screen icon: the gradient mark on the dark tile, square and opaque —
 * iOS rounds the corners itself, and transparent corners would show black.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_BG,
          backgroundImage: "radial-gradient(circle at 50% 42%, rgba(255,78,18,0.16) 0%, transparent 62%)",
        }}
      >
        <ZuniaMark id="apple-icon" size={92} />
      </div>
    ),
    { ...size },
  );
}
