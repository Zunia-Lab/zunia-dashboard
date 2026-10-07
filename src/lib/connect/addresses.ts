/**
 * Your address on a chain: from the wallet when it said, derived only when the
 * derivation is certain, otherwise unknown.
 *
 * 1. The wallet's own `getKey(chainId)` answer (or the phone's shared account)
 *    is the truth, and wins.
 * 2. Otherwise the address of a chain with the *same key scheme* — same
 *    SLIP-44 coin type and same address derivation — re-encoded under the
 *    target prefix. Two coin-118 chains derive the same 20 bytes from the same
 *    seed, so `cosmos1…` and `osmo1…` are one account. Two Ethereum-style
 *    chains (coin type 60, keccak addresses) share bytes the same way.
 * 3. Otherwise null. Never across schemes: a coin-60 address re-encoded from a
 *    coin-118 one is a valid-looking address belonging to nobody, and funds
 *    sent there are gone.
 *
 * Pure (catalog passed in as a lookup) so it is tested without the catalog.
 */

import { bech32 } from "bech32";

export interface AddressChain {
  chainId: string;
  bech32Prefix: string;
  coinType: number;
  features?: string[];
}

export type ChainLookup = (chainId: string) => AddressChain | undefined;

/** Key scheme: the coin type, and whether addresses are Ethereum-derived. */
export function keyScheme(chain: AddressChain): string {
  const eth = chain.coinType === 60 || Boolean(chain.features?.includes("eth-address-gen"));
  return `${chain.coinType}:${eth ? "eth" : "cosmos"}`;
}

/** The same bytes under another prefix; null when `address` is not bech32. */
export function reencodeBech32(address: string, prefix: string): string | null {
  try {
    const decoded = bech32.decode(address, 200);
    return bech32.encode(prefix, decoded.words, 200);
  } catch {
    return null;
  }
}

/**
 * `known` maps chain id → address the wallet gave. Preference order among
 * candidates: the caller's `prefer` chain (usually the primary account), then
 * catalog order of `known`, so the answer is stable across renders.
 */
export function resolveAddressFor(
  chainId: string,
  known: Readonly<Record<string, string>>,
  lookup: ChainLookup,
  prefer?: string | null,
): string | null {
  const direct = known[chainId];
  if (direct) return direct;
  const target = lookup(chainId);
  if (!target) return null;
  const scheme = keyScheme(target);
  const sources = Object.keys(known);
  if (prefer && known[prefer]) sources.unshift(prefer);
  for (const sourceId of sources) {
    const source = lookup(sourceId);
    if (!source || keyScheme(source) !== scheme) continue;
    const address = known[sourceId];
    if (!address || !address.startsWith(`${source.bech32Prefix}1`)) continue;
    const encoded = reencodeBech32(address, target.bech32Prefix);
    if (encoded) return encoded;
  }
  return null;
}

/** `resolveAddressFor` over many chains, skipping the unknowable ones. */
export function resolveAddresses(
  chainIds: readonly string[],
  known: Readonly<Record<string, string>>,
  lookup: ChainLookup,
  prefer?: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chainId of chainIds) {
    const address = resolveAddressFor(chainId, known, lookup, prefer);
    if (address) out[chainId] = address;
  }
  return out;
}

/** The amino fields that name the signer of the messages this app builds. */
const SIGNER_FIELDS = ["from_address", "delegator_address", "sender", "voter", "depositor", "granter"] as const;

/**
 * `msgs` with every signer field that says `from` saying `to` instead.
 *
 * Only signer fields: a recipient that happens to be the same account on
 * another chain (an IBC `receiver`, a `to_address`) keeps its own prefix,
 * because rewriting it would point the funds at an address the receiving
 * chain cannot parse. Used by the deprecated amino path to move a pre-v2
 * page's signer onto the chain it signs on (see `sign-broadcast.ts`).
 */
export function retargetSignerFields<T extends { type: string; value: Record<string, unknown> }>(
  msgs: readonly T[],
  from: string,
  to: string,
): T[] {
  return msgs.map((msg) => {
    let changed = false;
    const value: Record<string, unknown> = { ...msg.value };
    for (const field of SIGNER_FIELDS) {
      if (value[field] === from) {
        value[field] = to;
        changed = true;
      }
    }
    return changed ? { ...msg, value } : msg;
  });
}
