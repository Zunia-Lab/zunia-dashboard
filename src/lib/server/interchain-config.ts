/**
 * Deployment configuration for the crosschain-swap path.
 *
 * Pure environment reading, with no chain access, so it can be imported from
 * anywhere on the server without pulling the engine in. The on-chain check that
 * decides whether the feature is actually offered lives in `swap-venue.ts`.
 *
 * The crosschain-swaps contract address is NOT a constant and never will be.
 * The addresses circulating in Osmosis governance threads are unverified, a new
 * deployment replaces them, and a wrong address in an ibc-hooks memo sends funds
 * to a contract that will not send them back. So it comes from the environment,
 * it is checked against the chain before use, and the whole feature fails
 * closed — with the missing key named — when either half is absent.
 *
 * Env vars, all optional; the feature is simply off without the first:
 *
 * | Key | Meaning |
 * |-----|---------|
 * | `ZUNIA_XCS_CONTRACT`      | crosschain-swaps contract address |
 * | `ZUNIA_XCS_CHAIN_ID`      | chain it runs on (default `osmosis-1`) |
 * | `ZUNIA_OSMOSIS_ROUTER`    | SQS router base URL used for quoting |
 * | `ZUNIA_PFM_CHAINS`        | comma-separated chain ids known to run PFM |
 * | `ZUNIA_IBC_HOOKS_CHAINS`  | comma-separated chain ids known to run ibc-hooks |
 */

import "server-only";
import { OSMOSIS_ROUTER_ENDPOINTS } from "@zunialab/interchain";

export const XCS_CONTRACT_KEY = "ZUNIA_XCS_CONTRACT";
export const XCS_CHAIN_KEY = "ZUNIA_XCS_CHAIN_ID";
export const ROUTER_KEY = "ZUNIA_OSMOSIS_ROUTER";

function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The configured contract address, or `null` when the key is unset. */
export function xcsContractAddress(): string | null {
  return process.env[XCS_CONTRACT_KEY]?.trim() || null;
}

/** Chain the crosschain-swaps contract runs on. */
export function xcsChainId(): string {
  return process.env[XCS_CHAIN_KEY]?.trim() || "osmosis-1";
}

/**
 * Base URL of the router used for quoting.
 *
 * Falls back to the venue's own published router, which the engine ships as
 * `OSMOSIS_ROUTER_ENDPOINTS`. This is a read made from the server, so no
 * visitor IP reaches it; the alternative is LCD-only quoting, which needs a
 * candidate pool list the chain cannot produce, and would leave every quote
 * permanently unavailable.
 */
export function routerEndpoint(): string | null {
  const configured = process.env[ROUTER_KEY]?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return OSMOSIS_ROUTER_ENDPOINTS[0] ?? null;
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
