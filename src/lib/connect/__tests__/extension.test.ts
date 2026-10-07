/** One prompt for every chain, suggestions only where needed, partial failures kept partial. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { clearAddressCaches } from "../cache";
import {
  enableChains,
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


/*
 * Wallets the Keplr API cannot ask for their chains (no
 * `getChainInfosWithoutEndpoints`): Cosmostation's Keplr provider and Leap.
 * Like Keplr, they refuse a chain they do not know in `enable`, before any
 * prompt ("There is no chain info for X").
 */
function unlisted(options: { knows: string[]; addable?: boolean; reject?: boolean }) {
  const calls: string[] = [];
  const knows = new Set(options.knows);
  const p: ExtensionProvider = {
    enable: async (ids) => {
      const list = Array.isArray(ids) ? ids : [ids];
      calls.push(`enable:${list.join(",")}`);
      const unknown = list.find((id) => !knows.has(id));
      if (unknown) throw new Error(`There is no chain info for ${unknown}`);
    },
    getKey: async (chainId) => ({ name: "W", algo: "secp256k1", bech32Address: `${chainId}-addr`, pubKey: new Uint8Array(33).fill(2) }),
    experimentalSuggestChain: async (info) => {
      const chainId = (info as { chainId: string }).chainId;
      calls.push(`suggest:${chainId}`);
      if (options.reject) throw new Error("User rejected the request.");
      if (options.addable !== false) knows.add(chainId);
    },
  };
  return { p, calls };
}

test("Cosmostation: its own chain list stands in, so the home chain is suggested before the one prompt", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4", "osmosis-1"] });
  const out = await enableChains(p, "cosmostation", ["safrochain-1", "cosmoshub-4", "osmosis-1", "akashnet-2"], {
    ...options(p),
    listChains: async () => new Set(["cosmoshub-4", "osmosis-1"]),
  });
  assert.deepEqual(calls, ["suggest:safrochain-1", "enable:safrochain-1,cosmoshub-4,osmosis-1"]);
  assert.deepEqual(Object.keys(out.keys).sort(), ["cosmoshub-4", "osmosis-1", "safrochain-1"]);
  assert.deepEqual(out.skipped, [
    { chainId: "akashnet-2", reason: "Cosmostation does not know akashnet-2 yet; it is added the first time you sign there." },
  ]);
});

test("a wallet that cannot list its chains and refuses the home chain: suggested once, then the batch again", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4"] });
  const out = await enableChains(p, "cosmostation", ["safrochain-1", "cosmoshub-4"], { ...options(p), listChains: async () => null });
  assert.deepEqual(calls, ["enable:safrochain-1,cosmoshub-4", "suggest:safrochain-1", "enable:safrochain-1,cosmoshub-4"]);
  assert.deepEqual(Object.keys(out.keys).sort(), ["cosmoshub-4", "safrochain-1"]);
  assert.deepEqual(out.skipped, []);
});

test("a home chain the user declines to add is left out with its reason; the rest connect", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4"], reject: true });
  const out = await enableChains(p, "cosmostation", ["safrochain-1", "cosmoshub-4"], options(p));
  assert.deepEqual(calls, ["enable:safrochain-1,cosmoshub-4", "suggest:safrochain-1", "enable:cosmoshub-4"]);
  assert.deepEqual(Object.keys(out.keys), ["cosmoshub-4"]);
  assert.deepEqual(out.skipped, [{ chainId: "safrochain-1", reason: "You declined adding safrochain-1 to Cosmostation." }]);
});

test("a home chain still refused after its suggestion is asked for once only, then left out", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4"], addable: false });
  const out = await enableChains(p, "cosmostation", ["safrochain-1", "cosmoshub-4"], options(p));
  assert.deepEqual(calls, ["enable:safrochain-1,cosmoshub-4", "suggest:safrochain-1", "enable:safrochain-1,cosmoshub-4", "enable:cosmoshub-4"]);
  assert.deepEqual(out.skipped, [{ chainId: "safrochain-1", reason: "Cosmostation does not know safrochain-1." }]);
});

test("Leap: it cannot list its chains, so the home chain is suggested before enable, as its docs ask", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4"] });
  const out = await enableChains(p, "leap", ["safrochain-1", "cosmoshub-4"], { ...options(p), suggestBeforeEnable: true });
  assert.deepEqual(calls, ["suggest:safrochain-1", "enable:safrochain-1,cosmoshub-4"]);
  assert.deepEqual(Object.keys(out.keys).sort(), ["cosmoshub-4", "safrochain-1"]);
  // A wallet that lists its chains is not asked to add one it has.
  const listing = provider({ known: ["safrochain-1", "cosmoshub-4"] });
  await enableChains(listing.p, "keplr", ["safrochain-1", "cosmoshub-4"], { ...options(listing.p), suggestBeforeEnable: true });
  assert.ok(!listing.calls.some((call) => call.startsWith("suggest")));
});

test("a restore suggests nothing: a chain the wallet forgot is left out, the rest come back", async () => {
  const { p, calls } = unlisted({ knows: ["cosmoshub-4"] });
  const out = await enableChains(p, "cosmostation", ["safrochain-1", "cosmoshub-4"], {
    suggestFirst: [],
    suggest: async () => false,
    nameOf: (id) => id,
  });
  assert.ok(!calls.some((call) => call.startsWith("suggest")));
  assert.deepEqual(Object.keys(out.keys), ["cosmoshub-4"]);
  assert.deepEqual(out.skipped.map((s) => s.chainId), ["safrochain-1"]);
});

test("every wallet's no is a rejection: Keplr's and Leap's words, Cosmostation's, the 4001 code", () => {
  assert.equal(isUserRejection(new Error("Request rejected")), true);
  assert.equal(isUserRejection(new Error("User rejected the request.")), true);
  assert.equal(isUserRejection(Object.assign(new Error("Rejected"), { code: 4001 })), true);
  assert.equal(isUserRejection(new Error("There is no chain info for safrochain-1")), false);
});
