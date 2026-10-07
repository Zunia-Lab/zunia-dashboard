/**
 * Browser-extension wallets: the Zunia extension (`window.zunia`) and Keplr
 * (`window.keplr`). Both speak the Keplr provider API; keys never leave them.
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

export type ExtensionWallet = "zunia" | "keplr";

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

/** The provider surface both extensions expose (Keplr API). */
export interface ExtensionProvider {
  enable(chainIds: string | string[]): Promise<void>;
  getKey(chainId: string): Promise<ExtensionKey>;
  experimentalSuggestChain?(chainInfo: unknown): Promise<void>;
  getChainInfosWithoutEndpoints?(): Promise<Array<{ chainId: string }>>;
  /** Zunia only: the chains this site may use now, without prompting. */
  getConnectedChains?(): Promise<string[]>;
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
  }
}

export const ZUNIA_EXTENSION_INSTALL_URL = "https://chromewebstore.google.com/detail/zunia/ngokakoekdogobjmokipglbcclelgajk";
export const KEPLR_INSTALL_URL = "https://www.keplr.app/get";

/** Fired by the Zunia extension once `window.zunia` exists (sdk-web `ZUNIA_INITIALIZED_EVENT`). */
const ZUNIA_INITIALIZED_EVENT = "zunia#initialized";

export function getExtensionProvider(wallet?: ExtensionWallet): ExtensionProvider | undefined {
  if (typeof window === "undefined") return undefined;
  if (wallet === "zunia") return window.zunia;
  if (wallet === "keplr") return isKeplrAvailable() ? window.keplr : undefined;
  return window.zunia ?? window.keplr;
}

export function isZuniaAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.zunia);
}

/**
 * Keplr proper. The Zunia extension can alias itself as `window.keplr` for
 * dApps that only know Keplr; that alias is Zunia, and offering it as "Keplr"
 * would connect the same wallet under the wrong name.
 */
export function isKeplrAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.keplr) && window.keplr !== window.zunia;
}

export function isExtensionAvailable(): boolean {
  return isZuniaAvailable() || isKeplrAvailable();
}

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
  window.addEventListener("keplr_keystorechange", listener);
  return () => {
    timers.forEach(clearTimeout);
    window.removeEventListener("load", listener);
    window.removeEventListener(ZUNIA_INITIALIZED_EVENT, listener);
    window.removeEventListener("keplr_keystorechange", listener);
  };
}

export function walletLabel(wallet: ExtensionWallet): string {
  return wallet === "keplr" ? "Keplr" : "Zunia";
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/** The user said no in the wallet. Not an error to dwell on, not one to retry. */
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
  const known = await knownChainIds(provider);
  let batch: string[] = [];
  for (const chainId of chainIds) {
    if (!known || known.has(chainId)) {
      batch.push(chainId);
      continue;
    }
    if (options.suggestFirst.includes(chainId)) {
      let added = false;
      try {
        added = await options.suggest(chainId);
      } catch (error) {
        if (isUserRejection(error)) {
          skipped.push({ chainId, reason: `You declined adding ${options.nameOf(chainId)} to ${walletLabel(wallet)}.` });
          continue;
        }
      }
      if (added) batch.push(chainId);
      else skipped.push({ chainId, reason: `${walletLabel(wallet)} could not add ${options.nameOf(chainId)}.` });
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
  for (let attempt = 0; batch.length > 0; attempt++) {
    try {
      await provider.enable(batch);
      break;
    } catch (error) {
      const unknown = unknownChainOf(error);
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
