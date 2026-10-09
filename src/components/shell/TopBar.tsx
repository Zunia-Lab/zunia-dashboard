"use client";

/**
 * The sticky top bar: the page's title with the scope control or breadcrumbs
 * under it, search, quick actions, privacy, Live, notifications and the
 * account.
 *
 * The title here is presentational (aria-hidden): the page's h1 is rendered
 * by `<Page>`, in the server HTML, while this bar only learns the title once
 * the page has hydrated (ShellContext). Before that, a detail page's bar shows
 * placeholder bars rather than its section's name and the scope control,
 * which would flip to the page's title and breadcrumbs a moment later.
 *
 * Sizes: 60 px from 768 px, 56 px on phones (menu, title + scope chip, bell,
 * avatar, and Live while a transfer is still moving), hairline included: the
 * rail's and the sidebar's header rows end on the same line, and
 * `--d-sticky-top` (the frame's) is exactly this height, so a sticky table
 * header meets the bar's edge. The bar is the page background at 82 % over a
 * 14 px blur, so content scrolling under it stays legible without a hard edge.
 *
 * Without a wallet, the privacy toggle and Live are left out (nothing to mask,
 * nothing of yours to follow) unless a transfer this browser signed is still
 * unsettled. While a stored session restores they stay, so a returning
 * visitor's bar does not shift when the wallet comes back.
 */

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import { IconButton, Kbd, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { navItemFor } from "@/lib/nav";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { AccountMenu } from "./AccountMenu";
import { LiveMenu } from "./LiveMenu";
import { NotificationsMenu } from "./NotificationsMenu";
import { ScopeControl } from "./ScopeControl";
import { useRouteLoading, useShellMeta, type Crumb } from "./ShellContext";
import { useShortcutLabel } from "./shortcut";
import { ViewToggle } from "./ViewToggle";

/* ------------------------------------------------------------------ pieces */

const noSubscription = () => () => {};

/** False in the server render and the hydrating render, true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[12px] text-fg-dim md:text-[12.5px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className={cn("flex min-w-0 items-center gap-1", !last && "shrink-0")}>
              {crumb.href && !last ? (
                // On a detail page these links are the way back up, so they
                // get the kit's 44 px touch area (`d-hit`) around the 18 px
                // text. No `truncate` on the link: its overflow clip would
                // cut that area off, and a parent crumb never shrinks anyway.
                <Link href={crumb.href} className="d-hit whitespace-nowrap rounded-[4px] transition-colors duration-[160ms] hover:text-fg">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "text-fg-muted")}>
                  {crumb.label}
                </span>
              )}
              {!last ? (
                <Icon name="chevronRight" size={12} className="shrink-0 text-fg-faint" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function TitleBlock({ pathname }: { pathname: string }) {
  const meta = useShellMeta();
  const hydrated = useHydrated();
  const loading = useRouteLoading();
  const item = navItemFor(pathname);
  // A detail page (a validator, a proposal, a chain, a transaction…) names
  // itself, and its title reaches the bar when the page mounts. Until then
  // the bar would read as the section ("Validators" over the scope control)
  // and flip: two quiet bars hold the place instead, before hydration and
  // while the route's loading state stands in for the page. Not beyond: a
  // detail URL that renders no page (a 404 inside the frame) publishes
  // nothing, and gets the section's name.
  if (!meta && (!hydrated || loading) && item && pathname !== item.href) {
    return (
      <div aria-hidden className="flex min-w-0 flex-1 flex-col justify-center gap-[7px]">
        <Skeleton className="h-[16px] w-36 rounded-[5px] md:h-[18px]" />
        <Skeleton className="h-3 w-28 rounded-[4px]" />
      </div>
    );
  }
  const title = meta?.title ?? item?.label ?? "Zunia";
  const crumbs = meta?.breadcrumbs && meta.breadcrumbs.length > 0 ? meta.breadcrumbs : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
      <p
        aria-hidden
        className="truncate text-[16px] font-semibold leading-[1.15] tracking-[-0.02em] text-fg md:text-[18px]"
        title={meta?.subtitle}
      >
        {title}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        {crumbs ? <Breadcrumbs crumbs={crumbs} /> : <ScopeControl className="min-[1800px]:shrink-0" />}
        {/* The page's one-liner, only where the bar has room for it next to
            the scope control (from 1800 px; below that, search and the quick
            actions need the width). The scope control never gives way to it. */}
        {meta?.subtitle && !crumbs ? (
          <span className="hidden min-w-0 truncate text-[12.5px] text-fg-dim min-[1800px]:block">
            <span aria-hidden className="mr-2">
              ·
            </span>
            {meta.subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SearchTrigger({ onSearch }: { onSearch: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <>
      {/* Named by its visible text (WCAG 2.5.3: the spoken name contains
          what is shown); the shortcut is announced through
          aria-keyshortcuts rather than read out as "⌘K". */}
      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "hidden h-9 w-[260px] shrink-0 items-center gap-2 rounded-[10px] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] pl-3 pr-1.5 text-left xl:flex",
          "text-[13px] text-fg-dim transition-[border-color,background-color,color] duration-[160ms] hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass-2)] hover:text-fg-muted",
        )}
      >
        <Icon name="search" size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search assets, chains, actions</span>
        <Kbd aria-hidden>{shortcut}</Kbd>
      </button>
      <IconButton label="Search" tooltip={`Search · ${shortcut}`} tooltipSide="bottom" icon="search" onClick={onSearch} className="hidden md:inline-flex xl:hidden" />
    </>
  );
}

const QUICK_ACTIONS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/send", label: "Send", icon: "send" },
  { href: "/receive", label: "Receive", icon: "receive" },
  { href: "/swap", label: "Swap", icon: "swap" },
];

function QuickActions({ pathname }: { pathname: string }) {
  return (
    <div className="hidden shrink-0 items-center gap-0.5 rounded-[11px] border border-[var(--d-hairline)] bg-[var(--d-glass)] p-[3px] 2xl:flex">
      {QUICK_ACTIONS.map((action) => {
        const active = pathname === action.href;
        return (
          <Link
            key={action.href}
            href={action.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium transition-colors duration-[160ms]",
              active ? "bg-[var(--d-seg-thumb)] text-fg shadow-[var(--d-seg-thumb-shadow)]" : "text-fg-muted hover:bg-[var(--d-glass-2)] hover:text-fg",
            )}
          >
            <Icon name={action.icon} size={15} className={active ? "text-[var(--d-accent-text)]" : "text-fg-dim"} />
            {action.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ bar */

export function TopBar({ pathname, onMenu, onSearch }: { pathname: string; onMenu: () => void; onSearch: () => void }) {
  const { hideAmounts, toggleHideAmounts } = usePrefs();
  const { account, restoring } = useWallet();
  const withWallet = Boolean(account) || restoring;
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--d-hairline)] bg-[color-mix(in_srgb,var(--z-bg)_82%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-[14px] backdrop-saturate-[1.4]">
      {/* 55 / 59 px + the 1 px hairline. The right edge (the account chip or
          Connect, both with a visible edge) lines up with the content gutter;
          the menu button on the left is borderless, so its glyph does. */}
      <div className="mx-auto flex h-[55px] w-full max-w-[1680px] items-center gap-1.5 pl-2 pr-4 sm:pl-3 md:h-[59px] md:gap-3 md:px-4 lg:px-5 xl:px-6">
        <IconButton label="Open menu" tooltip={false} icon="menu" onClick={onMenu} className="lg:hidden" />
        <TitleBlock pathname={pathname} />
        <SearchTrigger onSearch={onSearch} />
        {account ? <QuickActions pathname={pathname} /> : null}
        {/* From lg the bar has room for it; below, the menu sheet holds it. */}
        <ViewToggle className="hidden shrink-0 lg:flex" />
        <div className="flex shrink-0 items-center gap-0.5">
          {withWallet ? (
            <IconButton
              label={hideAmounts ? "Show amounts" : "Hide amounts"}
              tooltipSide="bottom"
              icon={hideAmounts ? "eyeOff" : "eye"}
              pressed={hideAmounts}
              onClick={toggleHideAmounts}
              className="hidden md:inline-flex"
            />
          ) : null}
          <LiveMenu />
          <NotificationsMenu />
        </div>
        <span aria-hidden className="hidden h-6 w-px shrink-0 bg-[var(--d-hairline-strong)] md:block" />
        <AccountMenu />
      </div>
    </header>
  );
}
