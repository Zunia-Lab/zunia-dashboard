/**
 * Server-side lookup of one validator, for the page's metadata and its
 * 404, and as the first paint of the profile (search engines and slow
 * networks get the moniker, details and commission in the HTML).
 *
 * One LCD read of `cosmos/staking/v1beta1/validators/<operator>`, through
 * the shared server cache under the same key the validator API route uses,
 * so a page view and the browser's follow-up read cost one upstream call.
 * Bounded: a cold, slow node gives up after a short wait and the page
 * renders anyway (the browser then loads the full profile).
 *
 * `react` `cache` makes `generateMetadata` and the page share one lookup
 * per request.
 */

import "server-only";
import { cache } from "react";
import { pick } from "@/lib/chain/parse";
import { parseValidator, type RawValidator } from "@/lib/chain/validators";
import { findServerChain, type ServerChainEntry } from "@/lib/server/chains";
import { lcd, within } from "@/lib/server/chain/lcd";
import { inferOperatorChain, parseOperatorAddress } from "@/lib/server/chain/request";

/** What the first paint shows before the full profile loads. */
export interface ValidatorProfile {
  moniker: string;
  identity: string | null;
  website: string | null;
  details: string | null;
  status: RawValidator["status"];
  jailed: boolean;
  commission: RawValidator["commission"];
}

interface Located {
  chainId: string;
  chainName: string;
  network: ServerChainEntry["network"];
  operator: string;
}

export type ValidatorLookup =
  | { kind: "invalid" }
  | ({ kind: "missing" } & Located)
  /** The node did not answer in time (or failed): render, the browser retries. */
  | ({ kind: "unknown" } & Located)
  | ({ kind: "found"; profile: ValidatorProfile } & Located);

const LOOKUP_BUDGET_MS = 2_500;

function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
}

export const lookupValidator = cache(async (rawAddress: string, chainParam: string | null): Promise<ValidatorLookup> => {
  const address = decode(rawAddress);
  if (!address || address.length > 128) return { kind: "invalid" };
  let chain: ServerChainEntry | undefined;
  let operator: string;
  try {
    chain = chainParam ? findServerChain(chainParam) : inferOperatorChain(address);
    if (!chain) return { kind: "invalid" };
    operator = parseOperatorAddress(address, chain);
  } catch {
    return { kind: "invalid" };
  }
  const located: Located = { chainId: chain.chainId, chainName: chain.chainName, network: chain.network, operator };
  const target = chain;
  const read = lcd(target, `cosmos/staking/v1beta1/validators/${encodeURIComponent(operator)}`, {
    ttlMs: 10 * 60_000,
    name: "validator",
    map: (body) => parseValidator(pick(body, ["validator"])),
  }).then(
    (result): ValidatorLookup => {
      if (!result.ok) return result.miss === "not-found" ? { kind: "missing", ...located } : { kind: "unknown", ...located };
      const v = result.data;
      if (!v) return { kind: "missing", ...located };
      return {
        kind: "found",
        ...located,
        profile: {
          moniker: v.moniker,
          identity: v.identity,
          website: v.website,
          details: v.details,
          status: v.status,
          jailed: v.jailed,
          commission: v.commission,
        },
      };
    },
    (): ValidatorLookup => ({ kind: "unknown", ...located }),
  );
  return within<ValidatorLookup>(read, LOOKUP_BUDGET_MS, () => ({ kind: "unknown", ...located }));
});
