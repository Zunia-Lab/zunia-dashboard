"use client";

/**
 * Small labels: Badge (a type tag: "IBC", "Native"), StatusBadge (a state
 * with a dot: "Active", "Jailed", "Voting"), SoonBadge, Kbd.
 *
 * Tones map to the four-token status sets of @zunialab/tokens (hue for text,
 * `-fill` behind it, `-line` for outlines), which clear 4.5:1 in both themes.
 * `info` is the brand amber, not blue: the token set reserves blue for charts.
 * That makes it as loud as `warning` (louder in dark), so a state that is
 * merely informative and carries no urgency should be `neutral`: a tone is
 * a claim, and the less urgent badge must not outshine the urgent one.
 * Colour is never the only carrier, so a status badge always has a word.
 */

import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-[var(--d-glass-2)] text-fg-muted",
  info: "bg-[var(--z-info-fill)] text-[var(--z-info)]",
  success: "bg-[var(--z-success-fill)] text-[var(--z-success)]",
  warning: "bg-[var(--z-warning-fill)] text-[var(--z-warning)]",
  danger: "bg-[var(--z-danger-fill)] text-[var(--z-danger)]",
  accent: "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]",
};

export const TONE_OUTLINE: Record<Tone, string> = {
  neutral: "border-[var(--d-hairline-strong)] text-fg-muted",
  info: "border-[var(--z-info-line)] text-[var(--z-info)]",
  success: "border-[var(--z-success-line)] text-[var(--z-success)]",
  warning: "border-[var(--z-warning-line)] text-[var(--z-warning)]",
  danger: "border-[var(--z-danger-line)] text-[var(--z-danger)]",
  accent: "border-[var(--d-accent-line)] text-[var(--d-accent-text)]",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-fg-dim",
  info: "bg-[var(--z-info)]",
  success: "bg-[var(--z-success)]",
  warning: "bg-[var(--z-warning)]",
  danger: "bg-[var(--z-danger)]",
  accent: "bg-[var(--z-accent)]",
};

/** The status icon that goes with a tone (callouts, toasts, insights). */
export const TONE_ICON: Record<Tone, IconName> = {
  neutral: "info",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
  accent: "sparkle",
};

export interface BadgeProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  tone?: Tone;
  /** `soft` (tinted fill, default) or `outline` (hairline in the tone). */
  variant?: "soft" | "outline";
  size?: "sm" | "md";
  /** A leading status dot. */
  dot?: boolean;
  /** Pulse the dot (live, connected). */
  pulse?: boolean;
  icon?: IconName | ReactElement;
  children?: ReactNode;
}

const BADGE_SIZE = {
  sm: "h-5 gap-1 px-1.5 text-[11.5px]",
  md: "h-6 gap-1.5 px-2 text-[12.5px]",
} as const;

/** A compact tag: asset type, network kind, a count. 6px radius. */
export function Badge({ tone = "neutral", variant = "soft", size = "sm", dot, pulse, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-[var(--d-radius-sm)] font-medium leading-none tracking-[-0.005em]",
        BADGE_SIZE[size],
        variant === "outline" ? cn("border bg-transparent", TONE_OUTLINE[tone]) : TONE_SOFT[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <Dot tone={tone} pulse={pulse} /> : null}
      {icon ? typeof icon === "string" ? <Icon name={icon as IconName} size={size === "sm" ? 12 : 14} /> : icon : null}
      {children !== undefined && children !== null ? <span className="truncate">{children}</span> : null}
    </span>
  );
}

/** A state pill: rounded, dot by default. "Active", "Jailed", "Voting". */
export function StatusBadge({ dot = true, size = "sm", className, ...rest }: BadgeProps) {
  return <Badge dot={dot} size={size} className={cn("rounded-full", size === "sm" ? "px-2" : "px-2.5", className)} {...rest} />;
}

/** "Soon": a feature that is designed but not shipped (spec §0). */
export function SoonBadge({ className, label = "Soon" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full bg-[var(--d-glass-2)] px-1.5",
        // fg-muted: 10px text on the chip fill needs 4.5:1, and fg-dim gave
        // 4.35:1 in light (3.76:1 on the active nav row) and 4.11:1 in dark.
        "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-fg-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_DOT[tone], pulse && "d-pulse", className)}
      style={pulse ? { color: `var(--z-${tone === "neutral" ? "fg-dim" : tone === "accent" ? "accent" : tone})` } : undefined}
    />
  );
}

/** A key cap: "⌘K", "Esc", "/". */
export function Kbd({ className, children, ...rest }: ComponentPropsWithRef<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] px-1",
        "border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] shadow-[inset_0_-1px_0_var(--d-hairline-strong)]",
        // fg-muted for the same reason as SoonBadge: fg-dim on the key cap
        // was 4.35:1 in light.
        "font-mono text-[11px] font-medium leading-none text-fg-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
