"use client";

/**
 * Keyboard hints as the visitor's platform writes them: "⌘K" and "⌘↵" on
 * Apple devices, "Ctrl K" and "Ctrl ↵" elsewhere. The top bar's search field
 * and the command palette's footer both show them, so they share one rule.
 *
 * The platform cannot change while the page is open, so the store never
 * notifies; the server (and the hydrating render) assume Apple, which is
 * what most visitors use and keeps the first paint stable.
 */

import { useSyncExternalStore } from "react";

function subscribeNothing() {
  return () => {};
}

function isApple(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/** The modifier key's label: "⌘" or "Ctrl". */
export function useModifierLabel(): string {
  return useSyncExternalStore(
    subscribeNothing,
    () => (isApple() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}

/** "⌘K" or "Ctrl K": the command palette's shortcut. */
export function useShortcutLabel(): string {
  const mod = useModifierLabel();
  return mod === "⌘" ? "⌘K" : "Ctrl K";
}
