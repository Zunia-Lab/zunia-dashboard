"use client";

/**
 * A page that failed inside the app frame. The rail, sidebar and top bar
 * stay up (this boundary sits under the `(app)` layout), so the user keeps
 * their navigation; the card says what happened, that the wallet is
 * untouched, and offers Retry and a way out.
 *
 * Only the digest is shown in production: it matches the server log line and
 * is what a support report needs. The message can carry internals and is
 * printed in development only. Its heading is the page's h1: the page that
 * failed never rendered the `<Page>` that carries one, and the top bar's
 * title is presentational.
 */

import { useEffect } from "react";
import { Mark } from "@zunialab/ui";
import { Button } from "@/components/ui";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Kept in the console so a support report can include it.
    console.error(error);
  }, [error]);

  const showDetail = process.env.NODE_ENV !== "production";

  return (
    <section
      role="alert"
      aria-labelledby="app-error-title"
      className="d-card d-card-hero mx-auto flex w-full max-w-[640px] flex-col gap-5 p-6 sm:p-8"
    >
      <span aria-hidden className="flex size-11 items-center justify-center rounded-[13px] bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]">
        <Mark size={16} />
      </span>
      <div className="flex flex-col gap-2">
        <p className="d-label">This page stopped</p>
        <h1 id="app-error-title" className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-fg">
          Something went wrong while loading this page
        </h1>
        <p className="max-w-[52ch] text-[14px] leading-relaxed text-fg-muted">
          Your wallet is not affected: nothing is ever signed without your approval in the wallet itself. Try again, or
          head back to your overview.
        </p>
        {error.digest ? <p className="font-mono text-[12px] text-fg-dim">Reference {error.digest}</p> : null}
        {showDetail && error.message ? (
          <pre className="d-scroll mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--d-radius-inner)] bg-[var(--d-glass)] p-3 font-mono text-[12px] text-fg-muted">
            {error.message}
          </pre>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" iconLeft="refresh" onClick={() => retry()}>
          Try again
        </Button>
        <Button href="/overview" variant="secondary">
          Open overview
        </Button>
      </div>
    </section>
  );
}
