/**
 * WalletConnect, kept compiling and deliberately unreachable.
 *
 * Hidden from every connect surface: the phone app registers its WalletConnect
 * request handlers as `null`, nothing reads its session requests, and this
 * build has no sign-client loader or project id (mobile-connect report,
 * 2026-10-07). Showing the option would be offering something that cannot
 * sign. Phone pairing goes through Zunia Connect (native-ws) instead.
 */

export function getWalletConnectProjectId(): string | undefined {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;
}

/** Off until the phone answers WalletConnect requests end to end. */
export const WALLETCONNECT_ENABLED = false;

export function mobileDeepLink(): string {
  return process.env.NEXT_PUBLIC_MOBILE_DEEP_LINK ?? process.env.NEXT_PUBLIC_MOBILE_UNIVERSAL_LINK ?? "zunia://wc";
}
