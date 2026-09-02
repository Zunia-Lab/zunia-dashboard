/**
 * Extension bridges — Zunia and Keplr share the same enable/getKey shape.
 * Signing stays in the wallet; the dashboard never holds keys.
 */

export type ExtensionWallet = "zunia" | "keplr";

export type ZuniaProvider = {
  enable: (chainIds: string | string[]) => Promise<void>;
  getKey: (chainId: string) => Promise<{
    name: string;
    bech32Address: string;
    algo: string;
    pubKey: Uint8Array;
  }>;
  experimentalSuggestChain?: (chainInfo: unknown) => Promise<void>;
  signArbitrary?: (
    chainId: string,
    signer: string,
    data: string,
  ) => Promise<{ signature: string; pub_key: { value: string } }>;
};

declare global {
  interface Window {
    zunia?: ZuniaProvider;
    keplr?: ZuniaProvider;
  }
}

export function getExtensionProvider(
  wallet?: ExtensionWallet,
): ZuniaProvider | undefined {
  if (typeof window === "undefined") return undefined;
  if (wallet === "zunia") return window.zunia;
  if (wallet === "keplr") return window.keplr;
  return window.zunia ?? window.keplr;
}

export function isZuniaAvailable(): boolean {
  return Boolean(getExtensionProvider("zunia"));
}

export function isKeplrAvailable(): boolean {
  return Boolean(getExtensionProvider("keplr"));
}

export function isExtensionAvailable(): boolean {
  return Boolean(getExtensionProvider());
}

export async function connectExtension(
  chainId = "cosmoshub-4",
  wallet: ExtensionWallet = "zunia",
): Promise<{
  mode: "extension";
  wallet: ExtensionWallet;
  chainId: string;
  address: string;
  name: string;
}> {
  const provider = getExtensionProvider(wallet);
  if (!provider) {
    throw new Error(
      wallet === "keplr"
        ? "Keplr not detected. Install or unlock it, then retry."
        : "Zunia extension not detected. Install or unlock it, then retry.",
    );
  }
  await provider.enable(chainId);
  const key = await provider.getKey(chainId);
  return {
    mode: "extension",
    wallet,
    chainId,
    address: key.bech32Address,
    name:
      key.name || (wallet === "keplr" ? "Keplr" : "Zunia"),
  };
}
