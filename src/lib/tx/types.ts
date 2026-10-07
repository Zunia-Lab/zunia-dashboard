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

export interface SignRequest {
  chainId: string;
  messages: TxMessage[];
  memo?: string;
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
