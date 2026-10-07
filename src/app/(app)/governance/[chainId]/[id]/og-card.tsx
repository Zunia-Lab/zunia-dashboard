/**
 * The share image of a proposal (Open Graph and X): where, what, its status
 * and deadline, and the tally against its rules — so a link dropped in a
 * chat already answers "is it passing?". Rendered with `next/og` from the
 * same server read as the page; the figures say when they were read, and a
 * proposal that cannot be read yet gets a plain card instead of made-up bars.
 *
 * Satori renders a subset of CSS: flex layout only, no hatching, so No with
 * veto is a deeper orange here (the page's hatch is its CVD relief; the
 * legend under the bar carries the names either way).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { typeBadge, VOTE_ORDER, VOTE_SHORT } from "@/components/governance/model";
import { outcomeOf, passLine, pct, tallyShares, withUsableTurnout } from "@/components/governance/rules";
import { BRAND_BG, BRAND_FG, BRAND_MUTED, BrandMark } from "@/lib/brand-mark";
import type { ProposalDetail, VoteOptionName } from "@/lib/chain/types";
import { findServerChain } from "@/lib/server/chains";
import { SITE_HOST } from "@/lib/site";
import { loadProposal } from "./load";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "A Cosmos governance proposal on Zunia: status, deadline and live tally";

/** Dark-theme slots of the dashboard palette (viz.css), the page's vote colours. */
const VOTE_COLOR: Record<VoteOptionName, string> = {
  yes: "#3987e5",
  no: "#d95926",
  veto: "#9c3b17",
  abstain: "#6e6e78",
};

const TONE: Record<string, { fg: string; bg: string }> = {
  success: { fg: "#4ed8a0", bg: "rgba(78,216,160,0.12)" },
  warning: { fg: "#f0a35e", bg: "rgba(240,163,94,0.12)" },
  danger: { fg: "#e85a4a", bg: "rgba(232,90,74,0.12)" },
  neutral: { fg: BRAND_MUTED, bg: "rgba(241,240,238,0.06)" },
  info: { fg: "#ffb020", bg: "rgba(255,176,32,0.12)" },
};

async function font(file: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), "node_modules/@zunialab/fonts/files", file));
  } catch {
    return null;
  }
}

type Font = { name: string; data: Buffer; weight: 500 | 700 | 400; style: "normal" };

function utc(iso: string | null): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at) || at <= 0) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(at);
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function statusLine(proposal: ProposalDetail): { text: string; tone: keyof typeof TONE } {
  switch (proposal.status) {
    case "voting": {
      const end = utc(proposal.votingEndTime);
      return { text: end ? `Voting · ends ${end}` : "Voting", tone: "info" };
    }
    case "deposit": {
      const end = utc(proposal.depositEndTime);
      return { text: end ? `Collecting deposit · until ${end}` : "Collecting deposit", tone: "neutral" };
    }
    case "passed":
      return { text: "Passed", tone: "success" };
    case "rejected":
      return { text: "Rejected", tone: "danger" };
    case "failed":
      return { text: "Failed", tone: "danger" };
    default:
      return { text: "Proposal", tone: "neutral" };
  }
}

function Tally({ proposal, now }: { proposal: ProposalDetail; now: number }) {
  const shares = tallyShares(proposal.tally);
  if (!shares) return null;
  const line = passLine(proposal.tally, proposal.threshold);
  const outcome = outcomeOf(proposal, now);
  const tone = TONE[outcome.tone] ?? TONE.neutral;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 28, fontSize: 24, color: BRAND_MUTED }}>
        {VOTE_ORDER.map((option) => (
          <div key={option} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: VOTE_COLOR[option] }} />
            <span>{VOTE_SHORT[option]}</span>
            <span style={{ color: BRAND_FG, fontWeight: 700 }}>{pct(shares[option])}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", display: "flex", height: 22, borderRadius: 6, overflow: "hidden", background: "rgba(241,240,238,0.08)" }}>
        {VOTE_ORDER.filter((option) => shares[option] > 0).map((option, index) => (
          <div
            key={option}
            // Satori expands every style key it is given: no undefined values.
            style={{
              width: `${shares[option] * 100}%`,
              height: "100%",
              background: VOTE_COLOR[option],
              ...(index > 0 ? { borderLeft: `3px solid ${BRAND_BG}` } : {}),
            }}
          />
        ))}
        {line !== null ? (
          <div style={{ position: "absolute", left: `${line * 100}%`, top: 0, bottom: 0, width: 3, background: BRAND_FG }} />
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", padding: "10px 18px", borderRadius: 12, background: tone.bg, color: tone.fg, fontSize: 26, fontWeight: 700 }}>
          {outcome.label}
        </div>
        {/* No turnout when an ended vote's estimate is withheld (too old to mean anything). */}
        {proposal.turnout !== null ? (
          <div style={{ display: "flex", gap: 8, fontSize: 24, color: BRAND_MUTED }}>
            <span>Turnout</span>
            {/* "~", not "≈": the share font has no glyph for it. */}
            <span style={{ color: BRAND_FG, fontWeight: 700 }}>
              {proposal.turnoutEstimate ? "~" : ""}
              {pct(proposal.turnout)}
            </span>
            <span>· quorum {pct(proposal.quorum)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The image for one proposal; a plain branded card when it cannot be read. */
export async function proposalShareImage(params: Promise<{ chainId: string; id: string }>): Promise<ImageResponse> {
  const raw = await params;
  let chainId = raw.chainId;
  let id = raw.id;
  try {
    chainId = decodeURIComponent(raw.chainId);
    id = decodeURIComponent(raw.id);
  } catch {
    // Malformed escapes: render the generic card with what we have.
  }
  const [loaded, medium, bold, mono] = await Promise.all([
    loadProposal(chainId, id, 6_000),
    font("SpaceGrotesk-Medium.ttf"),
    font("SpaceGrotesk-Bold.ttf"),
    font("JetBrainsMono-Regular.ttf"),
  ]);
  const fonts = [
    medium && { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
    bold && { name: "Space Grotesk", data: bold, weight: 700, style: "normal" },
    mono && { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
  ].filter(Boolean) as Font[];
  const monoFamily = mono ? "JetBrains Mono" : "Space Grotesk";
  const chainName = findServerChain(chainId)?.chainName ?? chainId;
  // An ended vote's turnout estimate only when it still means something.
  const proposal = loaded.kind === "ok" ? withUsableTurnout(loaded.body.proposal, loaded.body.updatedAt) : null;
  const status = proposal ? statusLine(proposal) : null;
  const statusTone = status ? (TONE[status.tone] ?? TONE.neutral) : TONE.neutral;
  const title = proposal ? clip(proposal.title, 120) : `Governance proposal #${id}`;
  const now = Date.now();
  const readAt = loaded.kind === "ok" ? new Date(loaded.body.updatedAt) : null;
  const asOf = readAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(readAt)
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 68px",
          background: BRAND_BG,
          backgroundImage: "radial-gradient(ellipse 70% 80% at 96% 4%, rgba(255,27,12,0.2) 0%, rgba(255,106,16,0.07) 45%, transparent 75%)",
          color: BRAND_FG,
          fontFamily: "Space Grotesk",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={26} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 30, lineHeight: 1 }}>
              <span style={{ fontWeight: 700, letterSpacing: "-0.06em" }}>zunia</span>
              <span style={{ fontWeight: 500, color: BRAND_MUTED, letterSpacing: "-0.02em" }}>governance</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: monoFamily, fontSize: 24, color: BRAND_MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <span style={{ color: BRAND_FG }}>{chainName}</span>
            <span>#{id}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {status ? (
              <div style={{ display: "flex", padding: "8px 16px", borderRadius: 999, background: statusTone.bg, color: statusTone.fg, fontSize: 22, fontWeight: 700 }}>
                {status.text}
              </div>
            ) : null}
            {proposal ? (
              <div style={{ display: "flex", padding: "8px 16px", borderRadius: 10, background: "rgba(241,240,238,0.07)", color: BRAND_MUTED, fontSize: 22 }}>
                {typeBadge(proposal)}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", fontSize: title.length > 80 ? 50 : 60, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.035em", maxWidth: 1040 }}>
            {title}
          </div>
        </div>

        {proposal ? <Tally proposal={proposal} now={now} /> : <div style={{ display: "flex", fontSize: 28, color: BRAND_MUTED }}>Status, deadline and live tally on Zunia.</div>}

        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: monoFamily, fontSize: 20, letterSpacing: "0.05em", color: BRAND_MUTED, textTransform: "uppercase" }}>
          <span>{`${SITE_HOST}/governance`}</span>
          <span>{asOf ? `As of ${asOf} UTC` : "Non-custodial"}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined },
  );
}
