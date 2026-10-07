/** The browser wallets: one registry, each found under its own name only, an alias never twice. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readWalletHint } from "../walletHint";
import {
  canGetWallet,
  COSMOS_WALLETS,
  cosmostationChains,
  EXTENSION_WALLETS,
  isExtensionWallet,
  revokeIn,
  WALLETS,
  walletLabel,
  walletProviderIn,
  walletsIn,
  type WalletScope,
} from "../wallets";

const ROOT = join(import.meta.dirname, "../../../..");

/** The two calls every wallet answers; `getKey` is never reached here. */
function provider(extra: Record<string, unknown> = {}) {
  return {
    enable: async () => {},
    getKey: async () => {
      throw new Error("not asked");
    },
    ...extra,
  };
}

test("one entry per wallet, Zunia first: its name, its keystore event, its logo, where to get it", () => {
  assert.deepEqual([...EXTENSION_WALLETS], ["zunia", "keplr", "leap", "cosmostation"]);
  assert.deepEqual([...COSMOS_WALLETS], ["keplr", "leap", "cosmostation"]);
  for (const wallet of EXTENSION_WALLETS) assert.equal(WALLETS[wallet].id, wallet);

  assert.deepEqual(EXTENSION_WALLETS.map(walletLabel), ["Zunia", "Keplr", "Leap", "Cosmostation"]);
  // Their own events (Interchain Kit's `keystoreChange`, Cosmostation's inject script);
  // Zunia keeps the one the dashboard has always listened to.
  assert.deepEqual(
    EXTENSION_WALLETS.map((wallet) => WALLETS[wallet].keystoreEvent),
    ["keplr_keystorechange", "keplr_keystorechange", "leap_keystorechange", "cosmostation_keystorechange"],
  );

  // Zunia draws its own mark; every other logo is a local file, never a hotlink.
  assert.equal(WALLETS.zunia.logo, null);
  for (const wallet of COSMOS_WALLETS) {
    const logo = WALLETS[wallet].logo;
    assert.ok(logo?.startsWith("/wallets/"), `${wallet}: a path under public/wallets`);
    const file = join(ROOT, "public", logo!);
    assert.ok(existsSync(file), `${wallet}: ${file} exists`);
    assert.ok(statSync(file).size < 16_000, `${wallet}: small enough for a 40 px tile`);
  }
  assert.match(readFileSync(join(ROOT, "public/wallets/leap.svg"), "utf8"), /^<svg[^>]*viewBox="0 0 166 166"/);
  for (const png of ["keplr", "cosmostation"]) {
    const bytes = readFileSync(join(ROOT, `public/wallets/${png}.png`));
    assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47], `${png}: a PNG`);
    assert.equal(bytes.readUInt32BE(16), 128, `${png}: 128 px wide`);
    assert.equal(bytes.readUInt32BE(20), 128, `${png}: 128 px tall`);
  }

  // Where to get each: Keplr's own page (it picks the build), Cosmostation's
  // Chrome Web Store listing, nothing for Leap (shut down on 28 May 2026).
  assert.deepEqual(WALLETS.keplr.install, { url: "https://www.keplr.app/get", browsers: "any" });
  assert.equal(WALLETS.cosmostation.install?.browsers, "chromium-desktop");
  assert.match(WALLETS.cosmostation.install!.url, /^https:\/\/chromewebstore\.google\.com\/detail\/[\w-]+\/fpkhgmpbidmiogeglndfbkegfdlnajnf$/);
  assert.equal(WALLETS.leap.install, null);
  assert.match(WALLETS.leap.detectedLine, /shut down in May 2026/);
});

test("what this browser can be sent to get: Keplr anywhere, Cosmostation in Chromium on a computer, Leap nowhere", () => {
  const desktop = { chromiumDesktop: true };
  const elsewhere = { chromiumDesktop: false };
  assert.equal(canGetWallet("keplr", desktop), true);
  assert.equal(canGetWallet("keplr", elsewhere), true);
  assert.equal(canGetWallet("cosmostation", desktop), true);
  assert.equal(canGetWallet("cosmostation", elsewhere), false);
  assert.equal(canGetWallet("leap", desktop), false);
  assert.equal(canGetWallet("leap", elsewhere), false);
});

test("a wallet name is one of the registry's, nothing else", () => {
  for (const wallet of EXTENSION_WALLETS) assert.equal(isExtensionWallet(wallet), true);
  for (const other of ["zunia-mobile", "metamask", "Keplr", "", 1, null, undefined]) assert.equal(isExtensionWallet(other), false, String(other));
});

test("each wallet is found at its own name: window.zunia, window.keplr, window.leap, window.cosmostation.providers.keplr", () => {
  const zunia = provider({ isZunia: true });
  const keplr = provider();
  const leap = provider();
  const cosmostation = provider();
  const scope: WalletScope = { zunia, keplr, leap, cosmostation: { providers: { keplr: cosmostation } } };
  assert.equal(walletProviderIn(scope, "zunia"), zunia);
  assert.equal(walletProviderIn(scope, "keplr"), keplr);
  assert.equal(walletProviderIn(scope, "leap"), leap);
  assert.equal(walletProviderIn(scope, "cosmostation"), cosmostation);
  assert.deepEqual(walletsIn(scope), ["zunia", "keplr", "leap", "cosmostation"]);

  assert.deepEqual(walletsIn({}), []);
  assert.deepEqual(walletsIn(undefined), [], "no window: the server and the hydration pass");
  // Cosmostation without its Keplr-API provider (an old build) is not offered.
  assert.deepEqual(walletsIn({ cosmostation: { providers: {} } }), []);
  assert.deepEqual(walletsIn({ cosmostation: true }), []);
  // Half a provider cannot connect.
  assert.deepEqual(walletsIn({ keplr: { enable: async () => {} }, leap: "leap" }), []);
});

test("an alias at window.keplr is its own wallet's, never a second row", () => {
  // Zunia's Keplr alias: the same object, and from 0.1.5 it says so.
  const zunia = provider({ isZunia: true });
  assert.deepEqual(walletsIn({ zunia, keplr: zunia }), ["zunia"]);
  // An older Zunia says nothing, but it is the same object.
  const quiet = provider();
  assert.deepEqual(walletsIn({ zunia: quiet, keplr: quiet }), ["zunia"]);
  // A Zunia alias seen before window.zunia (or under another name): isZunia alone.
  assert.deepEqual(walletsIn({ keplr: provider({ isZunia: true }) }), []);
  assert.deepEqual(walletsIn({ leap: provider({ isZunia: true }) }), []);

  // Cosmostation's "Keplr" option: window.keplr = window.cosmostation.providers.keplr.
  const cosmostation = provider({ version: "0.0.0", mode: "extension" });
  const aliased: WalletScope = { keplr: cosmostation, cosmostation: { providers: { keplr: cosmostation } } };
  assert.deepEqual(walletsIn(aliased), ["cosmostation"]);
  assert.equal(walletProviderIn(aliased, "keplr"), undefined);
  assert.equal(walletProviderIn(aliased, "cosmostation"), cosmostation);

  // A Leap alias the same way.
  const leap = provider();
  assert.deepEqual(walletsIn({ keplr: leap, leap }), ["leap"]);

  // Keplr installed beside them keeps its own row.
  const keplr = provider();
  assert.deepEqual(walletsIn({ keplr, leap, cosmostation: { providers: { keplr: cosmostation } } }), ["keplr", "leap", "cosmostation"]);
});

test("Cosmostation's chains, asked without a prompt: cos_supportedChainIds, official and unofficial", async () => {
  const asked: unknown[] = [];
  const scope = (request: (args: { method: string }) => Promise<unknown>): WalletScope => ({
    cosmostation: { providers: { keplr: provider() }, cosmos: { request } },
  });
  const known = await cosmostationChains(
    scope(async (args) => {
      asked.push(args);
      return { official: ["cosmoshub-4", "osmosis-1"], unofficial: ["safrochain-1", 7] };
    }),
  );
  assert.deepEqual(asked, [{ method: "cos_supportedChainIds" }]);
  assert.deepEqual(known && [...known], ["cosmoshub-4", "osmosis-1", "safrochain-1"]);
  // Anything else: it cannot say, and the connect asks the wallet chain by chain.
  assert.equal(await cosmostationChains(scope(async () => Promise.reject(new Error("x")))), null);
  assert.equal(await cosmostationChains(scope(async () => ({ official: [], unofficial: [] }))), null);
  assert.equal(await cosmostationChains(scope(async () => "nope")), null);
  assert.equal(await cosmostationChains({ cosmostation: { providers: { keplr: provider() } } }), null);
  assert.equal(await cosmostationChains(undefined), null);
  assert.equal(WALLETS.cosmostation.listChains, cosmostationChains);
  assert.equal(WALLETS.keplr.listChains, undefined, "Keplr answers getChainInfosWithoutEndpoints");
  assert.equal(WALLETS.leap.suggestBeforeEnable, true, "Leap: suggest a chain it does not ship before enable");
});

test("Disconnect takes the site's access back the wallet's own way, and never throws", async () => {
  const calls: string[] = [];
  // Zunia and Keplr: disable().
  const zunia = provider({
    isZunia: true,
    disable: async () => {
      calls.push("zunia.disable");
    },
  });
  await revokeIn({ zunia }, "zunia", ["safrochain-1"]);
  const keplr = provider({
    disable: async () => {
      calls.push("keplr.disable");
    },
  });
  await revokeIn({ keplr }, "keplr", ["safrochain-1"]);
  // Leap: disconnect(chainId), per chain.
  const leap = provider({
    disconnect: async (chainId: string) => {
      calls.push(`leap.disconnect:${chainId}`);
      return true;
    },
  });
  await revokeIn({ leap }, "leap", ["safrochain-1", "osmosis-1"]);
  // Cosmostation: its own cos_disconnect.
  await revokeIn(
    {
      cosmostation: {
        providers: { keplr: provider() },
        cosmos: {
          request: async ({ method }: { method: string }) => {
            calls.push(`cosmostation.${method}`);
            return null;
          },
        },
      },
    },
    "cosmostation",
    ["safrochain-1"],
  );
  assert.deepEqual(calls, ["zunia.disable", "keplr.disable", "leap.disconnect:safrochain-1", "leap.disconnect:osmosis-1", "cosmostation.cos_disconnect"]);

  // A wallet that refuses, or is gone, or cannot revoke: the session here ends all the same.
  const refusing = provider({ disable: async () => Promise.reject(new Error("nope")) });
  await revokeIn({ keplr: refusing }, "keplr", ["safrochain-1"]);
  await revokeIn({}, "leap", ["safrochain-1"]);
  await revokeIn({ keplr: provider() }, "keplr", ["safrochain-1"]);
  // An alias is revoked as the wallet it is, never as Keplr.
  const cosmostation = provider({
    disable: async () => {
      calls.push("wrong");
    },
  });
  await revokeIn({ keplr: cosmostation, cosmostation: { providers: { keplr: cosmostation } } }, "keplr", []);
  assert.equal(calls.includes("wrong"), false);
});

test("the reconnect hint remembers every browser wallet, and nothing it does not know", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  const globals = globalThis as unknown as { window?: unknown };
  const before = globals.window;
  globals.window = { localStorage: storage };
  try {
    for (const wallet of EXTENSION_WALLETS) {
      stored.set("zunia.dashboard.walletHint", JSON.stringify({ mode: "extension", wallet, chainId: "safrochain-1", chains: ["safrochain-1", "osmosis-1"] }));
      assert.deepEqual(readWalletHint(), { mode: "extension", wallet, chainId: "safrochain-1", chains: ["safrochain-1", "osmosis-1"] }, wallet);
    }
    stored.set("zunia.dashboard.walletHint", JSON.stringify({ mode: "extension", wallet: "metamask", chainId: "safrochain-1" }));
    assert.equal(readWalletHint(), null);
  } finally {
    globals.window = before;
  }
});
