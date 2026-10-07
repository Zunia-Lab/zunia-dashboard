/**
 * The CosmWasm capability gate, as a pure decision.
 *
 * Separated from `lib/server/nft.ts` for two reasons. It is the single most
 * consequential branch in this feature — it decides whether a chain gets a
 * grid, a "this chain cannot hold NFTs" sentence, or a "nobody checked" one —
 * and a module carrying `import "server-only"` cannot be unit-tested, because
 * `server-only` is an alias Next supplies at build time and does not resolve
 * under the test runner. So the I/O (the registry lookup, the endpoint check,
 * the live probe) stays there and the judgement lives here.
 *
 * The three statuses are not interchangeable and none of them may be inferred
 * from another:
 *
 * - `supported`   — go ahead.
 * - `unsupported` — the registry has a feature list for this chain and
 *                   `cosmwasm` is not in it. There are no CW721 contracts here,
 *                   so an empty grid would say "you own nothing" about a chain
 *                   where nothing is ownable.
 * - `unverified`  — this build does not know: the chain's registry entry has no
 *                   `features[]` list at all (a few catalog chains, Sei among
 *                   them), or the chain is not in the catalog. Rendering it as
 *                   either of the other two would be a claim nobody made.
 *
 * Every `reason` and `note` is shown on the NFT pages as it is, so they are
 * written for the person holding the wallet: what is known about the chain
 * and what Zunia did about it. How a deployment changes that (the
 * `ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES` override, the catalog generator) is
 * operator documentation, kept in `lib/server/nft-config.ts`, never page copy.
 */

import { featureSupport, type ChainInfoLike } from "@zunialab/interchain";

/** How this build knows what it claims about a chain's CosmWasm support. */
export type NftSupportBasis =
  /** The registry entry lists `cosmwasm`. The only answer we did not have to work for. */
  | "registry-declared"
  /** The registry entry has a feature list and `cosmwasm` is not in it. */
  | "registry-denied"
  /** No feature list at all, and no operator override. Nobody has said either way. */
  | "catalog-missing"
  /** No feature list, override set, and the chain answered a wasm query. */
  | "chain-probe"
  /** No feature list, override set, and the probe did not answer. */
  | "probe-failed"
  /** The catalog has no REST endpoint, so nothing can be read at all. */
  | "no-endpoint";

export interface NftChainSupport {
  readonly chainId: string;
  readonly chainName: string;
  readonly status: "supported" | "unsupported" | "unverified";
  readonly basis: NftSupportBasis;
  /** Present whenever `status` is not `supported`. The sentence a control shows. */
  readonly reason: string | null;
  /** Present when support rests on something weaker than the registry. */
  readonly note: string | null;
  /** The registry entry carries a features list (most catalog chains; see `unverified` above). */
  readonly featuresDeclared: boolean;
  readonly allowUnknownFeatures: boolean;
}

/** The result of asking a chain whether it serves `x/wasm`. */
export interface WasmProbeResult {
  /** True only for a positive answer. A refusal is never read as "no wasm". */
  readonly ok: boolean;
  /** One sentence, already user-facing. */
  readonly detail: string;
}

export interface NftSupportInputs {
  readonly chainId: string;
  /** The catalog row, or undefined when the chain is not in this build. */
  readonly chain: ChainInfoLike | undefined;
  readonly allowUnknownFeatures: boolean;
  /** Whether the catalog carries a REST endpoint for this chain. */
  readonly hasEndpoint: boolean;
  /**
   * The live probe, or `null` when none was run.
   *
   * A probe is only ever run when the registry said nothing *and* the operator
   * set the override — so a `null` here with an unknown feature list is the
   * ordinary, un-overridden case, not a missing check.
   */
  readonly probe: WasmProbeResult | null;
}

/**
 * Why nothing is known, for a chain whose registry entry lists no features.
 * The pages put it under "Zunia cannot tell whether this network runs
 * CosmWasm", so it gives the cause rather than repeating that.
 */
function noFeaturesList(chainName: string): string {
  return `The chain registry lists no features for ${chainName}, so nothing says whether it runs CosmWasm, which CW721 NFTs need.`;
}

export function decideNftSupport(inputs: NftSupportInputs): NftChainSupport {
  const { chainId, chain, allowUnknownFeatures } = inputs;
  const chainName = chain?.chainName ?? chainId;
  const base = { chainId, chainName, allowUnknownFeatures } as const;

  if (!chain) {
    return {
      ...base,
      status: "unverified",
      basis: "catalog-missing",
      reason: `${chainId} is not in this build's chain catalog, so nothing is known about it.`,
      note: null,
      featuresDeclared: false,
    };
  }

  const declared = featureSupport(chain, "cosmwasm");

  if (declared === "yes") {
    return {
      ...base,
      status: "supported",
      basis: "registry-declared",
      reason: null,
      note: null,
      featuresDeclared: true,
    };
  }

  if (declared === "no") {
    return {
      ...base,
      status: "unsupported",
      basis: "registry-denied",
      reason: `${chainName} does not declare the "cosmwasm" feature in the chain registry, so it runs no CW721 contracts and there are no NFTs to hold here. This is not an empty wallet — it is a chain without the module.`,
      note: null,
      featuresDeclared: true,
    };
  }

  // From here on the registry said nothing.
  if (!allowUnknownFeatures) {
    return {
      ...base,
      status: "unverified",
      basis: "catalog-missing",
      // The pages follow it with "Nothing was asked, so nothing here is a
      // claim…": the cause is all this needs to say.
      reason: noFeaturesList(chainName),
      note: null,
      featuresDeclared: false,
    };
  }

  if (!inputs.hasEndpoint) {
    return {
      ...base,
      status: "unverified",
      basis: "no-endpoint",
      reason: `${chainName} has no REST endpoint in this build's catalog, so its CosmWasm support cannot be checked and no contract can be queried.`,
      note: null,
      featuresDeclared: false,
    };
  }

  if (inputs.probe?.ok === true) {
    return {
      ...base,
      status: "supported",
      basis: "chain-probe",
      reason: null,
      // Said out loud, because this is a weaker claim than the registry's and
      // the user should know which one they are looking at.
      note: `${inputs.probe.detail} The chain registry lists no features for ${chainName}, so this answer came from the chain itself.`,
      featuresDeclared: false,
    };
  }

  return {
    ...base,
    status: "unverified",
    basis: "probe-failed",
    reason: `${noFeaturesList(chainName)} ${
      inputs.probe?.detail ?? `${chainName} was not asked, so nothing was checked.`
    }`,
    note: null,
    featuresDeclared: false,
  };
}
