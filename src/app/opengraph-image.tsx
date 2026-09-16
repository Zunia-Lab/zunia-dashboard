import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BrandMark, BRAND_BG, BRAND_FG, BRAND_MUTED } from "@/lib/brand-mark";

export const alt = "Zunia Wallet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(file: string) {
  try {
    return await readFile(
      path.join(process.cwd(), "node_modules/@zunialab/fonts/files", file),
    );
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const [medium, mono] = await Promise.all([
    loadFont("SpaceGrotesk-Medium.ttf"),
    loadFont("JetBrainsMono-Regular.ttf"),
  ]);

  const fonts = [
    medium && {
      name: "Space Grotesk",
      data: medium,
      weight: 500 as const,
      style: "normal" as const,
    },
    mono && {
      name: "JetBrains Mono",
      data: mono,
      weight: 400 as const,
      style: "normal" as const,
    },
  ].filter(Boolean) as {
    name: string;
    data: Buffer;
    weight: 500 | 400;
    style: "normal";
  }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_BG,
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(241,240,238,0.06) 0%, transparent 70%)",
          color: BRAND_FG,
          fontFamily: "Space Grotesk",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <BrandMark size={88} />
          <span
            style={{
              fontSize: 96,
              letterSpacing: "-0.06em",
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            zunia
          </span>
        </div>
        <div
          style={{
            marginTop: 36,
            display: "flex",
            fontFamily: fonts.length > 1 ? "JetBrains Mono" : "Space Grotesk",
            fontSize: 26,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: BRAND_MUTED,
          }}
        >
          wallet.zunialab.com
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
