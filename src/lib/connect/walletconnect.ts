/**
 * WalletConnect helpers for the dashboard.
 * Live sessions go through @zunialab/sdk-web `connectWithZunia({ prefer: "walletconnect" })`.
 */

export function getWalletConnectProjectId(): string | undefined {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;
}

export function mobileDeepLink(): string {
  return (
    process.env.NEXT_PUBLIC_MOBILE_DEEP_LINK ??
    process.env.NEXT_PUBLIC_MOBILE_UNIVERSAL_LINK ??
    "zunia://wc"
  );
}
