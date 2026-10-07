/**
 * A message's JSON, bounded for the transaction detail's "raw" view.
 *
 * Messages are public chain data, but not small: a relayer's MsgUpdateClient
 * carries a full validator set and signatures, a MsgRecvPacket a Merkle proof,
 * a MsgStoreCode the whole contract binary. Shipping them verbatim would make
 * one detail response megabytes long and freeze the collapsible viewer. The
 * shape is kept and every cut is marked in place, so nothing reads as if it
 * were the whole value.
 */

import { stripInvisible } from "./clean";

export interface SanitizeLimits {
  maxDepth: number;
  maxArray: number;
  maxString: number;
  maxKeys: number;
  /** Values visited before the rest is replaced by a marker. */
  maxNodes: number;
}

export const DEFAULT_SANITIZE_LIMITS: SanitizeLimits = {
  maxDepth: 8,
  maxArray: 20,
  maxString: 512,
  maxKeys: 40,
  maxNodes: 1_500,
};

export function sanitizeJson(value: unknown, limits: SanitizeLimits = DEFAULT_SANITIZE_LIMITS): unknown {
  let budget = limits.maxNodes;

  const walk = (node: unknown, depth: number): unknown => {
    budget -= 1;
    if (budget < 0) return "[omitted: too large to show]";
    if (node === null || typeof node === "boolean") return node;
    if (typeof node === "number") return Number.isFinite(node) ? node : String(node);
    if (typeof node === "string") {
      // Invisible and bidi formatting characters go: a raw view must not
      // render one string as another (./clean).
      const value = stripInvisible(node);
      return value.length > limits.maxString
        ? `${value.slice(0, limits.maxString)}… (+${value.length - limits.maxString} characters)`
        : value;
    }
    if (Array.isArray(node)) {
      if (depth >= limits.maxDepth) return `[${node.length} items omitted]`;
      const kept = node.slice(0, limits.maxArray).map((item) => walk(item, depth + 1));
      if (node.length > limits.maxArray) kept.push(`… ${node.length - limits.maxArray} more items`);
      return kept;
    }
    if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      if (depth >= limits.maxDepth) return `[object with ${entries.length} fields omitted]`;
      const out: Record<string, unknown> = {};
      for (const [key, child] of entries.slice(0, limits.maxKeys)) {
        out[stripInvisible(key).slice(0, 128)] = walk(child, depth + 1);
      }
      if (entries.length > limits.maxKeys) out["…"] = `${entries.length - limits.maxKeys} more fields`;
      return out;
    }
    return undefined;
  };

  return walk(value, 0);
}
