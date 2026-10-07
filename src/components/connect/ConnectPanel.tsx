"use client";

/**
 * Shown in place of a wallet page's content when no wallet is linked.
 *
 * A compact hero, not a wall: what this page shows once connected, the ways
 * in (the two browser wallets, then the Zunia Mobile zone), and the promise
 * that keys stay in the wallet. Zunia Mobile opens the connect modal on its
 * QR view (the code needs the room).
 */

import { useId } from "react";
import { Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
import { ConnectFeedback, WalletOptions } from "@/components/connect/WalletOptions";
import { useConnectModal } from "@/components/connect/ConnectModal";

export function ConnectPanel({ title, description }: { title?: string; description?: string }) {
  const modal = useConnectModal();
  // Unique per instance: a page may show the panel twice (a gate and a card).
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="relative mx-auto w-full max-w-[920px] overflow-hidden rounded-[18px] border border-[var(--z-line)] bg-[var(--z-surface)] p-5 sm:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-[320px] rounded-full opacity-[0.14] blur-3xl [background:var(--z-accent-gradient)]"
      />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="hidden size-12 shrink-0 items-center justify-center rounded-[14px] bg-[image:var(--z-accent-gradient)] text-[#111] sm:flex"
          >
            <Mark size={17} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[22px]">
              {title ?? "Connect a wallet to see this page"}
            </h2>
            <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-fg-muted">
              {description ??
                "Zunia reads your balances and activity from public chain data. Keys stay in your wallet; this page never asks for a recovery phrase."}
            </p>
          </div>
        </div>
        <WalletOptions variant="cards" onMobile={() => modal.open("mobile")} />
        <ConnectFeedback />
        <p className="flex items-center gap-2 text-[12px] text-fg-dim">
          <Icon name="lock" size={14} className="shrink-0" />
          Non-custodial: every transaction is approved in your wallet or on your phone.
        </p>
      </div>
    </section>
  );
}
