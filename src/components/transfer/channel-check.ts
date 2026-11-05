/**
 * What the page knows about a route's channels, in words, including the check
 * the page runs on its own as soon as it knows its two networks
 * (`/api/interchain/channels`, see ./useChannelChecks.ts).
 *
 * A route used to open as "not verified" because its first plan answered
 * before the channel check of a new pair had finished, and fell back to the
 * registry's default channel; typing an amount planned again and found the
 * check done. Now the pair is checked independently of the amount, a hop whose
 * channel that check confirmed reads as verified, and a hop whose check is
 * still running reads as checking, in neutral words: "not verified" is said
 * only once a check has finished without confirming the channel.
 *
 * Pure: no network, no React.
 */

import type { Tone } from "@/components/ui";
import type { ChannelLinkWire } from "@/lib/interchain/wire";

export interface ChannelVerdict {
  label: string;
  tone: Tone;
  detail: string;
}

/** Where a pair's own channel check stands. */
export interface PairCheck {
  /** `checking` until the server answered for good (a first check can take a minute or two). */
  readonly status: "checking" | "done" | "failed";
  /** The channels from the pair's first chain to its second, as read from both. */
  readonly links: readonly ChannelLinkWire[];
  /** Why the check could not confirm anything, in the user's words. */
  readonly failures: readonly string[];
}

/** The key a pair's check is kept under. */
export function pairKey(fromChainId: string, toChainId: string): string {
  return `${fromChainId}>${toChainId}`;
}

/** Read from both chains just now, and open. */
export function isVerifiedOpen(link: ChannelLinkWire | undefined): boolean {
  return link !== undefined && link.source === "verified" && link.state === "open";
}

/** What the planner knows about one channel, in words. */
export function channelVerdict(link: ChannelLinkWire | undefined): ChannelVerdict {
  if (!link) return { label: "Not checked", tone: "neutral", detail: "No channel record came with this hop." };
  if (link.state === "closed") return { label: "Closed", tone: "danger", detail: "This channel is closed: a packet sent on it would never arrive." };
  if (link.source === "manual") {
    // Not "you entered": the planner also reuses a channel typed in an earlier
    // session. What is certain is that nobody discovered it on chain.
    return {
      label: "Entered by hand",
      tone: "warning",
      detail: "Typed in by hand, not discovered on chain, and not verified: it is used as given. Check the channel before you send.",
    };
  }
  if (isVerifiedOpen(link)) {
    return { label: "Verified · open", tone: "success", detail: "Read from both chains just now: the channel is open and connects these two networks." };
  }
  if (link.source === "seed") {
    return {
      label: "Registry default",
      tone: "warning",
      detail: "The channel the chain registry lists for this pair. It could not be checked on chain just now.",
    };
  }
  return { label: link.state === "open" ? "Open" : "Unconfirmed", tone: "neutral", detail: "The channel's state could not be confirmed." };
}

/** Said while a hop's channel is being read on both chains. */
export const CHECKING_VERDICT: ChannelVerdict = {
  label: "Checking…",
  tone: "neutral",
  detail: "Reading this channel on both chains now. The first check of a pair can take a minute.",
};

function confirmedBy(link: ChannelLinkWire, checks: ReadonlyMap<string, PairCheck>): ChannelLinkWire | undefined {
  const check = checks.get(pairKey(link.sourceChainId, link.destChainId));
  return check?.links.find(
    (candidate) =>
      candidate.channelId === link.channelId && (candidate.port || "transfer") === (link.port || "transfer") && isVerifiedOpen(candidate),
  );
}

/**
 * The record to show for a planned hop: the plan's own when it is verified,
 * closed or typed by hand, else the same channel as the pair's check confirmed
 * it, when it did.
 */
export function linkWithCheck(
  link: ChannelLinkWire | undefined,
  checks: ReadonlyMap<string, PairCheck>,
): ChannelLinkWire | undefined {
  if (!link || isVerifiedOpen(link) || link.state === "closed" || link.source === "manual") return link;
  return confirmedBy(link, checks) ?? link;
}

/** The hop's verdict, with the pair's check taken into account (checking reads neutral, never as a warning). */
export function hopVerdict(link: ChannelLinkWire | undefined, checks: ReadonlyMap<string, PairCheck>): ChannelVerdict {
  const shown = linkWithCheck(link, checks);
  if (shown && !isVerifiedOpen(shown) && shown.state !== "closed" && shown.source !== "manual") {
    if (checks.get(pairKey(shown.sourceChainId, shown.destChainId))?.status === "checking") return CHECKING_VERDICT;
  }
  return channelVerdict(shown);
}

/** The route's summary badge from its hops' verdicts. */
export function routeBadge(verdicts: readonly ChannelVerdict[]): { readonly label: string; readonly tone: Tone } {
  if (verdicts.some((verdict) => verdict.tone === "danger")) return { label: "Closed channel", tone: "danger" };
  if (verdicts.some((verdict) => verdict === CHECKING_VERDICT)) return { label: "Checking channels", tone: "neutral" };
  if (verdicts.some((verdict) => verdict.tone === "warning")) return { label: "Not fully verified", tone: "warning" };
  return { label: "Channels verified", tone: "success" };
}

/** The pairs a page checks: its two networks as soon as both are known, then every hop of the planned route. */
export function pairsToCheck(
  fromChainId: string | null | undefined,
  toChainId: string | null | undefined,
  hops: readonly { readonly chainId: string; readonly counterpartyChainId: string | null; readonly channelId: string }[] = [],
): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  const add = (from: string | null | undefined, to: string | null | undefined) => {
    if (!from || !to || from === to) return;
    const key = pairKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    out.push([from, to]);
  };
  add(fromChainId, toChainId);
  for (const hop of hops) if (hop.channelId) add(hop.chainId, hop.counterpartyChainId);
  return out;
}
