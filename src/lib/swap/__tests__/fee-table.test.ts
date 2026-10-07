/**
 * The release check on Zunia's swap commission: ported from
 * zunia-extension lib/__tests__/release-consistency.test.ts ("Zunia's swap
 * fee") @ 1453e7a.
 *
 * `treasuryProblems` is written here on its own, apart from src/lib/swap/fee.ts,
 * so the build does not check the code with itself: every treasury must be a
 * catalog chain's, decode as bech32 (checksum included), be lowercase, carry
 * exactly that chain's prefix, and hold an account's 20 bytes or a
 * contract's 32. And no coin type 60 chain's treasury may carry the same bytes
 * as another coin type's: Ethereum-key chains hash their keys another way, so
 * those bytes can only be another chain's address re-encoded with a new
 * prefix, an account nobody can spend from.
 */

import "./json-modules";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import { SWAP_FEE_BPS, SWAP_FEE_RECIPIENTS } from "@/config/fees";
import { CHAINS } from "@/lib/chains";
import { swapFeeRecipient } from "../fee";

const ROOT = join(import.meta.dirname, "../../../..");

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function treasuryProblems(map: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const rows: { chainId: string; coinType: number; hex: string }[] = [];
  for (const [chainId, address] of Object.entries(map)) {
    const entry = CHAINS.find((row) => row.chainId === chainId);
    if (!entry) {
      problems.push(`${chainId}: not a bundled chain`);
      continue;
    }
    let decoded: { prefix: string; bytes: Uint8Array };
    try {
      decoded = bech32.decodeToBytes(address);
    } catch (error) {
      problems.push(`${chainId}: ${address} does not decode (${(error as Error).message})`);
      continue;
    }
    if (decoded.prefix !== entry.bech32Prefix) {
      problems.push(`${chainId}: ${address} has the prefix ${decoded.prefix}, the chain's is ${entry.bech32Prefix}`);
    }
    if (address !== address.toLowerCase()) problems.push(`${chainId}: ${address} is not lowercase`);
    if (decoded.bytes.length !== 20 && decoded.bytes.length !== 32) {
      problems.push(`${chainId}: ${address} holds ${decoded.bytes.length} bytes`);
    }
    rows.push({ chainId, coinType: entry.coinType, hex: hex(decoded.bytes) });
  }
  for (const row of rows) {
    if (row.coinType !== 60) continue;
    const twin = rows.find((other) => other.coinType !== 60 && other.hex === row.hex);
    if (twin) problems.push(`${row.chainId}: re-encodes ${twin.chainId}'s treasury, which no coin type 60 key can spend`);
  }
  return problems;
}

/** Module specifiers a source file imports (static `import … from "…"` and bare `import "…"`). */
function importsOf(file: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const match of source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    out.push(match[1] ?? "");
  }
  return out;
}

describe("Zunia's swap fee", () => {
  test("is 50 basis points of the amount sold", () => {
    assert.equal(SWAP_FEE_BPS, 50);
  });

  test("lists the 131 treasuries the extension ships, Osmosis and Safrochain among them", () => {
    assert.equal(Object.keys(SWAP_FEE_RECIPIENTS).length, 131);
    assert.equal(SWAP_FEE_RECIPIENTS["osmosis-1"], "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm");
    assert.equal(SWAP_FEE_RECIPIENTS["safrochain-1"], "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e");
    assert.equal(SWAP_FEE_RECIPIENTS["cosmoshub-4"], "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f");
    assert.equal(SWAP_FEE_RECIPIENTS["injective-1"], "inj1rmgck8u7m0mmhtuyjfhxfcxlactsm97ag29c36");
  });

  test("pays only treasuries that decode with their own chain's prefix", () => {
    assert.deepEqual(treasuryProblems(SWAP_FEE_RECIPIENTS), []);
    // And each one is paid exactly as configured: none is dropped as invalid
    // at run time, which would silently charge nothing there.
    for (const [chainId, address] of Object.entries(SWAP_FEE_RECIPIENTS)) {
      assert.equal(swapFeeRecipient(chainId), address, chainId);
    }
  });

  test("would refuse a wrong-chain, mistyped, re-encoded or unbundled treasury", () => {
    const bytes = (fill: number) => bech32.toWords(new Uint8Array(20).fill(fill));
    const osmo = bech32.encode("osmo", bytes(0x5a));
    // One key on two coin type 118 chains is one account: the same bytes are fine there.
    assert.deepEqual(
      treasuryProblems({
        "osmosis-1": osmo,
        "cosmoshub-4": bech32.encode("cosmos", bytes(0x5a)),
        "injective-1": bech32.encode("inj", bytes(0x5b)),
      }),
      [],
    );
    assert.deepEqual(treasuryProblems({ "osmosis-1": osmo, "injective-1": bech32.encode("inj", bytes(0x5a)) }), [
      "injective-1: re-encodes osmosis-1's treasury, which no coin type 60 key can spend",
    ]);
    assert.deepEqual(
      treasuryProblems({
        "cosmoshub-4": osmo,
        "osmosis-1": `${osmo.slice(0, -1)}${osmo.endsWith("q") ? "p" : "q"}`,
        "noble-1": bech32.encode("noble", bech32.toWords(new Uint8Array(16).fill(1))),
        "my-chain-1": osmo,
      }).map((problem) => problem.split(":")[0]),
      ["cosmoshub-4", "osmosis-1", "noble-1", "my-chain-1"],
    );
  });

  test("is compiled in: the table imports nothing and the fee module reads no network or storage", () => {
    assert.deepEqual(importsOf("src/config/fees.ts"), []);
    assert.deepEqual(
      importsOf("src/lib/swap/fee.ts").sort(),
      ["@/config/fees", "@/lib/chains", "@/lib/swap/types", "@scure/base"].sort(),
    );
    const fee = readFileSync(join(ROOT, "src/lib/swap/fee.ts"), "utf8");
    assert.doesNotMatch(fee, /\bfetch\(|\bwindow\.|localStorage\.|sessionStorage\.|process\.env/);
  });
});
