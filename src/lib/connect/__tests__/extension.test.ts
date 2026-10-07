/** One prompt for every chain, suggestions only where needed, partial failures kept partial. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { clearAddressCaches } from "../cache";
import {
  enableChains,
  extensionStoreFor,
  grantedChains,
  isExtensionLocked,
  isLockedOrClosed,
  isUserRejection,
  unknownChainOf,
  type ExtensionProvider,
} from "../extension";

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

/*
 * Zunia's own words (zunia-extension lib/provider-handler.ts, approvals.ts,
 * entrypoints/background.ts @ 1453e7a). A lock is not a lost connection.
 */
test("a lock, or a prompt window closed unanswered, is not a lost connection", () => {
  const zunia = (code: string, message: string) => Object.assign(new Error(message), { code });
  assert.equal(isLockedOrClosed(zunia("LOCKED", "Zunia stayed locked, so the request was cancelled")), true);
  assert.equal(isLockedOrClosed(zunia("LOCKED", "The Zunia window was closed before unlocking")), true);
  assert.equal(isLockedOrClosed(zunia("USER_REJECTED", "The Zunia window was closed before the request was answered")), true);
  // `enableChains` rethrows a key it could not read by its reason, without the code.
  assert.equal(isLockedOrClosed(new Error("Zunia stayed locked, so the request was cancelled")), true);
  assert.equal(isLockedOrClosed(new Error("Wallet is locked")), true);
  assert.equal(isLockedOrClosed(zunia("NOT_CONNECTED", "Not authorized")), false);
  assert.equal(isLockedOrClosed(zunia("USER_REJECTED", "Request rejected")), false);
  assert.equal(isLockedOrClosed(new Error("There is no chain info for x")), false);
});

test("Zunia's silent questions: granted chains and the lock, never a throw", async () => {
  const answering = (over: Partial<ExtensionProvider>): ExtensionProvider => ({
    enable: async () => {},
    getKey: async () => {
      throw new Error("not asked");
    },
    ...over,
  });
  assert.deepEqual(await grantedChains(answering({ getConnectedChains: async () => ["safrochain-1", "osmosis-1"] })), ["safrochain-1", "osmosis-1"]);
  assert.deepEqual(await grantedChains(answering({ getConnectedChains: async () => [] })), [], "no grant left: an empty list, not null");
  assert.equal(await grantedChains(answering({})), null, "an extension that cannot say");
  assert.equal(await grantedChains(answering({ getConnectedChains: async () => Promise.reject(new Error("x")) })), null);
  assert.equal(await grantedChains(answering({ getConnectedChains: async () => "nope" as unknown as string[] })), null);

  assert.equal(await isExtensionLocked(answering({ isLocked: async () => true })), true);
  assert.equal(await isExtensionLocked(answering({ isLocked: async () => false })), false);
  assert.equal(await isExtensionLocked(answering({})), false, "cannot say: go on as before");
  const refused = Object.assign(new Error("Not authorized"), { code: "NOT_CONNECTED" });
  assert.equal(await isExtensionLocked(answering({ isLocked: async () => Promise.reject(refused) })), false);
});

test("where this browser installs the extension from", () => {
  const ua = {
    chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0",
    firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
    firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
    safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  };
  assert.equal(extensionStoreFor(ua.chrome), "chrome");
  assert.equal(extensionStoreFor(ua.edge), "chrome");
  assert.equal(extensionStoreFor(ua.opera), "chrome");
  assert.equal(extensionStoreFor(ua.androidChrome), "chrome");
  assert.equal(extensionStoreFor(ua.firefox), "firefox");
  assert.equal(extensionStoreFor(ua.firefoxAndroid), "firefox");
  assert.equal(extensionStoreFor(ua.safari), "safari");
  assert.equal(extensionStoreFor(ua.iphoneSafari), "safari");
  // On iPhone only Safari runs extensions, whatever the browser.
  assert.equal(extensionStoreFor(ua.iphoneChrome), "safari");
  assert.equal(extensionStoreFor(""), "chrome");
});
