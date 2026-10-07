import { ImageResponse } from "next/og";
import { ZuniaMark } from "@/components/landing/ZuniaMark";
import { BRAND_BG } from "@/lib/brand-mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * The browser-tab icon: the brand app icon (zunia-brand
 * `svg/icon/zunia-icon-black-tile.svg`) at 32 px, the gradient mark on a
 * dark rounded tile, which reads on light and dark browser chrome alike.
 */
export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <ZuniaMark id="icon" size={20} />
      </div>
    ),
    { ...size },
  );
}
