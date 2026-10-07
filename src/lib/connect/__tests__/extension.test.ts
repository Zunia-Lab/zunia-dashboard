/** One prompt for every chain, suggestions only where needed, partial failures kept partial. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { clearAddressCaches } from "../cache";
import { enableChains, isUserRejection, unknownChainOf, type ExtensionProvider } from "../extension";

function provider(options: { known?: string[] | null; failKey?: string[]; reject?: boolean }) {
  const calls: string[] = [];
  const known = options.known === null ? null : new Set(options.known ?? []);
  const p: ExtensionProvider = {
    ...(known ? { getChainInfosWithoutEndpoints: async () => [...known].map((chainId) => ({ chainId })) } : {}),
    enable: async (ids) => {
      const list = Array.isArray(ids) ? ids : [ids];
      calls.push(`enable:${list.join(",")}`);
      if (options.reject) throw new Error("Request rejected");
      const unknown = known ? list.find((id) => !known.has(id)) : list.find((id) => id === "nope-1");
      if (unknown) throw new Error(`There is no chain info for ${unknown}`);
    },
    getKey: async (chainId) => {
      calls.push(`getKey:${chainId}`);
      if (options.failKey?.includes(chainId)) throw new Error("Key unavailable");
      // A plain array, as some wallets answer across postMessage.
      return { name: "W", algo: "secp256k1", bech32Address: `${chainId}-addr`, pubKey: Array.from(new Uint8Array(33).fill(2)) as unknown as Uint8Array };
    },
    experimentalSuggestChain: async (info) => {
      calls.push(`suggest:${(info as { chainId: string }).chainId}`);
      known?.add((info as { chainId: string }).chainId);
    },
  };
  return { p, calls };
}

const options = (p: ExtensionProvider) => ({
  suggestFirst: ["safrochain-1"],
  suggest: async (chainId: string) => {
    await p.experimentalSuggestChain!({ chainId });
    return true;
  },
  nameOf: (id: string) => id,
});

test("Keplr without Safrochain: suggest it, then ONE enable for everything", async () => {
  const { p, calls } = provider({ known: ["cosmoshub-4", "osmosis-1"] });
  const out = await enableChains(p, "keplr", ["safrochain-1", "cosmoshub-4", "osmosis-1"], options(p));
  assert.deepEqual(calls.slice(0, 2), ["suggest:safrochain-1", "enable:safrochain-1,cosmoshub-4,osmosis-1"]);
  assert.deepEqual(Object.keys(out.keys).sort(), ["cosmoshub-4", "osmosis-1", "safrochain-1"]);
  assert.ok(out.keys["safrochain-1"]!.pubKey instanceof Uint8Array);
  assert.equal(out.skipped.length, 0);
});

test("other unknown chains are left for later, not suggested at connect", async () => {
  const { p, calls } = provider({ known: ["safrochain-1", "cosmoshub-4"] });
  const out = await enableChains(p, "keplr", ["safrochain-1", "cosmoshub-4", "akashnet-2"], options(p));
  assert.ok(!calls.some((c) => c === "suggest:akashnet-2"));
  assert.deepEqual(out.skipped.map((s) => s.chainId), ["akashnet-2"]);
  assert.match(out.skipped[0]!.reason, /first time you sign there/);
});

test("a wallet that cannot list its chains: the refused one is dropped and the batch retried", async () => {
  const { p, calls } = provider({ known: null });
  const out = await enableChains(p, "zunia", ["safrochain-1", "nope-1", "cosmoshub-4"], options(p));
  assert.deepEqual(calls.filter((c) => c.startsWith("enable")), ["enable:safrochain-1,nope-1,cosmoshub-4", "enable:safrochain-1,cosmoshub-4"]);
  assert.deepEqual(out.skipped.map((s) => s.chainId), ["nope-1"]);
});

test("a key that fails is skipped; the rest stay connected", async () => {
  const { p } = provider({ known: ["safrochain-1", "cosmoshub-4"], failKey: ["cosmoshub-4"] });
  const out = await enableChains(p, "keplr", ["safrochain-1", "cosmoshub-4"], options(p));
  assert.deepEqual(Object.keys(out.keys), ["safrochain-1"]);
  assert.equal(out.skipped[0]!.chainId, "cosmoshub-4");
});

test("a rejected prompt throws; so does nothing at all enabled", async () => {
  const rejected = provider({ known: ["safrochain-1"], reject: true });
  await assert.rejects(enableChains(rejected.p, "keplr", ["safrochain-1"], options(rejected.p)), /Request rejected/);
  const keyless = provider({ known: ["safrochain-1"], failKey: ["safrochain-1"] });
  await assert.rejects(enableChains(keyless.p, "keplr", ["safrochain-1"], options(keyless.p)), /Key unavailable/);
});

test("error reading: rejections and unknown chains in both wallets' words", () => {
  assert.equal(isUserRejection(new Error("Request rejected")), true);
  assert.equal(isUserRejection(Object.assign(new Error("x"), { code: "USER_REJECTED" })), true);
  assert.equal(isUserRejection(new Error("Network error")), false);
  assert.equal(unknownChainOf(new Error("There is no chain info for safrochain-1")), "safrochain-1");
  assert.equal(unknownChainOf(new Error("Zunia does not know the chain foo-1. Add it with experimentalSuggestChain first.")), "foo-1");
  assert.equal(unknownChainOf(new Error("Something else")), null);
});

test("disconnect forgets address-keyed caches, and only those", () => {
  const data = new Map<string, string>([
    ["zunia.dashboard.api.v1:/api/portfolio?address=cosmos1x", "{}"],
    ["zunia.dashboard.json.v1:/api/activity?address=cosmos1x", "{}"],
    ["zunia.dashboard.followed", "[]"],
    ["zunia-theme", "dark"],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
  assert.equal(clearAddressCaches(storage), 2);
  assert.deepEqual([...data.keys()], ["zunia.dashboard.followed", "zunia-theme"]);
});
