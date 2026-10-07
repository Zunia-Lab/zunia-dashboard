"use client";

/**
 * The landing page's sticky navigation.
 *
 * Transparent over the hero, it takes the frosted top-bar surface once the
 * page scrolls. Links to the public pages and the docs from 1024px; below
 * that a menu button opens the same links in a sheet (a bottom sheet on
 * phones). The primary action follows the wallet: "Connect wallet" opens the
 * shared connect modal, a linked wallet gets "Open dashboard".
 */

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Button, IconButton, Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWallet } from "@/providers/WalletProvider";
import { NAV_LINKS } from "./content";
import { useOpenConnect } from "./useOpenConnect";
import { ZuniaLockup } from "./ZuniaMark";
import styles from "./landing.module.css";

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** True once the page has scrolled past the first few pixels. */
function useScrolled(threshold = 8): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > threshold,
    () => false,
  );
}

export function LandingNav() {
  const { account } = useWallet();
  const openConnect = useOpenConnect();
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  // The sheet's own button is gone once the modal closes: focus goes back
  // to the menu button that opened the sheet.
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const primary = account ? (
    <Button variant="primary" size="sm" href="/overview" iconRight="arrowRight">
      Open dashboard
    </Button>
  ) : (
    <Button variant="primary" size="sm" onClick={() => openConnect()}>
      Connect wallet
    </Button>
  );

  return (
    <header className={cn(styles.nav, "sticky top-0 z-40")} data-scrolled={scrolled || undefined}>
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:gap-8 lg:px-8">
        {/* The name starts with the words the lock-up shows ("zunia
            dashboard", or "zunia" alone on the narrowest phones), so speech
            input can say what it sees; d-hit gives the 28px-tall lock-up a
            44px touch target. */}
        <Link href="/" aria-label="Zunia dashboard home" className="d-hit -ml-1 flex shrink-0 items-center rounded-[10px] px-1 py-1">
          <ZuniaLockup id="nav-mark" size={19} className="max-[419px]:[&>span>span:last-child]:hidden" />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1 rounded-[10px] px-3 text-[14px] text-fg-muted transition-colors duration-[160ms] hover:bg-[var(--d-glass)] hover:text-fg"
                  >
                    {link.label}
                    <Icon name="arrowUpRight" size={13} className="opacity-70" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link
                    href={link.href}
                    className="inline-flex h-9 items-center rounded-[10px] px-3 text-[14px] text-fg-muted transition-colors duration-[160ms] hover:bg-[var(--d-glass)] hover:text-fg"
                  >
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {primary}
          <IconButton
            ref={menuButtonRef}
            label="Open menu"
            icon="menu"
            variant="ghost"
            className="lg:hidden"
            tooltip={false}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          />
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Zunia dashboard" side="right" width={360}>
        <nav aria-label="Main" className="flex flex-col gap-1 pt-1">
          {NAV_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMenu}
                className="flex min-h-12 items-center justify-between rounded-[12px] px-3 text-[15px] text-fg transition-colors duration-[160ms] hover:bg-[var(--d-glass)]"
              >
                {link.label}
                <Icon name="arrowUpRight" size={16} className="text-fg-dim" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="flex min-h-12 items-center justify-between rounded-[12px] px-3 text-[15px] text-fg transition-colors duration-[160ms] hover:bg-[var(--d-glass)]"
              >
                {link.label}
                <Icon name="chevronRight" size={16} className="text-fg-dim" />
              </Link>
            ),
          )}
        </nav>
        <div className="mt-4 border-t border-[var(--d-hairline)] pt-4">
          {account ? (
            <Button variant="primary" size="lg" fullWidth href="/overview" iconRight="arrowRight" onClick={closeMenu}>
              Open dashboard
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                closeMenu();
                openConnect(undefined, menuButtonRef.current);
              }}
            >
              Connect wallet
            </Button>
          )}
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-fg-dim">
            <Icon name="lock" size={14} className="shrink-0" />
            Non-custodial. Zunia never asks for a recovery phrase.
          </p>
        </div>
      </Sheet>
    </header>
  );
}
