/**
 * Is the crosschain-swap path usable in this deployment, right now?
 *
 * Two independent conditions, both required, and the answer names whichever one
 * failed:
 *
 * 1. `ZUNIA_XCS_CONTRACT` is set. Without it there is nothing to route through.
 * 2. That address holds a contract on the venue chain. A well-formed address
 *    with no contract behind it would accept an ibc-hooks memo and never act on
 *    it, which strands the transfer at an address nobody controls.
 *
 * Failing closed is the whole point: every caller treats `available: false` as
 * "disable the control and show `reason`", never as "try anyway".
 */

import "server-only";
import {
  DEFAULT_SLIPPAGE_PERCENT,
  isInterchainError,
} from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { lcdFor } from "@/lib/server/interchain";
import {
  routerEndpoint,
  XCS_CONTRACT_KEY,
  XCS_CHAIN_KEY,
  xcsChainId,
  xcsContractAddress,
} from "@/lib/server/interchain-config";

/** Re-verified this often, so a contract migrated away stops working. */
const VERIFY_TTL_MS = 10 * 60 * 1000;
/** A failed check retries sooner: a flaky LCD must not disable the feature for ten minutes. */
const VERIFY_FAILURE_TTL_MS = 30 * 1000;

export interface SwapVenueConfig {
  readonly available: boolean;
  readonly chainId: string;
  readonly chainName: string;
  readonly contractAddress: string | null;
  readonly configured: boolean;
  readonly verified: boolean;
  /** Specific and user-facing. Present whenever `available` is false. */
  readonly reason: string | null;
  readonly configKey: string;
  readonly routerConfigured: boolean;
  readonly routerEndpoint: string | null;
  readonly defaultSlippagePercent: number;
}

let cached: { at: number; value: SwapVenueConfig } | null = null;

function unavailable(params: {
  chainId: string;
  chainName: string;
  contractAddress: string | null;
  configured: boolean;
  reason: string;
}): SwapVenueConfig {
  const endpoint = routerEndpoint();
  return {
    available: false,
    chainId: params.chainId,
    chainName: params.chainName,
    contractAddress: params.contractAddress,
    configured: params.configured,
    verified: false,
    reason: params.reason,
    configKey: XCS_CONTRACT_KEY,
    routerConfigured: endpoint !== null,
    routerEndpoint: endpoint,
    defaultSlippagePercent: DEFAULT_SLIPPAGE_PERCENT,
  };
}

/**
 * Read the config and confirm the contract exists on chain.
 *
 * Never throws. An unreachable chain produces `available: false` with a reason
 * that says the *check* failed — which is a different sentence from "that
 * contract is not there", and is worded that way, because refusing to swap
 * while a public endpoint is down should not read as an accusation.
 */
export async function swapVenueConfig(): Promise<SwapVenueConfig> {
  const now = Date.now();
  if (
    cached &&
    now - cached.at <
      (cached.value.available ? VERIFY_TTL_MS : VERIFY_FAILURE_TTL_MS)
  ) {
    return cached.value;
  }

  const chainId = xcsChainId();
  const chain = findChain(chainId);
  const chainName = chain?.chainName ?? chainId;
  const contractAddress = xcsContractAddress();

  let value: SwapVenueConfig;
  if (!contractAddress) {
    value = unavailable({
      chainId,
      chainName,
      contractAddress: null,
      configured: false,
      reason: `Cross-chain swap is off for this deployment: ${XCS_CONTRACT_KEY} is not set, so there is no crosschain-swaps contract to route through.`,
    });
  } else if (!chain) {
    value = unavailable({
      chainId,
      chainName,
      contractAddress,
      configured: true,
      reason: `${XCS_CHAIN_KEY} names ${chainId}, which is not in this build's chain catalog.`,
    });
  } else {
    const lcd = lcdFor(chain);
    if (!lcd) {
      value = unavailable({
        chainId,
        chainName,
        contractAddress,
        configured: true,
        reason: `${chainName} has no REST endpoint in the catalog, so the crosschain-swaps contract cannot be checked.`,
      });
    } else {
      try {
        await lcd.getJson(
          `/cosmwasm/wasm/v1/contract/${encodeURIComponent(contractAddress)}`,
          { cacheTtlMs: VERIFY_TTL_MS, timeoutMs: 8_000 },
        );
        const endpoint = routerEndpoint();
        value = {
          available: true,
          chainId,
          chainName,
          contractAddress,
          configured: true,
          verified: true,
          reason: null,
          configKey: XCS_CONTRACT_KEY,
          routerConfigured: endpoint !== null,
          routerEndpoint: endpoint,
          defaultSlippagePercent: DEFAULT_SLIPPAGE_PERCENT,
        };
      } catch (error) {
        const notFound =
          isInterchainError(error) &&
          (error.httpStatus === 404 || error.httpStatus === 400);
        value = unavailable({
          chainId,
          chainName,
          contractAddress,
          configured: true,
          reason: notFound
            ? `${XCS_CONTRACT_KEY} is set to ${contractAddress}, but ${chainName} has no contract at that address. Cross-chain swap stays off rather than send funds to it.`
            : `Could not reach ${chainName} to confirm the crosschain-swaps contract exists. Cross-chain swap stays off until that check succeeds.`,
        });
      }
    }
  }

  cached = { at: now, value };
  return value;
}

/** Drop the memoised answer, so the next call re-reads the environment. */
export function resetSwapVenueCache(): void {
  cached = null;
}
