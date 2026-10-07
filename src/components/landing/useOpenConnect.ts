"use client";

/**
 * Opens the shared connect modal and, once it closes, puts keyboard focus
 * back on the control that opened it, or on `returnTo`.
 *
 * ConnectModalProvider now returns focus to its opener by itself, so for
 * most callers the focus call here is a harmless repeat. What it still adds
 * is `returnTo`: the navigation's menu sheet closes as it opens the modal,
 * taking its "Connect wallet" button (the opener) with it, and without a
 * stand-in focus would fall to <body>, the top of the page.
 */

import { useCallback, useEffect, useRef } from "react";
import { useConnectModal, type ConnectModalView } from "@/components/connect/ConnectModal";

export function useOpenConnect(): (view?: ConnectModalView, returnTo?: HTMLElement | null) => void {
  const { open, isOpen } = useConnectModal();
  const returnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const target = returnRef.current;
    if (isOpen || !target) return;
    returnRef.current = null;
    // Next frame: the dialog has released its focus trap by then. A control
    // that is gone (the button became "Open dashboard") is left alone.
    const frame = requestAnimationFrame(() => {
      if (target.isConnected) target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return useCallback(
    (view?: ConnectModalView, returnTo?: HTMLElement | null) => {
      const active = document.activeElement;
      returnRef.current = returnTo ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      open(view);
    },
    [open],
  );
}
