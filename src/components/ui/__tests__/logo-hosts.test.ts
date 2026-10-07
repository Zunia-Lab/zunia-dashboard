/**
 * The optimizer allowlist: the kit must only send logos to /_next/image that
 * next.config.ts lets it fetch, and every catalog logo prefix must be on it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";

import { TOKEN_LOGO_PREFIXES } from "@/lib/token/registry.generated";
import nextConfig from "../../../../next.config";
import { OPTIMIZED_LOGO_PREFIXES, isOptimizableLogo, logoRemotePatterns } from "../logo-hosts";

test("registry logos and keybase avatars go through the optimizer", () => {
  assert.equal(isOptimizableLogo("https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/bitcoin/images/btc.png"), true);
  assert.equal(isOptimizableLogo("https://raw.githubusercontent.com/Zunia-Lab/zunia-chain-registry/main/images/cosmoshub/chain.png"), true);
  assert.equal(isOptimizableLogo("https://s3.amazonaws.com/keybase_processed_uploads/0a1b2c_360_360.jpg"), true);
});

test("anything else stays a plain image", () => {
  assert.equal(isOptimizableLogo("https://raw.githubusercontent.com/cosmos/chain-registry/master/x.png?v=2"), false);
  assert.equal(isOptimizableLogo("https://raw.githubusercontent.com/cosmos/chain-registry/master/../../evil/x.png"), false);
  assert.equal(isOptimizableLogo("https://raw.githubusercontent.com/someone/else/main/x.png"), false);
  assert.equal(isOptimizableLogo("http://raw.githubusercontent.com/cosmos/chain-registry/master/x.png"), false);
  assert.equal(isOptimizableLogo("https://s3.amazonaws.com/another-bucket/x.jpg"), false);
  assert.equal(isOptimizableLogo("/zunia-mark.svg"), false);
  assert.equal(isOptimizableLogo("not a url"), false);
});

test("every catalog logo prefix is on the list", () => {
  for (const prefix of TOKEN_LOGO_PREFIXES) assert.ok(OPTIMIZED_LOGO_PREFIXES.includes(prefix), prefix);
});

test("the patterns accept exactly what isOptimizableLogo accepts (Next's own matcher)", () => {
  const patterns = logoRemotePatterns();
  for (const src of [
    "https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.png",
    "https://s3.amazonaws.com/keybase_processed_uploads/0a1b2c_360_360.jpg",
    "https://raw.githubusercontent.com/someone/else/main/x.png",
    "https://raw.githubusercontent.com/cosmos/chain-registry/master/x.png?v=2",
  ]) {
    assert.equal(hasRemoteMatch([], patterns, new URL(src)), isOptimizableLogo(src), src);
  }
});

test("next.config.ts allows exactly these hosts", () => {
  assert.deepEqual(nextConfig.images?.remotePatterns, logoRemotePatterns());
});
