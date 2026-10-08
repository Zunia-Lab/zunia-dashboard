/**
 * The shapes every signing flow agrees on.
 *
 * A message is carried in both encodings it may be signed with: protobuf
 * (`typeUrl` + `value`, always present, what ends up in the TxRaw) and amino
 * JSON (`amino`, present when the type has a registered amino name). The
 * signer picks the mode: direct for messages a wallet's amino summarizer does
 * not know (the Zunia extension refuses `osmosis/poolmanager/*` over amino),
 * amino when the wallet or transport only offers that.
 */

import type { AminoMsg, Coin } from "@/lib/tx/amino-tx";
import type { TokenIdentity } from "@/lib/token/types";

export type { AminoMsg, Coin };

export interface TxMessage {
  /** Protobuf type URL, e.g. "/cosmos.bank.v1beta1.MsgSend". */
  typeUrl: string;
  /** Protobuf-encoded message (the Any value). */
  value: Uint8Array;
  /** Amino JSON form, when the type has a registered amino name. */
  amino?: AminoMsg;
  /** One plain sentence for review cards ("Send 12.5 OSMO to osmo1…"). */
  summary?: string;
}

export type FeeTier = "low" | "average" | "high";

export type SignMode = "auto" | "direct" | "amino";

/** The mode a signature was actually made in. */
export type ResolvedSignMode = "direct" | "amino";

/**
 * A coin as the page names it: the fields of its `TokenIdentity` (from the
 * API, where the identity tables live) that the default memo reads. Pass the
 * identity itself.
 */
export type MemoToken = Pick<TokenIdentity, "chainId" | "denom" | "ticker" | "proven"> & Partial<Pick<TokenIdentity, "listed">>;

/**
 * What the page already shows about a transaction, for its default memo
 * (`./memo`). Read only when the user leaves the memo empty, and only to
 * name: what the transaction is comes from its first message, never from here.
 */
export interface TxMemoContext {
  /**
   * The coins the messages move, as the page names them. A coin is named
   * only by an entry for its exact chain and denom whose identity is proven.
   */
  readonly tokens?: readonly MemoToken[];
  /**
   * Where an IBC transfer's funds end up: the chain the user picked. Named
   * only when the transfer's last receiver is an address of that chain.
   */
  readonly destinationChainId?: string;
}

export interface SignRequest {
  chainId: string;
  messages: TxMessage[];
  /**
   * The user's memo. Signed trimmed; when empty, the flow writes Zunia's
   * default for the messages instead (`./memo` `resolveTxMemo`).
   */
  memo?: string;
  /** Names for the default memo; ignored when `memo` has text. */
  memoContext?: TxMemoContext;
  /** Fixed gas limit. When omitted the transaction is simulated first. */
  gasLimit?: number;
  feeTier?: FeeTier;
  signMode?: SignMode;
  /** Multiplier on simulated gas. Default 1.4. */
  gasAdjustment?: number;
  /** Block height after which the tx is invalid. Rarely needed; default none. */
  timeoutHeight?: string;
}

export interface SignResult {
  chainId: string;
  txHash: string;
  /** False when the watch window ended before the tx was seen in a block. */
  confirmed?: boolean;
  height?: number;
  gasUsed?: number;
  gasWanted?: number;
  /** The fee as signed (a wallet may have changed it). */
  fee?: Coin[];
  gasLimit?: string;
  signMode?: ResolvedSignMode;
}

/** Where a sign-and-broadcast attempt is, for progress UI. */
export type SignStage =
  | "idle"
  | "preparing"
  | "awaiting-signature"
  | "broadcasting"
  | "confirming"
  | "success"
  /**
   * The node accepted the transaction but it was not seen in a block before
   * the watch window ended. Not a failure: it may still land (check Activity).
   */
  | "submitted"
  | "failed";

export interface TxOutcome {
  status: "pending" | "success" | "failed" | "unknown";
  height?: number;
  gasUsed?: number;
  gasWanted?: number;
  /** Chain's raw log on failure, explained in plain words by the caller. */
  rawLog?: string;
  code?: number;
  codespace?: string;
  txHash?: string;
  /** Block time (RFC 3339) once included. */
  timestamp?: string;
  /** Epoch ms of the read. */
  updatedAt?: number;
}
