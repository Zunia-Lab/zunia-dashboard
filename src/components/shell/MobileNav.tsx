"use client";

/**
 * Navigation below the desktop sidebar's breakpoint.
 *
 * - Phones (< 768 px): a bottom tab bar (Overview · Assets · Swap · Activity
 *   · More), Swap raised in the centre on the brand gradient, and "More"
 *   opening a bottom sheet with search, the chain chips (the rail's job on a
 *   phone) and every destination as a grid of tiles.
 * - Tablets and small laptops (768–1023 px): the menu button opens the same
 *   sheet as a left drawer, with the sidebar's list (the rail stays visible).
 */

import Link from "next/link";
import { Icon } from "@/components/icons";
import { ChainLogo, Chip, Sheet, useMediaQuery } from "@/components/ui";
import { cn } from "@/lib/cn";
import { findChain, type ChainEntry } from "@/lib/chains";
import { MOBILE_TABS, NAV_GROUPS, isNavActive, type NavItem } from "@/lib/nav";
import { useChainScope } from "@/lib/useChainScope";
import { AllChainsMark, PHONE_FRAME_QUERY } from "./ScopeControl";
import { useShellData } from "./ShellData";
import { Lockup, NavGroups, NavLink } from "./Sidebar";

/* ------------------------------------------------------------------ tab bar */

function Tab({ href, label, icon, active }: { href: string; label: string; icon: NavItem["icon"]; active: boolean }) {
  return (
    <li className="flex">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium tracking-[-0.005em] transition-colors duration-[160ms]",
          active ? "text-fg" : "text-fg-dim active:text-fg",
        )}
      >
        <Icon name={icon} size={22} className={active ? "text-[var(--d-accent-text)]" : undefined} />
        {label}
      </Link>
    </li>
  );
}

export function MobileTabBar({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const [overview, assets, swap, activity] = MOBILE_TABS;
  const swapActive = isNavActive(pathname, swap.href);
  // A page reached through "More" (Staking, Markets, Settings…) lights that
  // tab, so the bar always says where you are.
  const inMore = !MOBILE_TABS.some((tab) => isNavActive(pathname, tab.href));
  return (
    // The page background at 88 % (the top bar uses 82 %): content passing
    // under the bar blurs into it instead of showing through its labels.
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--d-hairline)] bg-[color-mix(in_srgb,var(--z-bg)_88%,transparent)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-[18px] backdrop-saturate-[1.4] md:hidden"
    >
      <ul className="mx-auto grid h-[60px] max-w-[560px] grid-cols-5">
        <Tab {...overview} active={isNavActive(pathname, overview.href)} />
        <Tab {...assets} active={isNavActive(pathname, assets.href)} />
        <li className="flex">
          {/* Laid out like the other tabs (a 22 px slot where their icon is),
              so the label shares their baseline; the raised button floats
              over that slot and is part of the same link. */}
          <Link
            href={swap.href}
            aria-current={swapActive ? "page" : undefined}
            className="group relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium tracking-[-0.005em] text-fg"
          >
            <span aria-hidden className="size-[22px]" />
            <span
              aria-hidden
              className={cn(
                "absolute -top-4 left-1/2 flex size-12 -translate-x-1/2 items-center justify-center rounded-full bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]",
                "shadow-[0_0_0_4px_var(--z-bg),0_6px_16px_rgba(255,45,31,0.26)] transition-transform duration-[160ms] group-active:scale-95",
              )}
            >
              <Icon name="swap" size={22} strokeWidth={1.9} />
            </span>
            {swap.label}
          </Link>
        </li>
        <Tab {...activity} active={isNavActive(pathname, activity.href)} />
        <li className="flex">
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium tracking-[-0.005em] transition-colors duration-[160ms]",
              inMore ? "text-fg" : "text-fg-dim active:text-fg",
            )}
          >
            <Icon name="grid" size={22} className={inMore ? "text-[var(--d-accent-text)]" : undefined} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ sheet */

function ChainChips({ onSelect }: { onSelect?: () => void }) {
  const { network, selectedChainId, selectChain, followedOnNetwork } = useChainScope();
  const { attention } = useShellData();
  const chains = followedOnNetwork.map((chainId) => findChain(chainId)).filter((chain): chain is ChainEntry => Boolean(chain));
  const pick = (chainId: string | null) => {
    selectChain(chainId);
    onSelect?.();
  };
  return (
    <div>
      <p className="d-label mb-2 text-[10.5px]">
        Scope · {network === "testnet" ? "Testnet" : "Mainnet"}
      </p>
      <div role="group" aria-label="Scope" className="d-no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <Chip size="md" selected={selectedChainId === null} onClick={() => pick(null)} leading={<AllChainsMark size={18} active={selectedChainId === null} />}>
          All chains
        </Chip>
        {chains.map((chain) => (
          <Chip
            key={chain.chainId}
            size="md"
            selected={selectedChainId === chain.chainId}
            onClick={() => pick(chain.chainId)}
            leading={
              <span className="relative flex">
                <ChainLogo chainId={chain.chainId} size={18} />
                {attention.get(chain.chainId)?.attention ? (
                  <span aria-hidden className="absolute -right-0.5 -top-0.5 size-[7px] rounded-full border border-[var(--d-pop-bg)] bg-[var(--z-brand-amber)]" />
                ) : null}
              </span>
            }
          >
            {chain.chainName}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Tile({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className="flex min-h-[78px] flex-col items-center gap-1.5 rounded-[14px] px-1 py-2 text-center transition-colors duration-[160ms] active:bg-[var(--d-glass)]"
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-[13px]",
          active ? "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]" : "bg-[var(--d-glass-2)] text-fg-muted",
        )}
      >
        <Icon name={item.icon} size={20} />
      </span>
      <span className={cn("text-[11.5px] leading-tight", active ? "font-medium text-fg" : "text-fg-muted")}>{item.label}</span>
      {item.badge === "soon" ? <span className="-mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-fg-dim">Soon</span> : null}
    </Link>
  );
}

export function NavSheet({
  open,
  onOpenChange,
  pathname,
  version,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
  version: string;
  onSearch: () => void;
}) {
  const phone = useMediaQuery(PHONE_FRAME_QUERY);
  const close = () => onOpenChange(false);
  const search = (
    <button
      type="button"
      onClick={() => {
        close();
        onSearch();
      }}
      className="flex h-11 w-full items-center gap-2.5 rounded-[11px] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] px-3 text-left text-[14px] text-fg-dim"
    >
      <Icon name="search" size={17} />
      Search assets, chains, actions
    </button>
  );
  const footer = (
    <div className="flex flex-col gap-1 border-t border-[var(--d-hairline)] pt-3">
      <NavLink item={{ href: "/settings", label: "Settings", icon: "settings" }} active={isNavActive(pathname, "/settings")} onNavigate={close} />
      <p className="px-2.5 pt-1 font-mono text-[10.5px] text-fg-dim">Zunia Dashboard v{version}</p>
    </div>
  );

  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Menu" side="bottom" bodyClassName="flex flex-col gap-5 pb-4 [&>*]:shrink-0">
        {search}
        <ChainChips />
        {NAV_GROUPS.map((group) => (
          <section key={group.id} aria-label={group.label ?? "Home"}>
            {group.label ? <h3 className="d-label mb-1 text-[10.5px]">{group.label}</h3> : null}
            <div className="grid grid-cols-4 gap-1">
              {group.items.map((item) => (
                <Tile key={item.href} item={item} active={isNavActive(pathname, item.href)} onNavigate={close} />
              ))}
            </div>
          </section>
        ))}
        {footer}
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={<Lockup />} side="left" width={300} bodyClassName="flex flex-col gap-3 pb-4 [&>*]:shrink-0">
      {search}
      <nav aria-label="Main" className="flex flex-col">
        <NavGroups pathname={pathname} onNavigate={close} />
      </nav>
      {footer}
    </Sheet>
  );
}
