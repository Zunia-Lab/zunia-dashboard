"use client";

/**
 * Hover labels for the frame's icon-only surfaces: the sidebar in icon mode
 * and the chain rail's hover cards.
 *
 * The kit's Tooltip mounts a provider per instance; the frame shares one
 * (`TipProvider`) so moving the pointer down the rail or the icon sidebar
 * shows each label at once after the first, the way a dock does. Radix opens
 * them on keyboard focus too. Touch never hovers: nothing here may be the
 * only way to learn something (the scope list repeats the rail's figures).
 */

import { Tooltip as TooltipRoot, TooltipContent, TooltipProvider, TooltipTrigger } from "@zunialab/ui";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={260} skipDelayDuration={600}>
      {children}
    </TooltipProvider>
  );
}

export interface ShellTipProps {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Render the child alone (e.g. the sidebar label is visible already). */
  disabled?: boolean;
  /** A card (rail hover card) rather than a one-line label. */
  card?: boolean;
  className?: string;
}

export function ShellTip({ content, children, side = "right", align = "center", disabled, card, className }: ShellTipProps) {
  if (disabled || content === null || content === undefined || content === false) return children;
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={10}
        collisionPadding={10}
        className={cn(
          "d-pop z-[70] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] font-sans tracking-normal text-fg shadow-[var(--d-pop-shadow)]",
          card ? "w-[264px] rounded-[12px] p-0 text-[12.5px] leading-[1.45]" : "rounded-[8px] px-2.5 py-1.5 text-[12.5px] leading-[1.4]",
          className,
        )}
      >
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}
