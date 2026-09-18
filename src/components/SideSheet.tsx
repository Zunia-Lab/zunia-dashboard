"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  cn,
} from "@zunialab/ui";

/**
 * Side sheet built on the shared Radix-backed Dialog primitives.
 *
 * The `Drawer` exported by @zunialab/ui is a bare `fixed inset-0` div: no
 * role="dialog", no aria-modal, no focus trap, no Escape handler, no scroll
 * lock and no focus restore to the trigger. Below 768px that drawer is the
 * dashboard's only navigation, so keyboard and screen-reader users could not
 * open it, move through it predictably, or leave it. Repositioning
 * DialogContent into a side panel inherits every one of those behaviours from
 * Radix instead of re-implementing them here.
 *
 * The width deliberately stops short of the viewport so a strip of the overlay
 * stays tappable at 360px, which is how a pointer user dismisses the sheet.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  side = "right",
  closeLabel,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: Radix needs an accessible name on every dialog. */
  title: string;
  description?: string;
  side?: "left" | "right";
  closeLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  // Radix warns when a dialog has neither a Description nor an explicit
  // aria-describedby; passing the attribute when a Description IS rendered
  // would overwrite the id Radix wires up, so it is only set in the other case.
  const describedBy = description ? {} : { "aria-describedby": undefined };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...describedBy}
        className={cn(
          "inset-y-0 max-w-none translate-x-0 translate-y-0",
          "flex w-[min(340px,calc(100%-24px))] flex-col gap-3 overflow-y-auto rounded-none p-4",
          side === "right"
            ? "left-auto right-0 rounded-l-[28px]"
            : "right-auto left-0 rounded-r-[28px]",
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <DialogTitle className="text-[18px]">{title}</DialogTitle>
          <DialogClose asChild>
            <IconButton
              size="sm"
              label={closeLabel ?? `Close ${title.toLowerCase()}`}
              variant="ghost"
            >
              <CloseGlyph />
            </IconButton>
          </DialogClose>
        </div>
        {description ? (
          <DialogDescription className="mt-0 text-[13px]">
            {description}
          </DialogDescription>
        ) : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
