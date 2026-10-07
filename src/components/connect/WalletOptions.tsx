"use client";

/**
 * The ways in: a wallet in this browser (the Zunia extension, then the Cosmos
 * wallets the page finds: Keplr, Leap, Cosmostation), or Zunia Mobile on a
 * phone.
 *
 * Shared by the connect modal (rows), the in-page connect panel and the
 * landing page (cards). The browser wallets are alike — detected or not, one
 * click to connect, or a link to get one — so they sit together. Zunia Mobile
 * is not another extension: it is set apart below them as its own zone
 * (product decision, 2026-10-07). Scan a QR code with the Zunia app and every
 * transaction the dashboard asks for is then approved and signed on the phone,
 * the way a phone wallet signs for a web app. The zone is one button that
 * opens the modal's QR view; nothing here says "pair", because to the person
 * connecting it is just another way to connect.
 *
 * Detection is live — a wallet that injects after the page loads lights up
 * its row — and an absent one offers where to get it instead of a dead
 * button. Each wallet shows its own logo (lib/connect/wallets). WalletConnect
 * is deliberately not here (see lib/connect/walletconnect).
 *
 * Top to bottom:
 * 1. The Zunia extension, always first and always saying where it stands:
 *    - Locked: a remembered connection waits for an unlock (`zuniaLocked`);
 *      the row is the Unlock button, so Zunia's unlock window opens on a click.
 *    - Detected: Connect.
 *    - Not in this browser: the install matched to the browser
 *      (lib/connect/install), marked Recommended where it is one click: the
 *      Chrome Web Store in a Chromium browser on a computer ("Add to Brave");
 *      in Firefox, Safari and on phones, "Get Zunia" and the download section
 *      of zunialab.com, saying where that build stands.
 *    - Installed after the page loaded: browsers do not put an extension into
 *      tabs that were already open, so detection cannot light up until a
 *      reload. Once the store link was followed, or the tab comes back into
 *      view with Zunia still missing, the list says so and offers the reload.
 * 2. The Cosmos wallets the page detects, each a Connect row with its logo.
 *    One that sits at `window.keplr` as another wallet's alias is that
 *    wallet, not a second row.
 * 3. "Other wallets": a small "Get Keplr" link for each one missing that this
 *    browser can install (Cosmostation's is a Chrome Web Store listing: Chromium
 *    on a computer only; Leap shut down, so it shows only where detected).
 * 4. "or", then the Zunia Mobile zone; on a phone or tablet with no wallet
 *    injected, the zone leads instead.
 */

import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/icons";
// By its own path, not the kit's barrel: this module is in every page's
// shared chunk (the connect modal is mounted by the root providers).
import { Button } from "@/components/ui/Button";
import { browserFor, zuniaInstallHint, type BrowserInfo, type ZuniaInstallHint } from "@/lib/connect/install";
import { canGetWallet, COSMOS_WALLETS, WALLETS, type CosmosWallet, type ExtensionWallet } from "@/lib/connect/wallets";
import { useWallet } from "@/lib/connect/context";
import { cn } from "@/lib/cn";
import { WalletLogo } from "./WalletLogo";

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

/** Brave's mark in the snapshot below: it sends Chrome's user agent word for word. */
const BRAVE = "brave\u0000";

/**
 * The browser this page runs in (lib/connect/install). Chrome on a computer
 * on the server and in the hydration pass, so the markup matches; the real
 * answer on the next render. The snapshot is a string, so it compares equal
 * between renders.
 */
function useBrowser(): BrowserInfo {
  const signature = useSyncExternalStore(
    noSubscription,
    () => `${"brave" in navigator ? BRAVE : ""}${navigator.userAgent}`,
    () => "",
  );
  return useMemo(() => {
    const brave = signature.startsWith(BRAVE);
    return browserFor(brave ? signature.slice(BRAVE.length) : signature, { brave });
  }, [signature]);
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

type ChipTone = "ok" | "beta" | "locked" | "soon" | "recommended";

function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]",
        tone === "ok" && "bg-[var(--z-success-fill)] text-[var(--z-success)]",
        (tone === "beta" || tone === "locked") && "bg-[var(--z-warning-fill)] text-[var(--z-warning)]",
        tone === "soon" && "bg-[var(--z-state-hover)] text-fg-muted",
        // The brand's own orange: Zunia's row, where installing it is one click.
        tone === "recommended" && "bg-[var(--z-info-fill)] text-[var(--z-info)]",
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
 * where only the arrow shows (narrow cards, the list on a phone), and an
 * install link says it opens a new tab — as words, not as an `aria-label`
 * that would replace what the row visibly says (WCAG 2.5.3).
 */
function RowAction({ busy, external, label, cards }: { busy?: boolean; external?: boolean; label: string; cards: boolean }) {
  if (busy) {
    return (
      <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--z-line-strong)] border-t-transparent" />
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium", external ? "text-fg-muted" : "text-fg")}>
      <span className={cards ? "@max-[439px]:sr-only" : "@max-[399px]:sr-only"}>{label}</span>
      {external ? <span className="sr-only"> (opens a new tab)</span> : null}
      <Icon name={external ? "external" : "chevronRight"} size={16} className={cards ? "@min-[440px]:size-3.5" : "@min-[400px]:size-3.5"} />
    </span>
  );
}

/** What a wallet's row does: connect, unlock, or link to where to get it. */
type RowOffer =
  | { kind: "connect" }
  | { kind: "unlock" }
  | { kind: "install"; url: string; label: string; onFollow: () => void };

interface ExtensionOptionProps {
  id: ExtensionWallet;
  title: string;
  line: string;
  chip: { tone: ChipTone; label: string } | null;
  offer: RowOffer;
  busy: boolean;
  /** Shown instead of `line` while the wallet's own prompt is open. */
  busyLine: string;
  disabled: boolean;
  /** Cards: the action shrinks to its arrow below 440 px (the list: below 400 px, a phone's sheet). */
  cards: boolean;
  onConnect: () => void;
  className?: string;
}

function ExtensionOption({ id, title, line, chip, offer, busy, busyLine, disabled, cards, onConnect, className: extra }: ExtensionOptionProps) {
  const body = (
    <>
      <WalletLogo wallet={id} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-medium tracking-[-0.01em] text-fg">{title}</span>
          {chip ? <StatusChip tone={chip.tone}>{chip.label}</StatusChip> : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-muted">{busy ? busyLine : line}</span>
      </span>
      <RowAction
        busy={busy}
        external={offer.kind === "install"}
        label={offer.kind === "install" ? offer.label : offer.kind === "unlock" ? "Unlock" : "Connect"}
        cards={cards}
      />
    </>
  );
  const className = cn(
    "group flex w-full items-center gap-3 rounded-[14px] border border-[var(--z-line)] bg-[var(--z-surface-raised)] px-3.5 py-3 text-left",
    "transition-[background-color,border-color] duration-[160ms] hover:border-[var(--z-line-strong)] hover:bg-[var(--z-state-hover)]",
    "disabled:pointer-events-none disabled:opacity-50",
    offer.kind === "unlock" && "border-[var(--z-warning-line)]",
    FOCUS_RING,
    extra,
  );
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
 * "Get Keplr": a wallet this page did not find, as a small link to where to
 * get it (its own page, or its Chrome Web Store listing), with its logo.
 * Named by what it says, plus that it opens a new tab.
 */
function GetWalletLink({ wallet, onFollow }: { wallet: CosmosWallet; onFollow: () => void }) {
  const { label, install } = WALLETS[wallet];
  if (!install) return null;
  return (
    <a
      href={install.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onFollow}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-[var(--z-line)] bg-[var(--z-surface-raised)] py-1 pl-1.5 pr-3 text-[12.5px] font-medium text-fg",
        "transition-[background-color,border-color] duration-[160ms] hover:border-[var(--z-line-strong)] hover:bg-[var(--z-state-hover)]",
        FOCUS_RING,
      )}
    >
      <WalletLogo wallet={wallet} size={24} />
      <span>Get {label}</span>
      <span className="sr-only"> (opens a new tab)</span>
      <Icon name="external" size={13} className="shrink-0 text-fg-dim" />
    </a>
  );
}

/** The wallets this page did not find and this browser can get, under the ones it did. */
function OtherWallets({ wallets, onFollow }: { wallets: readonly CosmosWallet[]; onFollow: (wallet: CosmosWallet) => void }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5 pt-1">
      <span id={labelId} className="px-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-dim">
        Other wallets
      </span>
      <div className="flex flex-wrap gap-2">
        {wallets.map((wallet) => (
          <GetWalletLink key={wallet} wallet={wallet} onFollow={() => onFollow(wallet)} />
        ))}
      </div>
    </div>
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

/** The Zunia row's words and action for where it stands (see the header). */
function zuniaRow(options: { available: boolean; locked: boolean; hint: ZuniaInstallHint; onFollow: () => void }): {
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
    return { line: WALLETS.zunia.detectedLine, chip: { tone: "ok", label: "Detected" }, offer: { kind: "connect" }, busyLine: "Confirm in Zunia…" };
  }
  const { hint } = options;
  return {
    line: hint.line,
    chip: hint.chip,
    offer: { kind: "install", url: hint.url, label: hint.action, onFollow: options.onFollow },
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
  const { zuniaAvailable, zuniaLocked, walletsAvailable, connectExtension, busy } = useWallet();
  const touch = useTouchDevice();
  const browser = useBrowser();
  const hint = useMemo(() => zuniaInstallHint(browser), [browser]);
  const [pending, setPending] = useState<ExtensionWallet | null>(null);
  // Which store page was followed (or, for Zunia, the tab came back into
  // view without it): the extension may be installed now, and only a reload
  // puts it in this page. Never on touch devices: none can install these.
  const [installed, setInstalled] = useState<ExtensionWallet | null>(null);
  const cards = variant === "cards";

  useEffect(() => {
    if (zuniaAvailable || touch || hint.kind !== "store") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setInstalled((current) => current ?? "zunia");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [zuniaAvailable, touch, hint.kind]);

  async function connect(wallet: ExtensionWallet) {
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
    hint,
    onFollow: () => {
      if (!touch && hint.kind === "store") setInstalled("zunia");
    },
  });
  const detected = COSMOS_WALLETS.filter((wallet) => walletsAvailable[wallet]);
  const missing = COSMOS_WALLETS.filter((wallet) => !walletsAvailable[wallet] && canGetWallet(wallet, browser));
  const reloadFor = installed && !walletsAvailable[installed] ? WALLETS[installed].label : null;
  // Two across in a wide panel: an odd count lets Zunia's row take the
  // whole first line rather than leave a hole beside the last one.
  const zuniaWide = cards && (1 + detected.length) % 2 === 1;

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
          className={zuniaWide ? "@min-[720px]:col-span-2" : undefined}
        />
        {detected.map((wallet) => (
          <ExtensionOption
            key={wallet}
            id={wallet}
            title={WALLETS[wallet].label}
            line={WALLETS[wallet].detectedLine}
            chip={{ tone: "ok", label: "Detected" }}
            offer={{ kind: "connect" }}
            busy={pending === wallet}
            busyLine={`Confirm in ${WALLETS[wallet].label}…`}
            disabled={busy && pending !== wallet}
            cards={cards}
            onConnect={() => void connect(wallet)}
          />
        ))}
      </div>
      {missing.length > 0 ? (
        <OtherWallets
          wallets={missing}
          onFollow={(wallet) => {
            if (!touch) setInstalled(wallet);
          }}
        />
      ) : null}
      {reloadFor ? <ReloadHint wallet={reloadFor} /> : null}
    </div>
  );
  const mobile = <MobileZone cards={cards} disabled={busy} onClick={onMobile} />;
  // On a phone or tablet with no wallet injected (no wallet's in-app
  // browser), an extension cannot be installed there at all: the phone app
  // leads.
  const phoneFirst = touch && !zuniaAvailable && detected.length === 0;

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
