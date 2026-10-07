"use client";

/**
 * The connect modal, and `useConnectModal()` to open it from anywhere.
 *
 * Two views: the wallet list (the Zunia extension and Keplr, then the Zunia
 * Mobile zone) and Zunia Mobile's QR view. `WalletProvider` mounts the
 * provider, so any component under it can call `useConnectModal().open()` —
 * the top bar's Connect button, a page's connect panel, a "Connect to see
 * your position" card, a sign flow that finds no wallet. `open("mobile")` is
 * the one way into Zunia Mobile (the command palette, Settings and the
 * landing page all use it).
 *
 * Closing the modal while the phone has not approved yet cancels the attempt
 * (the relay session is ended), so a QR code left on screen in a closed
 * dialog cannot be scanned later.
 *
 * Focus goes back to whatever opened the modal. It is opened through this
 * context, never by a dialog trigger, so Radix would otherwise drop focus on
 * <body> and send a keyboard user back to the top of the page.
 */

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
import { useWallet } from "@/lib/connect/context";
import { cn } from "@/lib/cn";
import { ConnectFeedback, FOCUS_RING, WalletOptions } from "./WalletOptions";

/*
 * The QR view loads when it is first shown: it brings the QR encoder, and
 * every page mounts this modal while most visitors never open that view. The
 * placeholder holds the code's height so the dialog does not jump.
 */
const MobilePairingPanel = dynamic(() => import("./MobilePairingPanel").then((mod) => mod.MobilePairingPanel), {
  ssr: false,
  loading: () => <div aria-busy="true" className="min-h-[284px]" />,
});

export type ConnectModalView = "wallets" | "mobile";

export interface ConnectModalApi {
  /** Open on the wallet list (default) or straight on Zunia Mobile's QR view. */
  open: (view?: ConnectModalView) => void;
  close: () => void;
  isOpen: boolean;
}

const ConnectModalContext = createContext<ConnectModalApi | null>(null);

export function useConnectModal(): ConnectModalApi {
  const ctx = useContext(ConnectModalContext);
  if (!ctx) throw new Error("useConnectModal must be used within WalletProvider");
  return ctx;
}

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; view: ConnectModalView }>({ open: false, view: "wallets" });
  // The control that opened the modal, taken when `open` is called (a click
  // or a key on it): by the time the dialog mounts, a menu or the command
  // palette that called `open` may already have moved focus elsewhere.
  // Called again while open (the QR view asked for from inside the modal),
  // the first opener is kept: focus belongs back where the visit started.
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);
  useEffect(() => {
    isOpen.current = state.open;
  }, [state.open]);
  const open = useCallback((view: ConnectModalView = "wallets") => {
    if (!isOpen.current) {
      const active = typeof document === "undefined" ? null : document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    isOpen.current = true;
    setState({ open: true, view });
  }, []);
  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);
  // Stable: the modal's auto-close timer depends on `onOpenChange`, and this
  // provider re-renders with every wallet state change above it.
  const setView = useCallback((view: ConnectModalView) => setState((prev) => ({ ...prev, view })), []);
  const setOpen = useCallback((next: boolean) => setState((prev) => ({ ...prev, open: next })), []);
  const returnFocus = useCallback((event: Event) => {
    const target = opener.current;
    opener.current = null;
    // A control that is gone (the Connect button became the account chip, a
    // connect panel gave way to the page) is left alone.
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  }, []);
  const api = useMemo(() => ({ open, close, isOpen: state.open }), [open, close, state.open]);
  return (
    <ConnectModalContext.Provider value={api}>
      {children}
      <ConnectModal open={state.open} view={state.view} onViewChange={setView} onOpenChange={setOpen} onCloseAutoFocus={returnFocus} />
    </ConnectModalContext.Provider>
  );
}

export function ConnectModal({
  open,
  view,
  onViewChange,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  view: ConnectModalView;
  onViewChange: (view: ConnectModalView) => void;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes (the provider returns it to the opener). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { mobile, clearError } = useWallet();
  const waiting = mobile.status === "creating" || mobile.status === "awaiting-scan" || mobile.status === "awaiting-approval";

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && waiting) void mobile.cancel();
      if (!next) clearError();
      onOpenChange(next);
    },
    [clearError, mobile, onOpenChange, waiting],
  );

  // A phone that just approved: show the success state briefly, then close.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || view !== "mobile" || mobile.status !== "connected") return;
    closeTimer.current = setTimeout(() => onOpenChange(false), 1_800);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, view, mobile.status, onOpenChange]);

  const wide = view === "mobile";
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "flex max-h-[min(92dvh,860px)] flex-col overflow-hidden border border-[var(--z-line)] p-0",
          wide ? "w-[min(760px,calc(100%-24px))]" : "w-[min(460px,calc(100%-24px))]",
          "max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-h-[94dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[22px]",
        )}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-5">
          {wide ? (
            <button
              type="button"
              onClick={() => {
                if (waiting) void mobile.cancel();
                onViewChange("wallets");
              }}
              aria-label="Back to the wallet list"
              className={cn(
                "-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-fg-dim hover:bg-[var(--z-state-hover)] hover:text-fg",
                FOCUS_RING,
              )}
            >
              <Icon name="chevronLeft" size={18} />
            </button>
          ) : (
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[image:var(--z-accent-gradient)] text-[#111]"
            >
              <Mark size={13} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em] text-fg">
              {wide ? "Connect Zunia Mobile" : "Connect a wallet"}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] leading-snug text-fg-muted">
              {/* "This site", not "Zunia": the Zunia extension itself asks for a
                  phrase when you restore a wallet in it, and it is the site
                  that must never. */}
              {wide
                ? "Scan with the Zunia app, then approve each transaction on your phone."
                : "Your keys stay in your wallet. This site never asks for your recovery phrase."}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className={cn(
                "-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-fg-dim hover:bg-[var(--z-state-hover)] hover:text-fg",
                FOCUS_RING,
              )}
            >
              <Icon name="close" size={16} />
            </button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
          {wide ? (
            <MobilePairingPanel autoStart onDone={() => onOpenChange(false)} onClose={() => onViewChange("wallets")} />
          ) : (
            <div className="flex flex-col gap-3">
              <WalletOptions onMobile={() => onViewChange("mobile")} onConnected={() => onOpenChange(false)} />
              <ConnectFeedback />
              <p className="flex items-start gap-2 pt-1 text-[12px] leading-snug text-fg-dim">
                <Icon name="shield" size={14} className="mt-px shrink-0" />
                <span>
                  Connecting shares your public addresses with this page so it can read balances. Signing always
                  happens in the wallet, one transaction at a time.
                </span>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
