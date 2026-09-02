"use client";

import { useEffect, useState } from "react";

/**
 * Fetches JSON for a url, returning null until that exact url has resolved.
 * Passing null skips the request, which is how callers wait for a connection.
 * `onError` must be a stable reference (module constant) so the fetch is not
 * re-run on every render.
 */
export function useJson<T>(url: string | null, onError?: T): T | null {
  const [entry, setEntry] = useState<{ url: string; data: T } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    void fetch(url)
      .then((response) => response.json() as Promise<T>)
      .then((data) => {
        if (!cancelled) setEntry({ url, data });
      })
      .catch(() => {
        if (!cancelled && onError !== undefined) {
          setEntry({ url, data: onError });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, onError]);

  return entry?.url === url ? entry.data : null;
}
