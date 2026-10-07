"use client";

/**
 * How a page talks to the persistent app frame.
 *
 * The frame lives in `app/(app)/layout.tsx` so the rail, sidebar and top bar
 * do not remount on every navigation. Pages still own their title (an asset
 * page knows it is "ATOM", the layout does not), so they publish it here with
 * `<Page title=…>` and the top bar reads it back. Without a published title the
 * frame falls back to the nav entry for the current path.
 *
 * The frame also exposes its own surfaces (`useShell()`): a page can open the
 * command palette or the navigation sheet without mounting a second copy of
 * them. Zunia Mobile is not one of them: it is a way to connect a wallet, so
 * it opens from the connect modal (`useConnectModal().open("mobile")`).
 */

import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageMeta {
  title: string;
  /**
   * One line about the page. The top bar keeps the scope control under the
   * title and shows this beside it on wide screens.
   */
  subtitle?: string;
  /** Detail pages: shown under the title instead of the scope control. */
  breadcrumbs?: Crumb[];
}

type SetMeta = (meta: PageMeta | null) => void;

// Readers and writers apart: the top bar reads the meta, pages only write it
// (a page subscribed to the value would re-render each time its own title
// lands). Same for the route-loading mark the loading state sets.
const ShellMetaContext = createContext<PageMeta | null>(null);
const SetShellMetaContext = createContext<SetMeta | null>(null);
const RouteLoadingContext = createContext(false);
const SetRouteLoadingContext = createContext<Dispatch<SetStateAction<number>> | null>(null);

export function ShellMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta | null>(null);
  // A count, not a flag: a loading state that unmounts as the next mounts
  // (one route's to another's) must not clear the other's mark.
  const [loading, setLoading] = useState(0);
  return (
    <SetShellMetaContext.Provider value={setMeta}>
      <SetRouteLoadingContext.Provider value={setLoading}>
        <RouteLoadingContext.Provider value={loading > 0}>
          <ShellMetaContext.Provider value={meta}>{children}</ShellMetaContext.Provider>
        </RouteLoadingContext.Provider>
      </SetRouteLoadingContext.Provider>
    </SetShellMetaContext.Provider>
  );
}

/** The meta the current page published, or null. */
export function useShellMeta(): PageMeta | null {
  return useContext(ShellMetaContext);
}

/**
 * True while the route's loading state is on screen: the page has not
 * mounted yet, so its title is still to come (the top bar holds the place
 * rather than showing the section's name, which the page would replace).
 */
export function useRouteLoading(): boolean {
  return useContext(RouteLoadingContext);
}

/** Marks the route as loading while the caller (the loading state) is mounted. */
export function useMarkRouteLoading() {
  const setLoading = useContext(SetRouteLoadingContext);
  useLayoutEffect(() => {
    if (!setLoading) return;
    setLoading((count) => count + 1);
    return () => setLoading((count) => count - 1);
  }, [setLoading]);
}

/**
 * Publishes the page's title/breadcrumbs while it is mounted.
 *
 * A layout effect, not a passive one: the update it makes is applied before
 * the browser paints, so the bar shows the page's own title in the very
 * frame the page appears in, on hydration as on every client navigation
 * (with a passive effect, a new page showed the previous title, or the nav
 * label, for a frame). It never runs on the server: the server HTML carries
 * the page's title in `<Page>`'s own heading, and the bar its placeholder.
 *
 * Compared by value (JSON) so a page that rebuilds its crumbs array on every
 * render does not loop through the provider.
 */
export function usePageMeta(meta: PageMeta) {
  const setMeta = useContext(SetShellMetaContext);
  const key = JSON.stringify(meta);
  useLayoutEffect(() => {
    if (!setMeta) return;
    setMeta(JSON.parse(key) as PageMeta);
    return () => setMeta(null);
  }, [key, setMeta]);
}

/* ------------------------------------------------------------------ frame surfaces */

export interface ShellControls {
  /** The command palette (also ⌘K / Ctrl K). */
  openPalette: () => void;
  /** The navigation sheet (the drawer under 1024 px, "More" on phones). */
  openNavigation: () => void;
}

const ShellControlsContext = createContext<ShellControls | null>(null);

export function ShellControlsProvider({ value, children }: { value: ShellControls; children: ReactNode }) {
  return <ShellControlsContext.Provider value={value}>{children}</ShellControlsContext.Provider>;
}

/** The frame's surfaces; null outside the app frame (the full-bleed landing page). */
export function useShell(): ShellControls | null {
  return useContext(ShellControlsContext);
}
