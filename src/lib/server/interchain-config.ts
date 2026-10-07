/**
 * Deployment configuration for the IBC engine and the crosschain-swap venue.
 *
 * Pure environment reading, with no chain access, so it can be imported from
 * anywhere on the server without pulling the engine in. The on-chain check
 * that decides whether a crosschain-swaps contract is actually used lives in
 * `swap/venue.ts`; every route that names the contract (the swap engine,
 * `/api/interchain/plan` and `/api/interchain/track`) goes through it.
 *
 * The contract address is never trusted because it is configured: it is
 * checked against the chain (label and reviewed code id) before use, and the
 * contract path fails closed, with a reason, when that check does not pass.
 *
 * Env vars, all optional:
 *
 * | Key | Meaning |
 * |-----|---------|
 * | `ZUNIA_XCS_CONTRACT`      | crosschain-swaps contract override (default: the shipped candidate) |
 * | `ZUNIA_PFM_CHAINS`        | comma-separated chain ids known to run PFM |
 * | `ZUNIA_IBC_HOOKS_CHAINS`  | comma-separated chain ids known to run ibc-hooks |
 *
 * `ZUNIA_XCS_CHAIN_ID` and `ZUNIA_OSMOSIS_ROUTER` fed the retired
 * `/api/interchain/quote` and `/api/interchain/config` routes and are no
 * longer read: the venue is Osmosis (`SWAP_VENUE_CHAIN_ID`) and the swap
 * engine's router endpoints are `SWAP_ROUTER_ENDPOINTS` (src/config/interchain.ts).
 */

import "server-only";

export const XCS_CONTRACT_KEY = "ZUNIA_XCS_CONTRACT";

function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The configured contract address override, or `null` when the key is unset. */
export function xcsContractAddress(): string | null {
  return process.env[XCS_CONTRACT_KEY]?.trim() || null;
}

/**
 * Chains the operator has confirmed run each middleware.
 *
 * The engine's probes are heuristics — `x/ibc-hooks` registers no query service
 * on several releases, so Osmosis itself probes as `unknown` — and a wallet
 * that refuses to plan a swap whenever a probe is inconclusive is a wallet that
 * never plans a swap. Pinned answers are consulted first. Nothing is pinned by
 * default: a hardcoded per-chain list here would be the same mistake as a
 * hardcoded contract address.
 */
export function pinnedModuleSupport(): {
  readonly pfm: readonly string[];
  readonly ibcHooks: readonly string[];
} {
  return {
    pfm: envList("ZUNIA_PFM_CHAINS"),
    ibcHooks: envList("ZUNIA_IBC_HOOKS_CHAINS"),
  };
}
