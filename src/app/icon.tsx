import { ImageResponse } from "next/og";
import { BrandMark, BRAND_BG } from "@/lib/brand-mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

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
        }}
      >
        <BrandMark size={22} />
      </div>
    ),
    { ...size },
  );
}
