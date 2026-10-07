"use client";

/**
 * Acts on `?connect=` (see connect-param.ts) once the landing page has
 * hydrated and the wallet's restore has settled.
 *
 * - No wallet: the Connect wallet modal opens on the view asked for, e.g.
 *   Zunia Mobile's QR code for a visitor sent here by `/mobile`.
 * - A wallet restored from the last visit: there is nothing to connect, and
 *   the hero's hand-off to the dashboard goes ahead as on any visit.
 *
 * Either way the parameter leaves the address bar. Waiting for the restore
 * matters: opening at hydration would show a returning user a connect
 * dialog for the second their wallet takes to come back, then close it
 * under them.
 *
 * Renders nothing.
 */

import { useEffect, useRef } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { useWallet } from "@/providers/WalletProvider";
import { readConnectRequest } from "./connect-param";

export function ConnectFromUrl() {
  const { account, restoring } = useWallet();
  const { open } = useConnectModal();
  // Once per page load: connecting, then disconnecting, must not reopen it.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || restoring) return;
    handled.current = true;
    const request = readConnectRequest(window.location);
    if (!request) return;
    // The native call rather than router.replace: Next keeps its router in
    // step with it (docs: Linking and Navigating, "Native History API"), and
    // it neither refetches the page nor moves the scroll position.
    window.history.replaceState(null, "", request.cleanUrl);
    if (!account && request.view) open(request.view);
  }, [account, open, restoring]);

  return null;
}
