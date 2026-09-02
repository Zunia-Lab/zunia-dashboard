"use client";

import { IconButton, Mark, useTheme } from "@zunialab/ui";
import { ConnectWallet } from "@/components/ConnectWallet";

/**
 * Full-viewport gate when no wallet is linked.
 * No nav, settings, or desk chrome — brand, theme, and connect only.
 */
export function ConnectGate() {
  const { resolved, setTheme } = useTheme();

  return (
    <div className="relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-bg text-fg">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[image:var(--z-hero-gradient)]" />
        <div className="zunia-gate-glow absolute left-1/2 top-[38%] size-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <div className="zunia-gate-ring absolute left-1/2 top-[38%] size-[min(70vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <div className="zunia-gate-ring zunia-gate-ring--late absolute left-1/2 top-[38%] size-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,transparent_40%,var(--z-bg)_78%)]" />
        <div className="zunia-gate-grain absolute inset-0 opacity-[0.35]" />
      </div>

      <header className="relative z-[2] flex items-center justify-end px-5 py-4 sm:px-8">
        <IconButton
          label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={resolved === "dark" ? "Light" : "Dark"}
          variant="ghost"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <SunGlyph /> : <MoonGlyph />}
        </IconButton>
      </header>

      <main className="relative z-[2] flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16 pt-4 sm:px-10">
        <div className="zunia-gate-rise flex w-full max-w-[520px] flex-col items-center text-center">
          <span className="flex size-16 items-center justify-center rounded-[22px] bg-accent text-[var(--z-accent-fg)] sm:size-[72px]">
            <Mark size={34} />
          </span>

          <h1 className="mt-8 font-sans text-[clamp(48px,12vw,88px)] font-medium leading-[0.92] tracking-[-0.055em] text-fg">
            Zunia
          </h1>

          <p className="mt-5 max-w-[28ch] text-[17px] leading-relaxed tracking-[-0.02em] text-fg-muted sm:text-[18px]">
            Portfolio and activity for a wallet that signs on your device.
          </p>

          <div className="mt-10 w-full max-w-[280px]">
            <ConnectWallet size="lg" fullWidth label="Connect wallet" />
          </div>

          <p className="mt-8 max-w-[32ch] text-[13px] leading-relaxed text-fg-dim">
            Keys stay in the extension or on your phone. This desk never asks
            for a recovery phrase.
          </p>
        </div>
      </main>
    </div>
  );
}

function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
