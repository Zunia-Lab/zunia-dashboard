/**
 * `?connect=` on the landing page: a link that opens the Connect wallet
 * modal on arrival.
 *
 * `/mobile` is a permanent redirect to `/?connect=mobile` since Zunia Mobile
 * became a way to connect rather than a page (product decision, 2026-10-07),
 * so old links, bookmarks and printed QR codes land on the modal's Zunia
 * Mobile view. `?connect=wallets` opens the wallet list, for a link that
 * means "connect" without picking a wallet.
 *
 * Pure (a type import only), so `node --test` covers it.
 */

import type { ConnectModalView } from "@/components/connect/ConnectModal";

export const CONNECT_PARAM = "connect";

const VIEWS: Readonly<Record<string, ConnectModalView>> = { wallets: "wallets", mobile: "mobile" };

export interface ConnectRequest {
  /** The modal view asked for; null for a value this page does not know. */
  view: ConnectModalView | null;
  /** The same address without the parameter: path, the other parameters, hash. */
  cleanUrl: string;
}

/**
 * The request in a location, or null when it carries none. The parameter is
 * an instruction for one arrival, so the clean address drops it whatever its
 * value: a reload, Back or a copied address bar must not open the modal
 * again.
 */
export function readConnectRequest(location: Pick<Location, "pathname" | "search" | "hash">): ConnectRequest | null {
  const params = new URLSearchParams(location.search);
  if (!params.has(CONNECT_PARAM)) return null;
  const value = (params.get(CONNECT_PARAM) ?? "").trim().toLowerCase();
  params.delete(CONNECT_PARAM);
  const rest = params.toString();
  return {
    view: Object.hasOwn(VIEWS, value) ? VIEWS[value] : null,
    cleanUrl: `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`,
  };
}
