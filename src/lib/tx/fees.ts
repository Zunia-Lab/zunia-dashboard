/**
 * Gas limits and fees, exactly.
 *
 * gas limit = ceil(simulated gas × adjustment), fee = ceil(gas limit × gas
 * price) in the chain's fee denom. Both round up, and the direction is not
 * arbitrary: a validator checks `fee >= ceil(gasLimit × minGasPrice)` at
 * CheckTx, and one base unit short is a rejection after the user has already
 * signed. One unit over costs a fraction of a cent.
 *
 * All arithmetic is bigint over exact rationals. The catalog holds gas prices
 * like 20000000000 (adym, 18 decimals) and 0.0025 (uakt), and neither survives
 * float multiplication at a 2,000,000 gas limit.
 *
 * Ported from zunia-sdk packages/interchain/src/tx.ts (`estimateFee`,
 * `toRational`, `ceilDiv`) at the version linked in this repo.
 */

import type { Coin, FeeTier } from "./types";
import { messageKind, type MessageKind } from "./messages";

export const DEFAULT_GAS_ADJUSTMENT = 1.4;

/**
 * Gas per message when simulation is unavailable. Generous on purpose: Cosmos
 * chains charge the whole fee whatever gas is used, so an over-estimate costs
 * a little fee, while an under-estimate costs the whole fee *and* fails. The
 * staking figures are high because Cosmos Hub's staking hooks are: a delegate
 * simulated at 834k gas and a claim at 775k there (Oct 2026), against 168k and
 * 104k on Safrochain.
 */
export const FALLBACK_GAS: Record<MessageKind, number> = {
  send: 150_000,
  delegate: 900_000,
  undelegate: 900_000,
  redelegate: 1_000_000,
  claim: 800_000,
  vote: 200_000,
  transfer: 300_000,
  contract: 800_000,
  swap: 900_000,
  other: 500_000,
};

const MIN_GAS = 50_000;
const MAX_GAS = 10_000_000;

function rational(value: number): { num: bigint; den: bigint } {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${value} is not a usable number`);
  // toString is round-trip exact and switches to exponent notation outside
  // 1e-7…1e21, which is squarely inside the range of real gas prices.
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.toString());
  if (!match) throw new Error(`${value} cannot be represented exactly`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const shift = Number(match[3] ?? "0") - fraction.length;
  const digits = BigInt(`${whole}${fraction}`);
  const ten = BigInt(10);
  return shift >= 0 ? { num: digits * ten ** BigInt(shift), den: BigInt(1) } : { num: digits, den: ten ** BigInt(-shift) };
}

function ceilDiv(num: bigint, den: bigint): bigint {
  return (num + den - BigInt(1)) / den;
}

/** ceil(gasUsed × adjustment), clamped to a sane range. */
export function gasLimitFromSimulation(gasUsed: string | number, adjustment = DEFAULT_GAS_ADJUSTMENT): number {
  const used = BigInt(typeof gasUsed === "number" ? Math.ceil(gasUsed) : gasUsed.trim());
  if (used <= BigInt(0)) throw new Error("Simulation reported no gas");
  const adj = rational(adjustment);
  if (adj.num === BigInt(0)) throw new Error("Gas adjustment must be positive");
  const limit = Number(ceilDiv(used * adj.num, adj.den));
  return Math.min(Math.max(limit, MIN_GAS), MAX_GAS);
}

/**
 * The fixed limit used when the chain could not be asked: the costliest
 * message in full, every other one at a quarter (the per-transaction overhead —
 * signature check, fee deduction, hooks warming up — is paid once).
 */
export function fallbackGasLimit(messages: readonly { typeUrl: string }[]): number {
  const costs = messages.map((msg) => FALLBACK_GAS[messageKind(msg)]).sort((a, b) => b - a);
  const total = costs.reduce((sum, cost, index) => sum + (index === 0 ? cost : Math.ceil(cost / 4)), 0);
  return Math.min(Math.max(total, MIN_GAS), MAX_GAS);
}

/** The catalog fields a fee needs. `ChainEntry` satisfies it. */
export interface FeeChain {
  chainId: string;
  chainName?: string;
  feeMinimalDenom: string;
  feeDenom?: string;
  feeDecimals: number;
  gasPriceStep?: { low: number; average: number; high: number };
}

export interface FeeQuote {
  /** Empty on a zero-price chain: several reject a `0denom` coin. */
  amount: Coin[];
  gasLimit: string;
  /** Gas price used, in fee minimal-denom units per gas. */
  gasPrice: number;
  tier: FeeTier;
  denom: string;
  decimals: number;
  /** Display amount in whole fee tokens ("0.0123"), exact. */
  display: string;
  /** Ticker for display ("ATOM"), when the catalog has one. */
  symbol?: string;
}

/** `amount` base units as a decimal string with `decimals` places, trailing zeros trimmed. */
export function formatUnits(amount: string, decimals: number): string {
  const raw = amount.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(raw)) throw new Error(`${amount} is not an integer amount`);
  if (decimals <= 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export class NoGasPriceError extends Error {
  constructor(chain: FeeChain) {
    super(
      `${chain.chainName ?? chain.chainId} publishes no gas price, so Zunia cannot compute a fee the network will accept.`,
    );
    this.name = "NoGasPriceError";
  }
}

/** fee = ceil(gasLimit × gasPriceStep[tier]) in the chain's fee denom. */
export function computeFee(chain: FeeChain, gasLimit: number | string, tier: FeeTier = "average"): FeeQuote {
  const limit = BigInt(gasLimit);
  if (limit <= BigInt(0)) throw new Error("The gas limit must be positive");
  const price = chain.gasPriceStep?.[tier];
  if (price === undefined || !Number.isFinite(price) || price < 0) throw new NoGasPriceError(chain);
  const r = rational(price);
  const fee = ceilDiv(limit * r.num, r.den);
  const amount = fee === BigInt(0) ? [] : [{ denom: chain.feeMinimalDenom, amount: fee.toString() }];
  return {
    amount,
    gasLimit: limit.toString(),
    gasPrice: price,
    tier,
    denom: chain.feeMinimalDenom,
    decimals: chain.feeDecimals,
    display: formatUnits(fee.toString(), chain.feeDecimals),
    ...(chain.feeDenom ? { symbol: chain.feeDenom } : {}),
  };
}

/** All three tiers at once, for a fee picker. Null when the chain has no prices. */
export function feeTiers(chain: FeeChain, gasLimit: number | string): Record<FeeTier, FeeQuote> | null {
  if (!chain.gasPriceStep) return null;
  return {
    low: computeFee(chain, gasLimit, "low"),
    average: computeFee(chain, gasLimit, "average"),
    high: computeFee(chain, gasLimit, "high"),
  };
}
