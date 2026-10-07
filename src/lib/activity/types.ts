/**
 * The activity contract: what `/api/activity` and `/api/activity/[hash]`
 * answer, and what the Activity page, the Overview "Recent activity" card,
 * the Live popover and the CSV export read.
 *
 * Types only, safe for client code. Everything here is decoded server-side
 * from public LCD reads (`/cosmos/tx/v1beta1/txs`), never from the Zunia
 * indexer: the indexer stores no amounts, covers six chains and is not
 * reachable from production (dash-api report §6).
 *
 * Honesty rules the shapes encode:
 * - amounts are base-unit integer strings with the identity that names them,
 *   so an unknown voucher stays "760 base units of IBC·1E18" instead of a
 *   guessed exponent;
 * - `coverage` says how far back each chain's list is complete, because a
 *   public node only keeps a window of history (Hub ≈ weeks, Osmosis ≈ months,
 *   Safrochain from genesis) and an empty list is not proof of "never".
 */

import type { TokenIdentity } from "@/lib/token/types";

/**
 * What a transaction was, for the address it is listed under.
 *
 * The same transaction can be a `send` for one account and a `receive` for
 * another: kinds are always relative to the account the row belongs to.
 */
export const ACTIVITY_KINDS = [
  "send",
  "receive",
  "ibc-out",
  "ibc-in",
  "swap",
  "delegate",
  "undelegate",
  "redelegate",
  "claim",
  "vote",
  "contract",
  "authz",
  "other",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(value: string): value is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(value);
}

export type FlowDirection = "in" | "out";

/**
 * One coin that entered or left the account in this transaction, read from
 * the chain's own `coin_received` / `coin_spent` events (what actually moved,
 * not what a message asked for). The network fee is not in here: it is
 * `ActivityItem.fee`. A denom that passed straight through (a multi-hop
 * swap's intermediate token, received and spent in equal amounts) is left out.
 */
export interface ActivityAmount {
  direction: FlowDirection;
  /** Exact bank denom on `ActivityItem.chainId`. */
  denom: string;
  /** Base units, a non-negative integer string. */
  amount: string;
  identity: TokenIdentity;
}

/** The fee the transaction paid, first coin of `auth_info.fee.amount`. */
export interface ActivityFee {
  /** Base units. */
  amount: string;
  denom: string;
  /** The identity's ticker ("OSMO", "IBC·498A"). */
  symbol?: string;
  /** Absent when unknown: show the amount in base units. */
  decimals?: number;
  /** The fee token's asset key (`TokenIdentity.key`), for pricing. */
  key?: string;
}

/** IBC packet facts for a transfer row, enough to follow the packet. */
export interface ActivityIbc {
  sequence?: string;
  /** Channel on the sending chain. */
  sourceChannel?: string;
  /** Channel on the receiving chain. */
  destChannel?: string;
  /** `ibc-out`: where the packet went (canonical channel table or the channel's client state). */
  destChainId?: string;
  /** `ibc-in`: where the packet came from. */
  sourceChainId?: string;
}

export interface ActivityItem {
  chainId: string;
  /** The account this row is about (one transaction can be a row for two of your accounts). */
  address: string;
  /** Upper-case hex, as the chain spells it. */
  hash: string;
  height: number;
  /** Block time, ISO 8601 (second precision, as the node reports it). */
  time: string;
  kind: ActivityKind;
  /** `code == 0`. A failed transaction still paid its fee. */
  success: boolean;
  /**
   * One sentence for the row, coins named by identity: "Sent 12.5 OSMO to
   * osmo1…", "Swapped 10 OSMO → 4.32 USDC.n", "Claimed 3.2 SAF in rewards from
   * 3 validators", "Failed to send 12.5 OSMO to osmo1…".
   */
  summary: string;
  fee: ActivityFee | null;
  /**
   * This account paid `fee` (it is the fee payer: first signer, no fee grant).
   * Fee analytics count only these; a received transfer's fee was the
   * sender's.
   */
  feePaid: boolean;
  /** This account signed the transaction (its first signer). */
  signed: boolean;
  amounts: ActivityAmount[];
  /** The other side: recipient, sender, validator, contract or grantee. */
  counterparty?: string;
  /** Trimmed to 256 characters. Untrusted text: render as text only. */
  memo?: string;
  ibc?: ActivityIbc;
  /** Number of messages in the transaction. */
  messages: number;
  /** Short protobuf name of the message the row is about ("MsgSend"). */
  primaryType: string;
  /** `vote` rows: the proposal voted on. */
  proposalId?: string;
  /**
   * Someone else ran this for the account with an authz grant (the grantee
   * that signed the MsgExec, usually an auto-compounding bot). `kind` is then
   * what was done (`claim`, `delegate`…), `signed` and `feePaid` are false.
   */
  via?: string;
  /** The chain's block explorer page for the hash, when the registry names one (never guessed). */
  explorerUrl?: string;
}

/**
 * How far back one account's list is complete on its chain.
 *
 * - `complete: true` — this is the account's whole history on the chain: the
 *   node keeps the chain from genesis, or every transaction the account ever
 *   signed is within the node's window and its oldest one is the transfer
 *   that funded it, or the chain has never seen the account (`oldest` null).
 * - `complete: false` without `note` — complete from `oldest` to now, and
 *   older rows exist: load the next page.
 * - `complete: false` with `note` — why the list stops or may have holes:
 *   the node's retention ("This node keeps history since 2026-08-17."), a
 *   search that failed (incoming or signed transactions), a gap stepped over
 *   while paging, or a chain that could not be read at all (`oldest` null).
 */
export interface ActivityCoverage {
  chainId: string;
  address: string;
  /** ISO time, or null when nothing could be read. */
  oldest: string | null;
  complete: boolean;
  /** Why it is not complete, in words ("This node keeps history since 2026-07-13"). */
  note?: string;
}

export interface ActivityError {
  chainId?: string;
  /** `history` (the chain could not be read), `incoming` / `outgoing` (one of the two searches failed). */
  scope: string;
  /** Short and user-safe ("lcd-osmosis.keplr.app timed out"); never an upstream body. */
  message: string;
}

/** `GET /api/activity` */
export interface ActivityPage {
  updatedAt: number;
  /** Newest first. */
  items: ActivityItem[];
  coverage: ActivityCoverage[];
  /**
   * The time this page's list is complete down to, when more exists (null
   * when nothing is left). Never later than a requested `before`. Paging is
   * done with `nextCursor` (per-chain height bounds, exact); `nextBefore` is
   * for labels ("loaded back to …") and for a fresh time-based request.
   */
  nextBefore: string | null;
  /** Opaque; pass back as `cursor` with the same `accounts` in the same order. */
  nextCursor: string | null;
  errors?: ActivityError[];
}

/* -------------------------------------------------------------------------- */
/* One transaction                                                             */
/* -------------------------------------------------------------------------- */

export interface TxMessageDetail {
  index: number;
  typeUrl: string;
  /** "MsgSend" */
  type: string;
  /** Neutral sentence: "Sent 12.5 OSMO from osmo1… to osmo1…". */
  summary: string;
  /** The message as the node returned it, bounded (long strings and lists cut, marked). */
  json: unknown;
}

export interface TxEventCount {
  type: string;
  count: number;
}

/** One bank transfer inside the transaction (`transfer` events). */
export interface TxMovement {
  /** Index of the message that caused it; null for the fee and other ante-handler movements. */
  msgIndex: number | null;
  from: string;
  to: string;
  denom: string;
  /** Base units. */
  amount: string;
  identity: TokenIdentity;
}

export type TxPacketStage = "send" | "receive" | "acknowledge" | "timeout";

/** An IBC packet event of the transaction, ICS20 fields decoded when present. */
export interface TxPacket {
  stage: TxPacketStage;
  sequence: string;
  sourcePort: string;
  sourceChannel: string;
  destPort: string;
  destChannel: string;
  /** The chain on the other end of this transaction's channel, when known. */
  counterpartyChainId?: string;
  denom?: string;
  amount?: string;
  sender?: string;
  receiver?: string;
  memo?: string;
  /** Receive / acknowledge: whether the ICS20 acknowledgement was a success. */
  ack?: "success" | "error";
  timeoutTimestamp?: string;
}

/** `GET /api/activity/[hash]?chainId=` */
export interface TxDetail {
  updatedAt: number;
  chainId: string;
  hash: string;
  height: number;
  time: string;
  success: boolean;
  /** Present when the chain rejected the transaction. */
  code?: number;
  codespace?: string;
  /** The chain's error text for a failed transaction, trimmed to 400 characters. */
  rawLog?: string;
  fee: ActivityFee | null;
  /** Every fee coin, when there is more than one. */
  fees: ActivityFee[];
  gasUsed: number | null;
  gasWanted: number | null;
  memo: string;
  /** First signer, when the node reported it. */
  signer?: string;
  feePayer?: string;
  feeGranter?: string;
  /** The first 100 messages; `messagesOmitted` counts the rest of a larger batch. */
  messages: TxMessageDetail[];
  messagesOmitted?: number;
  /** Event types in first-seen order, with how often each was emitted. */
  events: TxEventCount[];
  /** Coin movements, at most 100. */
  movements: TxMovement[];
  packets: TxPacket[];
  explorerUrl?: string;
  /** With `?address=`: the row this transaction is for that account (null when it is not involved). */
  forAddress?: ActivityItem | null;
}
