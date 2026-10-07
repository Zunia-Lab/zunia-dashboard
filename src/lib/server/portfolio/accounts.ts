/**
 * The `accounts` parameter: `<chainId>:<address>,…`, at most 32.
 *
 * The browser names the address for every chain itself (the wallet's
 * `getKey(chainId)`), so the server never re-derives one across coin types.
 * Each address must decode as bech32 under that chain's own prefix, and each
 * chain id must be in the shipped catalog — that is what keeps a request from
 * steering the server at a host or a path it was not built for.
 */

import "server-only";

import type { ServerChainEntry } from "@/lib/server/chains";
import { ParamError, parseChainId } from "@/lib/server/validate";
import { checkChainAddress } from "./address";

export const MAX_ACCOUNTS = 32;

export interface PortfolioAccount {
  chain: ServerChainEntry;
  address: string;
}

export function parseAccounts(raw: string | null | undefined): PortfolioAccount[] {
  const value = (raw ?? "").trim();
  if (!value) throw new ParamError("accounts_required", "accounts is required (chainId:address,…)");
  if (value.length > MAX_ACCOUNTS * 200) throw new ParamError("accounts_invalid", "accounts is too long");
  const entries = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
  if (entries.length === 0) throw new ParamError("accounts_required", "accounts is required (chainId:address,…)");
  if (entries.length > MAX_ACCOUNTS) {
    throw new ParamError("accounts_too_many", `At most ${MAX_ACCOUNTS} accounts per request`);
  }
  const seen = new Set<string>();
  return entries.map((entry) => {
    const split = entry.indexOf(":");
    if (split <= 0) throw new ParamError("accounts_invalid", "Each account must read chainId:address");
    const chain = parseChainId(entry.slice(0, split), "chainId");
    if (seen.has(chain.chainId)) {
      throw new ParamError("accounts_duplicate_chain", `One address per chain (${chain.chainId} appears twice)`);
    }
    seen.add(chain.chainId);
    const checked = checkChainAddress(entry.slice(split + 1), chain);
    if (!checked.ok) throw new ParamError(checked.code, checked.message);
    return { chain, address: checked.address };
  });
}
