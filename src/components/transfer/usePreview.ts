"use client";

/**
 * The fee a transfer would cost, before the wallet is asked: `useTxPreview`
 * (a simulation of the real messages, priced at the chain's three gas
 * prices), plus what Max must leave behind for it.
 *
 * The simulation is requested at one tier and read at all three, so switching
 * Low / Average / High does not measure again. The fee reserve is the chosen
 * tier's fee with a margin (the wallet measures again when it signs and the
 * figure can move), and never less than the per-kind fallback the sign flow
 * itself would use: Max must not leave an amount the fee then cannot cover.
 */

import { useMemo } from "react";
import type { ChainEntry } from "@/lib/chains";
import { useTxPreview } from "@/lib/data/wallet";
import { computeFee, FALLBACK_GAS, type FeeQuote } from "@/lib/tx/fees";
import type { GasEstimate } from "@/lib/tx/flow";
import type { FeeTier, TxMessage } from "@/lib/tx/types";

export interface FeePreview {
  tiers: Record<FeeTier, FeeQuote> | null;
  /** The chosen tier. */
  fee: FeeQuote | null;
  gas: GasEstimate | null;
  loading: boolean;
  /** Why there are no figures, in plain words. */
  problem: string | null;
  /** Base units of the fee token Max keeps back; null when unknown. */
  reserve: string | null;
}

/** 30% over the measured fee: room for the re-measurement at signing time. */
const MARGIN_NUM = BigInt(13);
const MARGIN_DEN = BigInt(10);

export function useWalletTxPreview(
  request: { chainId: string; messages: TxMessage[]; memo?: string } | null,
  chain: ChainEntry | undefined,
  tier: FeeTier,
  kind: "send" | "transfer",
): FeePreview {
  const signRequest = useMemo(
    () =>
      request && request.messages.length > 0
        ? { chainId: request.chainId, messages: request.messages, memo: request.memo?.trim() || undefined, feeTier: "average" as const }
        : null,
    [request],
  );
  const preview = useTxPreview(signRequest);
  const tiers = preview.preview?.tiers ?? null;
  const fee = tiers?.[tier] ?? (tier === "average" ? (preview.preview?.fee ?? null) : null);

  const fallback = useMemo(() => {
    if (!chain) return null;
    try {
      return computeFee(chain, FALLBACK_GAS[kind], tier);
    } catch {
      return null;
    }
  }, [chain, kind, tier]);

  const reserve = useMemo(() => {
    const measured = fee?.amount[0]?.amount;
    const floor = fallback?.amount[0]?.amount;
    const withMargin = measured ? ((BigInt(measured) * MARGIN_NUM + MARGIN_DEN - BigInt(1)) / MARGIN_DEN).toString() : null;
    if (withMargin && floor) return BigInt(withMargin) > BigInt(floor) ? withMargin : floor;
    return withMargin ?? floor ?? null;
  }, [fee, fallback]);

  const problem = !chain
    ? null
    : !chain.gasPriceStep
      ? `${chain.chainName} publishes no gas price, so the fee cannot be shown here; your wallet will propose one.`
      : preview.error
        ? `${preview.error.message} The fee is measured again when you sign.`
        : null;

  return {
    tiers,
    fee,
    gas: preview.preview?.gas ?? null,
    loading: preview.loading,
    problem,
    reserve,
  };
}
