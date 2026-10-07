"use client";

/**
 * Small pieces shared by Staking, Validators and the validator page: the
 * logo + moniker identity, the risk badges, the score dots, and the "—" a
 * figure shows when it is not known.
 *
 * Badges carry their whole meaning in words ("Jailed", "Can rise to 20%"),
 * so colour is never the only signal; the longer explanation sits in a
 * tooltip for pointers and in visually hidden text for screen readers.
 */

import Link from "next/link";
import { AssetLogo, Badge, Tooltip, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NO_VALUE } from "@/lib/format";
import type { ValidatorFlag } from "./model";
import type { ScoreCheck } from "./score";

/**
 * A figure that is not known and is not money or a percentage (a count, a
 * rank): the kit's "—", with its reason on hover and for screen readers.
 */
export function Unavailable({ reason }: { reason?: string }) {
  return (
    <span className="text-fg-dim" title={reason}>
      <span aria-hidden>{NO_VALUE}</span>
      <span className="sr-only">{reason ? `Unavailable: ${reason}` : "Unavailable"}</span>
    </span>
  );
}

const FLAG_TONE: Record<ValidatorFlag["tone"], Tone> = {
  danger: "danger",
  warning: "warning",
  neutral: "neutral",
  info: "neutral",
};

export function FlagBadges({
  flags,
  max,
  className,
}: {
  flags: readonly ValidatorFlag[];
  /** Show at most this many, then "+N". */
  max?: number;
  className?: string;
}) {
  if (flags.length === 0) return null;
  const shown = max !== undefined ? flags.slice(0, max) : flags;
  const rest = flags.length - shown.length;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((flag) => (
        <Tooltip key={flag.id} content={flag.detail}>
          <span className="inline-flex">
            <Badge
              tone={FLAG_TONE[flag.tone]}
              variant={flag.tone === "info" ? "outline" : "soft"}
              icon={flag.tone === "danger" ? "danger" : flag.tone === "warning" ? "warning" : undefined}
            >
              {flag.label}
            </Badge>
            <span className="sr-only">: {flag.detail}</span>
          </span>
        </Tooltip>
      ))}
      {rest > 0 ? (
        <Tooltip content={flags.slice(shown.length).map((flag) => flag.label).join(" · ")}>
          <span className="inline-flex">
            <Badge tone="neutral">+{rest}</Badge>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

export interface ValidatorIdentityProps {
  moniker: string;
  logoUrl?: string | null;
  /** Links the name (the validator page). */
  href?: string;
  size?: number;
  /** A line under the name (commission, uptime). */
  sub?: React.ReactNode;
  /** Right of the name on the first line (a "Yours" badge). */
  aside?: React.ReactNode;
  className?: string;
  nameClassName?: string;
}

/** Logo + moniker (+ a dim line). The moniker truncates; the full one is in the title. */
export function ValidatorIdentity({ moniker, logoUrl, href, size = 28, sub, aside, className, nameClassName }: ValidatorIdentityProps) {
  const name = (
    <span className={cn("block truncate font-medium text-fg", nameClassName)} title={moniker}>
      {moniker}
    </span>
  );
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <AssetLogo src={logoUrl ?? null} symbol={moniker} size={size} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {href ? (
            <Link
              href={href}
              data-row-action=""
              // `d-hit`: a 21px line of text, grown to a 44px target on touch screens.
              className="d-hit min-w-0 rounded-[4px] underline-offset-[3px] transition-colors duration-[160ms] hover:underline focus-visible:outline-offset-2"
            >
              {name}
            </Link>
          ) : (
            name
          )}
          {aside}
        </span>
        {sub ? <span className="mt-0.5 block truncate text-[12px] leading-tight text-fg-dim">{sub}</span> : null}
      </span>
    </span>
  );
}

/** Four dots, one per score check: filled = passed, ring = failed, dashed = no data. */
export function ScoreDots({ checks, className }: { checks: readonly ScoreCheck[]; className?: string }) {
  const passed = checks.filter((check) => check.pass === true).length;
  const label = `Score ${passed} of ${checks.length}: ${checks
    .map((check) => `${check.label} ${check.pass === true ? "yes" : check.pass === false ? "no" : "unknown"}`)
    .join(", ")}`;
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-1">
          <span className="font-medium text-fg">
            Score {passed}/{checks.length}
          </span>
          {checks.map((check) => (
            <span key={check.id} className="flex items-center gap-1.5 text-fg-muted">
              <span aria-hidden className={check.pass === true ? "text-[var(--d-pos)]" : "text-fg-dim"}>
                {check.pass === true ? "✓" : check.pass === false ? "✕" : "?"}
              </span>
              {check.label}
              {check.pass === null ? <span className="text-fg-dim">(no data)</span> : null}
            </span>
          ))}
        </span>
      }
    >
      <span role="img" aria-label={label} className={cn("inline-flex shrink-0 items-center gap-[3px]", className)}>
        {checks.map((check) => (
          <span
            key={check.id}
            aria-hidden
            className={cn(
              "size-[7px] rounded-full",
              check.pass === true
                ? "bg-[var(--d-pos)]"
                : check.pass === false
                  ? "border border-[color-mix(in_srgb,var(--z-fg)_32%,transparent)]"
                  : "border border-dashed border-[color-mix(in_srgb,var(--z-fg)_32%,transparent)]",
            )}
          />
        ))}
      </span>
    </Tooltip>
  );
}
