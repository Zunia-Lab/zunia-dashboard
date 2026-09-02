/**
 * WalletConnect stub — no real WC session until @walletconnect/* is wired.
 * Project ID from NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID; signing remains on mobile.
 */

export type WalletConnectSessionStub = {
  mode: "walletconnect";
  topic: string;
  chainId: string;
  address: string;
  peerName: string;
};

export function getWalletConnectProjectId(): string | undefined {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;
}

/**
 * Opens a placeholder pairing flow. Replace with SignClient when mobile WC is ready.
 */
export async function connectWalletConnectStub(chainId = "cosmoshub-4"): Promise<WalletConnectSessionStub> {
  const projectId = getWalletConnectProjectId();
  if (!projectId) {
    throw new Error(
      "WalletConnect project ID missing. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.",
    );
  }

  // Stub: no network call — returns a deterministic placeholder for UI wiring.
  await new Promise((r) => setTimeout(r, 400));
  return {
    mode: "walletconnect",
    topic: `stub-${projectId.slice(0, 8)}`,
    chainId,
    address: "cosmos1watchonlywcstub000000000000000000000",
    peerName: "Zunia Mobile (stub)",
  };
}

export function mobileDeepLink(): string {
  return (
    process.env.NEXT_PUBLIC_MOBILE_DEEP_LINK ??
    process.env.NEXT_PUBLIC_MOBILE_UNIVERSAL_LINK ??
    "zunia://wc"
  );
}
