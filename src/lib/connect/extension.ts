/**
 * Browser-extension wallets: the Zunia extension (`window.zunia`), Keplr
 * (`window.keplr`), Leap (`window.leap`) and Cosmostation
 * (`window.cosmostation.providers.keplr`). All speak the Keplr provider API;
 * keys never leave them. What differs between them is in `./wallets`.
 *
 * Connecting means one `enable([...])` for the home chain plus the followed
 * chains — one approval prompt, not one per chain — then `getKey` per chain.
 * Chains a wallet does not know are handled without a prompt storm:
 * - the home chain (Safrochain, absent from Keplr's registry) is suggested at
 *   connect time, because the dashboard is useless without it;
 * - any other unknown chain is left out of the batch and suggested later, the
 *   first time something has to be signed there (`ensureChain`).
 * A chain that still fails is reported per chain; the others stay connected.
 */

import { asBytes } from "@/lib/tx/bytes";
import {
  EXTENSION_WALLETS,
  WALLETS,
  revokeIn,
  walletLabel,
  walletProviderIn,
  type ExtensionWallet,
  type WalletScope,
} from "./wallets";

export type { ExtensionWallet } from "./wallets";
export { walletLabel } from "./wallets";

/** What `getKey(chainId)` answers (Keplr's `Key`). */
export interface ExtensionKey {
  name: string;
  algo: string;
  pubKey: Uint8Array;
  address?: Uint8Array | string;
  bech32Address: string;
  isNanoLedger?: boolean;
  isKeystone?: boolean;
  ethereumHexAddress?: string;
}

/** The provider surface every one of them exposes (Keplr API). */
export interface ExtensionProvider {
  /**
   * The provider API version. Zunia answers "0.1.0" in every release so far,
   * so it says nothing about the build: read `zuniaCapabilities` instead.
   * Keplr answers its own release.
   */
  readonly version?: string;
  /** Zunia 0.1.5+: the installed release (manifest version), "" when unreadable. Absent on 0.1.4 and older. */
  readonly extensionVersion?: string;
  /** Zunia 0.1.5+: true on Zunia's provider, also when it is aliased as `window.keplr`. */
  readonly isZunia?: boolean;
  /** Zunia 0.1.5+: what this build can sign (`ZUNIA_SIGNING_FEATURES` in `@/lib/tx/zunia-capabilities`). */
  readonly features?: readonly string[];
  enable(chainIds: string | string[]): Promise<void>;
  getKey(chainId: string): Promise<ExtensionKey>;
  experimentalSuggestChain?(chainInfo: unknown): Promise<void>;
  getChainInfosWithoutEndpoints?(): Promise<Array<{ chainId: string }>>;
  /** Zunia only: the chains this site may use now, without prompting. */
  getConnectedChains?(): Promise<string[]>;
  /**
   * Zunia only, for a site that holds a grant: whether the wallet is locked,
   * answered silently (no unlock window). Refused (`NOT_CONNECTED`) without a grant.
   */
  isLocked?(): Promise<boolean>;
  signAmino?(chainId: string, signer: string, signDoc: unknown, signOptions?: unknown): Promise<unknown>;
  signDirect?(chainId: string, signer: string, signDoc: unknown, signOptions?: unknown): Promise<unknown>;
  signArbitrary?(
    chainId: string,
    signer: string,
    data: string,
  ): Promise<{ signature: string; pub_key: { type?: string; value: string } }>;
  on?(event: string, listener: (data?: unknown) => void): void;
  off?(event: string, listener: (data?: unknown) => void): void;
  /** Revoke this site's access (Zunia; recent Keplr). */
  disable?(chainIds?: string | string[]): Promise<void>;
  /** Leap: revoke this site's access to one chain. */
  disconnect?(chainId: string): Promise<unknown>;
}

/** Waits up to `timeoutMs` for an extension to inject its provider (Zunia injects after start). */
export async function waitForProvider(wallet: ExtensionWallet, timeoutMs = 2_500): Promise<ExtensionProvider | undefined> {
  const now = getExtensionProvider(wallet);
  if (now || typeof window === "undefined") return now;
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const provider = getExtensionProvider(wallet);
      if (provider || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(provider);
      }
    }, 100);
  });
}

/** @deprecated Use `ExtensionProvider`. */
export type ZuniaProvider = ExtensionProvider;

declare global {
  interface Window {
    zunia?: ExtensionProvider;
    keplr?: ExtensionProvider;
    leap?: ExtensionProvider;
    cosmostation?: {
      providers?: { keplr?: ExtensionProvider };
      cosmos?: { request?: (args: { method: string; params?: unknown }) => Promise<unknown> };
    };
  }
}

/** Fired by the Zunia extension once `window.zunia` exists (sdk-web `ZUNIA_INITIALIZED_EVENT`). */
const ZUNIA_INITIALIZED_EVENT = "zunia#initialized";

function scope(): WalletScope | undefined {
  return typeof window === "undefined" ? undefined : window;
}

export function getExtensionProvider(wallet?: ExtensionWallet): ExtensionProvider | undefined {
  if (typeof window === "undefined") return undefined;
  if (wallet) return walletProviderIn(window, wallet);
  return window.zunia ?? window.keplr;
}

export function isZuniaAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.zunia);
}

/**
 * Keplr proper. The Zunia extension can alias itself as `window.keplr` for
 * dApps that only know Keplr; that alias is Zunia, and offering it as "Keplr"
 * would connect the same wallet under the wrong name. From 0.1.5 the alias
 * also says so itself (`isZunia`). Cosmostation's alias is its own provider
 * object, and is Cosmostation's (`walletProviderIn`).
 */
export function isKeplrAvailable(): boolean {
  return walletProviderIn(scope(), "keplr") !== undefined;
}

export function isWalletAvailable(wallet: ExtensionWallet): boolean {
  return wallet === "zunia" ? isZuniaAvailable() : walletProviderIn(scope(), wallet) !== undefined;
}

export function isExtensionAvailable(): boolean {
  return EXTENSION_WALLETS.some(isWalletAvailable);
}

/**
 * The detected wallets as one string ("zunia,keplr"), for
 * `useSyncExternalStore`: a snapshot must compare equal while nothing
 * changed, and a fresh array never does. Zunia is `isZuniaAvailable`, Keplr
 * `isKeplrAvailable`.
 */
export function detectedWalletsKey(): string {
  return EXTENSION_WALLETS.filter(isWalletAvailable).join(",");
}

/** The keystore events of every wallet, each once (Zunia and Keplr share Keplr's). */
const KEYSTORE_EVENTS = [...new Set(EXTENSION_WALLETS.map((wallet) => WALLETS[wallet].keystoreEvent))];

/**
 * For `useSyncExternalStore`: providers are injected after the page starts
 * (at `load`, or on the extension's own event), so detection is re-read then
 * and once more shortly after.
 */
export function subscribeExtensions(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const timers = [setTimeout(listener, 600), setTimeout(listener, 2_000)];
  window.addEventListener("load", listener);
  window.addEventListener(ZUNIA_INITIALIZED_EVENT, listener);
  for (const event of KEYSTORE_EVENTS) window.addEventListener(event, listener);
  return () => {
    timers.forEach(clearTimeout);
    window.removeEventListener("load", listener);
    window.removeEventListener(ZUNIA_INITIALIZED_EVENT, listener);
    for (const event of KEYSTORE_EVENTS) window.removeEventListener(event, listener);
  };
}

/** Take this site's access back in the wallet (`revokeIn`). Best effort. */
export function revokeAccess(wallet: ExtensionWallet, chainIds: readonly string[]): Promise<void> {
  return revokeIn(scope(), wallet, chainIds);
}

/**
 * What a wallet needs beyond the Keplr API to connect without a prompt storm
 * (`EnableOptions`): its own way to list its chains (Cosmostation), and
 * whether the home chain is suggested before `enable` when it cannot (Leap).
 * Nothing for Zunia and Keplr.
 */
export function enableOptionsFor(wallet: ExtensionWallet): Pick<EnableOptions, "listChains" | "suggestBeforeEnable"> {
  const info = WALLETS[wallet];
  const listChains = info.listChains;
  return {
    ...(listChains ? { listChains: () => listChains(scope()) } : {}),
    ...(info.suggestBeforeEnable ? { suggestBeforeEnable: true } : {}),
  };
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/**
 * The wallet is locked and was not unlocked: Zunia's `LOCKED` ("Zunia stayed
 * locked, so the request was cancelled", "The Zunia window was closed before
 * unlocking", "Wallet locked") or a prompt window closed unanswered. Read from
 * the words too, because `enableChains` reports a key it could not read by
 * its reason. Neither means the site lost its access: a restore that meets
 * one keeps the reconnect hint and waits for an unlock.
 */
export function isLockedOrClosed(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === "LOCKED") return true;
  return /stayed locked|wallet (?:is )?locked|closed before unlocking|window was closed/i.test(errorText(error));
}

/**
 * Whether Zunia is locked, asked without opening anything. False when it
 * cannot say (an extension without `isLocked`, a refused call): the caller
 * then goes on as before.
 */
export async function isExtensionLocked(provider: ExtensionProvider): Promise<boolean> {
  if (!provider.isLocked) return false;
  try {
    return (await provider.isLocked()) === true;
  } catch {
    return false;
  }
}

/**
 * The chains Zunia lets this site use now, asked silently; null when it
 * cannot say (no `getConnectedChains`, an older build, a failed call). An
 * empty list means the grant is gone: Zunia keeps a site's approval for 7
 * days, and the user can revoke it in Zunia's Settings at any time.
 */
export async function grantedChains(provider: ExtensionProvider): Promise<string[] | null> {
  if (!provider.getConnectedChains) return null;
  try {
    const granted: unknown = await provider.getConnectedChains();
    return Array.isArray(granted) ? granted.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/**
 * The user said no in the wallet. Not an error to dwell on, not one to retry.
 * Keplr and Leap say "Request rejected"; Cosmostation "User rejected the
 * request." (its Keplr-API provider rethrows without the 4001 code).
 */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "USER_REJECTED" || code === 4001) return true;
  return /request rejected|rejected by (the )?user|user rejected|user denied|declined/i.test(errorText(error));
}

/** The wallet does not know the chain (Keplr: "There is no chain info for X"). */
export function unknownChainOf(error: unknown): string | null {
  const text = errorText(error);
  const match =
    /no chain info for ([^\s,.'"]+)/i.exec(text) ?? /does not know the chain ([^\s,'"]+?)\.?(\s|$)/i.exec(text);
  if (match?.[1]) return match[1];
  const code = (error as { code?: unknown } | null)?.code;
  return code === "UNKNOWN_CHAIN" ? "" : null;
}

/** The chains the wallet already knows, or null when it cannot say (old Keplr). */
export async function knownChainIds(provider: ExtensionProvider): Promise<Set<string> | null> {
  if (!provider.getChainInfosWithoutEndpoints) return null;
  try {
    const infos = await provider.getChainInfosWithoutEndpoints();
    if (!Array.isArray(infos)) return null;
    return new Set(infos.map((info) => info?.chainId).filter((id): id is string => typeof id === "string"));
  } catch {
    return null;
  }
}

/** A key with its bytes normalised (extensions answer across postMessage). */
export async function readKey(provider: ExtensionProvider, chainId: string): Promise<ExtensionKey> {
  const key = await provider.getKey(chainId);
  if (!key || typeof key.bech32Address !== "string" || !key.bech32Address) {
    throw new Error(`The wallet returned no address for ${chainId}.`);
  }
  return { ...key, pubKey: asBytes(key.pubKey, "public key") };
}

export interface EnableOutcome {
  /** Chains enabled and with a key. */
  keys: Record<string, ExtensionKey>;
  /** Chains left out, each with a reason a person can read. */
  skipped: Array<{ chainId: string; reason: string }>;
}

export interface EnableOptions {
  /** Chains to suggest when the wallet does not know them (usually the home chain). */
  suggestFirst: readonly string[];
  /** Adds a chain the wallet does not know; resolves false when it could not. */
  suggest: (chainId: string) => Promise<boolean>;
  /** Readable chain name for messages. */
  nameOf: (chainId: string) => string;
  /**
   * The chains the wallet knows, asked its own way, for a wallet the Keplr
   * API cannot ask (Cosmostation). Null when it cannot say either.
   */
  listChains?: () => Promise<Set<string> | null>;
  /**
   * When the wallet cannot list its chains at all, suggest `suggestFirst`
   * before the batch anyway (Leap's documented order for a chain it does not
   * ship). Otherwise such a chain is suggested only once `enable` refuses it.
   */
  suggestBeforeEnable?: boolean;
}

/**
 * One `enable([...])` for `chainIds`, then `getKey` per chain.
 *
 * Throws only when nothing at all was enabled (a rejection, a locked wallet
 * that stayed locked); every partial failure is in `skipped`.
 */
export async function enableChains(
  provider: ExtensionProvider,
  wallet: ExtensionWallet,
  chainIds: readonly string[],
  options: EnableOptions,
): Promise<EnableOutcome> {
  const skipped: EnableOutcome["skipped"] = [];
  const known = (await knownChainIds(provider)) ?? (options.listChains ? await options.listChains() : null);
  const suggested = new Set<string>();
  /** Suggests a chain once: true when it is in the wallet now, false when it was left out (with its reason). */
  const suggestOnce = async (chainId: string): Promise<boolean> => {
    suggested.add(chainId);
    let added = false;
    try {
      added = await options.suggest(chainId);
    } catch (error) {
      if (isUserRejection(error)) {
        skipped.push({ chainId, reason: `You declined adding ${options.nameOf(chainId)} to ${walletLabel(wallet)}.` });
        return false;
      }
    }
    if (!added) skipped.push({ chainId, reason: `${walletLabel(wallet)} could not add ${options.nameOf(chainId)}.` });
    return added;
  };
  let batch: string[] = [];
  for (const chainId of chainIds) {
    const unlisted = !known && options.suggestBeforeEnable === true && options.suggestFirst.includes(chainId);
    if ((!known && !unlisted) || known?.has(chainId)) {
      batch.push(chainId);
      continue;
    }
    if (options.suggestFirst.includes(chainId)) {
      if (await suggestOnce(chainId)) batch.push(chainId);
      continue;
    }
    skipped.push({
      chainId,
      reason: `${walletLabel(wallet)} does not know ${options.nameOf(chainId)} yet; it is added the first time you sign there.`,
    });
  }

  // One prompt for the whole batch. When the wallet could not list its chains
  // and refuses one in the batch, drop that one and ask again (at most three
  // times): the refusal happens before any prompt, so this costs no clicks.
  // A refused chain the dashboard needs (the home chain) is suggested first,
  // once, and the batch asked again with it.
  for (let attempt = 0; batch.length > 0; attempt++) {
    try {
      await provider.enable(batch);
      break;
    } catch (error) {
      const unknown = unknownChainOf(error);
      if (unknown && batch.includes(unknown) && options.suggestFirst.includes(unknown) && !suggested.has(unknown)) {
        if (!(await suggestOnce(unknown))) batch = batch.filter((id) => id !== unknown);
        attempt--;
        continue;
      }
      if (unknown && batch.includes(unknown) && attempt < 3) {
        batch = batch.filter((id) => id !== unknown);
        skipped.push({ chainId: unknown, reason: `${walletLabel(wallet)} does not know ${options.nameOf(unknown)}.` });
        continue;
      }
      throw error;
    }
  }

  const keys: Record<string, ExtensionKey> = {};
  await Promise.all(
    batch.map(async (chainId) => {
      try {
        keys[chainId] = await readKey(provider, chainId);
      } catch (error) {
        skipped.push({ chainId, reason: errorText(error) });
      }
    }),
  );
  if (Object.keys(keys).length === 0) {
    throw new Error(
      skipped[0]?.reason ?? `${walletLabel(wallet)} did not share an account for any of the requested chains.`,
    );
  }
  return { keys, skipped };
}
