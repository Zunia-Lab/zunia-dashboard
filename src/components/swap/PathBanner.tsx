"use client";

/**
 * Which way this swap reaches Osmosis, in plain words, right above the
 * button: one transaction in Osmosis's pools, a swap then a delivery, one
 * signature through Zunia's verified contract, or two steps (move, then
 * swap). The words come from swap-view `pathCopy`; this only lays them out.
 */

import { Icon, type IconName } from "@/components/icons";
import { Stepper, type Step } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SwapPath } from "@/lib/data/swap";
import type { PathCopy } from "./swap-view";

const PATH_ICON: Record<SwapPath, IconName> = {
  pool: "swap",
  "pool-deliver": "send",
  contract: "link",
  "move-first": "bridge",
};

const PATH_TAG: Record<SwapPath, string> = {
  pool: "Pool swap",
  "pool-deliver": "Swap + delivery",
  contract: "Cross-chain contract",
  "move-first": "2 steps",
};

export interface PathBannerProps {
  path: SwapPath;
  copy: PathCopy;
  /** The two-step plan for move-first (or step 2 after a return). */
  steps?: Step[];
  /** An estimate or a stale answer: dimmed. */
  pending?: boolean;
  className?: string;
}

export function PathBanner({ path, copy, steps, pending, className }: PathBannerProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-glass)] px-3.5 py-3 transition-opacity duration-[160ms]",
        pending && "opacity-60",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px]",
            path === "move-first" ? "bg-[var(--z-warning-fill)] text-[var(--z-warning)]" : "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]",
          )}
        >
          <Icon name={PATH_ICON[path]} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13.5px] font-medium leading-snug text-fg">{copy.title}</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-dim">{PATH_TAG[path]}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">{copy.body}</p>
        </div>
      </div>
      {steps && steps.length > 0 ? <Stepper steps={steps} className="mt-3 pl-11" /> : null}
    </div>
  );
}
