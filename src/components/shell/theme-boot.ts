/**
 * What the page paints before React runs: the theme, and the sidebar width
 * the user chose.
 *
 * `@zunialab/ui`'s ThemeProvider (mounted with `defaultTheme="dark"`) only
 * reads storage in an effect, after the first paint. Whatever the document
 * shows before that comes from {@link THEME_BOOT_SCRIPT}, an inline script in
 * the root layout's <head>. The two must agree, or the page flashes: the old
 * script followed the OS when nothing was stored, so a light-OS visitor saw a
 * light page turn dark on hydration. The rule, in one place:
 *
 * - a stored "light" / "dark" wins;
 * - a stored "system" follows `prefers-color-scheme`;
 * - anything else is dark, the dashboard's default.
 *
 * The same script restores the sidebar's collapsed / expanded preference as
 * `html[data-sidebar]` so a collapsed sidebar does not paint expanded first
 * (the frame's CSS reads the attribute; see `shell.module.css`), and the
 * Lite / Pro view as `html[data-view]`, so server-rendered pages hide their
 * Pro-only cards with CSS (`lite:` variant) before React runs.
 *
 * Pure (no DOM at import): `node --test` evaluates the script against a fake
 * document.
 */

/** ThemeProvider's storage key (its default; the provider is mounted without one). */
export const THEME_STORAGE_KEY = "zunia-theme";

/** The sidebar width preference, JSON-encoded by `useStoredValue`. */
export const SIDEBAR_STORAGE_KEY = "zunia.dashboard.sidebar";

/** The Lite / Pro view, JSON-encoded by `useStoredValue` (see `lib/view.ts`). */
export const VIEW_STORAGE_KEY = "zunia.dashboard.view";

/** Browser chrome colour per theme: the page background (`--z-bg`). */
export const THEME_COLORS = { dark: "#0B0A09", light: "#F1F0EE" } as const;

export type BootTheme = "light" | "dark";

/** Sidebar width the user picked; null means "by viewport" (icons 1024–1279, full above). */
export type SidebarPref = "collapsed" | "expanded" | null;

/** The theme to paint for a stored ThemeProvider value and the OS preference. */
export function resolveBootTheme(stored: string | null | undefined, systemDark: boolean): BootTheme {
  if (stored === "light" || stored === "dark") return stored;
  if (stored === "system") return systemDark ? "dark" : "light";
  return "dark";
}

/** The view from its raw storage value (a JSON string): Lite only when stored as such; Pro is the default. */
export function parseViewPref(raw: string | null | undefined): "lite" | "pro" {
  if (!raw) return "pro";
  try {
    return JSON.parse(raw) === "lite" ? "lite" : "pro";
  } catch {
    return "pro";
  }
}

/** The sidebar preference from its raw storage value (a JSON string). */
export function parseSidebarPref(raw: string | null | undefined): SidebarPref {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value === "collapsed" || value === "expanded" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Applies a resolved theme to the document exactly as ThemeProvider does
 * (`data-theme`, the `zunia-dark` / `zunia-light` classes, `color-scheme`),
 * plus the browser chrome colour.
 */
export function applyDocumentTheme(doc: Document, theme: BootTheme): void {
  const root = doc.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.toggle("zunia-dark", theme === "dark");
  root.classList.toggle("zunia-light", theme === "light");
  root.style.colorScheme = theme;
  for (const meta of Array.from(doc.querySelectorAll('meta[name="theme-color"]'))) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
}

/**
 * The inline <head> script. Written out by hand rather than serialised from
 * the functions above (a bundler may rename what `Function#toString` shows);
 * `__tests__/theme-boot.test.ts` runs it against the same cases as
 * {@link resolveBootTheme} so the two cannot drift.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=null,b=null,v=null,o=false;try{s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});b=localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)});v=localStorage.getItem(${JSON.stringify(VIEW_STORAGE_KEY)});}catch(e){}try{o=matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}var t=s==="light"||s==="dark"?s:s==="system"?(o?"dark":"light"):"dark";d.setAttribute("data-theme",t);d.classList.toggle("zunia-dark",t==="dark");d.classList.toggle("zunia-light",t==="light");d.style.colorScheme=t;var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",t==="dark"?${JSON.stringify(
  THEME_COLORS.dark,
)}:${JSON.stringify(THEME_COLORS.light)});var p=null;try{p=b?JSON.parse(b):null;}catch(e){}if(p==="collapsed"||p==="expanded")d.setAttribute("data-sidebar",p);var w="pro";try{w=v&&JSON.parse(v)==="lite"?"lite":"pro";}catch(e){}d.setAttribute("data-view",w);}catch(e){}})();`;
