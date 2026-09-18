/**
 * Client helpers: sign via wallet session/extension, broadcast via BFF.
 */

import {
  assembleAminoTxRaw,
  estimateFee,
  makeStdSignDoc,
  parseSignatureBase64,
  type AminoMsg,
  type StdFee,
  type StdSignDoc,
} from "./amino-tx";
import { fromBase64, toBase64 } from "./bytes";
import { findChain } from "@/lib/chains";

export type AminoSignResult = {
  signed: StdSignDoc;
  signature: {
    pub_key: { type: string; value: string };
    signature: string;
  };
};

type SignAminoFn = (
  chainId: string,
  signer: string,
  signDoc: StdSignDoc,
) => Promise<AminoSignResult>;

export async function fetchAccount(chainId: string, address: string) {
  const res = await fetch(
    `/api/account?chainId=${encodeURIComponent(chainId)}&address=${encodeURIComponent(address)}`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Account lookup failed (${res.status})`);
  }
  return (await res.json()) as {
    accountNumber: string;
    sequence: string;
  };
}

export async function broadcastTxBytes(params: {
  chainId: string;
  txBytes: string;
  mode?: string;
}): Promise<{ txhash: string; code: number; rawLog: string }> {
  const res = await fetch("/api/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as {
    txhash?: string;
    code?: number;
    rawLog?: string;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? body.rawLog ?? `Broadcast failed (${res.status})`);
  }
  if (!body.txhash) throw new Error("Broadcast returned no txhash");
  return {
    txhash: body.txhash,
    code: body.code ?? 0,
    rawLog: body.rawLog ?? "",
  };
}

/**
 * The fee for a gas limit on a chain.
 *
 * Reads the catalog's `gasPriceStep.average` when it has one. It always did —
 * the field was in the JSON and simply not declared on `ChainEntry` — so every
 * fee on this dashboard was computed at a flat 0.025, which underpays Osmosis
 * (0.1) and Safrochain (0.075) and gets the transaction rejected for
 * insufficient fee. 0.025 stays as the fallback for a row that carries no
 * steps, because it is the common SDK default, not because it is right
 * everywhere.
 */
export function feeForChain(chainId: string, gasLimit: number): StdFee {
  const chain = findChain(chainId);
  const denom = chain?.feeMinimalDenom ?? chain?.coinMinimalDenom ?? "uatom";
  const gasPrice = chain?.gasPriceStep?.average ?? 0.025;
  return estimateFee({ gasLimit, gasPrice, denom });
}

export async function signAminoAndBroadcast(params: {
  chainId: string;
  signer: string;
  msgs: AminoMsg[];
  memo?: string;
  gasLimit?: number;
  signAmino: SignAminoFn;
  ethKeyType?: boolean;
}): Promise<{ txhash: string }> {
  const gasLimit = params.gasLimit ?? 200_000;
  const fee = feeForChain(params.chainId, gasLimit);
  const account = await fetchAccount(params.chainId, params.signer);
  const signDoc = makeStdSignDoc({
    chainId: params.chainId,
    accountNumber: account.accountNumber,
    sequence: account.sequence,
    fee,
    msgs: params.msgs,
    memo: params.memo,
  });
  const signed = await params.signAmino(
    params.chainId,
    params.signer,
    signDoc,
  );
  const pubKey = fromBase64(signed.signature.pub_key.value);
  if (pubKey.length !== 33) {
    throw new Error("Expected compressed secp256k1 public key");
  }
  const signature = parseSignatureBase64(signed.signature.signature);
  const txRaw = assembleAminoTxRaw({
    signDoc: signed.signed ?? signDoc,
    pubKey,
    signature,
    ethKeyType: params.ethKeyType,
  });
  const result = await broadcastTxBytes({
    chainId: params.chainId,
    txBytes: toBase64(txRaw),
  });
  return { txhash: result.txhash };
}
