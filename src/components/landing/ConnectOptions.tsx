"use client";

/**
 * "Connect your way": the connect modal's three options, live, in a card.
 *
 * Detection is the shared `WalletOptions` (an extension that injects late
 * still lights up), so the landing page never disagrees with the connect
 * modal about what is installed. Zunia Mobile opens the modal on its QR
 * view, where the code has room.
 *
 * With a wallet already connected (restored, or `?stay=1` after the hero's
 * hand-off) the options give way to the connection itself: offering to
 * connect the wallet the hero says is connected would contradict it.
 */

import { Mark } from "@zunialab/ui";
import { ConnectFeedback, WalletOptions } from "@/components/connect/WalletOptions";
import { Icon } from "@/components/icons";
import { AddressText, Button, Card } from "@/components/ui";
import type { WalletKind } from "@/lib/connect/context";
import { useWallet, walletKindLabel } from "@/providers/WalletProvider";
import { useOpenConnect } from "./useOpenConnect";

const CARD = "gap-3 p-3 shadow-[0_24px_60px_-34px_rgba(0,0,0,0.5)] sm:p-4";

export function ConnectOptions() {
  const { account, walletKind } = useWallet();
  const openConnect = useOpenConnect();
  if (account && walletKind) {
    return (
      <Card className={CARD}>
        <Connected kind={walletKind} address={account.address} />
        <SigningNote kind={walletKind} />
      </Card>
    );
  }
  return (
    <Card className={CARD}>
      {/* Rows with the action spelled out where there is room; on phones the
          card variant, whose action is an icon, so each line keeps its width. */}
      <WalletOptions onMobile={() => openConnect("mobile")} className="max-md:hidden" />
      <WalletOptions variant="cards" onMobile={() => openConnect("mobile")} className="md:hidden" />
      <ConnectFeedback />
      <SigningNote kind={null} />
    </Card>
  );
}

function SigningNote({ kind }: { kind: WalletKind | null }) {
  return (
    <p className="flex items-center gap-2 px-1 pb-0.5 text-[12.5px] text-fg-dim">
      <Icon name="lock" size={14} className="shrink-0" />
      {kind === "zunia-mobile" ? "Signing happens on your phone, one transaction at a time." : "Signing happens in the wallet, one transaction at a time."}
    </p>
  );
}

/**
 * The wallet in use, in the connect modal's glyphs (the Zunia mark on the
 * brand ramp, the extension piece for Keplr, the phone for Zunia Mobile),
 * with a success dot: connected is also said in words beside it.
 */
function WalletGlyph({ kind }: { kind: WalletKind }) {
  const tile =
    kind === "zunia"
      ? "bg-[image:var(--z-accent-gradient)] text-[#111]"
      : "border border-[var(--z-line)] bg-[var(--z-glass)] text-fg";
  return (
    <span aria-hidden className={`relative flex size-10 shrink-0 items-center justify-center rounded-[12px] ${tile}`}>
      {kind === "zunia" ? <Mark size={15} /> : <Icon name={kind === "keplr" ? "extension" : "mobile"} size={20} />}
      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-[var(--z-success)] ring-2 ring-[var(--z-surface-raised)]" />
    </span>
  );
}

function Connected({ kind, address }: { kind: WalletKind; address: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--z-line)] bg-[var(--z-surface-raised)] px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <WalletGlyph kind={kind} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14.5px] font-medium tracking-[-0.01em] text-fg">Connected with {walletKindLabel(kind)}</span>
          <AddressText address={address} copy={false} />
        </span>
      </div>
      <Button variant="primary" href="/overview" iconRight="arrowRight" className="shrink-0 max-sm:w-full">
        Open dashboard
      </Button>
    </div>
  );
}
