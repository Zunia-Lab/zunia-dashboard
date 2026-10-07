/**
 * Sign and broadcast, end to end, with every dependency passed in.
 *
 * One path for every flow and every transport (Zunia extension, Keplr, Leap,
 * Cosmostation, Zunia Mobile), so the rules below hold everywhere:
 *
 * 1. **Prepare.** Make sure the wallet has the chain (enable / suggest) and
 *    get its key; read account number + sequence (`/api/account`); simulate
 *    with an empty signature (`/api/tx/simulate`) → gas = ceil(used × 1.4).
 *    A simulation the chain refuses stops here, before anyone signs a
 *    transaction that cannot succeed. A simulation that could not run falls
 *    back to a fixed gas per message kind, flagged as an estimate. A stale
 *    sequence is corrected by the simulation itself (the chain names the one
 *    it expects), and the corrected one is what gets signed.
 * 2. **Sign** in the mode `chooseSignMode` picks. The TxRaw is assembled from
 *    what the wallet returns (`signed`), never from what it was sent: wallets
 *    let users change the fee, and the chain verifies the signature against
 *    the bytes that are broadcast. Both modes are checked: a wallet may change
 *    fee and memo, never the messages, the chain, the sequence or the account
 *    that signs (a switched account is stopped with words, not broadcast into
 *    an opaque "unauthorized"). Then the signature itself is verified over
 *    the bytes the chain will rebuild (`verify-signature.ts`): one the chain
 *    would refuse is stopped here, and nothing is sent.
 * 3. **Broadcast** (`/api/broadcast`, sync). A sequence mismatch — another
 *    transaction from the account went first — is retried once, re-signed
 *    with the sequence the chain expects. "Already in the mempool" (the same
 *    bytes twice) is followed like an accepted transaction.
 * 4. **Confirm**: poll `/api/tx/<hash>` every 2 s for up to 60 s. Inclusion
 *    with an error is a failure with the chain's reason in plain words; no
 *    inclusion within the window is "submitted", not failure.
 *
 * Pure orchestration (no React, no window), so `__tests__/flow.test.ts` drives
 * it with fake wallets and fake routes.
 */

import { asBytes, bytesEqual, canonicalJson, fromBase64, toBase64, toHex } from "./bytes";
import {
  decodeAuthInfoFee,
  encodeAuthInfo,
  encodePubKeyAny,
  encodeSimulationTx,
  encodeTxBody,
  encodeTxRaw,
  normalizeSignature,
  SIGN_MODE_DIRECT,
} from "./encode";
import { assembleAminoTxRaw, makeStdSignDoc, type StdSignDoc } from "./amino-tx";
import { explainError, explainTxError, signatureMismatch, TxError } from "./errors";
import {
  computeFee,
  DEFAULT_GAS_ADJUSTMENT,
  fallbackGasLimit,
  feeTiers,
  gasLimitFromSimulation,
  type FeeChain,
  type FeeQuote,
} from "./fees";
import { isEthKeyChain, pubKeyTypeUrlFor, type KeyChain } from "./pubkey";
import { readProtoFields } from "./proto";
import { chooseSignMode, type SignerCapabilities, type SignerKind } from "./sign-mode";
import type { AccountInfo, BroadcastAnswer } from "./client";
import { SimulationRefused } from "./client";
import type { ResolvedSignMode, SignRequest, SignResult, SignStage, TxOutcome } from "./types";
import { checkAminoSignature, checkDirectSignature } from "./verify-signature";

/** The signer's key on one chain. */
export interface SignerKey {
  address: string;
  /** 33-byte compressed secp256k1 key. */
  pubKey: Uint8Array;
  algo?: string;
  isNanoLedger?: boolean;
}

export interface DirectSignDocInput {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  /** A decimal string: what Keplr, the Zunia extension and the SDK all accept. */
  accountNumber: string;
}

export interface WalletSignature {
  pub_key: { type: string; value: string };
  signature: string;
}

/** What the sign flow needs from a wallet. `WalletProvider` builds one per transport. */
export interface TxSigner {
  /** Which wallet: the sign-mode policy has rules per wallet (`chooseSignMode`). */
  kind: SignerKind;
  capabilities(chainId: string, key: SignerKey): SignerCapabilities;
  /** Enable (suggest when unknown) the chain and return its key. Readable errors. */
  ensureKey(chainId: string): Promise<SignerKey>;
  signDirect(
    chainId: string,
    signer: string,
    doc: DirectSignDocInput,
  ): Promise<{ signed?: { bodyBytes?: unknown; authInfoBytes?: unknown }; signature: WalletSignature }>;
  signAmino(chainId: string, signer: string, doc: StdSignDoc): Promise<{ signed?: StdSignDoc; signature: WalletSignature }>;
}

/** What the sign flow needs from the dashboard's server (`./client` in the app). */
export interface TxApi {
  getAccount(chainId: string, address: string): Promise<AccountInfo>;
  simulate(chainId: string, txBytes: string): Promise<{ gasUsed: string }>;
  /**
   * `address` is the signer: the server drops its cached reads of that account
   * (balances, activity) so the refresh after the transaction is not served
   * the pre-transaction answer.
   */
  broadcast(chainId: string, txBytes: string, address?: string): Promise<BroadcastAnswer>;
  getTx(chainId: string, hash: string, address?: string): Promise<TxOutcome>;
}

export interface FlowChain extends KeyChain, FeeChain {
  chainName: string;
}

export interface FlowOptions {
  signer: TxSigner;
  api: TxApi;
  chain: FlowChain;
  onStage?: (stage: SignStage, detail?: { txHash?: string }) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface GasEstimate {
  /** "simulated": measured by the chain; "fixed": per-kind fallback; "caller": request.gasLimit. */
  method: "simulated" | "fixed" | "caller";
  gasLimit: number;
  gasUsed?: string;
  /** True unless the chain measured it. */
  estimate: boolean;
  /** Shown next to the fee when the gas is not a measurement. */
  note?: string;
}

/** Everything decided before the wallet is asked. */
export interface TxPlan {
  chainId: string;
  signer: SignerKey;
  accountNumber: string;
  sequence: string;
  pubKeyTypeUrl: string;
  mode: ResolvedSignMode;
  gas: GasEstimate;
  fee: FeeQuote;
}

const MAX_MESSAGES = 64;
const MAX_MEMO_BYTES = 256;

function validate(req: SignRequest, chain: FlowChain): void {
  if (req.chainId !== chain.chainId) throw new Error("The request and the chain disagree.");
  if (req.messages.length === 0) throw new Error("Nothing to sign.");
  if (req.messages.length > MAX_MESSAGES) throw new Error(`At most ${MAX_MESSAGES} messages per transaction.`);
  if (new TextEncoder().encode(req.memo ?? "").length > MAX_MEMO_BYTES) {
    throw new Error("The memo is longer than the 256 bytes chains accept.");
  }
}

/** A lone UTF-16 surrogate: half of a character (an emoji cut in two), which UTF-8 cannot carry. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    }
  }
  return true;
}

/**
 * Why a memo cannot be signed as typed, in words; null when it can.
 *
 * Two kinds of character break the signature rather than the transaction,
 * so the chain would refuse it as "signature verification failed":
 * - U+2028 and U+2029 (line and paragraph separators, invisible, pasted in
 *   from documents): the chain writes them escaped in an amino document,
 *   CosmJS-based wallets (Keplr, Zunia Mobile) sign them as they are;
 * - a broken character (half of an emoji, a lone surrogate): UTF-8 cannot
 *   carry it, so the transaction's bytes and a wallet's JSON disagree.
 * Refused in every mode, so the outcome does not depend on which mode the
 * policy picked. Separators at either end are not a problem: the memo is
 * trimmed before signing, and trimming removes them.
 */
export function memoProblem(memo: string | undefined): string | null {
  if (!memo) return null;
  if (/[\u2028\u2029]/.test(memo)) {
    return "The memo contains an invisible line separator, often pasted in with text. Clear the memo and type it again: wallets and chains encode that character differently, so the chain would refuse the signature.";
  }
  if (!isWellFormed(memo)) {
    return "The memo contains a broken character, often half of an emoji cut off when pasting. Clear the memo and type it again.";
  }
  return null;
}

function maxSequence(a: string, b: string | null | undefined): string {
  if (!b || !/^\d+$/.test(b)) return a;
  return BigInt(b) > BigInt(a) ? b : a;
}

/**
 * Measures the gas, and settles the sequence while doing so.
 *
 * The SDK checks the sequence even in simulation, so a refused simulation can
 * say "account sequence mismatch, expected N": the account endpoint lagged
 * the chain by a block. The retry uses N, and N is what the caller signs with
 * — signing with the stale one would be a guaranteed mismatch at broadcast and
 * a second wallet prompt.
 */
async function simulateGas(
  req: SignRequest,
  api: Pick<TxApi, "simulate">,
  publicKeyAny: Uint8Array | null,
  sequence: string,
): Promise<{ gas: GasEstimate; sequence: string }> {
  if (req.gasLimit !== undefined) {
    return { gas: { method: "caller", gasLimit: Math.ceil(req.gasLimit), estimate: false }, sequence };
  }
  const build = (seq: string) =>
    toBase64(
      encodeSimulationTx({
        messages: req.messages,
        memo: req.memo,
        timeoutHeight: req.timeoutHeight,
        publicKeyAny,
        sequence: seq,
      }),
    );
  const adjustment = req.gasAdjustment ?? DEFAULT_GAS_ADJUSTMENT;
  let seq = sequence;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { gasUsed } = await api.simulate(req.chainId, build(seq));
      return {
        gas: { method: "simulated", gasLimit: gasLimitFromSimulation(gasUsed, adjustment), gasUsed, estimate: false },
        sequence: seq,
      };
    } catch (error) {
      if (error instanceof SimulationRefused) {
        const explained = explainTxError(error.rawLog ?? error.message);
        if (attempt === 0 && explained.kind === "sequence-mismatch" && explained.expectedSequence) {
          seq = explained.expectedSequence;
          continue;
        }
        throw new TxError(explained);
      }
      break;
    }
  }
  return {
    gas: {
      method: "fixed",
      gasLimit: fallbackGasLimit(req.messages),
      estimate: true,
      note: "The network could not measure this transaction, so a fixed gas limit for this kind of transaction is used.",
    },
    sequence: seq,
  };
}

/** Steps 1 of the flow: everything up to the wallet prompt. Also the fee preview. */
export async function planTx(req: SignRequest, opts: FlowOptions, minSequence?: string | null): Promise<TxPlan> {
  validate(req, opts.chain);
  // Not in `validate`: the fee preview of such a memo is still right, only
  // its signature would not be.
  const memo = memoProblem(req.memo);
  if (memo) throw new Error(memo);
  const key = await opts.signer.ensureKey(req.chainId);
  const account = await opts.api.getAccount(req.chainId, key.address);
  const pubKeyTypeUrl = pubKeyTypeUrlFor(opts.chain, account.pubKey?.typeUrl);
  const mode = chooseSignMode(req.messages, opts.signer.capabilities(req.chainId, key), req.signMode ?? "auto", {
    ethKeyChain: isEthKeyChain(opts.chain),
    wallet: opts.signer.kind,
    memo: req.memo,
  });
  const measured = await simulateGas(
    req,
    opts.api,
    encodePubKeyAny(key.pubKey, pubKeyTypeUrl),
    maxSequence(account.sequence, minSequence),
  );
  const fee = computeFee(opts.chain, measured.gas.gasLimit, req.feeTier ?? "average");
  return {
    chainId: req.chainId,
    signer: key,
    accountNumber: account.accountNumber,
    sequence: measured.sequence,
    pubKeyTypeUrl,
    mode,
    gas: measured.gas,
    fee,
  };
}

export interface PreviewOptions {
  api: Pick<TxApi, "getAccount" | "simulate">;
  chain: FlowChain;
  /** The signer's address on the chain (`addressFor`); no wallet prompt. */
  address: string;
  /** The key when the wallet has shared it (`pubKeyFor`); simulation runs without it otherwise. */
  pubKey: Uint8Array | null;
}

export interface TxPreview {
  gas: GasEstimate;
  /** At the requested tier. */
  fee: FeeQuote;
  /** All three tiers for a picker; null when the chain publishes no prices. */
  tiers: Record<"low" | "average" | "high", FeeQuote> | null;
  /** False for an address the chain has never seen (it cannot pay a fee yet). */
  accountExists: boolean;
}

/**
 * The fee a transaction would cost, before any wallet prompt: for review
 * cards. Same simulation and fee rules as the sign flow, which measures again
 * when it runs (the sequence may have moved).
 */
export async function previewTx(req: SignRequest, opts: PreviewOptions): Promise<TxPreview> {
  validate(req, opts.chain);
  const account = await opts.api.getAccount(req.chainId, opts.address);
  const pubKeyTypeUrl = pubKeyTypeUrlFor(opts.chain, account.pubKey?.typeUrl);
  const publicKeyAny = opts.pubKey ? encodePubKeyAny(opts.pubKey, pubKeyTypeUrl) : null;
  const { gas } = await simulateGas(req, opts.api, publicKeyAny, account.sequence);
  const tier = req.feeTier ?? "average";
  const fee = computeFee(opts.chain, gas.gasLimit, tier);
  return { gas, fee, tiers: feeTiers(opts.chain, gas.gasLimit), accountExists: account.exists };
}

interface Signed {
  txRaw: Uint8Array;
  fee: { amount: { denom: string; amount: string }[]; gasLimit: string } | null;
}

const CHANGED_TX = "The wallet returned a different transaction from the one it was asked to sign, so nothing was sent.";
const OTHER_ACCOUNT =
  "Your wallet signed with a different account from the one connected here (did it switch accounts?). Nothing was sent: reconnect the wallet and try again.";

/**
 * A `TxBody` with its memo left out: the messages (field 1), the timeout
 * height (3) and anything else. Keplr lets the user edit the memo in its
 * direct prompt; nothing else in the body is the wallet's to change.
 */
function bodyWithoutMemo(body: Uint8Array): string {
  return readProtoFields(body)
    .filter((field) => field.field !== 2)
    .map((field) => `${field.field}:${field.wire === 2 ? toHex(field.value) : field.value.toString()}`)
    .join("|");
}

/**
 * The key the wallet says it signed with, when it says so. A different key
 * than the one the plan was built for means the wallet switched accounts
 * between "connect" and "sign"; the chain would answer an opaque
 * "unauthorized", so the flow stops here with words instead.
 */
function assertSameKey(signature: WalletSignature, expected: Uint8Array): void {
  const value = signature.pub_key?.value;
  if (typeof value !== "string" || !value) return;
  let returned: Uint8Array;
  try {
    returned = fromBase64(value);
  } catch {
    throw new Error("The wallet returned an unreadable public key.");
  }
  if (returned.length === 33 && !bytesEqual(returned, expected)) throw new Error(OTHER_ACCOUNT);
}

async function signPlan(req: SignRequest, plan: TxPlan, opts: FlowOptions): Promise<Signed> {
  const { signer } = opts;
  if (plan.mode === "direct") {
    const bodyBytes = encodeTxBody({ messages: req.messages, memo: req.memo, timeoutHeight: req.timeoutHeight });
    const authInfoBytes = encodeAuthInfo({
      signers: [
        {
          publicKey: encodePubKeyAny(plan.signer.pubKey, plan.pubKeyTypeUrl),
          mode: SIGN_MODE_DIRECT,
          sequence: plan.sequence,
        },
      ],
      fee: { amount: plan.fee.amount, gasLimit: plan.fee.gasLimit },
    });
    const response = await signer.signDirect(req.chainId, plan.signer.address, {
      bodyBytes,
      authInfoBytes,
      chainId: req.chainId,
      accountNumber: plan.accountNumber,
    });
    const signedBody = response.signed?.bodyBytes !== undefined ? asBytes(response.signed.bodyBytes, "body bytes") : bodyBytes;
    const signedAuth =
      response.signed?.authInfoBytes !== undefined ? asBytes(response.signed.authInfoBytes, "auth info bytes") : authInfoBytes;
    // Same rule as amino below: the fee (auth info) and the memo may change,
    // what the transaction does may not.
    if (!bytesEqual(signedBody, bodyBytes)) {
      let same = false;
      try {
        same = bodyWithoutMemo(signedBody) === bodyWithoutMemo(bodyBytes);
      } catch {
        same = false;
      }
      if (!same) throw new Error(CHANGED_TX);
    }
    assertSameKey(response.signature, plan.signer.pubKey);
    const signature = normalizeSignature(fromBase64(response.signature.signature));
    const check = checkDirectSignature({
      bodyBytes: signedBody,
      authInfoBytes: signedAuth,
      chainId: req.chainId,
      accountNumber: plan.accountNumber,
      pubKey: plan.signer.pubKey,
      pubKeyTypeUrl: plan.pubKeyTypeUrl,
      signature,
    });
    if (check.verdict === "invalid") throw new TxError(signatureMismatch(check.detail));
    return {
      txRaw: encodeTxRaw({ bodyBytes: signedBody, authInfoBytes: signedAuth, signatures: [signature] }),
      fee: decodeAuthInfoFee(signedAuth),
    };
  }

  const msgs = req.messages.map((message) => {
    if (!message.amino) throw new Error("A message without an amino form cannot be signed in amino mode.");
    return message.amino;
  });
  const doc = makeStdSignDoc({
    chainId: req.chainId,
    accountNumber: plan.accountNumber,
    sequence: plan.sequence,
    fee: { amount: plan.fee.amount, gas: plan.fee.gasLimit },
    msgs,
    memo: req.memo,
    timeoutHeight: req.timeoutHeight,
  });
  const response = await signer.signAmino(req.chainId, plan.signer.address, doc);
  const signed = response.signed ?? doc;
  // A wallet may change the fee (a tier the user picked) and, in Keplr, the
  // memo. It may not change what the transaction does or where it applies.
  if (
    canonicalJson(signed.msgs) !== canonicalJson(doc.msgs) ||
    signed.chain_id !== doc.chain_id ||
    signed.account_number !== doc.account_number ||
    signed.sequence !== doc.sequence ||
    (signed.timeout_height ?? "0") !== (doc.timeout_height ?? "0")
  ) {
    throw new Error(CHANGED_TX);
  }
  // Amino's AuthInfo is built from the key the wallet returns, so it must be
  // there, compressed, and the connected account's.
  const pubKey = fromBase64(response.signature.pub_key?.value ?? "");
  if (pubKey.length !== 33) throw new Error("The wallet returned an unexpected public key.");
  assertSameKey(response.signature, plan.signer.pubKey);
  const signature = normalizeSignature(fromBase64(response.signature.signature));
  const check = checkAminoSignature({ signed, pubKey, pubKeyTypeUrl: plan.pubKeyTypeUrl, signature });
  if (check.verdict === "invalid") throw new TxError(signatureMismatch(check.detail));
  return {
    txRaw: assembleAminoTxRaw({
      signDoc: signed,
      pubKey,
      signature,
      pubKeyTypeUrl: plan.pubKeyTypeUrl,
      protoMessages: req.messages.map(({ typeUrl, value }) => ({ typeUrl, value })),
    }),
    fee: { amount: signed.fee.amount, gasLimit: signed.fee.gas },
  };
}

async function confirm(
  chainId: string,
  txHash: string,
  address: string,
  opts: FlowOptions,
): Promise<{ outcome: TxOutcome | null }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const interval = opts.pollIntervalMs ?? 2_000;
  const deadline = now() + (opts.pollTimeoutMs ?? 60_000);
  while (now() < deadline) {
    await sleep(interval);
    try {
      const outcome = await opts.api.getTx(chainId, txHash, address);
      if (outcome.status === "success" || outcome.status === "failed") return { outcome };
    } catch {
      // A node that cannot be read right now says nothing about the
      // transaction; keep asking until the window closes.
    }
  }
  return { outcome: null };
}

/**
 * CheckTx code 19 (`sdk`): the node already holds these exact bytes. Signing
 * is deterministic (RFC 6979), so the same document signed twice — a double
 * click on "Send" — is the same transaction with the same hash, and the first
 * copy is the one waiting for a block. Followed, not reported as a failure.
 */
function alreadyKnown(answer: BroadcastAnswer): boolean {
  return answer.code === 19 && (!answer.codespace || answer.codespace === "sdk");
}

/** The whole flow. Resolves with the result; throws `TxError` with a plain-words reason. */
export async function signAndBroadcast(req: SignRequest, opts: FlowOptions): Promise<SignResult> {
  const stage = (s: SignStage, detail?: { txHash?: string }) => opts.onStage?.(s, detail);
  // A hash the chain knows: set once a node accepted the transaction into its
  // mempool. A CheckTx refusal has a hash too (it is computed from the
  // bytes), but nothing on chain answers to it, so progress UI never shows it.
  let knownHash: string | null = null;
  try {
    let minSequence: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      stage("preparing");
      const plan = await planTx(req, opts, minSequence);
      stage("awaiting-signature");
      const signed = await signPlan(req, plan, opts);
      stage("broadcasting");
      const answer = await opts.api.broadcast(req.chainId, toBase64(signed.txRaw), plan.signer.address);
      if (answer.code !== 0 && !alreadyKnown(answer)) {
        const explained = explainTxError(answer.rawLog, { code: answer.code, codespace: answer.codespace });
        if (explained.kind === "sequence-mismatch" && attempt === 0) {
          minSequence = explained.expectedSequence;
          continue;
        }
        throw new TxError(explained, answer.txHash, false);
      }

      knownHash = answer.txHash;
      stage("confirming", { txHash: answer.txHash });
      const { outcome } = await confirm(req.chainId, answer.txHash, plan.signer.address, opts);
      const base: SignResult = {
        chainId: req.chainId,
        txHash: answer.txHash,
        signMode: plan.mode,
        ...(signed.fee ? { fee: signed.fee.amount, gasLimit: signed.fee.gasLimit } : {}),
      };
      if (!outcome) {
        stage("submitted", { txHash: answer.txHash });
        return { ...base, confirmed: false };
      }
      if (outcome.status === "failed") {
        throw new TxError(
          explainTxError(outcome.rawLog, { code: outcome.code, codespace: outcome.codespace }),
          answer.txHash,
          true,
        );
      }
      stage("success", { txHash: answer.txHash });
      return {
        ...base,
        confirmed: true,
        ...(outcome.height !== undefined ? { height: outcome.height } : {}),
        ...(outcome.gasUsed !== undefined ? { gasUsed: outcome.gasUsed } : {}),
        ...(outcome.gasWanted !== undefined ? { gasWanted: outcome.gasWanted } : {}),
      };
    }
    throw new TxError(explainTxError("account sequence mismatch"), null, false);
  } catch (error) {
    stage("failed", knownHash ? { txHash: knownHash } : undefined);
    if (error instanceof TxError) throw error;
    throw new TxError(explainError(error, { wallet: opts.signer.kind }), knownHash, false);
  }
}
