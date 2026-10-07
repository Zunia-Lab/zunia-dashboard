/**
 * The rules behind Send, Bridge and Receive, as pure functions.
 *
 * Kept out of the components so each rule is tested on its own: which
 * balances can be sent, how much Max leaves for the fee, what an address is
 * and which chain it belongs to, whether a planned route still pays the
 * person the user typed, and which routes are worth offering. Nothing here
 * reads the chain catalog JSON (callers pass lookups) or touches React.
 */

import { bech32PrefixOf, isValidBech32Address, validateMemo } from "@zunialab/interchain";
import type { ActivityItem } from "@/lib/activity/types";
import type { HopOverrideInput } from "@/lib/interchain/client";
import type { ChannelLinkWire } from "@/lib/interchain/wire";
import type { PortfolioAmounts, PortfolioAsset, PortfolioResponse, UnpricedReason } from "@/lib/token/wire";
import type { TokenIdentity } from "@/lib/token/types";

/* -------------------------------------------------------------------------- *
 * Amounts
 * -------------------------------------------------------------------------- */

const DIGITS = /^\d+$/;

function isUnits(value: string): boolean {
  return DIGITS.test(value);
}

/**
 * A typed amount in display units → base units, exactly. `null` when it is
 * not a plain decimal or has more fraction digits than the token. With
 * unknown decimals the field holds base units already (only Max fills it).
 */
export function toBase(text: string, decimals: number | null): string | null {
  const value = text.trim();
  if (decimals === null) return isUnits(value) ? value.replace(/^0+(?=\d)/, "") : null;
  if (value === "" || value === "." || !/^\d*\.?\d*$/.test(value)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return `${whole || "0"}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

/** Base units → an exact display string ("12.5"), trailing zeros dropped. */
export function fromBase(base: string, decimals: number | null): string {
  if (!isUnits(base)) return "0";
  const value = base.replace(/^0+(?=\d)/, "");
  if (decimals === null || decimals <= 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function isPositive(base: string | null | undefined): base is string {
  return typeof base === "string" && isUnits(base) && BigInt(base) > BigInt(0);
}

/** `a > b` over base units, never through floats. */
export function exceeds(a: string, b: string): boolean {
  return isUnits(a) && isUnits(b) && BigInt(a) > BigInt(b);
}

export function subtractUnits(a: string, b: string): string {
  if (!isUnits(a) || !isUnits(b)) return "0";
  const out = BigInt(a) - BigInt(b);
  return out > BigInt(0) ? out.toString() : "0";
}

/**
 * The most that can be sent: the liquid balance, less the fee reserve when
 * the token is also the fee token. Never negative.
 */
export function maxSendable(liquid: string, reserve: string | null): string {
  if (!isUnits(liquid)) return "0";
  if (!reserve || !isUnits(reserve)) return liquid.replace(/^0+(?=\d)/, "");
  return subtractUnits(liquid, reserve);
}

/** `percent` of a base amount, rounded down (the quick 25 / 50 / 75 % chips). */
export function fractionOf(base: string, percent: number): string {
  if (!isUnits(base) || !Number.isFinite(percent) || percent <= 0) return "0";
  if (percent >= 100) return base.replace(/^0+(?=\d)/, "");
  return ((BigInt(base) * BigInt(Math.round(percent * 100))) / BigInt(10_000)).toString();
}

/** Whole tokens as a float, for money only (amounts stay exact elsewhere). */
export function toWhole(base: string, decimals: number | null): number | null {
  if (decimals === null || !isUnits(base)) return null;
  const scale = BigInt(10) ** BigInt(decimals);
  const units = BigInt(base);
  return Number(units / scale) + Number(units % scale) / Number(scale);
}

/** `base × price` in the price's currency; null when either is unknown. */
export function valueOf(base: string, decimals: number | null, price: number | null): number | null {
  const whole = toWhole(base, decimals);
  return whole === null || price === null || !Number.isFinite(price) ? null : whole * price;
}

/**
 * The network fee as a share of the amount sent, in percent: exact when the
 * fee is paid in the token being sent, else from both values in money. Null
 * when neither comparison can be made honestly.
 */
export function feeShare(input: {
  feeBase: string | null;
  feeDenom: string | null;
  amountBase: string | null;
  denom: string;
  feeValue: number | null;
  amountValue: number | null;
}): number | null {
  const { feeBase, feeDenom, amountBase, denom, feeValue, amountValue } = input;
  if (feeBase && feeDenom === denom && isPositive(amountBase) && isUnits(feeBase)) {
    // Both in base units of one token: scaled integer division, no float until the end.
    return Number((BigInt(feeBase) * BigInt(1_000_000)) / BigInt(amountBase)) / 10_000;
  }
  if (feeValue !== null && amountValue !== null && amountValue > 0 && Number.isFinite(feeValue)) {
    return (feeValue / amountValue) * 100;
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * What can be sent
 * -------------------------------------------------------------------------- */

/** One balance the user can send right now (liquid only: staked tokens cannot move). */
export interface SpendableAsset {
  /** `${chainId}|${denom}`: unique per balance, unlike the identity key. */
  key: string;
  chainId: string;
  denom: string;
  identity: TokenIdentity;
  /** Liquid balance, base units. */
  liquid: string;
  decimals: number | null;
  /** Price of one whole token in the response currency; null when unpriced. */
  price: number | null;
  /** Liquid balance × price; null when unpriced. */
  value: number | null;
  unpriced?: UnpricedReason;
}

export function balanceKey(chainId: string, denom: string): string {
  return `${chainId}|${denom}`;
}

/** `balanceKey` back into its parts (a denom never holds "|"). */
export function splitBalanceKey(key: string): { chainId: string; denom: string } {
  const at = key.indexOf("|");
  return at < 0 ? { chainId: key, denom: "" } : { chainId: key.slice(0, at), denom: key.slice(at + 1) };
}

export type MissingTokenReason = "scope" | "unfollowed" | "unread" | "empty";

/**
 * Why a token the user picked (or a link named) is not among the balances
 * read, so the form says so instead of quietly putting another token in its
 * place (an amount typed for one token must never end up attached to
 * another):
 *
 * - `unfollowed`: its chain is not one of the followed networks on this slice;
 * - `scope`: its chain is followed, but the rail has another chain selected;
 * - `unread`: its chain was read and did not answer;
 * - `empty`: the chain answered and holds none of it to move (spent, or
 *   only staked).
 */
export function missingTokenReason(
  chainId: string,
  context: { scoped: readonly string[]; followed: readonly string[]; chainStatus: "ok" | "error" | null },
): MissingTokenReason {
  if (!context.followed.includes(chainId)) return "unfollowed";
  if (!context.scoped.includes(chainId)) return "scope";
  return context.chainStatus === "error" ? "unread" : "empty";
}

/**
 * Portfolio rows that can move: a positive liquid balance of a bank denom.
 * CW20 balances live in a contract, not the bank module, so neither MsgSend
 * nor an ICS-20 transfer can move them. Most valuable first; unpriced ones
 * after the priced, by ticker.
 */
export function spendableAssets(assets: readonly PortfolioAsset[]): SpendableAsset[] {
  const rows: SpendableAsset[] = [];
  for (const asset of assets) {
    const liquid = asset.amounts.liquid;
    if (!isPositive(liquid) || asset.identity.kind === "cw20") continue;
    const price = asset.price && Number.isFinite(asset.price.price) ? asset.price.price : null;
    rows.push({
      key: balanceKey(asset.chainId, asset.identity.denom),
      chainId: asset.chainId,
      denom: asset.identity.denom,
      identity: asset.identity,
      liquid,
      decimals: asset.identity.decimals,
      price,
      value: valueOf(liquid, asset.identity.decimals, price),
      ...(asset.unpriced ? { unpriced: asset.unpriced } : {}),
    });
  }
  return rows.sort((a, b) => {
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    return a.identity.ticker.localeCompare(b.identity.ticker);
  });
}

/* -------------------------------------------------------------------------- *
 * What it is worth
 * -------------------------------------------------------------------------- */

/**
 * A sum of values that says what it leaves out. A balance without a price
 * is counted, never added as 0: a total of only unpriced tokens is unknown,
 * not $0.00, and a total that skips some says how many.
 */
export interface PricedSum {
  /**
   * The priced rows' values added up: 0 when there are no rows (a real
   * zero), null when there are rows and none of them has a price.
   */
  value: number | null;
  /** Rows counted, priced or not. */
  count: number;
  /** Rows without a price. */
  unpriced: number;
}

/** What some balances are worth ("Spendable now"), as a {@link PricedSum}. */
export function pricedSum(rows: readonly Pick<SpendableAsset, "value">[]): PricedSum {
  let value: number | null = rows.length === 0 ? 0 : null;
  let unpriced = 0;
  for (const row of rows) {
    if (row.value === null || !Number.isFinite(row.value)) unpriced += 1;
    else value = (value ?? 0) + row.value;
  }
  return { value, count: rows.length, unpriced };
}

/** {@link pricedSum} per chain, for the chains holding something to move (in the balances' order). */
export function pricedSumByChain(assets: readonly SpendableAsset[]): Map<string, PricedSum> {
  const byChain = new Map<string, SpendableAsset[]>();
  for (const asset of assets) {
    const rows = byChain.get(asset.chainId);
    if (rows) rows.push(asset);
    else byChain.set(asset.chainId, [asset]);
  }
  return new Map([...byChain].map(([chainId, rows]) => [chainId, pricedSum(rows)]));
}

/** One of the four amounts a portfolio row holds. */
export type Bucket = keyof PortfolioAmounts;

/**
 * The read each bucket comes from: the issue scopes of the portfolio read
 * (`server/portfolio/read.ts`). The bank read is required (its failure
 * fails the whole chain); the other three fail on their own.
 */
const BUCKET_READ: Readonly<Record<Bucket, string>> = {
  liquid: "bank",
  staked: "delegations",
  rewards: "rewards",
  unbonding: "unbonding",
};

export interface BucketWorth {
  /**
   * The buckets' priced value (the response's totals). Null when that is 0
   * only because what sits there has no price, or was not read: unknown,
   * not $0.00. A positive figure stays; `unpriced` and `unread` say what it
   * leaves out.
   */
  value: number | null;
  /** Holdings with an amount in the buckets and no price. */
  unpriced: number;
  /** Networks whose read of the buckets failed (the whole chain, or that one read). */
  unread: number;
}

/**
 * What some buckets of the portfolio are worth: Send's "Staked & unbonding"
 * and its rewards. The totals the server sends add up priced value only, so
 * a bucket that holds nothing but unpriced tokens (a testnet's stake, SAF
 * while its one price source is down), or whose only read failed, totals 0;
 * the tile then said $0.00 for a stake that exists.
 */
export function bucketWorth(
  portfolio: Pick<PortfolioResponse, "totals" | "assets" | "chains" | "errors">,
  buckets: readonly Bucket[],
): BucketWorth {
  let value = 0;
  for (const bucket of buckets) {
    const total = portfolio.totals[bucket];
    if (Number.isFinite(total)) value += total;
  }
  let unpriced = 0;
  for (const asset of portfolio.assets) {
    if (asset.value === null && buckets.some((bucket) => isPositive(asset.amounts[bucket]))) unpriced += 1;
  }
  const unread = new Set<string>();
  for (const chain of portfolio.chains) if (chain.status === "error") unread.add(chain.chainId);
  for (const issue of portfolio.errors ?? []) {
    if (issue.chainId && buckets.some((bucket) => issue.scope === BUCKET_READ[bucket])) unread.add(issue.chainId);
  }
  const known = value > 0 || (unpriced === 0 && unread.size === 0);
  return { value: known ? value : null, unpriced, unread: unread.size };
}

/** Where a token comes from, relative to a move from `from` to `to`. */
export type MoveKind = "native" | "home" | "away";

/**
 * - `native`: minted on the source chain; the destination mints a voucher.
 * - `home`: a voucher going back to its own chain (unwinds, arrives native).
 * - `away`: a voucher moving on to a third chain. The planner sends it home
 *   first and forwards it from there (more hops, more time).
 */
export function moveKind(identity: Pick<TokenIdentity, "chainId" | "originChainId" | "provenance">, toChainId: string): MoveKind {
  const origin = identity.provenance === "unknown" ? null : (identity.originChainId ?? null);
  if (!origin || origin === identity.chainId) return "native";
  return origin === toChainId ? "home" : "away";
}

/* -------------------------------------------------------------------------- *
 * Recipients
 * -------------------------------------------------------------------------- */

/** The catalog fields recipient detection needs. */
export interface PrefixChain {
  chainId: string;
  chainName: string;
  bech32Prefix: string;
  network: "mainnet" | "testnet";
}

export type RecipientState = "empty" | "partial" | "invalid" | "operator" | "unknown-prefix" | "valid";

export interface RecipientCheck {
  state: RecipientState;
  /** Trimmed, lower-cased when it was all upper case. */
  address: string;
  prefix: string | null;
  /** Catalog chains using the prefix (in the lookup's order). */
  chains: PrefixChain[];
  /** Why it cannot be used, for the field's error line. */
  message: string | null;
}

/** The shortest Cosmos account address: a one-letter prefix, "1", 32 data + 6 checksum characters. */
const MIN_ADDRESS_LENGTH = 40;

/**
 * Is this an address, and of which chain?
 *
 * The checksum is verified, not only the shape (a typo in one character is
 * the classic loss). A validator operator address (`…valoper1…`) is refused
 * with its own sentence: tokens sent to one are not delegated, they are gone.
 * Text still being typed is `partial`, so the field does not shout at the
 * third character.
 */
export function checkRecipient(text: string, chainsForPrefix: (prefix: string) => PrefixChain[]): RecipientCheck {
  const trimmed = text.trim();
  const address = trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed;
  const base = { address, prefix: null, chains: [] as PrefixChain[] };
  if (!address) return { ...base, state: "empty", message: null };
  const prefix = bech32PrefixOf(address);
  if (/valoper$|valcons$/.test(prefix ?? "")) {
    return {
      ...base,
      prefix,
      state: "operator",
      message: "That is a validator operator address. Tokens sent to it are not staked and cannot be recovered; delegate from Staking instead.",
    };
  }
  if (address !== address.toLowerCase() || !isValidBech32Address(address)) {
    return address.length < MIN_ADDRESS_LENGTH && /^[a-z0-9_@.-]*1?[a-z0-9]*$/.test(address)
      ? { ...base, prefix, state: "partial", message: null }
      : { ...base, prefix, state: "invalid", message: "Not a valid address. Check it for a typo." };
  }
  const chains = prefix ? chainsForPrefix(prefix) : [];
  if (chains.length === 0) {
    return {
      ...base,
      prefix,
      state: "unknown-prefix",
      message: `No network Zunia knows uses ${prefix}1… addresses.`,
    };
  }
  return { address, prefix, chains, state: "valid", message: null };
}

export interface Destination {
  /** The chain the recipient is on; null when the prefix is ambiguous and nothing decides it. */
  chainId: string | null;
  /** Every chain on the source's network that uses the prefix (more than one: the user picks). */
  options: PrefixChain[];
}

/**
 * Which chain a valid address is on, for a send from `source`.
 *
 * Same prefix as the source chain: it is a plain send on that chain. Several
 * chains share some prefixes (a mainnet and its testnet, a chain and its
 * "classic" fork); only those on the source's network count, and when more
 * than one remains the `preferred` choice (the user's) wins, else the first.
 */
export function pickDestination(
  check: RecipientCheck,
  source: { chainId: string; bech32Prefix: string; network: "mainnet" | "testnet" },
  preferred?: string | null,
): Destination {
  if (check.state !== "valid" || !check.prefix) return { chainId: null, options: [] };
  if (check.prefix === source.bech32Prefix) {
    const same = check.chains.filter((chain) => chain.network === source.network);
    return { chainId: source.chainId, options: same.length > 0 ? same : check.chains };
  }
  const onNetwork = check.chains.filter((chain) => chain.network === source.network);
  if (onNetwork.length === 0) return { chainId: null, options: [] };
  const chosen = preferred ? onNetwork.find((chain) => chain.chainId === preferred) : undefined;
  return { chainId: (chosen ?? onNetwork[0])?.chainId ?? null, options: onNetwork };
}

export interface AddressParts {
  /** The human-readable part and the separator: "cosmos1". Empty when there is no separator. */
  head: string;
  /** The data part before the tail, in groups (four characters each, the last may be shorter). */
  groups: string[];
  /** The last characters: the ones people compare first. */
  tail: string;
}

/**
 * An address cut into the pieces people check it by: the prefix, short
 * groups, and the last six characters. Presentation only: joined back, the
 * parts are the address exactly (nothing added, nothing lost). The separator
 * is bech32's: the last "1".
 */
export function addressParts(address: string, group = 4, tailLength = 6): AddressParts {
  const separator = address.lastIndexOf("1");
  const head = separator > 0 ? address.slice(0, separator + 1) : "";
  const body = address.slice(head.length);
  const size = Math.max(1, Math.floor(group));
  const keep = body.length > tailLength ? Math.max(0, Math.floor(tailLength)) : body.length;
  const tail = body.slice(body.length - keep);
  const middle = body.slice(0, body.length - keep);
  const groups: string[] = [];
  for (let at = 0; at < middle.length; at += size) groups.push(middle.slice(at, at + size));
  return { head, groups, tail };
}

/**
 * Exchange deposit addresses usually need a memo (a deposit tag) to be
 * credited. Read from the contact's label and note: there is no public list
 * of exchange addresses to check against, so this only fires on a name.
 */
const EXCHANGES =
  /\b(binance|coinbase|kraken|okx|okex|kucoin|bybit|gate\.?io|mexc|bitget|htx|huobi|crypto\.com|bitfinex|bitstamp|upbit|bithumb|coinstore|bitmart|coinex|exchange|cex)\b/i;

export function looksLikeExchange(...texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((value) => typeof value === "string" && EXCHANGES.test(value));
}

/* -------------------------------------------------------------------------- *
 * Route checks
 * -------------------------------------------------------------------------- */

/** The planned-route fields the intent check reads. */
export interface PlannedTransfer {
  receiver: string;
  plan: { destChainId: string; memo: string };
}

/**
 * Does the planned transfer still pay the person the user typed, on the
 * network they chose? Checked from the memo bytes, right before signing.
 *
 * The plan arrives over the network. With no memo, the packet's receiver is
 * the recipient; with a packet-forward memo, the receiver is an intermediate
 * chain's address and the memo's last hop names who is paid. A plain
 * transfer never carries a contract call, so any other memo is refused.
 */
export function transferIntentProblem(
  planned: PlannedTransfer,
  intent: { recipient: string; destChainId: string },
): string | null {
  if (planned.plan.destChainId !== intent.destChainId) {
    return "The planned route ends on another network than the one chosen. Plan it again.";
  }
  const memo = planned.plan.memo;
  if (!memo) {
    return planned.receiver === intent.recipient ? null : "The planned transfer pays another address than the recipient entered.";
  }
  const inspection = validateMemo(memo, { receiver: planned.receiver });
  if (inspection.kind !== "forward" || !inspection.forward) {
    return "The planned route carries a memo a plain transfer should not have, so it is not signed from here.";
  }
  if (inspection.forward.finalReceiver !== intent.recipient) {
    return "The forwarding memo pays another address than the recipient entered.";
  }
  return null;
}

/** The planned-link fields the stranger check reads. */
export type PlannedLink = Pick<ChannelLinkWire, "sourceChainId" | "destChainId" | "channelId" | "source">;

/**
 * The hand-entered channels of a planned route that this form did not set.
 *
 * The planner keeps the channels typed into earlier plan requests (any
 * session, any user) and serves them back marked `manual`, exactly like the
 * channel typed here. Only the second kind is the user's own choice, checked
 * on both chains as they typed it (`ChannelOverrides`); the first is
 * somebody's word that nothing proved. A wrong channel does not fail, it
 * delivers: the source escrows the tokens and a chain someone else picked
 * mints them. So a route that leans on one is not signed from here until the
 * user sets that channel themselves. Closed links never reach a candidate
 * (the planner skips them), so the state is not read.
 */
export function strangerChannels<T extends PlannedLink>(links: readonly T[], overrides: Readonly<Record<string, HopOverrideInput>>): T[] {
  const own = Object.values(overrides);
  return links.filter(
    (link) =>
      link.source === "manual" &&
      !own.some((entry) => entry.fromChainId === link.sourceChainId && entry.toChainId === link.destChainId && entry.channelId === link.channelId),
  );
}

/**
 * The hand-set channels worth a plan request: channel ids, not the half of
 * one still being typed ("chan", "channel-"). Planning each keystroke would
 * refuse the partial id and re-plan the route under the caret.
 */
export function plannableOverrides(overrides: Readonly<Record<string, HopOverrideInput>>): HopOverrideInput[] {
  return Object.values(overrides).filter((entry) => /^channel-\d+$/.test(entry.channelId));
}

/** Why a route over a channel someone else typed is not signed (the form line, the refusal toast). */
export const STRANGER_CHANNEL_PROBLEM =
  "This route uses a channel entered by hand elsewhere, which Zunia has not verified. Set the channel yourself below to use it.";

/** One directed chain pair whose channel the user may set by hand. */
export interface ChannelLegInput {
  key: string;
  fromChainId: string;
  toChainId: string;
  /** Why this leg needs attention (a discovery failure, a channel nobody here set). */
  note?: string;
  /** The heading for `note` when the field is folded away (default: discovery failed). */
  noteTitle?: string;
}

/**
 * The legs worth offering a manual channel for: every pair whose discovery
 * failed and every leg planned over a channel someone else entered, else the
 * direct pair (so a channel can be typed before the planner has anything to
 * show).
 */
export function channelLegs(
  from: string,
  to: string,
  failures: readonly { fromChainId: string; toChainId: string; message: string }[],
  strangers: readonly PlannedLink[] = [],
): ChannelLegInput[] {
  const legs = new Map<string, ChannelLegInput>();
  for (const failure of failures) {
    const key = `${failure.fromChainId}>${failure.toChainId}`;
    legs.set(key, { key, fromChainId: failure.fromChainId, toChainId: failure.toChainId, note: failure.message });
  }
  for (const link of strangers) {
    const key = `${link.sourceChainId}>${link.destChainId}`;
    if (legs.has(key)) continue;
    legs.set(key, {
      key,
      fromChainId: link.sourceChainId,
      toChainId: link.destChainId,
      note: `The route found ${link.channelId}, entered by hand elsewhere and not verified. Type the channel yourself: it is checked on both chains.`,
      noteTitle: "Set this channel yourself",
    });
  }
  if (legs.size === 0) legs.set(`${from}>${to}`, { key: `${from}>${to}`, fromChainId: from, toChainId: to });
  return [...legs.values()];
}

/* -------------------------------------------------------------------------- *
 * Activity: transfers only
 * -------------------------------------------------------------------------- */

const TRANSFER_KINDS = new Set(["send", "receive", "ibc-out", "ibc-in"]);

export function isTransfer(item: Pick<ActivityItem, "kind">): boolean {
  return TRANSFER_KINDS.has(item.kind);
}

export function isIbc(item: Pick<ActivityItem, "kind">): boolean {
  return item.kind === "ibc-in" || item.kind === "ibc-out";
}

export function isOutgoing(item: Pick<ActivityItem, "kind">): boolean {
  return item.kind === "send" || item.kind === "ibc-out";
}

/**
 * A refund: one of your own IBC transfers that timed out or was refused,
 * credited back on the chain it left. It reads as a `receive`, but nobody
 * sent anything, so it is neither a deposit nor a sender.
 */
export function isRefund(item: Pick<ActivityItem, "kind" | "primaryType">): boolean {
  return item.kind === "receive" && /^Msg(Acknowledgement|Timeout|TimeoutOnClose)$/.test(item.primaryType);
}

/** The row happened on `chainId`, or `chainId` is the other end of its IBC transfer (single-chain scope). */
export function touchesChain(item: Pick<ActivityItem, "chainId" | "ibc">, chainId: string): boolean {
  return item.chainId === chainId || item.ibc?.destChainId === chainId || item.ibc?.sourceChainId === chainId;
}

function timeOf(item: Pick<ActivityItem, "time">): number {
  const ms = Date.parse(item.time);
  return Number.isFinite(ms) ? ms : 0;
}

export interface TransferStats {
  /** Outgoing transfers (send + IBC out) that succeeded. */
  sent: number;
  received: number;
  ibcOut: number;
  ibcIn: number;
  failed: number;
  lastSent: ActivityItem | null;
  lastReceived: ActivityItem | null;
  /** Oldest row loaded (epoch ms): the figures cover only from here on. */
  since: number | null;
}

/** Counts over the loaded rows (their coverage must be shown beside them). */
export function transferStats(items: readonly ActivityItem[]): TransferStats {
  const stats: TransferStats = {
    sent: 0,
    received: 0,
    ibcOut: 0,
    ibcIn: 0,
    failed: 0,
    lastSent: null,
    lastReceived: null,
    since: null,
  };
  for (const item of items) {
    const at = timeOf(item);
    if (at > 0) stats.since = stats.since === null ? at : Math.min(stats.since, at);
    if (!isTransfer(item)) continue;
    if (!item.success) {
      stats.failed += 1;
      continue;
    }
    if (isOutgoing(item)) {
      stats.sent += 1;
      if (item.kind === "ibc-out") stats.ibcOut += 1;
      if (!stats.lastSent || timeOf(stats.lastSent) < at) stats.lastSent = item;
    } else {
      stats.received += 1;
      if (item.kind === "ibc-in") stats.ibcIn += 1;
      if (!stats.lastReceived || timeOf(stats.lastReceived) < at) stats.lastReceived = item;
    }
  }
  return stats;
}

/**
 * How far back the loaded history is complete, for "since Sep 22" captions:
 * the activity hook's boundary while older pages remain (`loadedUntil`),
 * else, everything the nodes keep being loaded, the oldest row. Never the
 * oldest row while pages remain: one busy chain can fill a page with a few
 * days while a quiet one reaches back weeks, and the older date would then
 * claim weeks of the busy chain that were never read.
 */
export function historySince(loadedUntil: string | null | undefined, oldestRow: number | null): number | null {
  if (loadedUntil) {
    const at = Date.parse(loadedUntil);
    if (Number.isFinite(at)) return at;
  }
  return oldestRow;
}

/**
 * The rows a "since" caption covers: at or after the loaded boundary (every
 * row when everything is loaded). Counting the extra older rows one chain
 * happened to return would make a figure claim more than its caption says.
 */
export function withinLoaded<T extends Pick<ActivityItem, "time">>(items: readonly T[], loadedUntil: string | null | undefined): T[] {
  const boundary = loadedUntil ? Date.parse(loadedUntil) : Number.NaN;
  if (!Number.isFinite(boundary)) return [...items];
  return items.filter((item) => timeOf(item) >= boundary);
}

export interface IbcCounts {
  /** Distinct transfers: one between two of your accounts counts once. */
  total: number;
  /** Out to an address that is not one of yours (as far as the loaded rows show). */
  out: number;
  /** In from an address that is not one of yours. */
  in: number;
  /** Between two of your own accounts (both ends loaded). */
  own: number;
}

/**
 * IBC transfers without the double count: a move between two of your own
 * accounts is in the history twice (sent on one chain, received on the
 * other), and `pairOwnIbc` knows how many such pairs it folded.
 */
export function ibcCounts(stats: Pick<TransferStats, "ibcOut" | "ibcIn">, ownTransfers: number): IbcCounts {
  const own = Math.max(0, Math.min(ownTransfers, stats.ibcOut, stats.ibcIn));
  return { total: stats.ibcOut + stats.ibcIn - own, out: stats.ibcOut - own, in: stats.ibcIn - own, own };
}

export interface IncomingSplit {
  /** Successful deposits from someone else: what "received" means. */
  fromOthers: ActivityItem[];
  /** Successful transfers in from one of your own addresses (a move, not a deposit). */
  fromOwn: ActivityItem[];
  /** Your own transfers that came back. */
  refunds: ActivityItem[];
}

/**
 * Incoming transfers, split by who sent them. A receipt whose sender is one
 * of your addresses (on any chain the wallet shares) is you moving funds,
 * and a refund is your own transfer bouncing: counting either as "received"
 * would make a busy week of rebalancing look like income.
 */
export function splitIncoming(items: readonly ActivityItem[], ownAddresses: ReadonlySet<string>): IncomingSplit {
  const split: IncomingSplit = { fromOthers: [], fromOwn: [], refunds: [] };
  for (const item of items) {
    if (!isTransfer(item) || isOutgoing(item) || !item.success) continue;
    if (isRefund(item)) split.refunds.push(item);
    else if (item.counterparty && ownAddresses.has(item.counterparty)) split.fromOwn.push(item);
    else split.fromOthers.push(item);
  }
  return split;
}

/** The newest row (by block time), or null. */
export function newest(items: readonly ActivityItem[]): ActivityItem | null {
  let best: ActivityItem | null = null;
  for (const item of items) if (!best || timeOf(best) < timeOf(item)) best = item;
  return best;
}

export interface Sender {
  address: string;
  /** The chain the sender's address belongs to (the source chain of an IBC deposit). */
  chainId: string;
  count: number;
  lastAt: number;
}

/** Who sends to you most, from deposits by others (`splitIncoming().fromOthers`). */
export function topSenders(deposits: readonly ActivityItem[], limit = 5): Sender[] {
  const rows = new Map<string, Sender>();
  for (const item of deposits) {
    if (!item.counterparty) continue;
    const chainId = item.kind === "ibc-in" ? (item.ibc?.sourceChainId ?? item.chainId) : item.chainId;
    const row = rows.get(item.counterparty) ?? { address: item.counterparty, chainId, count: 0, lastAt: 0 };
    row.count += 1;
    row.lastAt = Math.max(row.lastAt, timeOf(item));
    rows.set(item.counterparty, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, Math.max(0, limit));
}

export interface FrequentRecipient {
  address: string;
  chainId: string;
  /** Destination chain for an IBC send; the row's chain otherwise. */
  toChainId: string;
  count: number;
  lastAt: number;
}

/** Who the user sends to most (successful sends and IBC transfers they signed). */
export function frequentRecipients(items: readonly ActivityItem[], limit = 5): FrequentRecipient[] {
  const rows = new Map<string, FrequentRecipient>();
  for (const item of items) {
    if (!isOutgoing(item) || !item.success || !item.signed || !item.counterparty) continue;
    const toChainId = item.kind === "ibc-out" ? (item.ibc?.destChainId ?? item.chainId) : item.chainId;
    const key = `${toChainId}|${item.counterparty}`;
    const row = rows.get(key) ?? { address: item.counterparty, chainId: item.chainId, toChainId, count: 0, lastAt: 0 };
    row.count += 1;
    row.lastAt = Math.max(row.lastAt, timeOf(item));
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, Math.max(0, limit));
}

/** Successful sends to `address` (exact) in the loaded rows: "Sent 3 times, last 2 days ago". */
export function historyWith(items: readonly ActivityItem[], address: string): { count: number; lastAt: number | null } {
  let count = 0;
  let lastAt: number | null = null;
  for (const item of items) {
    if (!isOutgoing(item) || !item.success || item.counterparty !== address) continue;
    count += 1;
    const at = timeOf(item);
    lastAt = lastAt === null ? at : Math.max(lastAt, at);
  }
  return { count, lastAt };
}

/** `${chainId}:${hash}`: one activity row (a transaction can be a row for two of your accounts). */
export function activityRowKey(item: Pick<ActivityItem, "chainId" | "hash">): string {
  return `${item.chainId}:${item.hash}`;
}

export interface PairedIbc {
  /** The rows to list: an IBC receipt matched to a send listed here is dropped (it is the same transfer). */
  rows: ActivityItem[];
  /** Rows (by `activityRowKey`) of IBC sends whose receipt on the other chain is loaded too: they arrived. */
  delivered: Set<string>;
  /** How many transfers went between two of the user's own accounts. */
  ownTransfers: number;
  /**
   * Observed delivery times of those transfers: the receipt's block time
   * minus the send's, per route. Measured, not estimated, but only on the
   * user's own transfers in the loaded history.
   */
  timings: { fromChainId: string; toChainId: string; seconds: number }[];
}

/**
 * A transfer between two of your own accounts shows up twice in the
 * history: sent on one chain, received on the other. Paired by the packet
 * (source chain, source channel, sequence), the receipt is folded into the
 * send, which can then say it arrived (the destination recorded it).
 */
export function pairOwnIbc(items: readonly ActivityItem[]): PairedIbc {
  const packet = (sourceChainId: string | undefined, channel: string | undefined, sequence: string | undefined) =>
    sourceChainId && channel && sequence ? `${sourceChainId}|${channel}|${sequence}` : null;
  const receipts = new Map<string, ActivityItem>();
  for (const item of items) {
    if (item.kind !== "ibc-in" || !item.success) continue;
    const key = packet(item.ibc?.sourceChainId, item.ibc?.sourceChannel, item.ibc?.sequence);
    if (key) receipts.set(key, item);
  }
  const delivered = new Set<string>();
  const folded = new Set<ActivityItem>();
  const timings: PairedIbc["timings"] = [];
  for (const item of items) {
    if (item.kind !== "ibc-out" || !item.success) continue;
    const key = packet(item.chainId, item.ibc?.sourceChannel, item.ibc?.sequence);
    const receipt = key ? receipts.get(key) : undefined;
    if (!receipt) continue;
    delivered.add(activityRowKey(item));
    folded.add(receipt);
    const seconds = (timeOf(receipt) - timeOf(item)) / 1000;
    // Block times are second-precision and two clocks: a negative or absurd
    // gap is a clock disagreement, not a delivery time.
    if (Number.isFinite(seconds) && seconds >= 0 && seconds < 86_400) {
      timings.push({ fromChainId: item.chainId, toChainId: receipt.chainId, seconds });
    }
  }
  return { rows: items.filter((item) => !folded.has(item)), delivered, ownTransfers: folded.size, timings };
}

export interface RouteTiming {
  /** Median delivery time in seconds. */
  median: number;
  fastest: number;
  slowest: number;
  count: number;
}

/** How long the user's own transfers took on one route; null without any. */
export function routeTiming(
  timings: readonly { fromChainId: string; toChainId: string; seconds: number }[],
  fromChainId: string,
  toChainId: string,
): RouteTiming | null {
  const values = timings
    .filter((row) => row.fromChainId === fromChainId && row.toChainId === toChainId)
    .map((row) => row.seconds)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? (values[middle] ?? 0) : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
  return { median, fastest: values[0] ?? 0, slowest: values[values.length - 1] ?? 0, count: values.length };
}

export interface RouteTimingRow extends RouteTiming {
  fromChainId: string;
  toChainId: string;
}

/** Every route with a measured delivery, most measured first (then fastest). */
export function timingsByRoute(timings: readonly { fromChainId: string; toChainId: string; seconds: number }[]): RouteTimingRow[] {
  const pairs = new Map<string, { fromChainId: string; toChainId: string }>();
  for (const row of timings) pairs.set(`${row.fromChainId}>${row.toChainId}`, { fromChainId: row.fromChainId, toChainId: row.toChainId });
  const rows: RouteTimingRow[] = [];
  for (const pair of pairs.values()) {
    const timing = routeTiming(timings, pair.fromChainId, pair.toChainId);
    if (timing) rows.push({ ...pair, ...timing });
  }
  return rows.sort((a, b) => b.count - a.count || a.median - b.median);
}

export interface HistoryChannel {
  /** The channel on `fromChainId` that leads to `toChainId`. */
  channelId: string;
  /** Transfers in the loaded history that used it (either direction). */
  uses: number;
  lastAt: number;
}

/**
 * The channel the user's own transfers between two chains used, read from
 * their history: a packet that went from B to A arrived on A's end of the
 * channel (`destChannel`), and a channel carries both directions, so that is
 * the channel A sends to B on. Offered when discovery cannot find one; the
 * route then still validates it on both chains and marks it as set by hand.
 */
export function channelFromHistory(items: readonly ActivityItem[], fromChainId: string, toChainId: string): HistoryChannel | null {
  const counts = new Map<string, HistoryChannel>();
  const count = (channelId: string | undefined, at: number) => {
    if (!channelId || !/^channel-\d+$/.test(channelId)) return;
    const row = counts.get(channelId) ?? { channelId, uses: 0, lastAt: 0 };
    row.uses += 1;
    row.lastAt = Math.max(row.lastAt, at);
    counts.set(channelId, row);
  };
  for (const item of items) {
    if (!item.success || !item.ibc) continue;
    // B → A, seen on B: the packet's destination channel is A's end.
    if (item.kind === "ibc-out" && item.chainId === toChainId && item.ibc.destChainId === fromChainId) count(item.ibc.destChannel, timeOf(item));
    // B → A, seen on A: received on A's end.
    if (item.kind === "ibc-in" && item.chainId === fromChainId && item.ibc.sourceChainId === toChainId) count(item.ibc.destChannel, timeOf(item));
    // A → B, seen on A: sent from A's end.
    if (item.kind === "ibc-out" && item.chainId === fromChainId && item.ibc.destChainId === toChainId) count(item.ibc.sourceChannel, timeOf(item));
  }
  return [...counts.values()].sort((a, b) => b.uses - a.uses || b.lastAt - a.lastAt)[0] ?? null;
}

/* -------------------------------------------------------------------------- *
 * Route suggestions (Bridge)
 * -------------------------------------------------------------------------- */

export type RouteReason = "used" | "home" | "venue";

export interface RouteSuggestion {
  id: string;
  fromChainId: string;
  toChainId: string;
  asset: SpendableAsset;
  reason: RouteReason;
  /** Times this route was used in the loaded history. */
  uses: number;
  lastUsedAt: number | null;
}

/** Balances below this value are dust: not worth a suggested route. */
const DUST_VALUE = 0.01;

/**
 * Routes worth one click, from what the user holds and has done:
 *
 * 1. `used`: routes their own IBC transfers took (same token, same pair),
 *    most used first, while they still hold the token;
 * 2. `home`: vouchers held away from their origin chain, sent home (they
 *    arrive as the native token, and the route is the token's canonical one);
 * 3. `venue`: a native token to the swap venue, where it can be traded.
 *
 * Only followed chains are destinations, and dust is skipped.
 */
export function suggestRoutes(input: {
  assets: readonly SpendableAsset[];
  activity: readonly ActivityItem[];
  followed: readonly string[];
  venueChainId?: string;
  limit?: number;
}): RouteSuggestion[] {
  const venue = input.venueChainId ?? "osmosis-1";
  const followed = new Set(input.followed);
  const byBalance = new Map(input.assets.map((asset) => [asset.key, asset]));
  const out = new Map<string, RouteSuggestion>();
  const idOf = (from: string, denom: string, to: string) => `${from}|${denom}>${to}`;

  const used = new Map<string, { from: string; to: string; denom: string; uses: number; lastAt: number }>();
  for (const item of input.activity) {
    if (item.kind !== "ibc-out" || !item.success || !item.signed) continue;
    const to = item.ibc?.destChainId;
    const moved = item.amounts.find((amount) => amount.direction === "out");
    if (!to || !moved) continue;
    const id = idOf(item.chainId, moved.denom, to);
    const row = used.get(id) ?? { from: item.chainId, to, denom: moved.denom, uses: 0, lastAt: 0 };
    row.uses += 1;
    row.lastAt = Math.max(row.lastAt, timeOf(item));
    used.set(id, row);
  }
  for (const [id, row] of [...used.entries()].sort((a, b) => b[1].uses - a[1].uses || b[1].lastAt - a[1].lastAt)) {
    const asset = byBalance.get(balanceKey(row.from, row.denom));
    if (!asset) continue;
    out.set(id, { id, fromChainId: row.from, toChainId: row.to, asset, reason: "used", uses: row.uses, lastUsedAt: row.lastAt });
  }

  const worthIt = (asset: SpendableAsset) => asset.value !== null && asset.value >= DUST_VALUE;

  for (const asset of input.assets) {
    if (!worthIt(asset) || asset.identity.provenance === "unknown") continue;
    const origin = asset.identity.originChainId;
    if (!origin || origin === asset.chainId || !followed.has(origin)) continue;
    const id = idOf(asset.chainId, asset.denom, origin);
    if (!out.has(id)) out.set(id, { id, fromChainId: asset.chainId, toChainId: origin, asset, reason: "home", uses: 0, lastUsedAt: null });
  }

  if (followed.has(venue)) {
    for (const asset of input.assets) {
      if (!worthIt(asset) || asset.chainId === venue) continue;
      if (moveKind(asset.identity, venue) !== "native" || asset.identity.provenance === "unknown") continue;
      const id = idOf(asset.chainId, asset.denom, venue);
      if (!out.has(id)) out.set(id, { id, fromChainId: asset.chainId, toChainId: venue, asset, reason: "venue", uses: 0, lastUsedAt: null });
    }
  }

  return [...out.values()].slice(0, Math.max(0, input.limit ?? 5));
}

/**
 * Where a Bridge transfer from `from` goes when nothing chose it (no usual
 * route, no voucher to send home, and `from` is the swap venue itself):
 *
 * 1. the token's own chain, when it is a voucher whose home is followed:
 *    the route the token itself proves exists;
 * 2. the followed chain where the user holds the most: one they use;
 * 3. the first other followed chain.
 *
 * Not simply the first followed chain: that is how Osmosis came to open on
 * dust sent to Safrochain over a channel nobody verified.
 */
export function fallbackDestination(
  from: string | null,
  asset: Pick<SpendableAsset, "chainId" | "identity"> | null,
  followed: readonly string[],
  liquidValue: (chainId: string) => number | null,
): string | null {
  const others = followed.filter((chainId) => chainId !== from);
  const origin = asset && asset.identity.provenance !== "unknown" ? (asset.identity.originChainId ?? null) : null;
  if (origin && origin !== asset?.chainId && others.includes(origin)) return origin;
  let richest: { chainId: string; value: number } | null = null;
  for (const chainId of others) {
    const value = liquidValue(chainId);
    if (value !== null && value > 0 && (!richest || value > richest.value)) richest = { chainId, value };
  }
  return richest?.chainId ?? others[0] ?? null;
}

/** The value of IBC vouchers held outside their origin chain ("away from home"). */
export function awayFromHome(assets: readonly SpendableAsset[]): { count: number; value: number | null; unpriced: number } {
  let count = 0;
  let value: number | null = null;
  let unpriced = 0;
  for (const asset of assets) {
    const origin = asset.identity.originChainId;
    if (asset.identity.kind !== "ibc" || !origin || origin === asset.chainId) continue;
    count += 1;
    if (asset.value === null) unpriced += 1;
    else value = (value ?? 0) + asset.value;
  }
  return { count, value, unpriced };
}
