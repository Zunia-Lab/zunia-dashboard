"use client";

/**
 * The sidebar (≥ 1024 px) and the navigation list it shares with the
 * drawer / "More" sheet.
 *
 * Width: 232 px, or 64 px icons. By viewport unless the user chose
 * (persisted as `zunia.dashboard.sidebar`, painted from the first frame via
 * `html[data-sidebar]`, see `shell.module.css`): icons from 1024 to 1279 px,
 * full from 1280 px. In icon mode every item keeps its accessible name (its
 * label is visually hidden, not removed, so the name is always the text a
 * sighted user sees in the wide sidebar) and gains a hover / focus label.
 *
 * The footer holds Settings and the version. Zunia Mobile has no card here:
 * it is one of the ways to connect a wallet, in the connect modal.
 */

import Link from "next/link";
import { useEffect } from "react";
import { Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
import { SoonBadge, useMediaQuery } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NAV_GROUPS, isNavActive, type NavItem } from "@/lib/nav";
import { useStoredValue } from "@/lib/useStoredValue";
import { ShellTip } from "./ShellTip";
import { useScrollFade } from "./scroll-fade";
import styles from "./shell.module.css";
import { SIDEBAR_STORAGE_KEY, type SidebarPref } from "./theme-boot";

/* ------------------------------------------------------------------ lockup */

/**
 * The product lockup: the Zunia mark, "Zunia" and a small "Dashboard". The
 * space between the two words is a real one (invisible between the stacked
 * lines): without it the lockup reads, and names its link and the drawer,
 * "ZuniaDashboard".
 */
export function Lockup() {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="flex h-[22px] w-[18px] shrink-0 items-center justify-center text-fg">
        <Mark size={15} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-none tracking-[-0.02em] text-fg">Zunia</span>{" "}
        <span className="mt-1 block font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.14em] text-fg-dim">
          Dashboard
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ nav list */

interface NavLinkProps {
  item: Pick<NavItem, "href" | "label" | "icon" | "badge">;
  active: boolean;
  onNavigate?: () => void;
  /** Icon mode: show the label as a hover / focus tip. */
  tip?: boolean;
}

export function NavLink({ item, active, onNavigate, tip }: NavLinkProps) {
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        styles.item,
        "group relative flex h-[34px] shrink-0 items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px] tracking-[-0.01em]",
        "transition-[background-color,color] duration-[160ms] ease-[var(--d-ease)] pointer-coarse:h-11",
        // Short laptop windows: a tighter list so the whole nav fits.
        "[@media(max-height:820px)_and_(pointer:fine)]:h-[30px]",
        active
          ? "bg-[var(--d-glass-2)] font-medium text-fg"
          : "text-fg-muted hover:bg-[var(--d-glass)] hover:text-fg active:bg-[var(--d-glass-2)]",
      )}
    >
      {active ? (
        <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[image:var(--z-accent-gradient)]" />
      ) : null}
      <Icon
        name={item.icon}
        size={18}
        className={cn(
          "shrink-0 transition-colors duration-[160ms]",
          active ? "text-[var(--d-accent-text)]" : "text-fg-dim group-hover:text-fg-muted",
        )}
      />
      {/* Visually hidden in icon mode rather than removed: the link keeps
          its visible text as its name ("Missions Soon"), in both widths. */}
      <span className={cn(styles.wideText, "min-w-0 flex-1 truncate")}>{item.label}</span>
      {item.badge === "soon" ? <SoonBadge className={styles.wideText} /> : null}
    </Link>
  );
  return (
    <ShellTip disabled={!tip} content={item.badge === "soon" ? `${item.label} · soon` : item.label}>
      {link}
    </ShellTip>
  );
}

export function NavGroups({ pathname, onNavigate, tips }: { pathname: string; onNavigate?: () => void; tips?: boolean }) {
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col">
          {group.label ? (
            <>
              <div className={cn(styles.wideOnly, "d-label px-2.5 pb-1 pt-2 text-[10.5px] [@media(max-height:820px)]:pt-1.5")}>{group.label}</div>
              <div aria-hidden className={cn(styles.narrowOnly, "mx-auto my-[7px] h-px w-6 bg-[var(--d-hairline-strong)]")} />
            </>
          ) : null}
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} active={isNavActive(pathname, item.href)} onNavigate={onNavigate} tip={tips} />
          ))}
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ sidebar */

function useSidebarPref() {
  const [pref, setPref] = useStoredValue<SidebarPref>(SIDEBAR_STORAGE_KEY, null);
  // The CSS reads the choice from <html>, where the boot script put it.
  useEffect(() => {
    const root = document.documentElement;
    if (pref === "collapsed" || pref === "expanded") root.dataset.sidebar = pref;
    else delete root.dataset.sidebar;
  }, [pref]);
  return [pref, setPref] as const;
}

export function Sidebar({ pathname, version }: { pathname: string; version: string }) {
  const [pref, setPref] = useSidebarPref();
  const wide = useMediaQuery("(min-width: 1280px)", true);
  const iconMode = pref === "collapsed" || (pref === null && !wide);
  const toggle = () => setPref(iconMode ? "expanded" : "collapsed");
  const settingsActive = isNavActive(pathname, "/settings");
  const navRef = useScrollFade<HTMLElement>();

  return (
    // The column runs the page's full height (its hairline with it, also in a
    // full-page capture) and carries the width; the panel inside sticks to the
    // viewport and clips what the width transition hides.
    <aside aria-label="Sidebar" className={cn(styles.sidebar, "hidden shrink-0 border-r border-[var(--d-hairline)] lg:block")}>
      <div className="sticky top-0 flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="flex h-[60px] shrink-0 items-center justify-center gap-2 border-b border-[var(--d-hairline)] px-3">
          <Link href="/overview" className={cn(styles.wideOnly, "group flex min-w-0 flex-1 items-center rounded-[8px] px-1.5 py-1")}>
            <Lockup />
          </Link>
          <ShellTip content={iconMode ? "Expand sidebar" : "Collapse sidebar"} side={iconMode ? "right" : "bottom"}>
            <button
              type="button"
              onClick={toggle}
              aria-label={iconMode ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!iconMode}
              className={cn(
                "d-hit inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-fg-dim",
                "transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg",
              )}
            >
              <Icon name={iconMode ? "chevronRight" : "chevronLeft"} size={16} />
            </button>
          </ShellTip>
        </div>

        <nav ref={navRef} aria-label="Main" className={cn(styles.fade, "d-no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2 pt-1.5")}>
          <NavGroups pathname={pathname} tips={iconMode} />
        </nav>

        <div className="flex shrink-0 items-center gap-1 border-t border-[var(--d-hairline)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <NavLink item={{ href: "/settings", label: "Settings", icon: "settings" }} active={settingsActive} tip={iconMode} />
          </div>
          <span className={cn(styles.wideOnly, "shrink-0 pr-1.5 font-mono text-[10px] text-fg-dim")} title={`Zunia Dashboard ${version}`}>
            v{version}
          </span>
        </div>
      </div>
    </aside>
  );
}
