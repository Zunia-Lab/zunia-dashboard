"use client";

import { useEffect } from "react";
import { Mark } from "@zunialab/ui";
import { Button } from "@/components/ui";

/**
 * The error boundary for every page under the root layout.
 *
 * It replaces the whole subtree, app frame included (the `(app)` layout sits
 * below this boundary), so like the 404 it stands on its own: what happened,
 * that the wallet is untouched, a retry, and a way out ("Go home": `/` hands a
 * connected wallet on to the overview and shows a visitor the landing page).
 * Same kit buttons and gradient mark tile as the in-app boundary.
 *
 * What it does not show in production is the error itself. A server error
 * reaches the browser as a generic message plus a `digest` that matches the
 * server log line, which is the only part worth showing a user (to quote in a
 * report); a client error's message and stack can carry internals and are
 * printed in development only.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Kept in the console so a support report can include it.
    console.error(error);
  }, [error]);

  const showDetail = process.env.NODE_ENV !== "production";

  return (
    <main className="relative isolate flex min-h-dvh flex-1 flex-col overflow-y-auto bg-bg text-fg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_100%_0%,var(--d-bloom-1)_0%,var(--d-bloom-2)_45%,transparent_75%)]"
      />
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-6 px-4 py-14 sm:px-6">
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-[13px] bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]"
        >
          <Mark size={22} />
        </span>

        <div className="flex flex-col gap-3" role="alert">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim">
            Unexpected error
          </p>
          <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
            Something went wrong
          </h1>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-fg-muted">
            This page stopped while loading. Your wallet is not affected: nothing
            is ever signed without your approval in the wallet itself.
          </p>
          {error.digest ? (
            <p className="font-mono text-[12px] text-fg-dim">Reference {error.digest}</p>
          ) : null}
          {showDetail && error.message ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--d-radius-inner)] bg-[var(--d-glass)] p-3 font-mono text-[12px] text-fg-muted">
              {error.message}
            </pre>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button variant="primary" size="lg" iconLeft="refresh" onClick={() => retry()}>
            Try again
          </Button>
          <Button href="/" variant="secondary" size="lg">
            Go home
          </Button>
        </div>
      </div>
    </main>
  );
}
