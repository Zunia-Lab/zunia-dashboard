/**
 * One chain's staking economics, read from its LCD (B1 in the research
 * report): pool, supply, mint, distribution, slashing and gov parameters, and
 * the observed block time, turned into naive vs actual APR, issuance and real
 * yield by `computeEconomics` (`@/lib/chain/apr`).
 *
 * Mint adapters, tried in order:
 *
 * 1. standard x/mint (`annual_provisions`, `inflation`, `params`) — most
 *    chains, Celestia included (its params are not exposed, its provisions
 *    are, its rate is `inflation_rate`, and its issuance is time based so no
 *    block-time correction applies). Refused when the mint denom is not the
 *    bond denom;
 * 2. Osmosis epochs (`osmosis/mint/v1beta1/epoch_provisions`);
 * 3. cosmos.directory's computed APR, labelled as such, when the chain's own
 *    endpoint exposes neither (dYdX, Stride, Kava's kavamint…).
 *
 * A transient failure (timeout) never falls through to the next adapter: the
 * figure is reported missing with the reason, and the next request retries.
 *
 * Cache lifetimes (via `lcd()`): parameters 60 min, pool / supply /
 * provisions 15–30 min, observed block time 60 min, latest block 60 s.
 */

import "server-only";
import { cached } from "@/lib/server/cache";
import type { ServerChainEntry } from "@/lib/server/chains";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import {
  BLOCK_TIME_WINDOW,
  computeEconomics,
  type BlockTimeSample,
  type EconomicsResult,
  type MintInputs,
} from "@/lib/chain/apr";
import {
  parseAnnualProvisions,
  parseBlockHeader,
  parseCommunityTax,
  parseDirectoryChain,
  parseEpochProvisions,
  parseEpochSeconds,
  parseGovSections,
  parseGovV1Params,
  parseInflation,
  parseMintParams,
  parseNodeStatus,
  parseOsmosisMintParams,
  parsePool,
  parseSlashingParams,
  parseStakingParams,
  parseSupplyAmount,
  type BlockRef,
  type MintParams,
  type StakingParams,
} from "@/lib/chain/params";
import type { GovParams, PartError, SlashingParams } from "@/lib/chain/types";
import { describeLcdError, describeMiss, lcd, ReadError, restBase, type LcdResult } from "./lcd";

const MIN = 60_000;
const PARAMS_TTL = 60 * MIN;
const DYNAMIC_TTL = 15 * MIN;
const PROVISIONS_TTL = 30 * MIN;

export interface ChainEconomics {
  chainId: string;
  bondDenom: string;
  symbol: string;
  decimals: number | null;
  staking: StakingParams | null;
  bonded: string | null;
  notBonded: string | null;
  totalSupply: string | null;
  communityTax: number | null;
  slashing: SlashingParams | null;
  gov: GovParams | null;
  mintParams: MintParams | null;
  latest: BlockRef | null;
  sample: BlockTimeSample | null;
  result: EconomicsResult;
  errors: PartError[];
  /** Read time of the oldest live figure (pool, supply, provisions, latest block). */
  asOf: number;
}

/** Display facts for the staking denom, from the catalog. */
export function denomFacts(
  chain: ServerChainEntry,
  bondDenom: string,
): { symbol: string; decimals: number | null } {
  if (bondDenom === chain.coinMinimalDenom) {
    return { symbol: chain.coinDenom, decimals: chain.coinDecimals };
  }
  const currency = chain.currencies?.find((c) => c.coinMinimalDenom === bondDenom);
  if (currency) return { symbol: currency.coinDenom, decimals: currency.coinDecimals };
  // Unknown to the catalog (e.g. a chain staking a separate "ustake" denom):
  // show the denom itself and no decimals rather than guessing six.
  return { symbol: bondDenom, decimals: null };
}

type Collector = {
  errors: PartError[];
  times: number[];
};

/** Unwraps an LCD read: data, or null with the miss / failure recorded. */
async function take<T>(
  collector: Collector,
  chainId: string,
  scope: string,
  read: Promise<LcdResult<T>>,
  options: { live?: boolean; missIsError?: boolean } = {},
): Promise<{ data: T | null; miss: boolean; failed: boolean; at: number | null }> {
  try {
    const result = await read;
    if (options.live) collector.times.push(result.at);
    if (result.ok) return { data: result.data, miss: false, failed: false, at: result.at };
    if (options.missIsError !== false) {
      collector.errors.push({ chainId, scope, message: describeMiss(result.miss) });
    }
    return { data: null, miss: true, failed: false, at: result.at };
  } catch (error) {
    collector.errors.push({ chainId, scope, message: describeLcdError(error) });
    return { data: null, miss: false, failed: true, at: null };
  }
}

/** gov params: v1 unified, v1 per section (SDK 0.46), then v1beta1. */
export function readGovParams(chain: ServerChainEntry): Promise<GovParams | null> {
  return cached(`econ:gov:${chain.chainId}`, { ttlMs: PARAMS_TTL, errorTtlMs: 30_000 }, async () => {
    const opts = { ttlMs: PARAMS_TTL };
    const tallying = await lcd(chain, "cosmos/gov/v1/params/tallying", opts);
    if (tallying.ok) {
      const unified = parseGovV1Params(tallying.data);
      if (unified) return unified;
      const [voting, deposit] = await Promise.all([
        lcd(chain, "cosmos/gov/v1/params/voting", opts),
        lcd(chain, "cosmos/gov/v1/params/deposit", opts),
      ]);
      return parseGovSections(
        tallying.data,
        voting.ok ? voting.data : null,
        deposit.ok ? deposit.data : null,
        "v1",
      );
    }
    const [legacyTally, legacyVoting, legacyDeposit] = await Promise.all([
      lcd(chain, "cosmos/gov/v1beta1/params/tallying", opts),
      lcd(chain, "cosmos/gov/v1beta1/params/voting", opts),
      lcd(chain, "cosmos/gov/v1beta1/params/deposit", opts),
    ]);
    if (!legacyTally.ok) return null;
    return parseGovSections(
      legacyTally.data,
      legacyVoting.ok ? legacyVoting.data : null,
      legacyDeposit.ok ? legacyDeposit.data : null,
      "v1beta1",
    );
  });
}

/**
 * Latest height and time: the tiny node-status route (SDK ≥ 0.50) first, the
 * block route (30–120 KB) on older SDKs. Both reads are cached for a minute
 * with a short stale window, so "latest" is never more than ~90 s old.
 */
export async function readLatestBlock(chain: ServerChainEntry): Promise<LcdResult<BlockRef>> {
  const options = { ttlMs: MIN, staleMs: 30_000 };
  const status = await lcd(chain, "cosmos/base/node/v1beta1/status", {
    ...options,
    name: "status",
    map: parseNodeStatus,
  });
  if (status.ok && status.data) return { ok: true, data: status.data, at: status.at };
  const block = await lcd(chain, "cosmos/base/tendermint/v1beta1/blocks/latest", {
    ...options,
    name: "header",
    map: parseBlockHeader,
  });
  if (block.ok && block.data) return { ok: true, data: block.data, at: block.at };
  if (!block.ok) return block;
  return { ok: false, miss: "rejected", status: 200, at: block.at };
}

/**
 * Two blocks `BLOCK_TIME_WINDOW` apart (1,000 when the node has pruned
 * further back), read once an hour: block time drifts slowly.
 */
function readBlockSample(chain: ServerChainEntry): Promise<BlockTimeSample> {
  return cached(
    `econ:blocksample:${chain.chainId}`,
    { ttlMs: PARAMS_TTL, errorTtlMs: 5 * MIN },
    async () => {
      const base = restBase(chain);
      const latest = await readLatestBlock(chain);
      if (!latest.ok) throw new ReadError("Latest block unavailable");
      for (const back of [BLOCK_TIME_WINDOW, 1_000]) {
        const height = latest.data.height - back;
        if (height < 1) continue;
        try {
          const body = await fetchJson<unknown>(
            `${base}/cosmos/base/tendermint/v1beta1/blocks/${height}`,
            { timeoutMs: 8_000 },
          );
          const earlier = parseBlockHeader(body);
          if (earlier) return { latest: latest.data, earlier };
        } catch {
          // Pruned or slow: try a shorter window.
        }
      }
      throw new ReadError("Could not read an earlier block to time blocks against (pruned or slow node)");
    },
  );
}

/** Total supply of `denom`: the query-param route first, the path route on old SDKs. */
async function readSupply(chain: ServerChainEntry, denom: string): Promise<LcdResult<string | null>> {
  const byDenom = await lcd(chain, `cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`, {
    ttlMs: PROVISIONS_TTL,
    name: "supply",
    map: parseSupplyAmount,
  });
  if (byDenom.ok || denom.includes("/")) return byDenom;
  return lcd(chain, `cosmos/bank/v1beta1/supply/${encodeURIComponent(denom)}`, {
    ttlMs: PROVISIONS_TTL,
    name: "supply",
    map: parseSupplyAmount,
  });
}

async function readDirectory(chain: ServerChainEntry) {
  const slug = chain.registrySlug;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
  return cached(`econ:directory:${chain.chainId}`, { ttlMs: PARAMS_TTL, errorTtlMs: 5 * MIN }, async () => {
    try {
      return parseDirectoryChain(
        await fetchJson<unknown>(`https://chains.cosmos.directory/${encodeURIComponent(slug)}`, {
          timeoutMs: 8_000,
        }),
      );
    } catch (error) {
      // Not listed there: no fallback, which is an answer, not a failure.
      if (error instanceof UpstreamError && error.kind === "http" && error.status === 404) return null;
      throw error;
    }
  });
}

/** Picks the mint adapter (see the module comment) and reads its inputs. */
async function readMint(
  chain: ServerChainEntry,
  collector: Collector,
): Promise<{ mint: MintInputs; params: MintParams | null }> {
  const id = chain.chainId;
  const [provisions, inflation, params] = await Promise.all([
    take(collector, id, "mint", lcd(chain, "cosmos/mint/v1beta1/annual_provisions", { ttlMs: PROVISIONS_TTL }), {
      live: true,
      missIsError: false,
    }),
    take(collector, id, "mint", lcd(chain, "cosmos/mint/v1beta1/inflation", { ttlMs: PROVISIONS_TTL }), {
      missIsError: false,
    }),
    take(collector, id, "mint", lcd(chain, "cosmos/mint/v1beta1/params", { ttlMs: PARAMS_TTL }), {
      missIsError: false,
    }),
  ]);
  const mintParams = params.data === null ? null : parseMintParams(params.data);
  if (provisions.failed) {
    return { mint: { kind: "none", reason: "Mint unreadable right now" }, params: mintParams };
  }
  const annual = provisions.data === null ? null : parseAnnualProvisions(provisions.data);
  if (annual !== null && annual > 0) {
    let rate = inflation.data === null ? null : parseInflation(inflation.data);
    if (rate === null && inflation.miss) {
      // Celestia's time-based mint publishes its rate under another name.
      const named = await take(
        collector,
        id,
        "mint",
        lcd(chain, "cosmos/mint/v1beta1/inflation_rate", { ttlMs: PROVISIONS_TTL }),
        { missIsError: false },
      );
      rate = named.data === null ? null : parseInflation(named.data);
    }
    return {
      mint: {
        kind: "standard",
        annualProvisions: annual,
        inflation: rate,
        blocksPerYear: mintParams?.blocksPerYear ?? null,
        paramsUnreadable: params.failed,
      },
      params: mintParams,
    };
  }

  // No standard provisions (route missing, or a mint that issues nothing):
  // try the Osmosis epoch mint.
  const epoch = await take(
    collector,
    id,
    "mint",
    lcd(chain, "osmosis/mint/v1beta1/epoch_provisions", { ttlMs: PROVISIONS_TTL }),
    { live: true, missIsError: false },
  );
  if (epoch.failed) {
    return { mint: { kind: "none", reason: "Mint unreadable right now" }, params: mintParams };
  }
  const epochProvisions = epoch.data === null ? null : parseEpochProvisions(epoch.data);
  if (epochProvisions !== null && epochProvisions > 0) {
    const [osmoParams, epochs] = await Promise.all([
      take(collector, id, "mint", lcd(chain, "osmosis/mint/v1beta1/params", { ttlMs: PARAMS_TTL })),
      take(collector, id, "mint", lcd(chain, "osmosis/epochs/v1beta1/epochs", { ttlMs: PARAMS_TTL }), {
        missIsError: false,
      }),
    ]);
    const parsed = osmoParams.data === null ? null : parseOsmosisMintParams(osmoParams.data);
    const identifier = parsed?.epochIdentifier ?? null;
    return {
      mint: {
        kind: "osmosis",
        epochProvisions,
        epochSeconds: identifier ? parseEpochSeconds(epochs.data, identifier) : null,
        stakingProportion: parsed?.stakingProportion ?? null,
      },
      params: mintParams,
    };
  }

  // Neither mint is readable on the chain's endpoint: third-party fallback.
  try {
    const directory = await readDirectory(chain);
    if (directory) return { mint: { kind: "directory", directory }, params: mintParams };
  } catch (error) {
    collector.errors.push({ chainId: id, scope: "cosmos.directory", message: describeLcdError(error) });
  }
  return {
    mint: {
      kind: "none",
      reason: "This chain exposes no mint data on its public endpoint, so its APR cannot be computed",
    },
    params: mintParams,
  };
}

/** Reads and computes one chain's economics. Never rejects: failures are listed in `errors`. */
export async function readEconomics(chain: ServerChainEntry): Promise<ChainEconomics> {
  const id = chain.chainId;
  const collector: Collector = { errors: [], times: [] };
  const guessDenom = chain.coinMinimalDenom;

  const [staking, pool, tax, slashing, gov, guessedSupply, mint, latest, sample] = await Promise.all([
    take(collector, id, "staking-params", lcd(chain, "cosmos/staking/v1beta1/params", { ttlMs: PARAMS_TTL })),
    take(collector, id, "pool", lcd(chain, "cosmos/staking/v1beta1/pool", { ttlMs: DYNAMIC_TTL }), { live: true }),
    take(collector, id, "distribution-params", lcd(chain, "cosmos/distribution/v1beta1/params", { ttlMs: PARAMS_TTL })),
    take(collector, id, "slashing-params", lcd(chain, "cosmos/slashing/v1beta1/params", { ttlMs: PARAMS_TTL })),
    readGovParams(chain).catch((error: unknown) => {
      collector.errors.push({ chainId: id, scope: "gov-params", message: describeLcdError(error) });
      return null;
    }),
    take(collector, id, "supply", readSupply(chain, guessDenom), { live: true }),
    readMint(chain, collector),
    take(collector, id, "latest-block", readLatestBlock(chain), { live: true }),
    readBlockSample(chain).catch((error: unknown) => {
      collector.errors.push({ chainId: id, scope: "block-time", message: describeLcdError(error) });
      return null;
    }),
  ]);

  const stakingParams = staking.data === null ? null : parseStakingParams(staking.data);
  const bondDenom = stakingParams?.bondDenom ?? guessDenom;
  let totalSupply = guessedSupply.data;
  if (bondDenom !== guessDenom) {
    // The staking denom is not the catalog's main coin (e.g. "ustake").
    const actual = await take(collector, id, "supply", readSupply(chain, bondDenom), { live: true });
    totalSupply = actual.data;
  }
  const parsedPool = pool.data === null ? null : parsePool(pool.data);
  const communityTax = tax.data === null ? null : parseCommunityTax(tax.data);
  const now = Date.now();

  // annual_provisions is counted in the mint denom; dividing it by bonded
  // tokens of another denom would be a ratio of two different assets.
  let mintInputs = mint.mint;
  const mintDenom = mint.params?.mintDenom ?? null;
  if (mintInputs.kind === "standard" && mintDenom && stakingParams?.bondDenom && mintDenom !== stakingParams.bondDenom) {
    mintInputs = {
      kind: "none",
      reason: `The mint issues ${mintDenom}, not the staking token ${stakingParams.bondDenom}, so no staking APR can be derived from it`,
    };
  }

  const result = computeEconomics({
    now,
    bonded: parsedPool?.bonded ?? null,
    totalSupply,
    communityTax,
    mint: mintInputs,
    latest: latest.data,
    latestReadAt: latest.at,
    sample,
  });

  const { symbol, decimals } = denomFacts(chain, bondDenom);
  return {
    chainId: id,
    bondDenom,
    symbol,
    decimals,
    staking: stakingParams,
    bonded: parsedPool?.bonded ?? null,
    notBonded: parsedPool?.notBonded ?? null,
    totalSupply,
    communityTax,
    slashing: slashing.data === null ? null : parseSlashingParams(slashing.data),
    gov,
    mintParams: mint.params,
    latest: latest.data,
    sample,
    result,
    errors: collector.errors,
    asOf: collector.times.length ? Math.min(...collector.times) : now,
  };
}
