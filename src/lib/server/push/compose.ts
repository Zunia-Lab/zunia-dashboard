/**
 * Words for the push poller's events. Pure, so the copy and its safety rules
 * are tested directly.
 *
 * Amounts are honest or absent. A coin the identity tables list (a registry
 * ticker and known decimals) reads "12.5 OSMO". An IBC voucher nothing names
 * keeps its base units and a shortened hash ("950000 base units of
 * ibc/7D72…DAB2"), never six guessed decimals — a wrong number in a
 * notification is worse than a raw one.
 *
 * And spam-safe. Anyone can send any wallet a token, and on Cosmos airdrop
 * spam is token factories named like `www.claim-reward.example`. A push is a
 * trusted channel, so text an attacker chose (an unlisted factory or CW20
 * name) never appears in one, and a plain transfer made only of such tokens is
 * not pushed at all — it still shows in Activity. An IBC arrival is different:
 * the user is usually waiting for it, so it is announced, with the unnamed
 * token described as "an unlisted token".
 */

import { noticeHref, noticeId } from "@/lib/notifications/ids";
import { clip, durationText, joinNames, shortAddress } from "@/lib/notifications/text";
import type { Notice, NoticeData } from "@/lib/notifications/types";

/** A received coin with what the identity tables could vouch for. */
export interface NamedCoin {
  /** Base units, decimal string. */
  readonly amount: string;
  readonly denom: string;
  /** Registry ticker, or null when nothing trustworthy names it (never a minter-chosen name). */
  readonly ticker: string | null;
  /** Known decimals, or null. */
  readonly decimals: number | null;
}

/** Base units → decimal string with at most `maxFraction` digits, no float math. */
export function formatBaseUnits(amount: string, decimals: number, maxFraction = 6): string {
  if (!/^\d{1,80}$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return amount;
  const digits = amount.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return withGrouping(digits);
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  let fraction = padded.slice(-decimals).slice(0, maxFraction).replace(/0+$/, "");
  // A tiny but non-zero amount must not print as "0".
  if (!fraction && /^0+$/.test(whole) && /[1-9]/.test(digits)) {
    fraction = padded.slice(-decimals).replace(/0+$/, "");
  }
  return fraction ? `${withGrouping(whole)}.${fraction}` : withGrouping(whole);
}

function withGrouping(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `ibc/7D72341AF4…` → `ibc/7D72…DAB2`; other denoms unchanged (callers decide if they may show them). */
export function shortDenom(denom: string): string {
  const match = /^ibc\/([0-9A-Fa-f]{64})$/.exec(denom);
  return match ? `ibc/${match[1].slice(0, 4).toUpperCase()}…${match[1].slice(-4).toUpperCase()}` : denom;
}

export interface CoinWords {
  readonly text: string;
  /** Named by a proven identity. */
  readonly named: boolean;
}

/** One coin in words, or null when its only possible name is attacker-chosen text. */
export function coinWords(coin: NamedCoin): CoinWords | null {
  if (coin.ticker && coin.decimals !== null) {
    return { text: `${formatBaseUnits(coin.amount, coin.decimals)} ${coin.ticker}`, named: true };
  }
  if (/^ibc\/[0-9A-Fa-f]{64}$/.test(coin.denom)) {
    return { text: `${coin.amount} base units of ${shortDenom(coin.denom)}`, named: false };
  }
  return null;
}

function sentence(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export interface IncomingEvent {
  readonly chainId: string;
  readonly chainName: string;
  readonly hash: string;
  /** Epoch ms of the block, or null when the node did not say. */
  readonly at: number | null;
  readonly coins: readonly NamedCoin[];
  /** Transfer senders as the chain recorded them (relayer escrow for IBC). */
  readonly senders: readonly string[];
  /** Set for a delivery over IBC. */
  readonly ibc: { readonly sourceChainName: string | null; readonly sender: string | null } | null;
  /** Tokens returned because an outgoing IBC transfer failed or timed out. */
  readonly refund: boolean;
}

/**
 * The notice for an incoming transfer, or null when it should not be pushed
 * (nothing nameable arrived in a plain transfer).
 */
export function composeIncoming(event: IncomingEvent, now: number): Notice | null {
  const words = event.coins.map(coinWords);
  const shown = words.filter((word): word is CoinWords => word !== null);
  const unnamed = words.length - shown.length;
  const parts = shown.map((word) => word.text);
  if (unnamed > 0) parts.push(unnamed === 1 ? "an unlisted token" : `${unnamed} unlisted tokens`);
  const amounts = joinNames(parts, 2, "more");
  const firstNamed = shown.find((word) => word.named)?.text ?? null;
  const data: NoticeData = firstNamed ? { amount: firstNamed, hash: event.hash } : { hash: event.hash };
  const base = {
    id: noticeId.transfer(event.hash),
    chainId: event.chainId,
    url: noticeHref.tx(event.chainId, event.hash),
    at: event.at ?? now,
    data,
  };

  if (event.refund) {
    if (!amounts) return null;
    return {
      ...base,
      kind: "ibc",
      title: "IBC transfer refunded",
      body: clip(sentence(`${amounts} came back to you on ${event.chainName}: the transfer did not complete.`), 240),
      severity: "warning",
    };
  }
  if (event.ibc) {
    const from = event.ibc.sourceChainName;
    const sender = event.ibc.sender ? ` from ${shortAddress(event.ibc.sender)}` : "";
    return {
      ...base,
      kind: "ibc",
      title: from ? `Arrived from ${from}` : `IBC transfer arrived on ${event.chainName}`,
      body: clip(sentence(`${amounts || "Tokens"} landed on ${event.chainName}${sender}.`), 240),
      severity: "success",
    };
  }
  // A plain transfer: only when something in it can be named honestly.
  if (shown.length === 0) return null;
  const senders = [...new Set(event.senders)];
  return {
    ...base,
    kind: "transfer",
    title: clip(`Received ${amounts} on ${event.chainName}`, 120),
    body: senders.length === 1 ? `From ${shortAddress(senders[0])}` : senders.length > 1 ? "From several addresses" : "",
    severity: "success",
  };
}

export function composeGovernanceEnding(input: {
  readonly chainId: string;
  readonly chainName: string;
  readonly proposalId: string;
  readonly title: string;
  readonly endsAt: number;
  readonly now: number;
}): Notice {
  return {
    id: noticeId.governanceEnding(input.chainId, input.proposalId),
    kind: "governance",
    title: `Vote ends in ${durationText(input.endsAt - input.now)}`,
    body: clip(`#${input.proposalId} ${input.title} · ${input.chainName}. You haven't voted yet.`, 240),
    chainId: input.chainId,
    url: noticeHref.proposal(input.chainId, input.proposalId),
    at: input.endsAt - 86_400_000,
    severity: "warning",
    data: { proposalId: input.proposalId },
  };
}

export function composeUnbondingDone(input: {
  readonly id: string;
  readonly chainId: string;
  readonly chainName: string;
  readonly completesAt: number;
  readonly text: string;
}): Notice {
  return {
    id: input.id,
    kind: "unbonding",
    title: "Unbonding complete",
    body: clip(`${input.text || "Your stake"} is liquid again on ${input.chainName}.`, 240),
    chainId: input.chainId,
    url: noticeHref.staking(),
    at: input.completesAt,
    severity: "success",
    ...(input.text ? { data: { amount: input.text } } : {}),
  };
}
