/**
 * A browser wallet's logo on its tile: Zunia's mark on the brand ramp, the
 * other wallets' own icons (public/wallets, sources in lib/connect/wallets),
 * clipped to the same rounded square. A hairline inside the edge keeps a
 * white icon (Cosmostation's) from melting into a white surface.
 *
 * Decorative: the wallet's name is always written beside it.
 */

import Image from "next/image";
import { Mark } from "@zunialab/ui";
import { cn } from "@/lib/cn";
import { WALLETS, type ExtensionWallet } from "@/lib/connect/wallets";

export function WalletLogo({ wallet, size = 40, className }: { wallet: ExtensionWallet; size?: number; className?: string }) {
  // 12 px at the list's 40 px: the radius the connect rows have always used.
  const radius = Math.round(size * 0.3);
  const logo = WALLETS[wallet].logo;
  if (!logo) {
    return (
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center bg-[image:var(--z-accent-gradient)] text-[#111]", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Mark size={Math.round(size * 0.375)} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative shrink-0 overflow-hidden", className)} style={{ width: size, height: size, borderRadius: radius }}>
      {/* Already sized for the tile (128 px for 40 at 3x): no optimizer round trip. */}
      <Image src={logo} alt="" width={size} height={size} unoptimized loading="eager" draggable={false} className="size-full object-cover" />
      <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--z-line)]" style={{ borderRadius: radius }} />
    </span>
  );
}
