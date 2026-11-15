/**
 * Opt-in LIVE check of staking claims against real chains. Skipped unless
 * ZUNIA_LIVE=1, so CI stays offline:
 *
 *   ZUNIA_LIVE=1 node --import tsx --test src/lib/tx/__tests__/live-claims.test.ts
 *
 * For a real delegator with rewards on several validators it builds the claim
 * exactly as ClaimSheet does (`buildWithdrawReward`, plus the restake
 * `buildDelegate` variant), encodes it with the dashboard's encoder and the
 * chain's public-key type (`pubKeyTypeUrlFor`), asks the node to simulate it
 * (`POST /cosmos/tx/v1beta1/simulate`, sequence = the account's real one), and
 * asserts: the simulation succeeds, the gas limit the flow would sign with
 * covers the gas used, and the fee at each tier meets the node's minimum.
 *
 * Simulation skips signature and pubkey-address checks, so the account's
 * on-chain key (or, for an account that never signed, a fixed valid key) is
 * enough. Override the endpoints with ZUNIA_LIVE_LCD_<N>, e.g.
 * ZUNIA_LIVE_LCD_OSMOSIS_1=https://...
 */
import "../../swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAccount } from "@zunialab/interchain";

import { findChain } from "@/lib/chains";
import { fromHex, toBase64 } from "../bytes";
import {
  encodeAuthInfo,
  encodePubKeyAny,
  encodeSimulationTx,
  encodeTxBody,
  encodeTxRaw,
  SIGN_MODE_DIRECT,
} from "../encode";
import { computeFee, gasLimitFromSimulation } from "../fees";
import { buildDelegate, buildWithdrawReward } from "../messages";
import { pubKeyTypeUrlFor } from "../pubkey";
import type { TxMessage } from "../types";

const LIVE = process.env.ZUNIA_LIVE === "1";
const MAX_CLAIMS = 32;

const LCD: Record<string, string> = {
  "safrochain-1": "https://api.safrochain.network",
  "cosmoshub-4": "https://cosmos-rest.publicnode.com",
  "osmosis-1": "https://osmosis-rest.publicnode.com",
  "injective-1": "https://lcd-injective.keplr.app",
};
/** The secp256k1 generator point, compressed: a valid key for an account that never signed. */
const FALLBACK_KEY = fromHex("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");

async function get(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

/** Whole base units of a DecCoin amount ("123.456" → 123n). */
const whole = (amount: string): bigint => BigInt(amount.split(".")[0] || "0");

async function findDelegator(lcd: string, denom: string, decimals: number): Promise<{ address: string; validators: string[]; rewards: Map<string, bigint> }> {
  const bonded = (await get(`${lcd}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=12`)) as {
    validators: { operator_address: string }[];
  };
  const seen = new Set<string>();
  let best: { address: string; rewards: Map<string, bigint> } | null = null;
  for (const v of bonded.validators) {
    let page: { delegation_responses?: { delegation: { delegator_address: string } }[] };
    try {
      page = (await get(`${lcd}/cosmos/staking/v1beta1/validators/${v.operator_address}/delegations?pagination.limit=25&pagination.reverse=true`)) as typeof page;
    } catch {
      continue;
    }
    for (const row of page.delegation_responses ?? []) {
      const address = row.delegation.delegator_address;
      if (seen.has(address)) continue;
      seen.add(address);
      let body: unknown;
      try {
        body = await get(`${lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
      } catch {
        continue;
      }
      // The final-form simulation charges the fee, so the account must hold some (0.05 token).
      try {
        const bal = (await get(`${lcd}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`)) as { balance?: { amount?: string } };
        if (BigInt(bal.balance?.amount ?? "0") < BigInt(10) ** BigInt(decimals) / BigInt(20)) continue;
      } catch {
        continue;
      }
      const rewards = new Map<string, bigint>();
      for (const item of (body as { rewards?: { validator_address: string; reward: { denom: string; amount: string }[] }[] }).rewards ?? []) {
        const own = (item.reward ?? []).filter((c) => c.denom === denom).reduce((sum, c) => sum + whole(c.amount), BigInt(0));
        if (own > BigInt(0)) rewards.set(item.validator_address, own);
      }
      if (!best || rewards.size > best.rewards.size) best = { address, rewards };
      if (rewards.size >= 4) return { address, validators: [...rewards.keys()], rewards };
    }
    if (best && best.rewards.size >= 2 && seen.size > 60) break;
  }
  if (!best || best.rewards.size === 0) throw new Error("no delegator with rewards found");
  return { address: best.address, validators: [...best.rewards.keys()], rewards: best.rewards };
}

/** "0.0500…usaf" → price as an exact fraction. */
function parsePrice(text: string): { num: bigint; den: bigint } | null {
  const m = /^(\d+)(?:\.(\d+))?/.exec(text);
  if (!m || /^0+(\.0+)?/.test(text) && Number(m[0]) === 0) return null;
  const frac = m[2] ?? "";
  return { num: BigInt(`${m[1]}${frac}`), den: BigInt(10) ** BigInt(frac.length) };
}

async function minimumPrice(lcd: string): Promise<{ num: bigint; den: bigint; source: string } | null> {
  try {
    const cfg = (await get(`${lcd}/cosmos/base/node/v1beta1/config`)) as { minimum_gas_price?: string };
    const first = (cfg.minimum_gas_price ?? "").split(",")[0] ?? "";
    const price = parsePrice(first);
    if (price) return { ...price, source: "node config" };
  } catch {
    /* fall through */
  }
  try {
    const eip = (await get(`${lcd}/osmosis/txfees/v1beta1/cur_eip_base_fee`)) as { base_fee?: string };
    const price = parsePrice(eip.base_fee ?? "");
    if (price) return { ...price, source: "EIP-1559 base fee" };
  } catch {
    /* none */
  }
  return null;
}

async function simulate(lcd: string, txRaw: Uint8Array): Promise<{ ok: boolean; gasUsed: bigint; error: string }> {
  const response = await fetch(`${lcd}/cosmos/tx/v1beta1/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: toBase64(txRaw) }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { gas_info?: { gas_used?: string }; message?: string };
  if (!response.ok) return { ok: false, gasUsed: BigInt(0), error: `${response.status} ${body.message ?? ""}` };
  return { ok: true, gasUsed: BigInt(body.gas_info?.gas_used ?? "0"), error: "" };
}

for (const chainId of Object.keys(LCD)) {
  test(`live claim simulation on ${chainId}`, { skip: LIVE ? false : "set ZUNIA_LIVE=1 to run against real chains", timeout: 240_000 }, async () => {
    const chain = findChain(chainId);
    assert.ok(chain, "chain in catalog");
    const lcd = process.env[`ZUNIA_LIVE_LCD_${chainId.replace(/-/g, "_").toUpperCase()}`] ?? LCD[chainId]!;
    const delegator = await findDelegator(lcd, chain.feeMinimalDenom, chain.feeDecimals);

    // The account exactly as /api/account reads it (vesting and Eth accounts unwrapped).
    const account = parseAccount(await get(`${lcd}/cosmos/auth/v1beta1/accounts/${delegator.address}`), chainId, delegator.address);
    const typeUrl = pubKeyTypeUrlFor(chain, account.pubKey?.typeUrl);
    const key = account.pubKey?.key ? Uint8Array.from(Buffer.from(account.pubKey.key, "base64")) : FALLBACK_KEY;
    const publicKeyAny = encodePubKeyAny(key.length === 33 ? key : FALLBACK_KEY, typeUrl);

    const claims = delegator.validators.slice(0, MAX_CLAIMS);
    const claimMessages: TxMessage[] = claims.map((validatorAddress) =>
      buildWithdrawReward({ delegatorAddress: delegator.address, validatorAddress }),
    );
    const restakeMessages: TxMessage[] = [
      ...claimMessages,
      ...claims.map((validatorAddress) =>
        buildDelegate({
          delegatorAddress: delegator.address,
          validatorAddress,
          amount: { denom: chain.feeMinimalDenom, amount: (delegator.rewards.get(validatorAddress) ?? BigInt(1)).toString() },
        }),
      ),
    ];
    const min = await minimumPrice(lcd);
    const lines: string[] = [];

    for (const [label, messages] of [["claim", claimMessages], ["claim+restake", restakeMessages]] as const) {
      // 1. The dashboard's own measurement request (empty signature, empty fee).
      const measured = await simulate(
        lcd,
        encodeSimulationTx({ messages, memo: "", publicKeyAny, sequence: account.sequence }),
      );
      assert.ok(measured.ok, `${label}: simulation refused: ${measured.error}`);
      const gasLimit = BigInt(gasLimitFromSimulation(measured.gasUsed.toString()));
      assert.ok(gasLimit >= measured.gasUsed, `${label}: limit ${gasLimit} below gas used ${measured.gasUsed}`);

      // 2. The final form: real fee and gas limit, direct mode, a 64-byte zero signature.
      for (const tier of ["low", "average", "high"] as const) {
        const fee = computeFee(chain, gasLimit.toString(), tier);
        const bodyBytes = encodeTxBody({ messages, memo: "" });
        const authInfoBytes = encodeAuthInfo({
          signers: [{ publicKey: publicKeyAny, mode: SIGN_MODE_DIRECT, sequence: account.sequence }],
          fee: { amount: fee.amount, gasLimit: fee.gasLimit },
        });
        const final = await simulate(lcd, encodeTxRaw({ bodyBytes, authInfoBytes, signatures: [new Uint8Array(64)] }));
        assert.ok(final.ok, `${label}/${tier}: final-form simulation refused: ${final.error}`);
        assert.ok(gasLimit >= final.gasUsed, `${label}/${tier}: limit ${gasLimit} below gas used ${final.gasUsed}`);
        if (min && tier !== "low") {
          const needed = (gasLimit * min.num + min.den - BigInt(1)) / min.den;
          assert.ok(BigInt(fee.amount[0]?.amount ?? "0") >= needed, `${label}/${tier}: fee ${fee.amount[0]?.amount} below minimum ${needed} (${min.source})`);
        }
        if (tier === "average") {
          lines.push(
            `${chainId} ${label}: msgs=${messages.length} validators=${claims.length} seq=${account.sequence} acct#${account.accountNumber} ` +
              `gasUsed=${measured.gasUsed}/${final.gasUsed} limit=${gasLimit} fee(avg)=${fee.amount[0]?.amount}${chain.feeMinimalDenom} ` +
              `min=${min ? `${min.num}/${min.den} (${min.source}) → ${(gasLimit * min.num + min.den - BigInt(1)) / min.den}` : "none published"} pubkey=${typeUrl}`,
          );
        }
      }
    }
    console.log(lines.join("\n"));
  });
}
