/**
 * `/api/x?…` from a record, skipping null/undefined/empty values.
 *
 * In a module of its own, without "use client", so a server component that
 * reads a route's answer ahead of time (initial data for a public page) builds
 * exactly the URL the client hook will ask for: the client cache is keyed by
 * that string, and an answer under another spelling would simply be ignored.
 * `@/lib/useApi` re-exports it for the hooks.
 */
export function apiUrl(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
