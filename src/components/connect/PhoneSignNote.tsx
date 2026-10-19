"use client";

/**
 * Under a "waiting for your wallet" state, for a Zunia Mobile session only:
 * where the request is, a way back into the app on this phone, and a link to
 * the phone that is down said as such (the request then waits for it, which
 * otherwise looks like a slow phone).
 *
 * Zunia does not send push notifications yet: a request reaches the phone
 * while the app is open. On a phone, "Open Zunia" uses the app's wake link,
 * which brings it to the front on this page's request.
 */

import { Icon } from "@/components/icons";
import { useWallet } from "@/lib/connect/context";
import { openAppLink } from "@/lib/connect/mobile";
import { cn } from "@/lib/cn";
import { FOCUS_RING, useTouchDevice } from "./WalletOptions";

export function PhoneSignNote({ className }: { className?: string }) {
  const { walletKind, mobile } = useWallet();
  const touch = useTouchDevice();
  if (walletKind !== "zunia-mobile") return null;
  const linkDown = mobile.status === "reconnecting";
  return (
    <div
      className={cn("flex flex-col gap-2.5 rounded-[12px] border border-[var(--z-line)] bg-[var(--z-glass)] p-3", className)}
      data-testid="phone-sign-note"
    >
      <p className="flex items-start gap-2 text-[12.5px] leading-snug text-fg-muted">
        <Icon name={linkDown ? "clock" : "mobile"} size={15} className="mt-px shrink-0 text-fg-dim" />
        <span>
          {linkDown
            ? "Reconnecting to your phone. The request goes out as soon as the link is back."
            : touch
              ? "The request is waiting in Zunia. Open the app to check it and approve."
              : "Open Zunia on your phone: the request waits there for 5 minutes. Check it on the phone before you approve."}
        </span>
      </p>
      {touch ? (
        <a
          href={openAppLink(mobile.sessionId)}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-2 self-start rounded-[10px] bg-[image:var(--z-button-gradient)] px-3.5 text-[13px] font-medium text-[var(--z-button-fg)] transition-[filter] duration-[160ms] hover:brightness-110",
            FOCUS_RING,
          )}
        >
          <Icon name="mobile" size={15} />
          Open Zunia
        </a>
      ) : null}
    </div>
  );
}
