/**
 * Why a transaction failed, in words a person can act on.
 *
 * A chain answers a rejected transaction with a result code and a raw log
 * ("failed to execute message; message index: 0: spendable balance 10uosmo is
 * smaller than 20uosmo: insufficient funds"). The code is only meaningful
 * within its codespace — 5 is "insufficient funds" in `sdk` and something else
 * in `wasm` — so the numeric table is consulted for the core codespace only and
 * the log text is always read as a second opinion: it is the one place a
 * wrapped error keeps its cause.
 *
 * Copy follows the extension's `explainTxError` (zunia-extension
 * entrypoints/popup/components/TxReview.tsx @ 1453e7a), extended with the SDK
 * code table from zunia-sdk packages/interchain/src/tx.ts (`classifyTxFailure`).
 */

import type { SignerKind } from "./sign-mode";

export type TxErrorKind =
  | "out-of-gas"
  | "insufficient-funds"
  | "insufficient-fee"
  | "sequence-mismatch"
  | "slippage"
  | "expired"
  | "network-timeout"
  | "unauthorized"
  | "already-in-mempool"
  | "user-rejected"
  | "no-account"
  /** The wallet (usually the phone) never answered the signature request. */
  | "wallet-timeout"
  /**
   * The wallet session is gone (phone unpaired or expired, extension revoked),
   * or the page lost its link to the extension (updated or reloaded).
   */
  | "wallet-disconnected"
  /** The wallet refused to show the request: it cannot display this transaction (Zunia without blind signing). */
  | "wallet-unsupported"
  | "unknown";

export interface ExplainedTxError {
  kind: TxErrorKind;
  /** Two or three words for a status line ("Out of gas"). */
  title: string;
  /** One or two plain sentences: what happened and what to do. */
  message: string;
  /** The chain's (or wallet's) own text, bounded, for a "details" fold. Null when empty. */
  detail: string | null;
  /** True when trying again as-is (re-measured, re-signed) can succeed. */
  retryable: boolean;
  /** From an "account sequence mismatch, expected N" log. */
  expectedSequence: string | null;
}

const MAX_DETAIL = 600;

/** `cosmos-sdk/types/errors` codes a wallet actually meets (codespace "sdk"). */
const SDK_CODES: Readonly<Record<number, TxErrorKind>> = {
  3: "sequence-mismatch",
  4: "unauthorized",
  5: "insufficient-funds",
  9: "no-account",
  11: "out-of-gas",
  13: "insufficient-fee",
  19: "already-in-mempool",
  30: "expired",
  32: "sequence-mismatch",
};

const PATTERNS: ReadonlyArray<readonly [RegExp, TxErrorKind]> = [
  [/request rejected|user rejected|rejected by (the )?user|user denied|declined/i, "user-rejected"],
  [/lesser than min amount|price impact protection|slippage|\bmin(imum)?[ _]?out\b|token_out_min_amount/i, "slippage"],
  [/insufficient fee/i, "insufficient-fee"],
  [/out of gas/i, "out-of-gas"],
  [/insufficient funds|is smaller than|spendable balance|insufficient balance/i, "insufficient-funds"],
  [/account sequence mismatch|incorrect account sequence/i, "sequence-mismatch"],
  [/tx already in mempool|tx already exists in cache|already in mempool/i, "already-in-mempool"],
  [/does not exist: unknown address|account .* not found/i, "no-account"],
  [/timeout height|tx timeout|has expired/i, "expired"],
  [/timed? ?out|deadline exceeded/i, "network-timeout"],
  [/signature verification failed|unauthorized|pubkey does not match|invalid pubkey/i, "unauthorized"],
];

const COPY: Record<TxErrorKind, { title: string; message: string; retryable: boolean }> = {
  "out-of-gas": {
    title: "Out of gas",
    message:
      "The transaction ran out of gas, so the chain undid it; the network fee was still charged. Try again — the gas is measured again.",
    retryable: true,
  },
  "insufficient-funds": {
    title: "Not enough balance",
    message: "There was not enough balance for the amount and the network fee. Nothing moved.",
    retryable: false,
  },
  "insufficient-fee": {
    title: "Fee too low",
    message: "The network fee was too low for this chain right now. Try again with a higher fee.",
    retryable: true,
  },
  "sequence-mismatch": {
    title: "Out of order",
    message: "Another transaction from this account went first. Try again.",
    retryable: true,
  },
  slippage: {
    title: "Price moved",
    message:
      "The price moved more than your slippage allows before the swap ran, so the chain refused it. Nothing was swapped.",
    retryable: true,
  },
  expired: {
    title: "Expired",
    message: "The transaction expired before a block included it. Nothing changed.",
    retryable: true,
  },
  "network-timeout": {
    title: "No answer",
    message: "The network did not answer in time. Check Activity before trying again: it may still go through.",
    retryable: false,
  },
  unauthorized: {
    title: "Signature refused",
    message:
      "The chain could not verify the signature, so nothing was sent. Reconnect your wallet and try again; if it repeats, the wallet signed something different from what was sent.",
    retryable: false,
  },
  "already-in-mempool": {
    title: "Already sent",
    message: "This transaction is already waiting for a block. Check Activity before sending it again.",
    retryable: false,
  },
  "no-account": {
    title: "Empty account",
    message:
      "This address has never received funds on this network, so it cannot pay a network fee yet. Send it some of the fee token first.",
    retryable: false,
  },
  "user-rejected": {
    title: "Declined",
    message: "You declined the request in your wallet. Nothing was signed.",
    retryable: true,
  },
  "wallet-timeout": {
    title: "No answer from the wallet",
    message:
      "Your wallet did not answer in time, so nothing was signed. With Zunia Mobile, open the app on your phone (no notification is sent yet), then try again.",
    retryable: true,
  },
  "wallet-disconnected": {
    title: "Wallet disconnected",
    message: "Your wallet is no longer connected to this page, so nothing was signed. Connect it again, then try again.",
    retryable: false,
  },
  "wallet-unsupported": {
    title: "Unsupported in Zunia",
    message: "Your Zunia extension can't show this transaction yet. Update Zunia to 0.1.4 or later, or use Keplr or Zunia Mobile.",
    retryable: false,
  },
  unknown: {
    title: "Refused",
    message: "The chain refused this transaction.",
    retryable: false,
  },
};

function bounded(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}…` : clean;
}

/**
 * The chain's words without the parts written for its developers: the
 * `failed to execute message; message index: N:` wrapper, Go source
 * references (`[cosmos/cosmos-sdk@v0.53.6/x/gov/keeper/vote.go:24]`, wasmd's
 * `[!cosm!wasm/…/errors.go:156]`) and the simulation's gas trailer
 * (`with gas used: '71619'` on SDK 0.50+, `With gas wanted: '…' and gas used:
 * '…'` before). What is left ("1: inactive proposal", "no such contract") is
 * what an unknown failure shows as its message.
 */
export function cleanChainLog(raw: string): string {
  return raw
    .replace(/\s*\[[^\]]*\.go:\d+\]/g, "")
    .replace(/\s*with gas (?:wanted|used):.*$/i, "")
    .replace(/^failed to execute message; message index: \d+: /i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a chain's raw log (and code, when known).
 *
 * Unknown errors keep the chain's own words as the message (cleaned and
 * bounded), because "refused" with nothing after it leaves the user nowhere to
 * go; `detail` then holds the raw text only when cleaning changed it.
 */
export function explainTxError(
  rawLog: string | null | undefined,
  options: { code?: number | null; codespace?: string | null } = {},
): ExplainedTxError {
  const text = rawLog ?? "";
  const core = !options.codespace || options.codespace === "sdk";
  let kind: TxErrorKind = "unknown";
  if (core && typeof options.code === "number") kind = SDK_CODES[options.code] ?? "unknown";
  if (kind === "unknown") {
    for (const [pattern, match] of PATTERNS) {
      if (pattern.test(text)) {
        kind = match;
        break;
      }
    }
  }
  const expected = /expected\s+(\d+)/i.exec(text);
  const copy = COPY[kind];
  const detail = bounded(text);
  if (kind === "unknown") {
    const words = bounded(cleanChainLog(text));
    return {
      kind,
      title: copy.title,
      message: words ?? detail ?? copy.message,
      detail: detail && words && detail !== words ? detail : null,
      retryable: copy.retryable,
      expectedSequence: null,
    };
  }
  return {
    kind,
    title: copy.title,
    message: copy.message,
    detail,
    retryable: copy.retryable,
    expectedSequence: kind === "sequence-mismatch" ? (expected?.[1] ?? null) : null,
  };
}

/**
 * Whether a failed `/cosmos/tx/v1beta1/simulate` answer is the chain refusing
 * the transaction (it ran it, and it would fail) rather than the node failing.
 *
 * The distinction decides what the user is asked next: a refusal stops the
 * flow before anyone signs a transaction that cannot succeed, a node failure
 * falls back to a fixed gas limit. The HTTP status alone does not tell them
 * apart: SDK 0.46+ answers a failed simulation with gRPC `Unknown` (HTTP 500,
 * `{"code":2,"message":"… with gas used: '71619'"}`, seen live on cosmoshub-4
 * v0.53 and safrochain-1 for an inactive proposal and a missing contract),
 * the same status a crashed node gives. The SDK's own wording is the tell:
 * only a transaction that ran carries the gas trailer or the "failed to
 * execute message" wrapper.
 *
 * @param message the gRPC-gateway body's `message` (already extracted).
 * @param grpcCode the body's numeric `code`, null when the body had none.
 */
export function isSimulationRefusal(status: number, message: string, grpcCode: number | null): boolean {
  if (status === 400) return true;
  if (!message) return false;
  if (/with gas (?:wanted|used)|failed to execute message|message index: \d+/i.test(message)) return true;
  // Older gateways, or an ante-handler refusal phrased without the trailer:
  // a gRPC-coded body naming a cause this app recognises.
  return grpcCode !== null && explainTxError(message).kind !== "unknown";
}

/** A kind with its standard copy, the original text kept as the detail. */
function withKind(kind: TxErrorKind, text: string): ExplainedTxError {
  const copy = COPY[kind];
  return { kind, title: copy.title, message: copy.message, detail: bounded(text), retryable: copy.retryable, expectedSequence: null };
}

/** A wallet-side kind with words of its own; the wallet's text is kept as the detail. */
function walletWords(kind: TxErrorKind, title: string, message: string, text: string): ExplainedTxError {
  return { ...withKind(kind, text), title, message };
}

/**
 * The Zunia extension's own refusals, with the next step in words.
 *
 * Read from the extension's wording (zunia-extension lib/provider-handler.ts,
 * lib/approvals.ts, entrypoints/background.ts and content.ts @ 1453e7a) as
 * well as its `code`, because a wrapper on the way may keep the text and drop
 * the code (`enableChains` reports a key it could not read by its reason).
 *
 * - `UNSUPPORTED` "Blind signing disabled for unknown messages": a message
 *   the extension cannot decode is refused before any prompt opens (0.1.3
 *   and Osmosis poolmanager swaps). Its own kind, `wallet-unsupported`:
 *   trying again cannot help, another wallet can.
 * - "Request expired before it was answered" carries `USER_REJECTED`, but
 *   nobody declined: the 5-minute prompt ran out. `wallet-timeout`, so no
 *   flow answers it with "Cancelled in your wallet".
 * - `LOCKED`: the wallet stayed locked (the unlock window was closed, or
 *   timed out), or locked while a prompt was open. `wallet-timeout` too.
 * - "Extension context invalidated.": the extension was updated or reloaded
 *   under an open page, whose content script is now orphaned; every call
 *   fails until the page is reloaded. A handshake that never completed ends
 *   the same way. `wallet-disconnected`. Chrome writes those words for any
 *   extension, Keplr included, so the wallet named is `wallet`'s.
 *
 * The last three are kinds every flow already draws on its "sign" step.
 * Null for anything else.
 */
export function walletRefusal(error: unknown, wallet?: SignerKind): ExplainedTxError | null {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "UNSUPPORTED" && /blind signing/i.test(text)) return withKind("wallet-unsupported", text);
  if (/request expired before it was answered/i.test(text)) {
    return walletWords("wallet-timeout", "No answer in time", "The Zunia prompt expired. Try again.", text);
  }
  if (code === "LOCKED" || /stayed locked|wallet (?:is )?locked|closed before unlocking/i.test(text)) {
    return walletWords("wallet-timeout", "Wallet locked", "Zunia stayed locked. Unlock it and try again.", text);
  }
  if (/context invalidated|provider handshake timed out|provider port not ready/i.test(text)) {
    const who = wallet === "keplr" ? "Keplr" : wallet === "zunia" || /zunia/i.test(text) ? "Zunia" : "Your wallet extension";
    return walletWords("wallet-disconnected", "Page out of date", `${who} was updated or reloaded. Reload this page.`, text);
  }
  return null;
}

/**
 * A thrown wallet or network error, through the same classifier.
 *
 * Wallet error codes first: the Zunia Connect SDK (phone) and the Zunia
 * extension both throw `{code}` errors (`USER_REJECTED`, `TIMEOUT`,
 * `NOT_CONNECTED`, `SESSION_EXPIRED`, `DISCONNECTED`, `UNKNOWN_CHAIN`), whose
 * messages are written for developers ("Pair a wallet first"); the Zunia
 * extension's own refusals before them (`walletRefusal`). `wallet`, when the
 * caller knows it, names the extension in the one refusal any extension can
 * raise.
 */
export function explainError(error: unknown, options: { wallet?: SignerKind } = {}): ExplainedTxError {
  if (error instanceof TxError) return error.explained;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = (error as { code?: unknown } | null)?.code;
  const refusal = walletRefusal(error, options.wallet);
  if (refusal) return refusal;
  if (code === "USER_REJECTED" || code === 4001) return explainTxError("Request rejected");
  if (code === "TIMEOUT") return withKind("wallet-timeout", message);
  if (code === "NOT_CONNECTED" || code === "SESSION_EXPIRED" || code === "DISCONNECTED") {
    return withKind("wallet-disconnected", message);
  }
  if (code === "UNKNOWN_CHAIN") {
    return {
      ...withKind("unknown", message),
      message: "Your wallet has not shared this network with the page. With Zunia Mobile, connect again and include it.",
    };
  }
  return explainTxError(message || "Something went wrong.");
}

/** An error that already carries its explanation (thrown by the sign flow). */
export class TxError extends Error {
  readonly explained: ExplainedTxError;
  /**
   * The transaction's hash once one exists (it is deterministic over the
   * signed bytes, so a transaction the node refused at CheckTx has one too:
   * the identifier support can ask for). Not proof the chain has it: see
   * `onChain`.
   */
  readonly txHash: string | null;
  /**
   * True when a block included the transaction (it failed in DeliverTx): the
   * fee was charged and balances moved, and an explorer can show it. False
   * for everything that stopped before a block, CheckTx refusals included.
   */
  readonly onChain: boolean;

  constructor(explained: ExplainedTxError, txHash: string | null = null, onChain = false) {
    super(explained.message);
    this.name = "TxError";
    this.explained = explained;
    this.txHash = txHash;
    this.onChain = onChain;
  }
}
