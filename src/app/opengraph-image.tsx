import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { mainnetCount } from "@/components/landing/content";
import { SHARE_IMAGE_ALT } from "@/components/landing/seo";
import { ZuniaMark } from "@/components/landing/ZuniaMark";
import { BRAND_BG, BRAND_FG, BRAND_MUTED } from "@/lib/brand-mark";
import { SITE_HOST } from "@/lib/site";

export const alt = SHARE_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The brand ramp (120°, red → orange → gold). */
const RAMP = "linear-gradient(100deg, #FF1B0C 0%, #FF6A10 52%, #FFC414 100%)";

async function loadFont(file: string) {
  try {
    return await readFile(path.join(process.cwd(), "node_modules/@zunialab/fonts/files", file));
  } catch {
    return null;
  }
}

type Font = { name: string; data: Buffer; weight: 400 | 500 | 700; style: "normal" };

/**
 * Rings and the mark on the right: the same composition as the coming-soon
 * pages, centred at (1060, 315) and pushed past the right edge so the
 * outer ring stays clear of the headline.
 */
function Orbit() {
  return (
    <svg width="520" height="520" viewBox="0 0 400 400" style={{ position: "absolute", right: -120, top: 55 }}>
      <defs>
        <linearGradient id="og-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF1B0C" />
          <stop offset="0.5" stopColor="#FF6A10" />
          <stop offset="1" stopColor="#FFC414" />
        </linearGradient>
        <radialGradient id="og-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FF4E12" stopOpacity="0.32" />
          <stop offset="0.6" stopColor="#FF6A10" stopOpacity="0.08" />
          <stop offset="1" stopColor="#FF6A10" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="150" fill="url(#og-glow)" />
      <circle cx="200" cy="200" r="194" fill="none" stroke={BRAND_FG} strokeOpacity="0.07" />
      <circle cx="200" cy="200" r="158" fill="none" stroke={BRAND_FG} strokeOpacity="0.16" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx="200" cy="200" r="120" fill="none" stroke={BRAND_FG} strokeOpacity="0.1" />
      <circle cx="200" cy="200" r="82" fill="none" stroke="url(#og-ring)" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="120 400" strokeLinecap="round" />
      <circle cx="200" cy="80" r="2.5" fill={BRAND_FG} fillOpacity="0.35" />
      <circle cx="358" cy="200" r="2.5" fill={BRAND_FG} fillOpacity="0.25" />
      <circle cx="118" cy="200" r="2" fill={BRAND_FG} fillOpacity="0.3" />
      <rect x="146" y="146" width="108" height="108" rx="32" fill="#161311" stroke={BRAND_FG} strokeOpacity="0.13" />
    </svg>
  );
}

export default async function OpenGraphImage() {
  const [medium, bold, mono] = await Promise.all([
    loadFont("SpaceGrotesk-Medium.ttf"),
    loadFont("SpaceGrotesk-Bold.ttf"),
    loadFont("JetBrainsMono-Regular.ttf"),
  ]);
  const fonts = [
    medium && { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
    bold && { name: "Space Grotesk", data: bold, weight: 700, style: "normal" },
    mono && { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
  ].filter(Boolean) as Font[];
  const monoFamily = mono ? "JetBrains Mono" : "Space Grotesk";

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: BRAND_BG,
          backgroundImage:
            "radial-gradient(ellipse 70% 80% at 92% 8%, rgba(255,27,12,0.22) 0%, rgba(255,106,16,0.08) 45%, transparent 75%)",
          color: BRAND_FG,
          fontFamily: "Space Grotesk",
        }}
      >
        <Orbit />
        {/* Centred in the orbit's core square (viewBox 146–254 at 1.3× from 800, 55). */}
        <div style={{ position: "absolute", right: 108, top: 275, display: "flex" }}>
          <ZuniaMark id="og-core" size={64} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ZuniaMark id="og-lockup" size={38} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 40, lineHeight: 1 }}>
            <span style={{ fontWeight: 700, letterSpacing: "-0.065em" }}>zunia</span>
            <span style={{ fontWeight: 500, letterSpacing: "-0.03em", color: BRAND_MUTED }}>dashboard</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 82, fontWeight: 500, lineHeight: 1.02, letterSpacing: "-0.045em" }}>
            <span>Every Cosmos chain.</span>
            {/* Shrunk to the text so the ramp runs red to gold across the words, not the column. */}
            <span style={{ alignSelf: "flex-start", backgroundImage: RAMP, backgroundClip: "text", color: "transparent", paddingBottom: 6 }}>
              One decision desk.
            </span>
          </div>
          <div style={{ display: "flex", maxWidth: 760, fontSize: 28, lineHeight: 1.4, color: BRAND_MUTED, letterSpacing: "-0.01em" }}>
            Balances, staking, governance, swaps and IBC across {mainnetCount()} networks. Your keys stay in your wallet.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: monoFamily, fontSize: 22, letterSpacing: "0.06em", color: BRAND_MUTED }}>
          <span style={{ textTransform: "uppercase" }}>{SITE_HOST}</span>
          <span style={{ width: 6, height: 6, borderRadius: 6, background: "#3a3632" }} />
          <span style={{ textTransform: "uppercase" }}>Non-custodial</span>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
