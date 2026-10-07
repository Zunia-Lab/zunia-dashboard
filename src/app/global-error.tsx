"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for an error in the root layout itself.
 *
 * It replaces the root layout, so it brings its own `<html>`/`<body>` and
 * nothing else: no globals.css, no theme boot script, no providers — any of
 * those could be what failed. Colours follow the OS scheme, styles are inline
 * (10 px control radius, like the kit's buttons), and the only actions are a
 * retry and a hard navigation home (a full reload, since the app shell is
 * gone; `/` hands a connected wallet on to the overview). No error text in
 * production; the digest matches the server log.
 */
const STYLES = `
  :root { color-scheme: dark; --bg: #0b0a09; --fg: #f1f0ee; --dim: #9a948c; --line: rgba(241,240,238,.16); }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --bg: #f1f0ee; --fg: #111111; --dim: #6b655e; --line: rgba(17,17,17,.16); }
  }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { box-sizing: border-box; min-height: 100dvh; max-width: 520px; margin: 0 auto;
    padding: 56px 16px; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
  h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; }
  p { margin: 0; font-size: 15px; line-height: 1.6; color: var(--dim); }
  .ref { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  button, a { box-sizing: border-box; height: 44px; padding: 0 18px; border-radius: 10px;
    font: 600 15px/44px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; text-decoration: none; }
  button { border: 0; color: #fff; background: linear-gradient(135deg, #e0261a, #b3121c); }
  a { border: 1px solid var(--line); color: var(--fg); background: transparent; }
  button:focus-visible, a:focus-visible { outline: 2px solid #ff6a10; outline-offset: 2px; }
`;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · Zunia</title>
        <meta name="robots" content="noindex" />
        <style>{STYLES}</style>
      </head>
      <body>
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>
            Zunia could not load this page. Your wallet is not affected: nothing is
            ever signed without your approval in the wallet itself.
          </p>
          {error.digest ? <p className="ref">Reference {error.digest}</p> : null}
          {process.env.NODE_ENV !== "production" && error.message ? (
            <p className="ref">{error.message}</p>
          ) : null}
          <div className="row">
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
            {/* A plain anchor on purpose: the client router went down with the layout. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is the point here */}
            <a href="/">Go home</a>
          </div>
        </main>
      </body>
    </html>
  );
}
