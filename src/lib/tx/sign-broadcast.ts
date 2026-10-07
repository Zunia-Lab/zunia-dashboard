/**
 * Amino sign + broadcast with a fixed gas limit.
 *
 * @deprecated Pre-v2 path, kept so pages that have not moved yet keep working.
 * New flows use `useSignAndBroadcast` (`./useSignAndBroadcast`): simulated gas,
 * direct mode where it is needed, inclusion confirmed, errors in plain words.
 * What changed under the old API: the fee is exact (bigint), the public key
 * type is the chain's own (Injective, cosmos/evm and Initia chains were signed
 * with the Ethermint URL or the Cosmos one), and a broadcast the chain rejects
 * now throws instead of returning a hash as if it had worked.
 */

import { assembleAminoTxRaw, makeStdSignDoc, parseSignatureBase64, type AminoMsg, type StdFee, type StdSignDoc } from "./amino-tx";
import { fromBase64, toBase64 } from "./bytes";
import { broadcastTx, fetchAccountInfo, type AccountInfo } from "./client";
import { explainTxError } from "./errors";
import { computeFee } from "./fees";
import { pubKeyTypeUrlFor } from "./pubkey";
import { findChain, findChainsByPrefix } from "@/lib/chains";
import { resolveAddressFor, retargetSignerFields } from "@/lib/connect/addresses";

export type AminoSignResult = {
  signed: StdSignDoc;
  signature: {
    pub_key: { type: string; value: string };
    signature: string;
  };
};

type SignAminoFn = (chainId: string, signer: string, signDoc: StdSignDoc) => Promise<AminoSignResult>;

/** @deprecated Use `fetchAccountInfo` from `./client`. */
export async function fetchAccount(chainId: string, address: string): Promise<AccountInfo> {
  return fetchAccountInfo(chainId, address);
}

/**
 * @deprecated Use `broadcastTx` from `./client`.
 * Throws when the chain rejects the transaction (with the reason in plain words).
 */
export async function broadcastTxBytes(params: {
  chainId: string;
  txBytes: string;
  mode?: string;
}): Promise<{ txhash: string; code: number; rawLog: string }> {
  const answer = await broadcastTx(params.chainId, params.txBytes);
  if (answer.code !== 0) {
    throw new Error(explainTxError(answer.rawLog, { code: answer.code, codespace: answer.codespace }).message);
  }
  return { txhash: answer.txHash, code: answer.code, rawLog: answer.rawLog };
}

/**
 * The fee for a gas limit on a chain, at the catalog's average gas price.
 *
 * @deprecated Use `computeFee` from `./fees` (tiers, display amount).
 */
export function feeForChain(chainId: string, gasLimit: number): StdFee {
  const chain = findChain(chainId);
  if (chain?.gasPriceStep) {
    const quote = computeFee(chain, gasLimit, "average");
    return { amount: quote.amount, gas: quote.gasLimit };
  }
  // Pre-v2 behaviour for a chain without published prices, because old pages
  // call this while rendering and must not throw there. The sign hook refuses
  // such a chain instead of guessing (`NoGasPriceError`).
  const denom = chain?.feeMinimalDenom ?? chain?.coinMinimalDenom ?? "uatom";
  return { amount: [{ denom, amount: String(Math.max(1, Math.ceil(gasLimit * 0.025))) }], gas: String(gasLimit) };
}

/**
 * Pre-v2 pages sign with `account.address`, which since v2 is the primary
 * account's address (Safrochain), whatever chain the page signs on. On a
 * chain with the same key scheme the same key controls the re-encoded
 * address (`resolveAddressFor`), so the signer and the message fields that
 * name it move to the signing chain's prefix; across schemes there is no such
 * address, and the page is told so instead of broadcasting a transaction
 * every node refuses. New flows take `addressFor(chainId)` and never need this.
 */
function retargetLegacySigner(chainId: string, signer: string, msgs: AminoMsg[]): { signer: string; msgs: AminoMsg[] } {
  const chain = findChain(chainId);
  if (!chain || signer.startsWith(`${chain.bech32Prefix}1`)) return { signer, msgs };
  const prefix = signer.slice(0, Math.max(0, signer.lastIndexOf("1")));
  const source = findChainsByPrefix(prefix)[0];
  const target = source ? resolveAddressFor(chainId, { [source.chainId]: signer }, findChain) : null;
  if (!target) {
    throw new Error(
      `Your ${source?.chainName ?? "connected"} address has no counterpart on ${chain.chainName} (a different key type). Reconnect your wallet and try again.`,
    );
  }
  return { signer: target, msgs: retargetSignerFields(msgs, signer, target) };
}

/** @deprecated Use `useSignAndBroadcast`. */
export async function signAminoAndBroadcast(params: {
  chainId: string;
  signer: string;
  msgs: AminoMsg[];
  memo?: string;
  gasLimit?: number;
  signAmino: SignAminoFn;
  /** @deprecated Ignored: the key type comes from the chain and the account. */
  ethKeyType?: boolean;
}): Promise<{ txhash: string }> {
  const chain = findChain(params.chainId);
  if (!chain) throw new Error(`Unknown chain ${params.chainId}`);
  const { signer, msgs } = retargetLegacySigner(params.chainId, params.signer, params.msgs);
  const gasLimit = params.gasLimit ?? 200_000;
  const fee = feeForChain(params.chainId, gasLimit);
  const account = await fetchAccountInfo(params.chainId, signer);
  const signDoc = makeStdSignDoc({
    chainId: params.chainId,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    fee,
    msgs,
    memo: params.memo,
  });
  const signed = await params.signAmino(params.chainId, signer, signDoc);
  const pubKey = fromBase64(signed.signature.pub_key.value);
  if (pubKey.length !== 33) {
    throw new Error("Expected compressed secp256k1 public key");
  }
  const signature = parseSignatureBase64(signed.signature.signature);
  const txRaw = assembleAminoTxRaw({
    signDoc: signed.signed ?? signDoc,
    pubKey,
    signature,
    pubKeyTypeUrl: pubKeyTypeUrlFor(chain, account.pubKey?.typeUrl),
  });
  const answer = await broadcastTx(params.chainId, toBase64(txRaw), signer);
  if (answer.code !== 0) {
    throw new Error(explainTxError(answer.rawLog, { code: answer.code, codespace: answer.codespace }).message);
  }
  return { txhash: answer.txHash };
}
