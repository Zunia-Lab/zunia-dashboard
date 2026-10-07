"use client";

/**
 * Data-card states and progress: Skeleton, SkeletonText, EmptyState,
 * InlineError, Callout, PartialDataBadge, ProgressBar, Stepper.
 *
 * Spec §3 "States": first load is a skeleton shaped like the content; empty
 * is a compact inline state (never a tall empty card); an error is a callout
 * inside the card with the reason and Retry; partial data shows what loaded
 * plus a small "2 networks unreachable" badge with details on hover.
 */

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { TONE_ICON, TONE_SOFT, type Tone } from "./Badge";
import { Button } from "./Button";
import { HoverCard } from "./Overlay";

/* ------------------------------------------------------------------ skeleton */

export interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  /** A circle of `width` (avatars, logos). */
  circle?: boolean;
  style?: CSSProperties;
}

/** A shimmering placeholder block. Give it the size of what it stands for. */
export function Skeleton({ className, width, height, circle, style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn("d-skeleton", circle && "rounded-full", className)}
      style={{ width, height: height ?? (circle ? width : undefined), ...style }}
    />
  );
}

/** Lines of text placeholder; the last line is shorter, like real prose. */
export function SkeletonText({ lines = 3, className, lastLineWidth = "62%" }: { lines?: number; className?: string; lastLineWidth?: string }) {
  return (
    <span aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-2.5" width={i === lines - 1 && lines > 1 ? lastLineWidth : "100%"} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ empty */

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  body?: ReactNode;
  /** One call to action (a Button). */
  action?: ReactNode;
  /** Left-aligned row instead of the centred block (inside dense lists). */
  inline?: boolean;
  className?: string;
}

/** A compact "nothing here yet": 32px icon, 15px title, one line, one CTA. */
export function EmptyState({ icon = "inbox", title, body, action, inline, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex gap-3",
        inline ? "items-center py-3 text-left" : "flex-col items-center px-4 py-7 text-center",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-glass)] text-fg-dim">
        <Icon name={icon} size={18} />
      </span>
      <div className={cn("min-w-0", inline ? "flex-1" : "max-w-[44ch]")}>
        <p className="text-[15px] font-medium leading-snug tracking-[-0.01em] text-fg">{title}</p>
        {body ? <p className="mt-1 text-[13px] leading-[1.5] text-fg-dim">{body}</p> : null}
      </div>
      {action ? <div className={cn("shrink-0", !inline && "mt-1")}>{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ inline error */

export interface InlineErrorProps {
  title?: ReactNode;
  /** The reason, in plain words. Never an upstream body or a stack trace. */
  message: ReactNode;
  onRetry?: () => void;
  /** Shows the Retry button busy. */
  retrying?: boolean;
  className?: string;
}

/** A read failed: the reason and Retry, inside the card that failed. */
export function InlineError({ title = "Couldn't load this", message, onRetry, retrying, className }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-[var(--d-radius-inner)] border border-[var(--z-danger-line)] bg-[var(--z-danger-fill)] px-3.5 py-3",
        className,
      )}
    >
      <Icon name="danger" size={18} className="mt-px shrink-0 text-[var(--z-danger)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-snug text-fg">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-fg-muted">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" iconLeft="refresh" loading={retrying} onClick={onRetry} className="-my-0.5 shrink-0">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ callout */

export interface CalloutProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link on the right (stacks under the text on phones). */
  action?: ReactNode;
  /** Overrides the tone's icon; `null` for none. */
  icon?: IconName | null;
  className?: string;
}

/**
 * A tinted note: warnings before signing, honest caveats, tips. Without a
 * tone it is neutral: `info` is the brand amber, as loud as a warning, so a
 * note only wears it when it is meant to stand out.
 */
export function Callout({ tone = "neutral", title, children, action, icon, className }: CalloutProps) {
  const glyph = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "status" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--d-radius-inner)] px-3.5 py-3 sm:flex-row sm:items-start",
        TONE_SOFT[tone],
        tone === "neutral" && "bg-[var(--d-glass)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {glyph ? <Icon name={glyph} size={18} className="mt-px shrink-0" /> : null}
        <div className="min-w-0 flex-1 text-[13px] leading-[1.5] text-fg-muted">
          {title ? <p className="mb-0.5 text-[13.5px] font-medium leading-snug text-fg">{title}</p> : null}
          {children}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 sm:-my-0.5">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ partial data */

/** One failed part of a read, as every API route reports it. */
export interface PartialError {
  chainId?: string;
  scope: string;
  message: string;
}

export interface PartialDataBadgeProps {
  errors: PartialError[] | null | undefined;
  className?: string;
}

/**
 * "2 networks unreachable": the figures on screen are what did load; this
 * says what did not, with each reason on hover or tap.
 */
export function PartialDataBadge({ errors, className }: PartialDataBadgeProps) {
  if (!errors || errors.length === 0) return null;
  const chains = new Set(errors.map((e) => e.chainId).filter((id): id is string => Boolean(id)));
  // Failures not tied to a chain (a price feed, the indexer) are counted
  // too: "1 network unreachable" alone would hide that prices are missing.
  const sources = errors.filter((e) => !e.chainId).length;
  const label = [
    chains.size > 0 ? `${chains.size} ${chains.size === 1 ? "network" : "networks"} unreachable` : null,
    sources > 0 ? `${sources} ${sources === 1 ? "source" : "sources"} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <HoverCard
      width={340}
      trigger={
        <button
          type="button"
          className={cn(
            "d-hit inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--d-radius-sm)] px-1.5 text-[11.5px] font-medium leading-none",
            TONE_SOFT.warning,
            "transition-[filter] duration-[160ms] hover:brightness-110",
            className,
          )}
        >
          <Icon name="warning" size={12} />
          {label}
        </button>
      }
    >
      <p className="mb-1.5 text-[12.5px] font-medium text-fg">Partial data</p>
      <p className="mb-2 text-[12px] text-fg-dim">Figures include only what loaded. Missing parts:</p>
      <ul className="flex flex-col gap-1.5">
        {errors.slice(0, 8).map((error, index) => (
          <li key={`${error.chainId ?? ""}-${error.scope}-${index}`} className="text-[12.5px] leading-snug">
            <span className="font-medium text-fg">{error.chainId ? (findChain(error.chainId)?.chainName ?? error.chainId) : error.scope}</span>
            {error.chainId ? <span className="text-fg-dim"> · {error.scope}</span> : null}
            <span className="block text-fg-muted">{error.message}</span>
          </li>
        ))}
        {errors.length > 8 ? <li className="text-[12px] text-fg-dim">and {errors.length - 8} more</li> : null}
      </ul>
    </HoverCard>
  );
}

/* ------------------------------------------------------------------ progress */

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: "accent" | "neutral" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  /** Accessible name (required when no visible label sits next to it). */
  label?: string;
  /** Show "62%" at the right. */
  showValue?: boolean;
  className?: string;
}

const PROGRESS_FILL = {
  accent: "bg-[image:var(--z-accent-gradient)]",
  neutral: "bg-fg-muted",
  success: "bg-[var(--z-success)]",
  warning: "bg-[var(--z-warning)]",
  danger: "bg-[var(--z-danger)]",
} as const;

export function ProgressBar({ value, max = 100, tone = "accent", size = "sm", label, showValue, className }: ProgressBarProps) {
  const ratio = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        // Rounded to 6 places so a tiny value never prints in exponent form
        // ("1e-7"), which is not a valid ARIA number.
        aria-valuenow={Number.isFinite(value) ? Number(value.toFixed(6)) : undefined}
        className={cn("relative min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--d-glass-2)]", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-[450ms] ease-[var(--d-ease)]", PROGRESS_FILL[tone])}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {showValue ? <span className="shrink-0 text-[12.5px] tabular-nums text-fg-dim">{Math.round(ratio * 100)}%</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ stepper */

export type StepState = "done" | "current" | "todo" | "error";

export interface Step {
  label: ReactNode;
  state: StepState;
  description?: ReactNode;
}

export interface StepperProps {
  steps: Step[];
  orientation?: "horizontal" | "vertical";
  /**
   * How a finished step is drawn. `brand` (default): the crimson button
   * gradient, for a flow the user is moving through (sign, then broadcast).
   * `status`: success green, for an outcome being reported (a delivered IBC
   * transfer), where three red checks next to a green "Delivered" read as
   * errors.
   */
  doneTone?: "brand" | "status";
  className?: string;
}

const STEP_STATE_LABEL: Record<StepState, string> = {
  done: "completed",
  current: "current step",
  todo: "not started",
  error: "failed",
};

/** Ordered steps: a two-step swap, a transfer's hops, a signing flow. */
export function Stepper({ steps, orientation = "horizontal", doneTone = "brand", className }: StepperProps) {
  const vertical = orientation === "vertical";
  return (
    <ol className={cn("flex", vertical ? "flex-col" : "items-start", className)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={index}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn("relative flex min-w-0", vertical ? "gap-3 pb-4 last:pb-0" : "flex-1 flex-col gap-2 last:flex-none")}
          >
            <div className={cn("flex items-center", vertical ? "flex-col self-stretch" : "w-full")}>
              <StepMark state={step.state} index={index} doneTone={doneTone} />
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    vertical ? "mt-1 w-px flex-1" : "mx-2 h-px flex-1",
                    step.state !== "done"
                      ? "bg-[var(--d-hairline-strong)]"
                      : doneTone === "status"
                        ? "bg-[var(--z-success)] opacity-60"
                        : "bg-[var(--z-accent)] opacity-60",
                  )}
                />
              ) : null}
            </div>
            <div className={cn("min-w-0", vertical ? "pt-0.5" : "pr-3")}>
              <p
                className={cn(
                  "text-[13px] font-medium leading-snug",
                  step.state === "todo" ? "text-fg-dim" : step.state === "error" ? "text-[var(--z-danger)]" : "text-fg",
                )}
              >
                {step.label}
                <span className="sr-only">, {STEP_STATE_LABEL[step.state]}</span>
              </p>
              {step.description ? <p className="mt-0.5 text-[12.5px] leading-snug text-fg-dim">{step.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepMark({ state, index, doneTone }: { state: StepState; index: number; doneTone: "brand" | "status" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums",
        state === "done" &&
          (doneTone === "status"
            ? "bg-[var(--z-success-fill)] text-[var(--z-success)] ring-1 ring-[var(--z-success-line)]"
            : "bg-[image:var(--z-button-gradient)] text-white"),
        state === "current" && "border-[1.5px] border-[var(--z-accent)] text-fg shadow-[0_0_0_3px_var(--d-accent-soft)]",
        state === "todo" && "border border-[var(--d-hairline-strong)] text-fg-dim",
        state === "error" && "bg-[var(--z-danger-fill)] text-[var(--z-danger)] ring-1 ring-[var(--z-danger-line)]",
      )}
    >
      {state === "done" ? <Icon name="check" size={13} strokeWidth={2.2} /> : state === "error" ? <Icon name="close" size={12} strokeWidth={2.2} /> : index + 1}
    </span>
  );
}
