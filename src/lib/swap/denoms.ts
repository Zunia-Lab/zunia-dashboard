/**
 * Denom rules the swap engine leans on: what counts as a denom, how two `ibc/`
 * hashes compare, and the hash a transfer mints.
 *
 * Pure and synchronous (noble's sha256, not WebCrypto), so the server, the
 * browser and node:test all compute the same voucher name the same way.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * The Cosmos SDK's own denom rule (`[a-zA-Z][a-zA-Z0-9/:._-]{2,127}`). Every
 * denom that reaches a signed message passes it, so a ticker, an empty string
 * or a denom with a space can never be signed by accident.
 */
export const DENOM = /^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/;

/** A positive integer in its one canonical spelling (no sign, no leading zero). */
export const POSITIVE_INT = /^[1-9]\d*$/;

/** A non-negative integer in its one canonical spelling. */
export const UINT = /^(0|[1-9]\d*)$/;

/** `ibc/` hashes compare without case; every other denom compares exactly. */
export function denomKey(denom: string): string {
  return denom.startsWith("ibc/") ? `ibc/${denom.slice(4).toUpperCase()}` : denom;
}

/** Whether two denoms name the same coin ({@link denomKey}). */
export function sameDenom(a: string, b: string): boolean {
  return denomKey(a) === denomKey(b);
}

/**
 * The `ibc/HASH` a chain mints for `base` arriving along `path`
 * (`transfer/channel-0` or `transfer/channel-0/transfer/channel-141`), as
 * ICS-20 defines it: uppercase hex SHA-256 of `path/base`. `base` keeps its
 * exact case: Injective's `erc20:0xa00C…` hashes to `ibc/794C…` on Osmosis,
 * while the lowercase spelling some catalogs carry hashes elsewhere.
 */
export function ibcDenomOf(path: string, base: string): string {
  const trimmedPath = path.replace(/^\/+|\/+$/g, "");
  const full = trimmedPath ? `${trimmedPath}/${base}` : base;
  return `ibc/${bytesToHex(sha256(utf8ToBytes(full))).toUpperCase()}`;
}

/** A short, human-safe rendering of a denom for sentences: `ibc/498A…6E4`, `factory/…/allUSDC`. */
export function shortDenom(denom: string): string {
  if (denom.startsWith("ibc/") && denom.length > 14) return `ibc/${denom.slice(4, 8)}…${denom.slice(-3)}`;
  if (denom.startsWith("factory/")) {
    const last = denom.split("/").pop() ?? denom;
    return `factory/…/${last}`;
  }
  return denom.length > 28 ? `${denom.slice(0, 18)}…${denom.slice(-6)}` : denom;
}

/** An address shortened for a sentence: `osmo1gv86dp…stl5rm`. */
export function shortAddress(address: string, head = 10, tail = 6): string {
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
}
