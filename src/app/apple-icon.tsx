import { ImageResponse } from "next/og";
import { BrandMark, BRAND_BG } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

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
          borderRadius: 36,
        }}
      >
        <BrandMark size={108} />
      </div>
    ),
    { ...size },
  );
}
