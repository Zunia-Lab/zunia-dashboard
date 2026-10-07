"use client";

/**
 * The ways in: the Zunia extension or Keplr in this browser, or Zunia Mobile
 * on a phone.
 *
 * Shared by the connect modal (rows), the in-page connect panel and the
 * landing page (cards). The two extensions are alike — detected or not, one
 * click to connect, or a link to install — so they sit together. Zunia Mobile
 * is not a third extension: it is set apart below them as its own zone (product
 * decision, 2026-10-07). Scan a QR code with the Zunia app and every
 * transaction the dashboard asks for is then approved and signed on the phone,
 * the way a phone wallet signs for a web app. The zone is one button that
 * opens the modal's QR view; nothing here says "pair", because to the person
 * connecting it is just another way to connect.
 *
 * Detection is live — an extension that injects after the page loads lights
 * up its row — and an absent extension offers its install page instead of a
 * dead button. WalletConnect is deliberately not here (see
 * lib/connect/walletconnect).
 *
 * The Zunia row always comes first and always says where it stands:
 * - Locked: a remembered connection waits for an unlock (`zuniaLocked`); the
 *   row is the Unlock button, so Zunia's unlock window opens on a click.
 * - Installed after the page loaded: browsers do not put an extension into
 *   tabs that were already open, so detection cannot light up until a
 *   reload. Once the install link was followed, or the tab comes back into
 *   view with Zunia still missing, the row says so and offers the reload.
 * - Firefox and Safari: the Chrome Web Store build cannot be installed there,
 *   so no link to it; the row says the browser's own build is coming and
 *   points at Keplr and Zunia Mobile meanwhile.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
// By its own path, not the kit's barrel: this module is in every page's
// shared chunk (the connect modal is mounted by the root providers).
import { Button } from "@/components/ui/Button";
import { extensionStoreFor, KEPLR_INSTALL_URL, ZUNIA_EXTENSION_INSTALL_URL, type ExtensionStore } from "@/lib/connect/extension";
import { useWallet } from "@/lib/connect/context";
import { cn } from "@/lib/cn";

/**
 * The connect flow's keyboard ring (spec §3: 2px `--z-focus-ring`, offset 2px).
 *
 * `outline-solid` is not decoration: `outline-none` sets the outline style to
 * none (Tailwind v4 keeps it in `--tw-outline-style`), and `outline-2` only
 * sets a width, so without it the ring never painted — and, being a utility,
 * `outline-none` also beat the global `:focus-visible` ring in the base layer.
 */
export const FOCUS_RING =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--z-focus-ring)]";

const COARSE = "(pointer: coarse)";

/** A touch-first device (phones, tablets). False on the server and in the hydration pass. */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(COARSE);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
}

const noSubscription = () => () => {};

/**
 * Where this browser installs the Zunia extension from. "chrome" on the
 * server and in the hydration pass, so the markup matches; the real answer
 * on the next render.
 */
function useExtensionStore(): ExtensionStore {
  return useSyncExternalStore(
    noSubscription,
    () => extensionStoreFor(navigator.userAgent),
    () => "chrome",
  );
}

type ExtensionId = "zunia" | "keplr";

function ExtensionIcon({ id }: { id: ExtensionId }) {
  if (id === "zunia") {
    return (
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-[image:var(--z-accent-gradient)] text-[#111]"
      >
        <Mark size={15} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--z-line)] bg-[var(--z-glass)] text-fg"
    >
      <Icon name="extension" size={20} />
    </span>
  );
}

/** A phone with a QR badge: what the zone asks you to do, at a glance. */
function MobileGlyph() {
  return (
    <span
      aria-hidden
      className="relative flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--d-hairline-strong)] bg-[var(--z-surface-raised)] text-fg"
    >
      <Icon name="mobile" size={20} />
      <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-[6px] bg-[image:var(--z-accent-gradient)] text-[#111] ring-2 ring-[var(--z-surface)]">
        <Icon name="qr" size={11} strokeWidth={2} />
      </span>
    </span>
  );
}

type ChipTone = "ok" | "beta" | "locked" | "soon";

function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]",
        tone === "ok" && "bg-[var(--z-success-fill)] text-[var(--z-success)]",
        (tone === "beta" || tone === "locked") && "bg-[var(--z-warning-fill)] text-[var(--z-warning)]",
        tone === "soon" && "bg-[var(--z-state-hover)] text-fg-muted",
      )}
    >
      {tone === "ok" ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {tone === "locked" ? <Icon name="lock" size={11} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

/**
 * The action at the end of a row. Its words stay in the accessible name even
 * where only the arrow shows (narrow cards), and an install link says it opens
 * a new tab — as words, not as an `aria-label` that would replace what the
 * row visibly says (WCAG 2.5.3).
 */
function RowAction({ busy, external, label, compact }: { busy?: boolean; external?: boolean; label: string; compact: boolean }) {
  if (busy) {
    return (
      <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--z-line-strong)] border-t-transparent" />
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium", external ? "text-fg-muted" : "text-fg")}>
      <span className={compact ? "@max-[439px]:sr-only" : undefined}>{label}</span>
      {external ? <span className="sr-only"> (opens a new tab)</span> : null}
      <Icon name={external ? "external" : "chevronRight"} size={compact ? 16 : 14} className={compact ? "@min-[440px]:size-3.5" : undefined} />
    </span>
  );
}

/** What an extension's row does: connect, unlock, link to its store, or nothing (not in this browser yet). */
type RowOffer =
  | { kind: "connect" }
  | { kind: "unlock" }
  | { kind: "install"; url: string; label: string; onFollow: () => void }
  | { kind: "unavailable" };

interface ExtensionOptionProps {
  id: ExtensionId;
  title: string;
  line: string;
  chip: { tone: ChipTone; label: string } | null;
  offer: RowOffer;
  busy: boolean;
  /** Shown instead of `line` while the wallet's own prompt is open. */
  busyLine: string;
  disabled: boolean;
  /** Cards: the action shrinks to its arrow in a narrow container. */
  cards: boolean;
  onConnect: () => void;
}

function ExtensionOption({ id, title, line, chip, offer, busy, busyLine, disabled, cards, onConnect }: ExtensionOptionProps) {
  const body = (
    <>
      <ExtensionIcon id={id} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-medium tracking-[-0.01em] text-fg">{title}</span>
          {chip ? <StatusChip tone={chip.tone}>{chip.label}</StatusChip> : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-muted">{busy ? busyLine : line}</span>
      </span>
      {offer.kind === "unavailable" ? null : (
        <RowAction
          busy={busy}
          external={offer.kind === "install"}
          label={offer.kind === "install" ? offer.label : offer.kind === "unlock" ? "Unlock" : "Connect"}
          compact={cards}
        />
      )}
    </>
  );
  const className = cn(
    "group flex w-full items-center gap-3 rounded-[14px] border border-[var(--z-line)] bg-[var(--z-surface-raised)] px-3.5 py-3 text-left",
    "transition-[background-color,border-color] duration-[160ms] hover:border-[var(--z-line-strong)] hover:bg-[var(--z-state-hover)]",
    "disabled:pointer-events-none disabled:opacity-50",
    offer.kind === "unlock" && "border-[var(--z-warning-line)]",
    FOCUS_RING,
  );
  if (offer.kind === "unavailable") {
    // Nothing to do here, so nothing to focus: read as text, in its place.
    return <div className={cn(className, "hover:border-[var(--z-line)] hover:bg-[var(--z-surface-raised)]")}>{body}</div>;
  }
  if (offer.kind === "install") {
    return (
      <a href={offer.url} target="_blank" rel="noopener noreferrer" onClick={offer.onFollow} className={className}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onConnect} disabled={disabled} aria-busy={busy || undefined} className={className}>
      {body}
    </button>
  );
}

/**
 * "Installed Zunia? Reload this page to connect": an extension installed while
 * this tab was open is not in it until the page loads again (MV3 content
 * scripts only reach pages loaded after the install).
 */
function ReloadHint({ wallet }: { wallet: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-[12px] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] py-2 pl-3 pr-2 text-[13px] leading-snug text-fg-muted"
    >
      <Icon name="info" size={16} className="shrink-0 text-fg-dim" />
      <span className="min-w-0 flex-1">Installed {wallet}? Reload this page to connect.</span>
      <Button variant="secondary" size="sm" iconLeft="refresh" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}

/**
 * Zunia Mobile's zone: its own surface, a phone-and-QR glyph and two short
 * lines on what happens (scan once, then approve each transaction on the
 * phone). Small on purpose — it is a way to connect, explained, not a feature
 * page. Honest about availability: Beta, apps in store review.
 */
function MobileZone({ cards, disabled, onClick }: { cards: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-[14px] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] px-3.5 py-3 text-left",
        "transition-[background-color,border-color] duration-[160ms] hover:border-[var(--z-line-strong)] hover:bg-[var(--z-state-hover)]",
        "disabled:pointer-events-none disabled:opacity-50",
        cards && "@min-[440px]:gap-4 @min-[440px]:px-4 @min-[440px]:py-3.5",
        FOCUS_RING,
      )}
    >
      {/* The brand bloom, faint: the zone reads as Zunia's own way in. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-14 -top-20 size-48 rounded-full [background:radial-gradient(closest-side,var(--d-bloom-1),transparent)]"
      />
      <MobileGlyph />
      <span className="relative min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-medium tracking-[-0.01em] text-fg">Zunia Mobile</span>
          <StatusChip tone="beta">Beta</StatusChip>
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-muted">
          Scan a QR code with the Zunia app, then approve each transaction on your phone.
        </span>
        <span className="mt-1 block text-[11.5px] leading-snug text-fg-dim">Keys stay on your phone · apps in store review</span>
      </span>
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-fg",
          // The words as a pill where the row has room; in the modal (a narrow
          // list) the arrow alone, so the two lines keep their width.
          cards
            ? "@min-[440px]:h-9 @min-[440px]:rounded-full @min-[440px]:border @min-[440px]:border-[var(--d-hairline-strong)] @min-[440px]:bg-[var(--z-surface-raised)] @min-[440px]:pl-3.5 @min-[440px]:pr-3"
            : "@min-[520px]:h-8 @min-[520px]:rounded-full @min-[520px]:border @min-[520px]:border-[var(--d-hairline-strong)] @min-[520px]:bg-[var(--z-surface-raised)] @min-[520px]:pl-3 @min-[520px]:pr-2.5",
        )}
      >
        <span className={cards ? "@max-[439px]:sr-only" : "@max-[519px]:sr-only"}>Show QR code</span>
        <Icon name="chevronRight" size={14} />
      </span>
    </button>
  );
}

/** "or", between the browser wallets and the phone. */
function OrDivider() {
  return (
    <div aria-hidden className="flex items-center gap-3 px-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-dim">
      <span className="h-px flex-1 bg-[var(--d-hairline-strong)]" />
      or
      <span className="h-px flex-1 bg-[var(--d-hairline-strong)]" />
    </div>
  );
}

const BROWSER_NAME: Record<Exclude<ExtensionStore, "chrome">, string> = { firefox: "Firefox", safari: "Safari" };

/** The Zunia row's words and action for where it stands (see the header). */
function zuniaRow(options: { available: boolean; locked: boolean; store: ExtensionStore; onFollow: () => void }): {
  line: string;
  chip: ExtensionOptionProps["chip"];
  offer: RowOffer;
  busyLine: string;
} {
  if (options.available && options.locked) {
    return {
      line: "Zunia is locked. Unlock it to continue.",
      chip: { tone: "locked", label: "Locked" },
      offer: { kind: "unlock" },
      busyLine: "Unlock in Zunia…",
    };
  }
  if (options.available) {
    return { line: "Connect the Zunia wallet in this browser.", chip: { tone: "ok", label: "Detected" }, offer: { kind: "connect" }, busyLine: "Confirm in Zunia…" };
  }
  if (options.store !== "chrome") {
    const browser = BROWSER_NAME[options.store];
    return {
      line:
        options.store === "firefox"
          ? `The Zunia extension for ${browser} is coming. Use Keplr or Zunia Mobile for now.`
          : `The Zunia extension for ${browser} is coming. Use Zunia Mobile or Keplr for now.`,
      chip: { tone: "soon", label: "Coming soon" },
      offer: { kind: "unavailable" },
      busyLine: "",
    };
  }
  return {
    line: "Not installed in this browser.",
    chip: null,
    offer: { kind: "install", url: ZUNIA_EXTENSION_INSTALL_URL, label: "Install for Chrome", onFollow: options.onFollow },
    busyLine: "",
  };
}

export function WalletOptions({
  onMobile,
  onConnected,
  variant = "list",
  className,
}: {
  /** Open the Zunia Mobile QR view. */
  onMobile: () => void;
  /** Called after an extension connected (the modal closes itself). */
  onConnected?: () => void;
  /** List: rows (the modal). Cards: two across when there is room (the connect panel). */
  variant?: "list" | "cards";
  className?: string;
}) {
  const { zuniaAvailable, zuniaLocked, keplrAvailable, connectExtension, busy } = useWallet();
  const touch = useTouchDevice();
  const store = useExtensionStore();
  const [pending, setPending] = useState<ExtensionId | null>(null);
  // Which install page was followed (or, for Zunia, the tab came back into
  // view without it): the extension may be installed now, and only a reload
  // puts it in this page. Never on touch devices: none can install these.
  const [installed, setInstalled] = useState<ExtensionId | null>(null);
  const cards = variant === "cards";

  useEffect(() => {
    if (zuniaAvailable || touch || store !== "chrome") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setInstalled((current) => current ?? "zunia");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [zuniaAvailable, touch, store]);

  async function connect(wallet: ExtensionId) {
    setPending(wallet);
    try {
      await connectExtension(wallet);
      onConnected?.();
    } catch {
      // The provider holds the message; the error line under the options shows it.
    } finally {
      setPending(null);
    }
  }

  const zunia = zuniaRow({
    available: zuniaAvailable,
    locked: zuniaLocked,
    store,
    onFollow: () => {
      if (!touch) setInstalled("zunia");
    },
  });
  const reloadFor =
    installed === "zunia" && !zuniaAvailable ? "Zunia" : installed === "keplr" && !keplrAvailable ? "Keplr" : null;

  const extensions = (
    <div className="flex flex-col gap-2">
      <div className={cn("grid gap-2", cards && "gap-2.5 @min-[720px]:grid-cols-2")}>
        <ExtensionOption
          id="zunia"
          title="Zunia extension"
          line={zunia.line}
          chip={zunia.chip}
          offer={zunia.offer}
          busy={pending === "zunia"}
          busyLine={zunia.busyLine}
          disabled={busy && pending !== "zunia"}
          cards={cards}
          onConnect={() => void connect("zunia")}
        />
        <ExtensionOption
          id="keplr"
          title="Keplr"
          line={keplrAvailable ? "Connect your Keplr wallet." : "Not installed in this browser."}
          chip={keplrAvailable ? { tone: "ok", label: "Detected" } : null}
          offer={
            keplrAvailable
              ? { kind: "connect" }
              : {
                  kind: "install",
                  url: KEPLR_INSTALL_URL,
                  label: "Get Keplr",
                  onFollow: () => {
                    if (!touch) setInstalled("keplr");
                  },
                }
          }
          busy={pending === "keplr"}
          busyLine="Confirm in Keplr…"
          disabled={busy && pending !== "keplr"}
          cards={cards}
          onConnect={() => void connect("keplr")}
        />
      </div>
      {reloadFor ? <ReloadHint wallet={reloadFor} /> : null}
    </div>
  );
  const mobile = <MobileZone cards={cards} disabled={busy} onClick={onMobile} />;
  // On a phone or tablet with no wallet injected (no Keplr in-app browser),
  // an extension cannot be installed there at all: the phone app leads.
  const phoneFirst = touch && !zuniaAvailable && !keplrAvailable;

  return (
    <div className={cn("@container flex flex-col", cards ? "gap-3" : "gap-2.5", className)}>
      {phoneFirst ? mobile : extensions}
      <OrDivider />
      {phoneFirst ? extensions : mobile}
    </div>
  );
}

/** The provider's last connect error (and chains a connect left out), under the options. */
export function ConnectFeedback({ className }: { className?: string }) {
  const { error, endedReason } = useWallet();
  const message = error ?? endedReason;
  if (!message) return null;
  // A refused connect is an error; a session that ended on its own (the phone
  // disconnected, 24 h passed) is information about what happened.
  const failed = Boolean(error);
  return (
    <p
      role={failed ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[13px] leading-snug",
        failed ? "bg-[var(--z-danger-fill)] text-[var(--z-danger)]" : "bg-[var(--z-warning-fill)] text-[var(--z-warning)]",
        className,
      )}
    >
      <Icon name={failed ? "warning" : "info"} size={16} className="mt-px shrink-0" />
      <span>{message}</span>
    </p>
  );
}
