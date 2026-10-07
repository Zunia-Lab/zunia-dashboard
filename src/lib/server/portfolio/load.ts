/**
 * The portfolio read: chain holdings → identities → prices → the answer.
 *
 * Shared by `/api/portfolio` and `/api/portfolio/history` (which needs the
 * same holdings to weight its curve), so both see one set of numbers.
 *
 * Time budgets: every upstream read has its own timeout, but a slow public
 * node can chain ten bank pages and a few retries into minutes, past what
 * nginx and Cloudflare wait for. A chain that has not answered within
 * {@link CHAIN_BUDGET_MS} is reported as unreachable for this answer, and
 * token names that need an LCD trace wait at most {@link IDENTITY_BUDGET_MS}
 * (the tables still name everything they know). In both cases the reads keep
 * running and fill their caches, so the next request has them.
 *
 * The two phases are pipelined per chain: a chain's denoms are named as soon
 * as its holdings arrive, so the budgets overlap instead of adding up.
 */

import "server-only";

import { describeUpstreamError, mapLimit } from "@/lib/server/http";
import { within } from "@/lib/server/prices/deadline";
import { getSpotPrices, type SpotResult } from "@/lib/server/prices/spot";
import { chainTicker, identifyDenom, identifyHeldDenoms, toTokenIdentity } from "@/lib/token/identity";
import type { FiatCurrency, TokenIdentity } from "@/lib/token/types";
import type { PortfolioResponse } from "@/lib/token/wire";
import type { PortfolioAccount } from "./accounts";
import { buildPortfolio, type ChainHoldings, type ChainInput } from "./aggregate";
import { readChainHoldings } from "./read";

/** Chains read at once; each chain's own host is capped separately by fetchJson. */
const CHAIN_CONCURRENCY = 8;
/** How long one chain's holdings may take before the answer goes without them. */
const CHAIN_BUDGET_MS = 20_000;
/** How long trace lookups of vouchers the tables do not know may hold the answer. */
const IDENTITY_BUDGET_MS = 8_000;

export interface LoadedPortfolio {
  response: PortfolioResponse;
  spot: SpotResult;
  /** Identity of every held denom, by `${chainId}\n${denom}`. */
  identities: Map<string, TokenIdentity>;
}

function denomsOf(holdings: ChainHoldings): string[] {
  return [
    ...new Set([...holdings.liquid, ...holdings.staked, ...holdings.rewards, ...holdings.unbonding].map((c) => c.denom)),
  ];
}

export async function loadPortfolio(
  accounts: readonly PortfolioAccount[],
  currency: FiatCurrency,
): Promise<LoadedPortfolio> {
  const identities = new Map<string, TokenIdentity>();

  /**
   * Name one chain's held denoms. Started the moment that chain's holdings
   * arrive rather than after every chain's have: with a barrier between the
   * two phases, the Hub's voucher traces (its slowest step) waited for the
   * slowest chain's bank read first, and the cold answer paid both in series.
   * Runs outside the holdings pool, so a slow trace never holds a chain slot.
   */
  const identify = async (chainId: string, holdings: ChainHoldings): Promise<void> => {
    const denoms = denomsOf(holdings);
    const named = (denom: string) => identities.set(`${chainId}\n${denom}`, identifyDenom(chainId, denom));
    try {
      const traced = await within(identifyHeldDenoms(chainId, denoms), IDENTITY_BUDGET_MS);
      if (!traced.done) {
        // Trace lookups only add names; the tables still answer without them.
        for (const denom of denoms) named(denom);
        return;
      }
      for (const [denom, identity] of traced.value) identities.set(`${chainId}\n${denom}`, toTokenIdentity(identity));
    } catch {
      for (const denom of denoms) named(denom);
    }
  };

  const naming: Promise<void>[] = [];
  const chains = await mapLimit(accounts, CHAIN_CONCURRENCY, async ({ chain, address }): Promise<ChainInput> => {
    const base = {
      chainId: chain.chainId,
      chainName: chain.chainName,
      iconUrl: chain.iconUrl ?? null,
      nativeSymbol: chainTicker(chain.chainId) ?? chain.coinDenom,
      address,
    };
    try {
      const read = await within(readChainHoldings(chain.chainId, address, chain.coinMinimalDenom), CHAIN_BUDGET_MS);
      if (!read.done) return { ...base, holdings: null, error: `${chain.chainName} did not answer in time` };
      naming.push(identify(chain.chainId, read.value));
      return { ...base, holdings: read.value };
    } catch (error) {
      return { ...base, holdings: null, error: describeUpstreamError(error) };
    }
  });
  await Promise.all(naming);

  const spot = await getSpotPrices([...identities.values()], currency);
  const response = buildPortfolio({
    currency: spot.currency,
    ...(spot.currencyFallback ? { currencyFallback: spot.currencyFallback } : {}),
    chains,
    identify: (chainId, denom) => identities.get(`${chainId}\n${denom}`) ?? identifyDenom(chainId, denom),
    prices: spot.prices,
    unpriced: spot.unpriced,
    errors: spot.errors,
    now: Date.now(),
  });
  return { response, spot, identities };
}
