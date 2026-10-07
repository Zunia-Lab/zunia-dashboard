import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@zunialab/ui";
import { Button } from "@/components/ui";
import { SITE_HOST } from "@/lib/site";

export const metadata: Metadata = {
  title: "Page not found",
  // Next already sends noindex with a 404; `follow` lets a crawler that landed
  // here still reach the two pages linked below.
  robots: { index: false, follow: true },
};

/**
 * The 404 for every unmatched URL and every `notFound()` call.
 *
 * For an unmatched URL it is full-bleed, outside the app frame: it renders at the
 * root, above the `(app)` layout, so there is no sidebar to fall back on — the
 * two exits a lost visitor most likely wants are offered instead. (A page in
 * the frame that calls `notFound()` after a read, for a proposal or validator
 * that does not exist, shows it in the frame's content area.) "Go home"
 * rather than "Open overview": `/` already hands a connected wallet on to the
 * overview, while a visitor without one would otherwise land on a connect
 * panel. It fills at least the viewport either way the root layout lays out
 * the body: pinned to the viewport (`h-dvh overflow-hidden`, where this page
 * scrolls itself on short screens) or scrolling as a document.
 *
 * Same kit buttons and gradient mark tile as the in-app error boundary
 * (`(app)/error.tsx`), so the error surfaces read as one product.
 */
export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-dvh flex-1 flex-col overflow-y-auto bg-bg text-fg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_100%_0%,var(--d-bloom-1)_0%,var(--d-bloom-2)_45%,transparent_75%)]"
      />
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-6 px-4 py-14 sm:px-6">
        <Link
          href="/"
          aria-label="Zunia home"
          className="flex size-11 items-center justify-center rounded-[13px] bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]"
        >
          <Mark size={22} />
        </Link>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim">
            Error 404 · Page not found
          </p>
          <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
            This page isn&apos;t here
          </h1>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-fg-muted">
            The link may be out of date, or the address mistyped. Nothing was
            loaded from your wallet and nothing was signed.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button href="/" variant="primary" size="lg">
            Go home
          </Button>
          <Button href="/markets" variant="secondary" size="lg">
            Explore markets
          </Button>
        </div>

        <p className="font-mono text-[12px] text-fg-faint">{SITE_HOST}</p>
      </div>
    </main>
  );
}
