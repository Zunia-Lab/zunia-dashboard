/**
 * The browser wallets the dashboard connects, in one registry: the Zunia
 * extension, then the Cosmos wallets that speak the Keplr provider API
 * (`enable`, `getKey`, `signAmino`, `signDirect`, `experimentalSuggestChain`).
 * Everything that differs between them is here: where the provider lives,
 * the window event an account switch fires, the logo, where to get it.
 *
 * Where each one injects, and its events, as Interchain Kit and Cosmos Kit
 * describe them (@interchain-kit/<wallet>-extension@0.11.0 `registry.js`,
 * @cosmos-kit/<wallet>-extension `connectEventNamesOnWindow`), checked
 * against Cosmostation's own inject script (cosmostation-chrome-extension,
 * develop, src/script/inject):
 * - Keplr: `window.keplr`, `keplr_keystorechange`.
 * - Leap: `window.leap`, `leap_keystorechange`. Leap is no longer offered:
 *   its site and store listings are gone (checked 2026-10-07). An extension still installed
 *   keeps its keys and still connects, but there is nowhere to get one, so
 *   it is offered only where it is detected.
 * - Cosmostation: a Keplr-compatible provider at
 *   `window.cosmostation.providers.keplr`, `cosmostation_keystorechange`.
 *   It cannot list its chains through the Keplr API, so they are read from
 *   its own `cos_supportedChainIds` (the list its `enable` checks), and
 *   Disconnect revokes the site with its own `cos_disconnect`.
 *
 * Aliases: Zunia (on request, saying so with `isZunia`) and Cosmostation
 * (when its "Keplr" provider option is on and Keplr is absent) put their own
 * provider object at `window.keplr`, for dApps that only know Keplr. That
 * object is theirs, not Keplr's, so it is never offered as Keplr: one wallet,
 * one row, under its own name.
 *
 * Logos: the `ICON` data URIs shipped in @interchain-kit/keplr-extension,
 * @interchain-kit/leap-extension and @interchain-kit/cosmostation-extension
 * 0.11.0 (MIT, github.com/interchain-kit/interchain-kit `src/constant.ts`),
 * the images Interchain Kit's wallet list shows, decoded into
 * public/wallets/: Leap's SVG as shipped; Keplr's and Cosmostation's 256 px
 * PNGs resized to 128 px (Cosmostation's 6 px transparent margin trimmed
 * first). The marks belong to their wallets. Zunia draws its own mark.
 */

import type { ExtensionProvider } from "./extension";

export type ExtensionWallet = "zunia" | "keplr" | "leap" | "cosmostation";

/** Every browser wallet, Zunia first. */
export const EXTENSION_WALLETS = ["zunia", "keplr", "leap", "cosmostation"] as const satisfies readonly ExtensionWallet[];

/** The Cosmos wallets other than Zunia, in the order the connect list shows them. */
export const COSMOS_WALLETS = ["keplr", "leap", "cosmostation"] as const satisfies readonly ExtensionWallet[];
export type CosmosWallet = (typeof COSMOS_WALLETS)[number];

/** Where providers are injected: the page's `window`, or a stand-in in tests. */
export interface WalletScope {
  readonly zunia?: unknown;
  readonly keplr?: unknown;
  readonly leap?: unknown;
  readonly cosmostation?: unknown;
}

/**
 * Where to get a wallet. `any`: its own page, which picks the build for the
 * browser or phone. `chromium-desktop`: a Chrome Web Store listing, useful
 * only in a Chromium browser on a computer.
 */
export interface WalletInstall {
  url: string;
  browsers: "any" | "chromium-desktop";
}

export interface WalletInfo {
  id: ExtensionWallet;
  /** The wallet's name as it writes it. */
  label: string;
  /** The window event it fires when the user switches accounts. */
  keystoreEvent: string;
  /** Its logo under /public; null for Zunia, which draws its own mark. */
  logo: string | null;
  /** Where to get it; null when it cannot be installed any more. Zunia's is browser-matched (`./install`). */
  install: WalletInstall | null;
  /** The object at the wallet's own name, before the alias checks. */
  provider(scope: WalletScope): unknown;
  /**
   * The chains it knows, asked its own way, for a wallet the Keplr API
   * cannot ask (`getChainInfosWithoutEndpoints`). Null when it cannot say.
   */
  listChains?(scope: WalletScope | undefined): Promise<Set<string> | null>;
  /**
   * Suggest the home chain before `enable` when the wallet cannot list the
   * chains it knows: Leap documents that order for a chain it does not ship
   * (Safrochain is in no wallet's registry).
   */
  suggestBeforeEnable?: boolean;
  /** Said under its name while it is detected, instead of the usual line. */
  detectedLine: string;
}

/** `window.cosmostation`, as far as this file reads it. */
interface CosmostationGlobal {
  providers?: { keplr?: unknown };
  cosmos?: { request?: (args: { method: string; params?: unknown }) => Promise<unknown> };
}

function cosmostationOf(scope: WalletScope): CosmostationGlobal | undefined {
  const value = scope.cosmostation;
  return value && typeof value === "object" ? (value as CosmostationGlobal) : undefined;
}

export const WALLETS: Readonly<Record<ExtensionWallet, WalletInfo>> = {
  zunia: {
    id: "zunia",
    label: "Zunia",
    // What the dashboard has always listened to for Zunia (it fires it while
    // its Keplr alias is on), beside the provider's own `accountsChanged`.
    keystoreEvent: "keplr_keystorechange",
    logo: null,
    install: { url: "https://chromewebstore.google.com/detail/zunia/ngokakoekdogobjmokipglbcclelgajk", browsers: "chromium-desktop" },
    provider: (scope) => scope.zunia,
    detectedLine: "Connect the Zunia wallet in this browser.",
  },
  keplr: {
    id: "keplr",
    label: "Keplr",
    keystoreEvent: "keplr_keystorechange",
    logo: "/wallets/keplr.png",
    install: { url: "https://www.keplr.app/get", browsers: "any" },
    provider: (scope) => scope.keplr,
    detectedLine: "Connect your Keplr wallet.",
  },
  leap: {
    id: "leap",
    label: "Leap",
    keystoreEvent: "leap_keystorechange",
    logo: "/wallets/leap.svg",
    // No longer offered: its site and store listings are gone (checked 2026-10-07).
    install: null,
    provider: (scope) => scope.leap,
    suggestBeforeEnable: true,
    detectedLine: "Leap is no longer offered for download.",
  },
  cosmostation: {
    id: "cosmostation",
    label: "Cosmostation",
    keystoreEvent: "cosmostation_keystorechange",
    logo: "/wallets/cosmostation.png",
    // Its Chrome Web Store listing: the extension is Chromium-only, and its
    // website's download pages are gone.
    install: { url: "https://chromewebstore.google.com/detail/cosmostation-wallet/fpkhgmpbidmiogeglndfbkegfdlnajnf", browsers: "chromium-desktop" },
    provider: (scope) => cosmostationOf(scope)?.providers?.keplr,
    listChains: cosmostationChains,
    detectedLine: "Connect your Cosmostation wallet.",
  },
};

export function isExtensionWallet(value: unknown): value is ExtensionWallet {
  return typeof value === "string" && (EXTENSION_WALLETS as readonly string[]).includes(value);
}

export function walletLabel(wallet: ExtensionWallet): string {
  return WALLETS[wallet].label;
}

/** An object that can at least connect: the two calls every wallet here answers. */
function isProvider(value: unknown): value is ExtensionProvider {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { enable?: unknown; getKey?: unknown };
  return typeof candidate.enable === "function" && typeof candidate.getKey === "function";
}

/**
 * The wallet's provider in `scope`, or undefined when it is absent or when
 * the object at its name belongs to another wallet (see the header):
 * - anything that says it is Zunia (`isZunia`, or `window.zunia` itself) is
 *   Zunia's, whatever name it sits at;
 * - `window.keplr` is Keplr's only when no other wallet's own name holds the
 *   same object (Cosmostation's alias, or a Leap one).
 * Zunia's own is `window.zunia` as it is, as it has always been read.
 */
export function walletProviderIn(scope: WalletScope | undefined, wallet: ExtensionWallet): ExtensionProvider | undefined {
  if (!scope) return undefined;
  const own = WALLETS[wallet].provider(scope);
  if (wallet === "zunia") return own ? (own as ExtensionProvider) : undefined;
  if (!isProvider(own)) return undefined;
  if (own === scope.zunia || own.isZunia === true) return undefined;
  if (wallet === "keplr" && COSMOS_WALLETS.some((other) => other !== "keplr" && WALLETS[other].provider(scope) === own)) {
    return undefined;
  }
  return own;
}

/** The wallets `scope` holds, in registry order (Zunia first). */
export function walletsIn(scope: WalletScope | undefined): ExtensionWallet[] {
  return EXTENSION_WALLETS.filter((wallet) => walletProviderIn(scope, wallet) !== undefined);
}

/**
 * Whether the page can send someone to get `wallet` in this browser: a
 * Chrome Web Store listing only helps in a Chromium browser on a computer,
 * and a wallet that is no longer offered has nothing to get.
 */
export function canGetWallet(wallet: ExtensionWallet, browser: { chromiumDesktop: boolean }): boolean {
  const install = WALLETS[wallet].install;
  if (!install) return false;
  return install.browsers === "any" || browser.chromiumDesktop;
}

/**
 * The chains Cosmostation knows, asked without a prompt (`cos_supportedChainIds`,
 * the list its Keplr-API `enable` checks before it opens anything). Null when
 * it cannot say.
 */
export async function cosmostationChains(scope: WalletScope | undefined): Promise<Set<string> | null> {
  const cosmos = scope ? cosmostationOf(scope)?.cosmos : undefined;
  if (typeof cosmos?.request !== "function") return null;
  try {
    const answer = (await cosmos.request({ method: "cos_supportedChainIds" })) as { official?: unknown; unofficial?: unknown } | null;
    const ids = [
      ...(Array.isArray(answer?.official) ? answer.official : []),
      ...(Array.isArray(answer?.unofficial) ? answer.unofficial : []),
    ].filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? new Set(ids) : null;
  } catch {
    return null;
  }
}

/**
 * Takes this site's access back, so Disconnect means the next visit asks
 * again: `disable()` where the wallet has it (Zunia, Keplr), Cosmostation's
 * `cos_disconnect`, Leap's per-chain `disconnect`. Best effort, never throws.
 */
export async function revokeIn(scope: WalletScope | undefined, wallet: ExtensionWallet, chainIds: readonly string[]): Promise<void> {
  const provider = walletProviderIn(scope, wallet);
  if (!provider) return;
  try {
    if (provider.disable) {
      await provider.disable();
      return;
    }
    if (wallet === "cosmostation") {
      const cosmos = scope ? cosmostationOf(scope)?.cosmos : undefined;
      if (typeof cosmos?.request === "function") await cosmos.request({ method: "cos_disconnect" });
      return;
    }
    const disconnect = provider.disconnect;
    if (typeof disconnect === "function") await Promise.all(chainIds.map((chainId) => disconnect.call(provider, chainId)));
  } catch {
    // The wallet keeps the site approved; the session here is gone all the same.
  }
}
