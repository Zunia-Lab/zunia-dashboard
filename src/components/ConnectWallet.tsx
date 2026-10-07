"use client";

/**
 * The "Connect wallet" button: opens the connect modal (`useConnectModal`).
 *
 * Props kept from the pre-v2 component (`size`, `fullWidth`, `label`) so the
 * top bar and any page that rendered it keep working. Styled as the primary
 * crimson button (white on `--z-button-gradient`), never white on the bright
 * brand ramp, which fails contrast at its gold end.
 */

import { useConnectModal } from "@/components/connect/ConnectModal";
import { FOCUS_RING } from "@/components/connect/WalletOptions";
import { Icon } from "@/components/icons";
import { useWallet } from "@/lib/connect/context";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: "h-9 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
  lg: "h-11 px-5 text-[14.5px] gap-2",
} as const;

export function ConnectWallet({
  size = "md",
  fullWidth = false,
  label = "Connect wallet",
}: {
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  label?: string;
} = {}) {
  const modal = useConnectModal();
  const { busy, restoring } = useWallet();
  return (
    <button
      type="button"
      onClick={() => modal.open()}
      aria-busy={busy || restoring || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] font-medium tracking-[-0.01em]",
        "bg-[image:var(--z-button-gradient)] text-[var(--z-button-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(60,4,8,0.24)]",
        "transition-[filter] duration-[160ms] hover:brightness-110 active:brightness-95",
        SIZES[size],
        fullWidth && "w-full",
        FOCUS_RING,
      )}
    >
      <Icon name="wallet" size={size === "sm" ? 15 : 16} />
      {restoring ? "Restoring…" : label}
    </button>
  );
}
