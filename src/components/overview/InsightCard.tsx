"use client";

/**
 * One insight as a card: kind icon and severity (icon, word and tone, so
 * colour is never the only carrier), the fact, its numbers, one action, and
 * the "why" behind it on demand.
 *
 * Shared: the Overview row renders it, and the Insights page can reuse it
 * (with the presentation maps below) so an insight reads the same in both.
 */

import { Icon, type IconName } from "@/components/icons";
import { Badge, Button, ChainLogo, IconButton, InfoTip, TONE_SOFT, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { INSIGHT_KIND_LABEL, SEVERITY_LABEL, type Insight, type InsightKind, type InsightSeverity } from "@/lib/insights";

export const SEVERITY_TONE: Readonly<Record<InsightSeverity, Tone>> = {
  critical: "danger",
  warning: "warning",
  opportunity: "success",
  info: "neutral",
};

export const SEVERITY_ICON: Readonly<Record<InsightSeverity, IconName>> = {
  critical: "danger",
  warning: "warning",
  opportunity: "sparkle",
  info: "info",
};

export const INSIGHT_ICON: Readonly<Record<InsightKind, IconName>> = {
  claim: "sparkle",
  compounding: "refresh",
  "idle-stake": "trendingUp",
  vote: "governance",
  unbonding: "hourglass",
  "validator-risk": "validators",
  concentration: "layers",
  unpriced: "help",
  security: "shield",
  "chain-risk": "networks",
};

export interface InsightCardProps {
  insight: Insight;
  /**
   * Hides the insight: called by its close button, and when its action is
   * opened (the reader has seen it and gone to act on it).
   */
  onDismiss?: () => void;
  className?: string;
}

export function InsightCard({ insight, onDismiss, className }: InsightCardProps) {
  const tone = SEVERITY_TONE[insight.severity];
  const titleId = `insight-${insight.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn("d-card relative flex min-w-0 flex-col gap-2.5 p-[var(--d-pad)] [overflow:clip]", className)}
    >
      {/* A hairline of the severity tone along the top edge: a quiet cue, the badge says it in words. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-[2px]",
          tone === "danger" && "bg-[var(--z-danger)]",
          tone === "warning" && "bg-[var(--z-warning)]",
          tone === "success" && "bg-[var(--z-success)]",
          tone === "neutral" && "bg-[var(--d-hairline-strong)]",
        )}
      />
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px]", TONE_SOFT[tone], tone === "neutral" && "text-fg-muted")}>
          <Icon name={INSIGHT_ICON[insight.kind]} size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="d-label truncate">{INSIGHT_KIND_LABEL[insight.kind]}</span>
          <Badge tone={tone} size="sm" icon={SEVERITY_ICON[insight.severity]} className="self-start">
            {SEVERITY_LABEL[insight.severity]}
          </Badge>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {insight.chainId ? <ChainLogo chainId={insight.chainId} size={18} labelled /> : null}
          {insight.why ? (
            <InfoTip
              label="Why this insight"
              size={14}
              content={<p className="max-w-[300px] text-[12.5px] leading-snug text-fg-muted">{insight.why}</p>}
            />
          ) : null}
          {onDismiss ? <IconButton label="Hide this insight" icon="close" size="sm" variant="ghost" className="-mr-1.5" onClick={onDismiss} /> : null}
        </span>
      </div>
      <h3 id={titleId} className="line-clamp-2 text-[14.5px] font-medium leading-snug tracking-[-0.01em] text-fg">
        {insight.title}
      </h3>
      <p className="line-clamp-3 text-[13px] leading-[1.5] text-fg-muted" title={insight.body}>
        {insight.body}
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-1">
        {insight.metric ? (
          <div className="min-w-0">
            <div className="truncate text-[11.5px] text-fg-dim">{insight.metric.label}</div>
            <div className="truncate text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-fg">{insight.metric.value}</div>
          </div>
        ) : (
          <span />
        )}
        {insight.action ? (
          <Button size="sm" variant="secondary" href={insight.action.href} iconRight="arrowRight" className="shrink-0" onClick={onDismiss}>
            {insight.action.label}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
