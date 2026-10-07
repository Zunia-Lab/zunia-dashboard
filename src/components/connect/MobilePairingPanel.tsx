"use client";

/**
 * Connect Zunia Mobile: the QR code, the 6-digit check, and every way it can
 * end.
 *
 * Driven entirely by `useWallet().mobile` (a `MobileConnect` snapshot), so it
 * renders the same wherever it is shown (today: the connect modal's Zunia
 * Mobile view). To the person connecting this is one way to connect a wallet,
 * like an extension: the copy says connect and QR code, never "pair" (product
 * decision, 2026-10-07). The phone app's own labels are quoted as the app
 * shows them.
 *
 * - The QR is dark on a white card in both themes, ≥ 264 px, four-module
 *   quiet zone: what phone cameras read first time.
 * - On phones the same link opens the app directly ("Open in Zunia app");
 *   the QR stays below it for connecting another phone.
 * - The verification code is the security step: the phone shows the same six
 *   digits only if nobody sits between the two. The copy says to compare.
 * - The code waits as long as the relay keeps the session (10 min), with a
 *   countdown; Cancel really ends the relay session.
 * - Labelled Beta, and honest that the apps are in store review.
 */

import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { QrCode } from "@/components/QrCode";
import { useWallet } from "@/lib/connect/context";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { FOCUS_RING, useTouchDevice } from "./WalletOptions";

/* ---------------------------------------------------------------- clocks */

const secondListeners = new Set<() => void>();
let secondTimer: ReturnType<typeof setInterval> | null = null;

function subscribeSeconds(listener: () => void): () => void {
  secondListeners.add(listener);
  if (!secondTimer) {
    secondTimer = setInterval(() => {
      for (const notify of secondListeners) notify();
    }, 1_000);
  }
  return () => {
    secondListeners.delete(listener);
    if (secondListeners.size === 0 && secondTimer) {
      clearInterval(secondTimer);
      secondTimer = null;
    }
  };
}

/** Whole seconds until `deadline` (epoch ms), ticking once a second; null without a deadline. */
function useSecondsLeft(deadline: number | undefined): number | null {
  const now = useSyncExternalStore(
    deadline ? subscribeSeconds : noopSubscribe,
    () => Math.floor(Date.now() / 1_000),
    () => 0,
  );
  if (!deadline || now === 0) return null;
  return Math.max(0, Math.floor(deadline / 1_000) - now);
}

function noopSubscribe() {
  return () => {};
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Ends `text` as a sentence (the SDK's messages often have no full stop), so a second one can follow. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatRemaining(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/* ---------------------------------------------------------------- pieces */

// The app's words, as it shows them (zunia-mobile: the unlock screen offers
// the password and, when set up, biometrics; the Browser tab's scanner button
// is "Scan a connect code").
const STEPS = [
  { title: "Open Zunia on your phone", line: "Unlock it with your password or biometrics." },
  { title: "Open the scanner", line: "Browser tab → “Scan a connect code”." },
  { title: "Scan, then compare the code", line: "Approve only if both screens show the same six digits." },
];

function Steps({ className }: { className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--z-line-strong)] font-mono text-[11px] text-fg-muted"
          >
            {index + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-fg">{step.title}</span>
            <span className="block text-[12.5px] leading-snug text-fg-dim">{step.line}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function QrCard({ uri, waiting, used }: { uri?: string; waiting: boolean; used: boolean }) {
  return (
    <div
      className={cn(
        "relative mx-auto flex size-[284px] shrink-0 items-center justify-center rounded-[18px] bg-white p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ring-1 ring-black/5",
        // Scanned already: the join token is single-use, so the code is spent.
        used && "opacity-35",
      )}
      aria-busy={waiting || undefined}
    >
      {uri ? (
        <QrCode value={uri} size={264} label="QR code to scan with the Zunia app" />
      ) : (
        <div className="flex size-[264px] flex-col items-center justify-center gap-3 rounded-[10px] bg-[#f3f2f0] text-[12.5px] text-[#55514c]">
          <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-[#c9c5bf] border-t-transparent" />
          Creating an encrypted session…
        </div>
      )}
    </div>
  );
}

function Button({
  children,
  onClick,
  variant = "secondary",
  href,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  href?: string;
  className?: string;
}) {
  const classes = cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-[13.5px] font-medium transition-[filter,background-color] duration-[160ms]",
    variant === "primary" && "bg-[image:var(--z-button-gradient)] text-[var(--z-button-fg)] hover:brightness-110",
    variant === "secondary" && "border border-[var(--z-line-strong)] bg-[var(--z-glass)] text-fg hover:bg-[var(--z-state-hover)]",
    variant === "ghost" && "text-fg-muted hover:bg-[var(--z-state-hover)] hover:text-fg",
    FOCUS_RING,
    className,
  );
  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- panel */

export interface MobilePairingPanelProps {
  /** Show a QR code as soon as the panel shows (the connect modal does). */
  autoStart?: boolean;
  /** "Done" after the phone approved. */
  onDone?: () => void;
  /**
   * Leave the panel (Back / Close / "Use a browser extension"); a waiting
   * attempt is cancelled first. In the connect modal: back to the wallet list.
   */
  onClose?: () => void;
  className?: string;
}

export function MobilePairingPanel({ autoStart = false, onDone, onClose, className }: MobilePairingPanelProps) {
  const { mobile, walletKind } = useWallet();
  const touch = useTouchDevice();
  const secondsLeft = useSecondsLeft(
    mobile.status === "awaiting-scan" || mobile.status === "awaiting-approval" || mobile.status === "connected"
      ? mobile.expiresAt
      : undefined,
  );

  const { status, start } = mobile;
  useEffect(() => {
    if (autoStart && status === "idle") void start();
    // Only on mount: a cancelled attempt must not restart itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chainNames = mobile.requestedChains.map((id) => findChain(id)?.chainName ?? id);
  const approvedNames = mobile.chains.map((id) => findChain(id)?.chainName ?? id);
  const waiting = status === "creating" || status === "awaiting-scan" || status === "awaiting-approval";
  const code = mobile.verificationCode;
  // The relay could not be reached: another way in is the useful next step,
  // not only the same attempt again.
  const unreachable = status === "error" && mobile.error?.code === "NETWORK";

  async function cancel() {
    await mobile.cancel();
    onClose?.();
  }

  return (
    <div className={cn("flex flex-col gap-5 md:flex-row md:items-start md:gap-7", className)}>
      {/* Left: the code (or the outcome). On phones it steps aside once the
          phone has scanned, so the six digits to compare are what is on screen. */}
      <div
        className={cn(
          "flex flex-col items-center gap-3 md:w-[300px] md:shrink-0",
          status === "awaiting-approval" && "max-md:hidden",
        )}
      >
        {status === "connected" || status === "reconnecting" ? (
          <div className="flex size-[284px] flex-col items-center justify-center gap-3 rounded-[18px] border border-[var(--z-success-line)] bg-[var(--z-success-fill)] text-center max-md:size-[200px]">
            <span className="flex size-12 items-center justify-center rounded-full border-2 border-[var(--z-success)] text-[var(--z-success)]">
              <Icon name="check" size={24} />
            </span>
            <span className="text-[15px] font-medium text-fg">{status === "connected" ? "Phone connected" : "Reconnecting…"}</span>
            {mobile.peerName ? <span className="text-[12.5px] text-fg-muted">{mobile.peerName}</span> : null}
          </div>
        ) : status === "error" ? (
          // The idle frame, marked: where the code would be, and that there is
          // none. Why, and what to do, is said once, on the right.
          <div className="flex size-[284px] flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-[var(--z-line-strong)] bg-[var(--d-glass)] px-6 text-center max-md:size-[200px]">
            <Icon name="danger" size={28} className="text-[var(--z-danger)]" />
            <span className="text-[13px] font-medium text-fg-muted">No QR code</span>
          </div>
        ) : status === "idle" ? (
          <div className="flex size-[284px] flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--z-line-strong)] px-6 text-center max-md:size-[200px] max-md:gap-3">
            <Icon name="qr" size={40} className="text-fg-dim" />
            <span className="text-[13px] leading-snug text-fg-muted">A QR code appears here. It works once and expires after 10 minutes.</span>
          </div>
        ) : (
          <>
            {touch && mobile.uri && status === "awaiting-scan" ? (
              <Button href={mobile.uri} variant="primary" className="w-full">
                <Icon name="mobile" size={16} />
                Open in Zunia app
              </Button>
            ) : null}
            <QrCard uri={mobile.uri} waiting={status === "creating"} used={status === "awaiting-approval"} />
          </>
        )}
        {waiting && secondsLeft !== null ? (
          <p className="font-mono text-[11.5px] tabular-nums text-fg-dim" aria-live="off">
            {secondsLeft > 0 ? `Code expires in ${formatClock(secondsLeft)}` : "Code expired"}
          </p>
        ) : null}
      </div>

      {/* Right: what is happening and what to do. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div role="status" aria-live="polite" className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim">
            Zunia Mobile
            <span className="rounded-full bg-[var(--z-warning-fill)] px-1.5 py-px text-[10px] text-[var(--z-warning)]">Beta</span>
          </span>
          <span className="text-[17px] font-medium tracking-[-0.015em] text-fg">
            {status === "idle" && "Connect your phone"}
            {status === "creating" && "Creating an encrypted session…"}
            {status === "awaiting-scan" && "Scan with the Zunia app"}
            {status === "awaiting-approval" && "Check the code on your phone"}
            {status === "connected" && "Your phone is connected"}
            {status === "reconnecting" && "Reconnecting to the relay…"}
            {status === "error" && "Not connected"}
          </span>
        </div>

        {status === "awaiting-approval" && code ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--z-line)] bg-[var(--z-surface-raised)] p-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim">Verification code</span>
            <span
              className="font-mono text-[34px] font-medium tabular-nums tracking-[0.12em] text-fg"
              aria-label={`Verification code: ${code.split("").join(" ")}`}
            >
              {code.slice(0, 3)} {code.slice(3)}
            </span>
            <span className="text-[13px] leading-snug text-fg-muted">
              Tap Connect on your phone if it shows the same code. If the codes differ, cancel: someone else may be
              trying to connect.
            </span>
          </div>
        ) : null}

        {status === "idle" || status === "creating" || status === "awaiting-scan" ? <Steps /> : null}

        {status === "connected" ? (
          <p className="text-[13.5px] leading-relaxed text-fg-muted">
            Signing on {approvedNames.length} {approvedNames.length === 1 ? "network" : "networks"}
            {approvedNames.length > 0 ? `: ${approvedNames.slice(0, 6).join(", ")}${approvedNames.length > 6 ? "…" : ""}` : ""}. Every
            transaction is shown and signed on your phone; open Zunia when the dashboard asks for a signature (no
            notification is sent yet).
            {secondsLeft !== null ? ` The session ends in ${formatRemaining(secondsLeft * 1_000)}.` : ""}
          </p>
        ) : null}

        {status === "error" && mobile.error ? (
          <p className="text-[13px] leading-snug text-fg-muted">
            {sentence(mobile.error.message)}{" "}
            {unreachable
              ? `Relay: ${mobile.relayHost}. Your keys are not affected; a browser extension works without it.`
              : "Nothing was shared. Try again with a new QR code."}
          </p>
        ) : null}

        {status === "idle" || waiting ? (
          <p className="text-[12.5px] leading-snug text-fg-dim">
            Shares {chainNames.length === 0 ? "no network" : chainNames.slice(0, 3).join(", ")}
            {chainNames.length > 3 ? ` and ${chainNames.length - 3} more` : ""} with this page. End-to-end encrypted;
            the relay ({mobile.relayHost}) only passes sealed messages. Ethereum-key networks are not shared by the
            phone.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status === "idle" ? (
            <Button variant="primary" onClick={() => void start()}>
              <Icon name="qr" size={16} />
              Show QR code
            </Button>
          ) : null}
          {status === "error" ? (
            <Button variant="primary" onClick={() => void start()}>
              <Icon name="refresh" size={16} />
              Try again
            </Button>
          ) : null}
          {waiting ? (
            <Button onClick={() => void cancel()}>{status === "awaiting-approval" ? "Codes differ — cancel" : "Cancel"}</Button>
          ) : null}
          {status === "connected" && onDone ? (
            <Button variant="primary" onClick={onDone}>
              Done
            </Button>
          ) : null}
          {unreachable && onClose ? (
            <Button variant="ghost" onClick={onClose}>
              <Icon name="extension" size={16} />
              Use a browser extension
            </Button>
          ) : (status === "idle" || status === "error") && onClose ? (
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          ) : null}
        </div>

        <p className="border-t border-[var(--z-line)] pt-3 text-[12px] leading-snug text-fg-dim">
          Zunia for iOS and Android is in review on the App Store and Google Play.
          {walletKind && walletKind !== "zunia-mobile" ? " Connecting a phone replaces the wallet connected now." : ""}
        </p>
      </div>
    </div>
  );
}
