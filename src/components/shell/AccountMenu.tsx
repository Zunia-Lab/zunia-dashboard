"use client";

/**
 * The account chip at the right of the top bar and its panel: who is
 * connected and how (Zunia extension, Keplr or Zunia Mobile, and for the
 * phone the link's state and the time left in its session: the bar has no
 * phone indicator of its own), the address (copy), the networks the wallet
 * did not share, display preferences (theme, currency, privacy) and
 * Disconnect.
 *
 * A panel rather than a plain menu: theme and currency are three-way choices
 * best shown as segmented controls with their state visible. Popover from
 * 768 px, bottom sheet on phones. Without a wallet the chip is the
 * "Connect wallet" button; while a stored session restores, a placeholder
 * holds its place so the bar does not flash "Connect".
 */

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { Avatar, useTheme, type ThemeMode } from "@zunialab/ui";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon, type IconName } from "@/components/icons";
import { Button, ChainLogo, Dot, InfoTip, Popover, Segmented, Sheet, Skeleton, StatusBadge, Switch, toast, useMediaQuery, useNow } from "@/components/ui";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { shortenAddress } from "@/lib/format";
import { accountLabel, useWallet, walletKindLabel } from "@/providers/WalletProvider";
import { usePrefs, type FiatCurrency } from "@/providers/PrefsProvider";
import { PHONE_FRAME_QUERY } from "./ScopeControl";
import { networksShared, phoneSessionLine } from "./session";

function PanelLink({ href, icon, children, onNavigate }: { href: string; icon: IconName; children: ReactNode; onNavigate: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] text-fg transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] max-md:h-11"
    >
      <Icon name={icon} size={16} className="shrink-0 text-fg-dim group-hover:text-fg" />
      <span className="flex-1">{children}</span>
      <Icon name="chevronRight" size={14} className="text-fg-faint" />
    </Link>
  );
}

function PrefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
      <span className="text-[13px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

/**
 * The address as one copy target: the whole row copies (a bigger target than
 * a 28 px icon, and the panel's first stop for keyboard focus without a
 * tooltip popping up on open).
 */
function AddressRow({ address, chainId, chainName }: { address: string; chainId: string; chainName: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => toast.error("Could not copy the address"),
    );
  };
  const short = shortenAddress(address, 12, 6);
  // Named by its content, a hidden "Copy address" ahead of the address as
  // shown (shortened) and its chain, so the spoken name always holds the
  // visible text (an aria-label with the address in it never matched it
  // for axe). The full address is on the hover title and in the clipboard;
  // the confirmation is announced from outside the button, so it never
  // becomes part of the name.
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="group mx-4 flex items-center gap-2.5 rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-glass)] px-2.5 py-2 text-left transition-[background-color,border-color] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-glass-2)] max-md:mx-0"
      >
        <ChainLogo chainId={chainId} size={18} />
        <span className="min-w-0 flex-1">
          <span className="sr-only">Copy address </span>
          <span className="block truncate font-mono text-[12px] text-fg" title={address}>
            {short}
          </span>{" "}
          <span className="block text-[11px] text-fg-dim">on {chainName}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex items-center gap-1 text-[11.5px] font-medium transition-colors duration-[160ms]",
            copied ? "text-[var(--d-pos)]" : "text-fg-dim group-hover:text-fg",
          )}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Address copied" : ""}
      </span>
    </>
  );
}

function AccountPanel({ onNavigate }: { onNavigate: () => void }) {
  const { account, walletKind, primaryChainId, skippedChains, keys, disconnect, mobile } = useWallet();
  const { theme, setTheme } = useTheme();
  const { currency, setCurrency, hideAmounts, toggleHideAmounts } = usePrefs();
  const now = useNow();
  if (!account) return null;
  const name = accountLabel(account);
  const chain = findChain(primaryChainId);
  const phone = walletKind === "zunia-mobile";
  const phoneLive = phone && mobile.status === "connected";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4 max-md:px-0 max-md:pt-0">
        <Avatar seed={account.address} fallback={name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.015em] text-fg">{name}</p>
          {/* How the wallet is connected. For an extension, what `keys`
              holds: the networks it shared an account for (it can add others
              when a page asks). For Zunia Mobile, the phone link and the time
              left in its session. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {walletKind ? (
              <StatusBadge tone={phone && !phoneLive ? "warning" : "success"} pulse={phoneLive}>
                <span className="sr-only">Connected with </span>
                {walletKindLabel(walletKind)}
              </StatusBadge>
            ) : null}
            <span className="text-[11.5px] text-fg-dim">
              {phone ? phoneSessionLine(mobile.status, mobile.expiresAt, now) : networksShared(Object.keys(keys).length)}
            </span>
          </div>
        </div>
      </div>

      <AddressRow address={account.address} chainId={primaryChainId} chainName={chain?.chainName ?? primaryChainId} />

      {skippedChains.length > 0 ? (
        <p className="mx-4 mt-2 flex items-center gap-1.5 text-[12px] text-[var(--z-warning)] max-md:mx-0">
          <Icon name="warning" size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {skippedChains.length} {skippedChains.length === 1 ? "network was" : "networks were"} not shared
          </span>
          <InfoTip
            label="Networks not shared"
            content={
              <ul className="flex flex-col gap-1">
                {skippedChains.slice(0, 8).map((skipped) => (
                  <li key={skipped.chainId}>
                    <span className="font-medium text-fg">{findChain(skipped.chainId)?.chainName ?? skipped.chainId}</span>
                    <span className="block text-fg-dim">{skipped.reason}</span>
                  </li>
                ))}
                {skippedChains.length > 8 ? <li className="text-fg-dim">and {skippedChains.length - 8} more</li> : null}
              </ul>
            }
          />
        </p>
      ) : null}

      <div className="mt-3 flex flex-col border-t border-[var(--d-hairline)] px-1.5 py-1.5 max-md:px-0">
        <PanelLink href="/receive" icon="receive" onNavigate={onNavigate}>
          Your addresses on every chain
        </PanelLink>
        <PanelLink href="/settings" icon="settings" onNavigate={onNavigate}>
          Settings
        </PanelLink>
      </div>

      <div className="flex flex-col border-t border-[var(--d-hairline)] px-1.5 py-1.5 max-md:px-0">
        <PrefRow label="Theme">
          <Segmented<ThemeMode>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </PrefRow>
        <PrefRow label="Currency">
          <Segmented<FiatCurrency>
            ariaLabel="Currency"
            mono
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "usd", label: "USD" },
              { value: "eur", label: "EUR" },
              { value: "gbp", label: "GBP" },
            ]}
          />
        </PrefRow>
        <PrefRow label="Hide amounts">
          <Switch checked={hideAmounts} onCheckedChange={toggleHideAmounts} ariaLabel="Hide amounts" />
        </PrefRow>
      </div>

      <div className="border-t border-[var(--d-hairline)] p-2 max-md:px-0 max-md:pb-0">
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          iconLeft="disconnect"
          className="justify-start text-[var(--z-danger)] hover:bg-[var(--z-danger-fill)] hover:text-[var(--z-danger)] max-md:h-11"
          onClick={() => {
            onNavigate();
            void disconnect();
          }}
        >
          {walletKind ? `Disconnect ${walletKindLabel(walletKind)}` : "Disconnect"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The chip's face: orb, name and short address (from 1280 px), chevron.
 * Spreads what the popover trigger passes (ref, handlers, state) onto the
 * button, or the popover would have nothing to anchor to.
 */
function Chip({ open, compact, className, ...rest }: ComponentPropsWithRef<"button"> & { open: boolean; compact: boolean }) {
  const { account, walletKind, mobile } = useWallet();
  if (!account) return null;
  const name = accountLabel(account);
  const short = shortenAddress(account.address, 9, 4);
  // The bar's only sign of a phone link in trouble: an amber dot on the orb
  // while a Zunia Mobile session is not connected (it reconnects by itself).
  const phoneDown = walletKind === "zunia-mobile" && mobile.status !== "connected";
  // Named by its content (WCAG 2.5.3): a hidden "Account:" then the name and
  // address as the chip shows them from 1280 px; below that (and in the
  // phone's compact chip) only the orb shows, and the same words are read
  // from a hidden copy. The orb itself is hidden: its own label would repeat
  // the name.
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      {...rest}
      className={cn(
        "d-hit group flex shrink-0 items-center gap-2 rounded-full border border-[var(--d-hairline)] bg-[var(--d-glass)] p-[3px] transition-[background-color,border-color] duration-[160ms]",
        "hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-glass-2)]",
        open && "border-[var(--d-hairline-strong)] bg-[var(--d-glass-2)]",
        !compact && "xl:rounded-[11px] xl:pr-2",
        className,
      )}
    >
      <span aria-hidden className="relative flex shrink-0">
        <Avatar seed={account.address} fallback={name} size={compact ? 30 : 28} />
        {phoneDown ? <Dot tone="warning" className="absolute -right-px -top-px size-2 shadow-[0_0_0_2px_var(--z-bg)]" /> : null}
      </span>
      <span className="sr-only">Account: </span>
      <span className={cn("sr-only", !compact && "xl:hidden")}>
        {name}, {short}
      </span>
      {!compact ? (
        <>
          <span className="hidden min-w-0 max-w-[140px] text-left xl:block">
            <span className="block truncate text-[12.5px] font-medium leading-tight text-fg">{name}</span>{" "}
            <span className="block truncate font-mono text-[10.5px] leading-tight text-fg-dim">{short}</span>
          </span>
          <Icon name="chevronDown" size={13} className="hidden shrink-0 text-fg-dim group-hover:text-fg xl:block" />
        </>
      ) : null}
      {phoneDown ? <span className="sr-only">, phone reconnecting</span> : null}
    </button>
  );
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(PHONE_FRAME_QUERY);
  const { account, restoring, zuniaLocked, zuniaAvailable, connectExtension } = useWallet();
  const modal = useConnectModal();

  if (!account) {
    if (restoring) return <Skeleton className="shrink-0 rounded-full" width={phone ? 36 : 120} height={34} />;
    // A remembered Zunia connection whose wallet locked itself: the account is
    // one unlock away, so say that instead of offering a fresh connect. The
    // click is the user gesture Zunia's unlock window needs; a refusal falls
    // back to the modal, which lists every way in.
    if (zuniaLocked && zuniaAvailable) {
      return (
        <Button
          variant="primary"
          size="sm"
          iconLeft="lock"
          onClick={() => void connectExtension("zunia").catch(() => modal.open())}
          className="shrink-0 max-md:px-2.5"
        >
          <span className="max-sm:hidden">Zunia is locked — Unlock</span>
          <span className="sm:hidden">Unlock</span>
        </Button>
      );
    }
    return (
      <Button variant="primary" size="sm" iconLeft="wallet" onClick={() => modal.open()} className="shrink-0 max-md:px-2.5">
        <span className="max-sm:hidden">Connect wallet</span>
        <span className="sm:hidden">Connect</span>
      </Button>
    );
  }

  if (phone) {
    return (
      <>
        <Chip open={open} compact onClick={() => setOpen(true)} />
        <Sheet open={open} onOpenChange={setOpen} title="Account" side="bottom">
          <AccountPanel onNavigate={() => setOpen(false)} />
        </Sheet>
      </>
    );
  }
  return (
    <Popover trigger={<Chip open={open} compact={false} />} open={open} onOpenChange={setOpen} width={340} padded={false} align="end" sideOffset={10} ariaLabel="Account">
      <AccountPanel onNavigate={() => setOpen(false)} />
    </Popover>
  );
}
