"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatShare } from "./format";
import { VIZ_ACCENT, VIZ_NEG, VIZ_WARN } from "./palette";

export type MeterLevel = "ok" | "warning" | "danger";

export interface MeterThresholds {
  /** Value (in the meter's own units) from which the fill turns to warning. */
  warning?: number;
  /** Value from which the fill turns to danger. */
  danger?: number;
  /** `up` (default): higher is worse. `down`: lower is worse (uptime, bonded ratio). */
  direction?: "up" | "down";
}

/** Which band a value falls in. Exported for tests and for callers that label the state. */
export function meterLevel(value: number, thresholds?: MeterThresholds): MeterLevel {
  if (!thresholds || !Number.isFinite(value)) return "ok";
  const worse = (limit: number | undefined) =>
    limit !== undefined && (thresholds.direction === "down" ? value <= limit : value >= limit);
  if (worse(thresholds.danger)) return "danger";
  if (worse(thresholds.warning)) return "warning";
  return "ok";
}

export interface MeterProps {
  value: number;
  min?: number;
  max?: number;
  /** Left of the head row: what is measured ("Staked ratio"). */
  label?: ReactNode;
  /** Right of the head row. Defaults to the share of the range ("62.4%"). */
  valueLabel?: ReactNode;
  /** Colour bands. Without them the fill is the brand accent. */
  thresholds?: MeterThresholds;
  /**
   * Status words for the warning and danger bands, shown next to the value
   * with a glyph: a status colour never carries meaning on its own.
   */
  statusLabels?: Partial<Record<Exclude<MeterLevel, "ok">, string>>;
  /** Thin ticks on the track (a target, a quorum). */
  markers?: ReadonlyArray<{ value: number; label: string }>;
  /** Fill colour when the value is in the ok band. */
  color?: string;
  size?: "sm" | "md";
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  className?: string;
}

const LEVEL_COLOR: Record<MeterLevel, string> = { ok: VIZ_ACCENT, warning: VIZ_WARN, danger: VIZ_NEG };

function StatusGlyph({ level }: { level: Exclude<MeterLevel, "ok"> }) {
  return (
    <svg className="viz-meter__status" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {level === "warning" ? (
        <path d="M6 1.5 11 10.5H1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      ) : (
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
      <path d="M6 4.6v2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy={level === "warning" ? 8.9 : 8.6} r="0.8" fill="currentColor" />
    </svg>
  );
}

/**
 * One ratio against a limit: a track and a fill. The fill wears the accent
 * until a threshold says otherwise (warning, then danger); the track is the
 * same hue at 16%, so the state reads across the whole bar, not just the
 * filled part.
 */
export function Meter({
  value,
  min = 0,
  max = 1,
  label,
  valueLabel,
  thresholds,
  statusLabels,
  markers,
  color,
  size = "md",
  ariaLabel,
  className,
}: MeterProps) {
  const span = max - min || 1;
  const clamped = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const pct = ((clamped - min) / span) * 100;
  const level = meterLevel(value, thresholds);
  const fill = level === "ok" ? (color ?? LEVEL_COLOR.ok) : LEVEL_COLOR[level];
  const shown = valueLabel ?? (Number.isFinite(value) ? formatShare((clamped - min) / span) : "—");
  const status = level === "ok" ? null : (statusLabels?.[level] ?? null);
  const text = typeof shown === "string" ? shown : undefined;

  return (
    <div
      className={className ? `viz-meter ${className}` : "viz-meter"}
      data-size={size}
      data-level={level}
      style={{ "--viz-meter-color": fill } as CSSProperties}
      role="meter"
      aria-valuemin={min}
      aria-valuemax={max}
      // Rounded to 6 places: JavaScript writes numbers under 1e-6 in exponent
      // form ("9.2e-9" for a dust holding's share), which is not a valid ARIA
      // number and fails axe's aria-valid-attr-value.
      aria-valuenow={Number.isFinite(value) ? Number(clamped.toFixed(6)) : undefined}
      aria-valuetext={[text, status].filter(Boolean).join(", ") || undefined}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
    >
      {label !== undefined || valueLabel !== undefined || status ? (
        <div className="viz-meter__head">
          <span className="viz-meter__label">{label}</span>
          <span className="viz-meter__value">
            {level !== "ok" ? <StatusGlyph level={level} /> : null}
            {status ? <span style={{ fontWeight: 500, color: "var(--z-fg-muted)" }}>{status}</span> : null}
            <span>{shown}</span>
          </span>
        </div>
      ) : null}
      <div className="viz-meter__track">
        <div className="viz-meter__fill" style={{ width: `${pct}%` }} />
        {markers?.map((m) => (
          <span
            key={m.label}
            className="viz-meter__marker"
            title={m.label}
            style={{ left: `${(((Math.min(max, Math.max(min, m.value)) - min) / span) * 100).toFixed(2)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
