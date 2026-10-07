"use client";

import { useEffect, useRef } from "react";

/**
 * Marks a scrolling box with `data-fade="top" | "bottom" | "both"` while
 * content hides past those edges (see `.fade` in shell.module.css). Written
 * to the DOM directly: it changes on every scroll frame and nothing React
 * renders depends on it. Pass `contentKey` when the list's items change
 * (followed chains), so the new items are measured too.
 */
export function useScrollFade<T extends HTMLElement>(contentKey?: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const update = () => {
      const top = box.scrollTop > 2;
      const bottom = box.scrollTop + box.clientHeight < box.scrollHeight - 2;
      const fade = top && bottom ? "both" : top ? "top" : bottom ? "bottom" : null;
      if (fade) box.setAttribute("data-fade", fade);
      else box.removeAttribute("data-fade");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    box.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", update);
    };
  }, [contentKey]);
  return ref;
}
