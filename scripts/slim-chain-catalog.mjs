#!/usr/bin/env node
/**
 * Writes src/data/chain-catalog.client.json: the browser's copy of the chain
 * catalog, without the fields only the server uses (REST/RPC endpoints, logo
 * slugs, currency lists).
 *
 * `ethPubKeyTypeUrl` stays in the browser copy: the signer puts the chain's
 * public-key type into the `AuthInfo` it asks a wallet to sign, so the browser
 * needs it (Injective's `/injective.crypto.v1beta1.ethsecp256k1.PubKey`; two
 * rows carry it, a few dozen bytes).
 *
 * The full catalog is ~300 KB and was shipped in a third of every page's JS.
 * Endpoints are server-only by design anyway (the browser never talks to a
 * chain node), so they have no business in the client bundle.
 *
 * Run after regenerating src/data/chain-catalog.json:
 *   node scripts/slim-chain-catalog.mjs
 * `src/lib/__tests__/chain-catalog.test.ts` fails when the two drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const full = JSON.parse(readFileSync(path.join(root, "src/data/chain-catalog.json"), "utf8"));

export const SERVER_ONLY_FIELDS = ["rest", "rpc", "logoSlugs", "currencies"];

const slim = full.map((entry) => {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!SERVER_ONLY_FIELDS.includes(key)) out[key] = value;
  }
  return out;
});

writeFileSync(path.join(root, "src/data/chain-catalog.client.json"), JSON.stringify(slim));
console.log(`wrote ${slim.length} chains`);
