/**
 * Request parameter parsing for route handlers.
 *
 * Every value that ends up in an upstream URL passes through one of these, so
 * a route can never be talked into reading a host or a path it was not built
 * for: chain ids must exist in the shipped catalog (which is where every
 * upstream host comes from), addresses must decode as bech32 under the chain's
 * own prefix, and lists are bounded so one request cannot fan out across the
 * whole registry.
 *
 * Parsers return a value or a `ParamError`; `badRequest` turns the error into
 * the 400 every route answers with, so the browser sees one error shape.
 */

import "server-only";
import { bech32 } from "bech32";
import { findServerChain as findChain, type ServerChainEntry as ChainEntry } from "@/lib/server/chains";

export class ParamError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ParamError";
    this.code = code;
  }
}

export function badRequest(error: unknown): Response {
  if (error instanceof ParamError) {
    return Response.json({ error: error.code, message: error.message }, { status: 400 });
  }
  return Response.json({ error: "bad_request", message: "Invalid request" }, { status: 400 });
}

/** A chain id that exists in the catalog. */
export function parseChainId(raw: string | null | undefined, name = "chainId"): ChainEntry {
  const value = (raw ?? "").trim();
  if (!value) throw new ParamError(`${name}_required`, `${name} is required`);
  if (value.length > 64) throw new ParamError(`${name}_invalid`, `${name} is too long`);
  const chain = findChain(value);
  if (!chain) throw new ParamError(`${name}_unknown`, `Unknown chain ${value}`);
  return chain;
}

/**
 * A comma-separated list of catalog chain ids, de-duplicated, unknown ids
 * dropped (they are reported back as `unknown` so the UI can say so), capped.
 */
export function parseChainList(
  raw: string | null | undefined,
  max = 40,
): { chains: ChainEntry[]; unknown: string[] } {
  const ids = Array.from(
    new Set(
      (raw ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length > max) {
    throw new ParamError("chains_too_many", `At most ${max} chains per request`);
  }
  const chains: ChainEntry[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const chain = id.length <= 64 ? findChain(id) : undefined;
    if (chain) chains.push(chain);
    else unknown.push(id.slice(0, 64));
  }
  return { chains, unknown };
}

/** Bech32 decode without throwing; `null` when the string is not bech32. */
export function decodeBech32(address: string): { prefix: string; words: number[] } | null {
  try {
    const decoded = bech32.decode(address, 200);
    return { prefix: decoded.prefix, words: decoded.words };
  } catch {
    return null;
  }
}

/**
 * A bech32 account address. With `chain`, the prefix must be that chain's.
 *
 * Accounts are 20 bytes and contracts 32; anything else is refused so a
 * crafted string cannot reach an upstream path.
 */
export function parseAddress(
  raw: string | null | undefined,
  chain?: Pick<ChainEntry, "bech32Prefix">,
  name = "address",
): string {
  const value = (raw ?? "").trim();
  if (!value) throw new ParamError(`${name}_required`, `${name} is required`);
  // Prefixes may contain "_" or "@" (Safrochain's is "addr_safro", Lava's "lava@"); bech32 allows
  // any printable ASCII in the human-readable part, the data part is checked
  // by the decoder below.
  if (value.length > 128 || !/^[a-z0-9_@]+1[a-z0-9]+$/.test(value)) {
    throw new ParamError(`${name}_invalid`, `${name} is not a bech32 address`);
  }
  const decoded = decodeBech32(value);
  if (!decoded) throw new ParamError(`${name}_invalid`, `${name} is not a bech32 address`);
  const bytes = bech32.fromWords(decoded.words).length;
  if (bytes !== 20 && bytes !== 32) {
    throw new ParamError(`${name}_invalid`, `${name} has an unexpected length`);
  }
  if (chain && decoded.prefix !== chain.bech32Prefix) {
    throw new ParamError(
      `${name}_prefix`,
      `${name} must start with ${chain.bech32Prefix}1`,
    );
  }
  return value;
}

/** A validator operator address (`<prefix>valoper1…`). */
export function parseValoper(
  raw: string | null | undefined,
  chain: Pick<ChainEntry, "bech32Prefix">,
): string {
  const value = (raw ?? "").trim();
  const expected = `${chain.bech32Prefix}valoper`;
  if (!value.startsWith(`${expected}1`)) {
    throw new ParamError("validator_invalid", `validator must start with ${expected}1`);
  }
  const decoded = decodeBech32(value);
  if (!decoded || decoded.prefix !== expected) {
    throw new ParamError("validator_invalid", "validator is not a valid operator address");
  }
  return value;
}

/** An integer within [min, max]; `fallback` when absent. */
export function parseIntParam(
  raw: string | null | undefined,
  { min, max, fallback, name }: { min: number; max: number; fallback: number; name: string },
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) throw new ParamError(`${name}_invalid`, `${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ParamError(`${name}_range`, `${name} must be between ${min} and ${max}`);
  }
  return value;
}

/** One of a fixed set of strings; `fallback` when absent. */
export function parseEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new ParamError(`${name}_invalid`, `${name} must be one of ${allowed.join(", ")}`);
}

/** A transaction hash: 64 hex characters (case-insensitive). */
export function parseTxHash(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new ParamError("hash_invalid", "hash must be 64 hex characters");
  }
  return value.toUpperCase();
}
