"use client";

/**
 * The persistent app frame (design spec §2): chain rail, sidebar, sticky top
 * bar, the phone tab bar, and the frame-wide surfaces (command palette,
 * navigation sheet). Zunia Mobile has no surface of its own here: it is one
 * way to connect a wallet, offered by the connect modal.
 *
 * Mounted once by `app/(app)/layout.tsx`, so navigating keeps the rail, the
 * sidebar scroll position and any open popover instead of rebuilding them.
 * Pages publish their title through `<Page>` (ShellContext).
 *
 * The document scrolls, not an inner box: the top bar is sticky, the rail and
 * sidebar are sticky full-height columns with their own overflow, so browser
 * scroll restoration, "scroll to top" on navigation, full-page screenshots
 * and the mobile URL bar collapse all behave as on any web page.
 * `--d-sticky-top` is set to the bar's height here so DataTable headers stick
 * just under it, and `styles.frame` keeps a control reached with the keyboard
 * clear of the bar and the tab bar when it scrolls into view.
 *
 * Keyboard (anywhere but in a text field or an open dialog):
 *   ⌘K / Ctrl K  command palette (also inside fields)
 *   0            all chains
 *   [ / ]        previous / next chain along the rail
 */

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { useChainScope } from "@/lib/useChainScope";
import { ChainRail } from "./ChainRail";
import { MobileTabBar, NavSheet } from "./MobileNav";
import { NoticeDriver } from "./NoticeDriver";
import { ShellControlsProvider, ShellMetaProvider, type ShellControls } from "./ShellContext";
import { ShellDataProvider } from "./ShellData";
import { TipProvider } from "./ShellTip";
import { Sidebar } from "./Sidebar";
import styles from "./shell.module.css";
import { cycleScope } from "./signals";
import { TopBar } from "./TopBar";

export function AppFrame({ children, version }: { children: ReactNode; version: string }) {
  return (
    <ShellMetaProvider>
      <ShellDataProvider>
        <TipProvider>
          <Frame version={version}>{children}</Frame>
        </TipProvider>
      </ShellDataProvider>
    </ShellMetaProvider>
  );
}

/** Keys typed into a field, a menu or a dialog are not frame shortcuts. */
function inTextOrOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [contenteditable="true"]')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type);
  }
  return false;
}

function Frame({ children, version }: { children: ReactNode; version: string }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { followedAll, followedOnNetwork, selectedChainId, selectChain, setSelectedChainId } = useChainScope();

  const controls = useMemo<ShellControls>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openNavigation: () => setNavOpen(true),
    }),
    [],
  );

  // A chain's own page scopes the frame to it (when the chain is followed),
  // once per visit: switching MAIN/TEST or the rail on that page afterwards
  // must not be overridden. The followed list is part of the key because it
  // reads as the default list until storage is read after hydration.
  const scopedFrom = useRef<string | null>(null);
  useEffect(() => {
    const match = pathname.match(/^\/chains\/([^/]+)/);
    const key = `${pathname}|${followedAll.join(",")}`;
    if (!match || scopedFrom.current === key) return;
    scopedFrom.current = key;
    const chainId = decodeURIComponent(match[1]);
    if (followedAll.includes(chainId)) selectChain(chainId);
  }, [pathname, followedAll, selectChain]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.defaultPrevented || event.repeat || inTextOrOverlay(event.target)) return;
      // '[' and ']' need AltGr / Option on some layouts (French AZERTY):
      // accept Alt, and Ctrl only together with Alt (how Windows reports AltGr).
      if ((event.key === "[" || event.key === "]") && !event.metaKey && (!event.ctrlKey || event.altKey)) {
        event.preventDefault();
        setSelectedChainId(cycleScope(followedOnNetwork, selectedChainId, event.key === "]" ? 1 : -1));
      } else if (event.key === "0" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        selectChain(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [followedOnNetwork, selectedChainId, selectChain, setSelectedChainId]);

  return (
    <ShellControlsProvider value={controls}>
      <div
        className={
          `${styles.frame} flex min-h-dvh w-full bg-bg text-fg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] ` +
          "[--d-sticky-top:calc(56px+env(safe-area-inset-top))] md:[--d-sticky-top:calc(60px+env(safe-area-inset-top))]"
        }
      >
        {/* Parked above the viewport and slid in on focus, rather than the
            sr-only / not-sr-only utilities: the kit's stylesheet declares its own
            unlayered `.sr-only`, which beats Tailwind's layered
            `focus:not-sr-only`, so the focused link stayed a clipped 1 px
            box. The shadow only comes with focus: its 48 px blur would
            otherwise reach into the page from above. */}
        <a
          href="#main"
          className="fixed left-3 top-3 z-[90] -translate-y-[200%] rounded-[10px] bg-[var(--d-pop-bg)] px-3 py-2 text-[13px] text-fg focus:translate-y-0 focus:shadow-[var(--d-pop-shadow)]"
        >
          Skip to content
        </a>
        <ChainRail />
        <Sidebar pathname={pathname} version={version} />
        {/* clip, not hidden: no scroll container, so the sticky bar still
            follows the page, and a too-wide element cannot scroll the page sideways. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
          <TopBar pathname={pathname} onMenu={controls.openNavigation} onSearch={controls.openPalette} />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full min-w-0 max-w-[1680px] flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-4 outline-none md:pb-10 md:pt-5 lg:px-5 xl:px-6 xl:pt-6"
          >
            {children}
          </main>
        </div>
        <MobileTabBar pathname={pathname} onMore={controls.openNavigation} />
      </div>
      <NavSheet open={navOpen} onOpenChange={setNavOpen} pathname={pathname} version={version} onSearch={controls.openPalette} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <NoticeDriver />
    </ShellControlsProvider>
  );
}
