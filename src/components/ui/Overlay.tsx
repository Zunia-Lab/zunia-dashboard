"use client";

/**
 * Floating surfaces: Tooltip, HoverCard, InfoTip, Popover, Menu, Dialog,
 * Sheet.
 *
 * Behaviour comes from the Radix primitives @zunialab/ui already wraps
 * (portal, focus trap, Escape, outside click, collision handling, focus
 * return, scroll lock); the kit only restyles them for desktop density:
 * 12.5px sans tooltips instead of the popup's 10px mono, a raised popover
 * surface, sized dialogs, and side sheets that become bottom sheets on
 * phones. Motion is in src/styles/ui.css (`.d-pop`, `.d-dialog`,
 * `.d-sheet`): 200 ms fade + 4px travel, none under reduced motion.
 */

import Link from "next/link";
import {
  Dialog as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTrigger,
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@zunialab/ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useIsPhone } from "./hooks";
import { Slot } from "./Slot";

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

/* ------------------------------------------------------------------ tooltip */

export interface TooltipProps {
  /** What the tooltip says. Empty content renders the child alone. */
  content: ReactNode;
  /** The trigger: one element that accepts a ref and event props. */
  children: ReactElement;
  side?: Side;
  align?: Align;
  /** Hover delay in ms (default 250). */
  delay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A label on hover and keyboard focus. Not for anything a touch user needs:
 * touch never hovers, so put essential explanations in an {@link InfoTip}.
 */
export function Tooltip({ content, children, side = "top", align = "center", delay = 250, open, onOpenChange, className }: TooltipProps) {
  if (content === null || content === undefined || content === false || content === "") return children;
  return (
    <TooltipProvider delayDuration={delay} skipDelayDuration={300}>
      <TooltipRoot open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "d-pop z-[70] max-w-[280px] rounded-[8px] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)]",
            "px-2.5 py-1.5 font-sans text-[12.5px] leading-[1.4] tracking-normal text-fg shadow-[var(--d-pop-shadow)]",
            className,
          )}
        >
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ hover card */

export interface HoverCardProps {
  /** The trigger: a button (it must be focusable for keyboard users). */
  trigger: ReactElement;
  children: ReactNode;
  side?: Side;
  align?: Align;
  /** Max width in px (default 300). */
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A card that opens on hover for a mouse, and on tap or Enter everywhere
 * else. A Popover underneath, not a Tooltip, precisely so touch and keyboard
 * users can read it; once clicked it stays open until dismissed. Used by
 * InfoTip and the partial-data badge; it also fits the chain rail's hover
 * cards (spec §1).
 */
export function HoverCard({ trigger, children, side = "top", align = "center", width = 300, open: openProp, onOpenChange, className }: HoverCardProps) {
  const [openState, setOpenState] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = openProp ?? openState;

  // A pending hover timer must not fire onOpenChange after unmount (a row
  // that scrolled away, a page that navigated).
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hoverOpen = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hoverClose = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse" || pinned) return;
    clearTimer();
    timer.current = setTimeout(() => setOpen(false), 140);
  };

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(next) => {
        clearTimer();
        setOpen(next);
        if (!next) setPinned(false);
      }}
    >
      <PopoverTrigger asChild>
        <Slot
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          onClick={(event: ReactMouseEvent) => {
            // Runs before the Popover's own toggle. A click (tap, Enter)
            // that opens the card pins it, so leaving with the mouse does not
            // close what was asked for, and a second tap closes it. A click
            // on a card that hover opened pins it instead of toggling it shut.
            clearTimer();
            if (!open) {
              setPinned(true);
              return;
            }
            if (!pinned) {
              event.preventDefault();
              setPinned(true);
            }
          }}
        >
          {trigger}
        </Slot>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={clearTimer}
        onPointerLeave={hoverClose}
        style={{ maxWidth: width }}
        className={cn(
          "d-pop z-[70] w-auto rounded-[10px] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)]",
          "px-3 py-2 text-[12.5px] leading-[1.45] text-fg-muted shadow-[var(--d-pop-shadow)]",
          className,
        )}
      >
        {children}
      </PopoverContent>
    </PopoverRoot>
  );
}

/* ------------------------------------------------------------------ infotip */

export interface InfoTipProps {
  /** The explanation: why a figure is "—", how an estimate is made. */
  content: ReactNode;
  /** Accessible name of the (i) button. */
  label?: string;
  side?: Side;
  size?: number;
  className?: string;
}

/**
 * An (i) that explains, readable by mouse, touch and keyboard alike.
 *
 * The button is at least 24×24 (WCAG 2.5.8; an 18px one failed axe's
 * target-size next to sort headers and tile actions) but is laid over a box
 * of the drawn size, so the (i) sits exactly where it did and nothing around
 * it moves. `className` goes on that box.
 */
export function InfoTip({ content, label = "More information", side = "top", size = 14, className }: InfoTipProps) {
  const drawn = size + 4;
  const target = Math.max(24, drawn);
  const inset = (drawn - target) / 2;
  return (
    <span className={cn("relative inline-flex shrink-0 align-middle", className)} style={{ width: drawn, height: drawn }}>
      <HoverCard
        side={side}
        trigger={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "d-hit absolute inline-flex items-center justify-center rounded-full text-fg-dim",
              // -2px on the larger box draws the same ring the 18px one had at +1px.
              "transition-colors duration-[160ms] hover:text-fg data-[state=open]:text-fg focus-visible:outline-offset-[-2px]",
            )}
            style={{ width: target, height: target, left: inset, top: inset }}
          >
            <Icon name="info" size={size} />
          </button>
        }
      >
        {content}
      </HoverCard>
    </span>
  );
}

/* ------------------------------------------------------------------ popover */

export interface PopoverProps {
  /** The trigger element (rendered as the Radix trigger via asChild). */
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  /** Panel width in px or any CSS length (default 320). */
  width?: number | string;
  /** Inner padding (default true). Off for lists that pad their own rows. */
  padded?: boolean;
  /** Keep focus on the trigger when opening (hover cards, previews). */
  keepFocus?: boolean;
  /** Accessible name when the content has no heading. */
  ariaLabel?: string;
  className?: string;
}

export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  width = 320,
  padded = true,
  keepFocus = false,
  ariaLabel,
  className,
}: PopoverProps) {
  return (
    <PopoverRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        aria-label={ariaLabel}
        onOpenAutoFocus={keepFocus ? (event) => event.preventDefault() : undefined}
        style={{ width: typeof width === "number" ? `${width}px` : width } as CSSProperties}
        className={cn(
          "d-pop z-[60] max-w-[calc(100vw-24px)] rounded-[var(--d-radius-inner)] border border-[var(--d-hairline-strong)]",
          "bg-[var(--d-pop-bg)] text-fg shadow-[var(--d-pop-shadow)] outline-none",
          "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
          padded ? "p-3" : "p-0",
          className,
        )}
      >
        {children}
      </PopoverContent>
    </PopoverRoot>
  );
}

/* ------------------------------------------------------------------ menu */

export type MenuEntry =
  | {
      type?: "item";
      label: ReactNode;
      icon?: IconName;
      /** Shown right-aligned in a Kbd style, e.g. "⌘K". */
      shortcut?: string;
      /** Second line in dim text. */
      description?: ReactNode;
      onSelect?: () => void;
      /** Navigate instead of calling onSelect (internal: next/link). */
      href?: string;
      /** Open `href` in a new tab with rel=noopener. */
      external?: boolean;
      disabled?: boolean;
      tone?: "default" | "danger";
    }
  | { type: "separator" }
  | { type: "label"; label: ReactNode };

export interface MenuProps {
  trigger: ReactElement;
  items: MenuEntry[];
  side?: Side;
  align?: Align;
  /** Min width in px (default 200). */
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const MENU_ITEM = cn(
  "group flex min-h-[34px] cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13.5px] text-fg outline-none",
  "data-[highlighted]:bg-[var(--d-glass-2)] data-[disabled]:cursor-default data-[disabled]:opacity-45",
);

/** A dropdown menu: items, separators, group labels, shortcuts. */
export function Menu({ trigger, items, side = "bottom", align = "end", width = 200, open, onOpenChange, className }: MenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={12}
        style={{ minWidth: width }}
        className={cn(
          "d-pop z-[60] rounded-[var(--d-radius-inner)] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] p-1",
          "text-fg shadow-[var(--d-pop-shadow)]",
          className,
        )}
      >
        {items.map((entry, index) => {
          if (entry.type === "separator") {
            return <div key={`sep-${index}`} role="separator" aria-orientation="horizontal" className="mx-1 my-1 h-px bg-[var(--d-hairline)]" />;
          }
          if (entry.type === "label") {
            return (
              <div key={`label-${index}`} className="d-label px-2.5 pb-1 pt-2">
                {entry.label}
              </div>
            );
          }
          const body = (
            <>
              {entry.icon ? (
                <Icon
                  name={entry.icon}
                  size={16}
                  className={cn("shrink-0", entry.tone === "danger" ? "text-[var(--z-danger)]" : "text-fg-dim group-data-[highlighted]:text-fg")}
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", entry.tone === "danger" && "text-[var(--z-danger)]")}>{entry.label}</span>
                {entry.description ? <span className="block truncate text-[12px] text-fg-dim">{entry.description}</span> : null}
              </span>
              {entry.shortcut ? (
                <span className="ml-3 shrink-0 font-mono text-[11px] tracking-[0.04em] text-fg-dim">{entry.shortcut}</span>
              ) : null}
              {entry.external ? <Icon name="arrowUpRight" size={14} className="shrink-0 text-fg-dim" /> : null}
            </>
          );
          if (entry.href && !entry.disabled) {
            return (
              <DropdownMenuItem key={`item-${index}`} asChild onSelect={entry.onSelect} className={MENU_ITEM}>
                {entry.external ? (
                  <a href={entry.href} target="_blank" rel="noopener noreferrer">
                    {body}
                  </a>
                ) : (
                  <Link href={entry.href}>{body}</Link>
                )}
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={`item-${index}`} disabled={entry.disabled} onSelect={entry.onSelect} className={MENU_ITEM}>
              {body}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------------------------------------------------- toast avoidance */

/**
 * Where an open side sheet or dialog sits, published on <html> for the
 * toaster (src/styles/ui.css): bottom-right toasts covered a right sheet's
 * footer, its Back / Close / Confirm buttons included. The latest overlay
 * opened wins; closing it hands back to the one under it.
 */
type ToastAvoid = { kind: "sheet" | "dialog"; width: number };

const toastAvoidStack: { id: symbol; avoid: ToastAvoid }[] = [];

function publishToastAvoid() {
  const root = document.documentElement;
  const top = toastAvoidStack[toastAvoidStack.length - 1];
  if (top) {
    root.dataset.dToastAvoid = top.avoid.kind;
    root.style.setProperty("--d-toast-avoid-w", `${top.avoid.width}px`);
  } else {
    delete root.dataset.dToastAvoid;
    root.style.removeProperty("--d-toast-avoid-w");
  }
}

function useToastAvoidance(open: boolean, kind: ToastAvoid["kind"] | null, width: number) {
  useEffect(() => {
    if (!open || kind === null) return;
    const id = Symbol(kind);
    toastAvoidStack.push({ id, avoid: { kind, width } });
    publishToastAvoid();
    return () => {
      const index = toastAvoidStack.findIndex((entry) => entry.id === id);
      if (index !== -1) toastAvoidStack.splice(index, 1);
      publishToastAvoid();
    };
  }, [open, kind, width]);
}

/* ------------------------------------------------------------------ dialog */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: every dialog needs an accessible name. */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions row, right-aligned (Cancel / Confirm). */
  footer?: ReactNode;
  /** sm 400px, md 520px (default), lg 720px. */
  size?: "sm" | "md" | "lg";
  /** Hide the close button (the footer must then offer a way out). */
  hideClose?: boolean;
  /** Which element gets focus on open; default: the first focusable. */
  onOpenAutoFocus?: (event: Event) => void;
  className?: string;
  bodyClassName?: string;
}

const DIALOG_WIDTH = { sm: "400px", md: "520px", lg: "720px" } as const;
const DIALOG_WIDTH_PX = { sm: 400, md: 520, lg: 720 } as const;

/**
 * A modal dialog. Centred on desktop; a bottom sheet on phones, where a
 * centred card leaves the actions out of thumb reach.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose,
  onOpenAutoFocus,
  className,
  bodyClassName,
}: DialogProps) {
  // Radix warns without a Description; an explicit undefined says "none".
  const describedBy = description ? {} : { "aria-describedby": undefined };
  const focus = useReturnFocus(onOpenAutoFocus);
  useToastAvoidance(open, "dialog", DIALOG_WIDTH_PX[size]);
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...describedBy}
        {...focus}
        style={{ "--d-dialog-w": DIALOG_WIDTH[size] } as CSSProperties}
        className={cn(
          "d-dialog flex max-h-[min(86dvh,800px)] w-[min(var(--d-dialog-w),calc(100%-32px))] flex-col overflow-hidden p-0",
          "rounded-[var(--d-radius-card)] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] text-fg shadow-[var(--d-pop-shadow)]",
          "max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-h-[90dvh] max-sm:translate-x-0 max-sm:translate-y-0",
          "max-sm:rounded-b-none max-sm:rounded-t-[20px] max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <OverlayHeader title={title} description={description} hideClose={hideClose} />
        {children !== undefined && children !== null ? (
          <div className={cn("d-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1", bodyClassName)}>{children}</div>
        ) : null}
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--d-hairline)] px-5 py-3.5 max-sm:[&>*]:flex-1">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * Focus goes back where it came from on close. Radix returns it to a
 * DialogTrigger, but these dialogs are controlled (`open` state), so most
 * have no trigger and focus would fall to <body>, losing a keyboard user's
 * place. The element focused when the dialog opens is remembered instead.
 */
function useReturnFocus(onOpenAutoFocus?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      const target = opener.current;
      opener.current = null;
      if (target && target.isConnected && target !== document.body) {
        event.preventDefault();
        target.focus();
      }
    },
  };
}

function OverlayHeader({ title, description, hideClose }: { title: ReactNode; description?: ReactNode; hideClose?: boolean }) {
  return (
    <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
      <div className="min-w-0 flex-1 pt-0.5">
        <DialogTitle className="text-[16px] font-semibold leading-snug tracking-[-0.015em] text-fg">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="mt-1 text-[13.5px] leading-[1.5] text-fg-muted">{description}</DialogDescription>
        ) : null}
      </div>
      {hideClose ? null : (
        <DialogClose asChild>
          <button
            type="button"
            aria-label="Close"
            className="d-hit -mr-1.5 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-fg-dim transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg"
          >
            <Icon name="close" size={16} />
          </button>
        </DialogClose>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Edge it slides from on tablets and up (default "right"). */
  side?: "left" | "right" | "bottom";
  /** Under 640px: "bottom" (default) turns side sheets into a bottom sheet. */
  mobileSide?: "bottom" | "same";
  /** Side sheet width in px (default 400). */
  width?: number;
  hideClose?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  className?: string;
  bodyClassName?: string;
}

const SHEET_POSITION = {
  right: "inset-y-0 left-auto right-0 top-0 h-dvh max-h-none w-[min(var(--d-sheet-w),calc(100%-24px))] translate-x-0 translate-y-0 rounded-l-[20px] rounded-r-none border-y-0 border-r-0",
  left: "inset-y-0 left-0 right-auto top-0 h-dvh max-h-none w-[min(var(--d-sheet-w),calc(100%-24px))] translate-x-0 translate-y-0 rounded-l-none rounded-r-[20px] border-y-0 border-l-0",
  bottom: "bottom-0 left-0 right-0 top-auto max-h-[90dvh] w-full translate-x-0 translate-y-0 rounded-b-none rounded-t-[20px] border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)]",
} as const;

/**
 * A panel from a screen edge: side sheets for detail and settings on
 * desktop, a bottom sheet on phones (spec §2). Same focus trap, Escape and
 * scroll lock as Dialog.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  mobileSide = "bottom",
  width = 400,
  hideClose,
  onOpenAutoFocus,
  className,
  bodyClassName,
}: SheetProps) {
  const phone = useIsPhone();
  const effective = phone && mobileSide === "bottom" ? "bottom" : side;
  const describedBy = description ? {} : { "aria-describedby": undefined };
  const focus = useReturnFocus(onOpenAutoFocus);
  // Only a right sheet shares the toaster's edge; a bottom sheet sits under
  // the phone toaster (top) and a left one away from it.
  useToastAvoidance(open, effective === "right" ? "sheet" : null, width);
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...describedBy}
        {...focus}
        data-side={effective}
        style={{ "--d-sheet-w": `${width}px` } as CSSProperties}
        className={cn(
          "d-sheet fixed flex flex-col overflow-hidden p-0",
          "border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] text-fg shadow-[var(--d-pop-shadow)]",
          SHEET_POSITION[effective],
          className,
        )}
      >
        {effective === "bottom" ? (
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--d-glass-2)]" />
        ) : null}
        <OverlayHeader title={title} description={description} hideClose={hideClose} />
        <div className={cn("d-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1", bodyClassName)}>{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--d-hairline)] px-5 py-3.5 max-sm:[&>*]:flex-1">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
