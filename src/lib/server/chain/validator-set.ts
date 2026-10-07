/**
 * A chain's validator set (B2 in the research report): every bonded
 * validator, paginated to the end of the list, joined with its signing info
 * through the consensus address, ranked and summarised.
 *
 * Signing infos are keyed by consensus address while validators publish
 * only their consensus public key, so the join derives the 20 address bytes
 * from the key (`@/lib/chain/valcons`) and matches them byte for byte — not
 * by bech32 string, because some chains use their own consensus prefix
 * (Crypto.org's `crocnclcons`). A validator whose key type we cannot derive
 * keeps `uptime: null` — never a made-up 100 %.
 *
 * Cache: validator lists 10 min, signing infos 5 min, parameters 60 min.
 */

import "server-only";
import type { ServerChainEntry } from "@/lib/server/chains";
import { parseSlashingParams, parseStakingParams } from "@/lib/chain/params";
import type { PartError, ValidatorLite, ValidatorRow } from "@/lib/chain/types";
import {
  buildValidatorRows,
  parseSigningInfo,
  parseValidator,
  signingIndex,
  summariseValidators,
  type RawSigningInfo,
  type RawValidator,
  type SigningIndex,
} from "@/lib/chain/validators";
import { consensusPrefixFor, valconsAddress } from "@/lib/chain/valcons";
import { pick, ratio } from "@/lib/chain/parse";
import { describeLcdError, describeMiss, lcd, lcdPages, ReadError, type LcdResult } from "./lcd";

const MIN = 60_000;
const LIST_TTL = 10 * MIN;
const SIGNING_TTL = 5 * MIN;
const PARAMS_TTL = 60 * MIN;
/** Rows returned for `status=all`: the bonded set plus the largest inactive ones. */
export const ALL_STATUS_CAP = 300;

export interface ValidatorSet {
  chainId: string;
  /** Bonded first (ranked), then inactive (largest first) when asked for. */
  rows: ValidatorRow[];
  summary: ReturnType<typeof summariseValidators>;
  /** Inactive validators were cut at `ALL_STATUS_CAP`. */
  truncated: boolean;
  errors: PartError[];
  /** Read time of the oldest list. */
  asOf: number;
}

/** Thrown when the bonded list itself is unreadable (nothing to show); the message is user-safe. */
export class ValidatorSetError extends ReadError {
  constructor(message: string) {
    super(message);
    this.name = "ValidatorSetError";
  }
}

function validatorList(chain: ServerChainEntry, status: "BONDED" | "UNBONDING" | "UNBONDED") {
  return lcdPages<RawValidator>(chain, `cosmos/staking/v1beta1/validators?status=BOND_STATUS_${status}`, {
    ttlMs: LIST_TTL,
    timeoutMs: 10_000,
    itemsKey: "validators",
    // 200 a page: the Hub's 180 fit in one; capped nodes still page through.
    limit: 200,
    maxPages: 6,
    item: parseValidator,
    name: "validators",
  });
}

function signingInfos(chain: ServerChainEntry) {
  return lcdPages<RawSigningInfo>(chain, "cosmos/slashing/v1beta1/signing_infos", {
    ttlMs: SIGNING_TTL,
    timeoutMs: 10_000,
    itemsKey: "info",
    limit: 500,
    maxPages: 6,
    item: parseSigningInfo,
    name: "signing",
  });
}

async function settle<T>(read: Promise<LcdResult<T>>): Promise<{ data: T | null; at: number | null; error: string | null }> {
  try {
    const result = await read;
    if (result.ok) return { data: result.data, at: result.at, error: null };
    return { data: null, at: result.at, error: describeMiss(result.miss) };
  } catch (error) {
    return { data: null, at: null, error: describeLcdError(error) };
  }
}

/**
 * Reads, joins and ranks the set. Rejects with `ValidatorSetError` only when
 * the bonded list is unreadable; other failures are listed in `errors`.
 */
export async function readValidatorSet(
  chain: ServerChainEntry,
  options: { status: "bonded" | "all"; chainApr: number | null; withSigning?: boolean },
): Promise<ValidatorSet> {
  const id = chain.chainId;
  const withSigning = options.withSigning ?? true;
  const [bonded, unbonding, unbonded, infos, slashingParams, stakingParams] = await Promise.all([
    settle(validatorList(chain, "BONDED")),
    options.status === "all" ? settle(validatorList(chain, "UNBONDING")) : null,
    options.status === "all" ? settle(validatorList(chain, "UNBONDED")) : null,
    withSigning ? settle(signingInfos(chain)) : null,
    settle(lcd(chain, "cosmos/slashing/v1beta1/params", { ttlMs: PARAMS_TTL })),
    settle(lcd(chain, "cosmos/staking/v1beta1/params", { ttlMs: PARAMS_TTL })),
  ]);
  if (!bonded.data) {
    throw new ValidatorSetError(bonded.error ?? "Validator list unreadable");
  }

  const errors: PartError[] = [];
  const note = (scope: string, part: { error: string | null } | null) => {
    if (part?.error) errors.push({ chainId: id, scope, message: part.error });
  };
  note("validators:unbonding", unbonding);
  note("validators:unbonded", unbonded);
  note("signing-infos", infos);
  note("slashing-params", slashingParams);
  note("staking-params", stakingParams);
  if (bonded.data.truncated) {
    errors.push({ chainId: id, scope: "validators", message: "Validator list longer than expected; shown partially" });
  }
  if (bonded.data.dropped > 0) {
    // Their stake is still in the pool, so shares here are of a slightly
    // smaller total than the chain's; say so rather than look complete.
    errors.push({
      chainId: id,
      scope: "validators",
      message: `${bonded.data.dropped} bonded validator(s) had unreadable fields and are not listed; shares exclude them`,
    });
  }
  if (infos?.data?.truncated) {
    errors.push({ chainId: id, scope: "signing-infos", message: "Signing info list longer than expected; some uptimes unknown" });
  }

  const window = slashingParams.data ? (parseSlashingParams(slashingParams.data)?.signedBlocksWindow ?? null) : null;
  const maxValidators = stakingParams.data ? (parseStakingParams(stakingParams.data)?.maxValidators ?? null) : null;
  const signing: SigningIndex | null = infos?.data ? signingIndex(infos.data.items) : null;

  const inactiveRaw: RawValidator[] = [...(unbonding?.data?.items ?? []), ...(unbonded?.data?.items ?? [])];
  const all = buildValidatorRows([...bonded.data.items, ...inactiveRaw], signing, {
    accountPrefix: chain.bech32Prefix,
    window,
    chainApr: options.chainApr,
    now: Date.now(),
  });
  const bondedCount = bonded.data.items.length;
  const cap = Math.max(ALL_STATUS_CAP, bondedCount);
  const rows = all.slice(0, cap);

  const times = [bonded.at, infos?.at ?? null].filter((at): at is number => at !== null);
  return {
    chainId: id,
    rows,
    summary: summariseValidators(rows, {
      maxValidators,
      aprActual: options.chainApr,
      signedBlocksWindow: window,
    }),
    truncated: all.length > rows.length,
    errors,
    asOf: times.length ? Math.min(...times) : Date.now(),
  };
}

/**
 * One validator that is not in the bonded set (jailed, unbonding…), read on
 * its own, with its signing info. Null when the chain does not know it.
 */
export async function readSingleValidator(
  chain: ServerChainEntry,
  operatorAddress: string,
  options: { window: number | null; chainApr: number | null; bondedTokens: string | null },
): Promise<{ row: ValidatorRow | null; errors: PartError[]; missing: boolean }> {
  const errors: PartError[] = [];
  let raw: RawValidator | null = null;
  try {
    const result = await lcd(chain, `cosmos/staking/v1beta1/validators/${encodeURIComponent(operatorAddress)}`, {
      ttlMs: LIST_TTL,
      name: "validator",
      map: (body) => parseValidator(pick(body, ["validator"])),
    });
    if (!result.ok) {
      errors.push({ chainId: chain.chainId, scope: "validator", message: describeMiss(result.miss) });
      return { row: null, errors, missing: true };
    }
    raw = result.data;
  } catch (error) {
    errors.push({ chainId: chain.chainId, scope: "validator", message: describeLcdError(error) });
    return { row: null, errors, missing: false };
  }
  if (!raw) return { row: null, errors, missing: true };

  let signing: SigningIndex | null = null;
  const consensus = valconsAddress(
    raw.consensusPubkey,
    chain.bech32Prefix,
    consensusPrefixFor(raw.operatorAddress, chain.bech32Prefix),
  );
  if (consensus) {
    const info = await settle(
      lcd(chain, `cosmos/slashing/v1beta1/signing_infos/${encodeURIComponent(consensus)}`, {
        ttlMs: SIGNING_TTL,
        name: "signing-one",
        map: (body) => parseSigningInfo(pick(body, ["val_signing_info"])),
      }),
    );
    if (info.data) signing = signingIndex([info.data]);
    else if (info.error) errors.push({ chainId: chain.chainId, scope: "signing-info", message: info.error });
  }
  const [built] = buildValidatorRows([raw], signing, {
    accountPrefix: chain.bech32Prefix,
    window: options.window,
    chainApr: options.chainApr,
    now: Date.now(),
  });
  if (!built) return { row: null, errors, missing: true };
  if (built.status !== "bonded") return { row: built, errors, missing: false };
  // Bonded but missing from the cached list (it just joined): alone in the
  // input it would look like 100 % of the set. Its share comes from the pool
  // instead, and its rank stays unknown until the list refreshes.
  const share = ratio(built.tokens, options.bondedTokens);
  return {
    row: { ...built, rank: null, votingPower: share ?? 0, cumulative: null, inNakamotoSet: false },
    errors,
    missing: false,
  };
}

/** The staking-row view of a validator. */
export function liteOf(row: ValidatorRow): ValidatorLite {
  return {
    operatorAddress: row.operatorAddress,
    moniker: row.moniker,
    ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
    status: row.status,
    jailed: row.jailed,
    tombstoned: row.tombstoned,
    commissionRate: row.commission.rate,
    commissionMaxRate: row.commission.maxRate,
    commissionReachable30d: row.commission.reachable30d,
    uptime: row.uptime,
    rank: row.rank,
    votingPower: row.votingPower,
    inNakamotoSet: row.inNakamotoSet,
    apr: row.apr,
  };
}

/** A validator we could not read: the address and nothing invented. */
export function unknownLite(operatorAddress: string): ValidatorLite {
  return {
    operatorAddress,
    moniker: operatorAddress,
    status: null,
    jailed: null,
    tombstoned: null,
    commissionRate: null,
    commissionMaxRate: null,
    commissionReachable30d: null,
    uptime: null,
    rank: null,
    votingPower: null,
    inNakamotoSet: null,
    apr: null,
  };
}
