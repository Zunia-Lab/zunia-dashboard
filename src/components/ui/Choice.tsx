"use client";

/**
 * Choosing among options: Chip / ChipGroup (filters), Segmented (ranges and
 * views), Tabs / TabPanel (sections of a page).
 *
 * Keyboard behaviour follows the ARIA patterns: one tab stop per group
 * (roving tabindex), arrows and Home / End move; in a radio group (single
 * chips, segmented) the selection follows focus, in a multi-select group
 * Space / Enter toggles. Tabs activate on arrow, which suits panels that
 * render instantly.
 */

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { nextRovingIndex } from "./roving";

type IconSlot = IconName | ReactElement;

function renderIcon(icon: IconSlot | undefined, size: number): ReactNode {
  if (icon === undefined) return null;
  return typeof icon === "string" ? <Icon name={icon as IconName} size={size} className="shrink-0" /> : icon;
}

/** Focus and return the next enabled item of a roving group. */
function focusRoving(container: HTMLElement | null, key: string, current: number): number | null {
  if (!container) return null;
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-roving]"));
  const next = nextRovingIndex(key, current, items.length, (i) => items[i]?.hasAttribute("disabled") ?? true);
  if (next === null) return null;
  items[next]?.focus();
  return next;
}

/* ------------------------------------------------------------------ chip */

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** A count after the label ("Staked 4"). */
  count?: number | string;
  icon?: IconSlot;
  /** Any leading node, e.g. a ChainLogo. */
  leading?: ReactNode;
  /** Shows an × that calls this (removable filter chips). */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const CHIP_BASE = cn(
  "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-full border font-medium",
  "transition-[background-color,border-color,color] duration-[160ms] ease-[var(--d-ease)]",
  "disabled:pointer-events-none disabled:opacity-45",
);

const CHIP_SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-[12.5px]",
  md: "h-8 gap-1.5 px-3 text-[13px]",
} as const;

function chipClasses(selected: boolean | undefined, size: "sm" | "md") {
  return cn(
    CHIP_BASE,
    CHIP_SIZE[size],
    selected
      ? "border-[var(--d-accent-line)] bg-[var(--d-accent-soft)] text-fg"
      : "border-[var(--d-hairline-strong)] bg-transparent text-fg-muted hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass)] hover:text-fg",
  );
}

function ChipCount({ count, selected }: { count: number | string; selected?: boolean }) {
  return (
    <span className={cn("tabular-nums", selected ? "text-fg-muted" : "text-fg-dim")} aria-hidden={false}>
      {count}
    </span>
  );
}

/** A standalone toggle chip (aria-pressed). Use ChipGroup for sets. */
export function Chip({ selected, onClick, children, count, icon, leading, onRemove, removeLabel, disabled, size = "sm", className }: ChipProps) {
  if (onRemove) {
    return (
      <span className={cn(chipClasses(true, size), "pr-1", className)}>
        {leading}
        {renderIcon(icon, 14)}
        <span>{children}</span>
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${typeof children === "string" ? children : "filter"}`}
          onClick={onRemove}
          disabled={disabled}
          className="d-hit inline-flex size-5 items-center justify-center rounded-full text-fg-dim hover:bg-[var(--d-glass-2)] hover:text-fg focus-visible:outline-offset-0"
        >
          <Icon name="close" size={12} strokeWidth={2} />
        </button>
      </span>
    );
  }
  return (
    <button type="button" aria-pressed={selected ?? false} onClick={onClick} disabled={disabled} className={cn(chipClasses(selected, size), "d-hit", className)}>
      {leading}
      {renderIcon(icon, 14)}
      <span>{children}</span>
      {count !== undefined ? <ChipCount count={count} selected={selected} /> : null}
    </button>
  );
}

export interface ChipItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | string;
  icon?: IconSlot;
  leading?: ReactNode;
  disabled?: boolean;
}

interface ChipGroupBase<T extends string> {
  items: ChipItem<T>[];
  /** Accessible name of the group: "Asset type". */
  ariaLabel: string;
  size?: "sm" | "md";
  /** One scrolling row (phones) instead of wrapping lines. */
  scroll?: boolean;
  className?: string;
}

export type ChipGroupProps<T extends string> = ChipGroupBase<T> &
  (
    | { type: "single"; value: T; onChange: (value: T) => void }
    | { type: "multi"; value: T[]; onChange: (value: T[]) => void }
  );

/**
 * Filter chips. `single` is a radio group (exactly one selected, e.g. type
 * "All / Native / IBC / Staked"); `multi` is a set of toggles.
 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { items, ariaLabel, size = "sm", scroll, className } = props;
  const ref = useRef<HTMLDivElement>(null);
  const isSelected = (value: T) => (props.type === "single" ? props.value === value : props.value.includes(value));
  // The group's single tab stop: the first selected chip, else the first
  // enabled one.
  const selectedIndex = items.findIndex((item) => isSelected(item.value) && !item.disabled);
  const focusIndex = selectedIndex !== -1 ? selectedIndex : items.findIndex((item) => !item.disabled);

  const select = (value: T) => {
    if (props.type === "single") props.onChange(value);
    else props.onChange(props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = focusRoving(ref.current, event.key, index);
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (props.type === "single" && item) props.onChange(item.value);
  };

  return (
    <div
      ref={ref}
      role={props.type === "single" ? "radiogroup" : "group"}
      aria-label={ariaLabel}
      className={cn("flex gap-1.5", scroll ? "d-no-scrollbar -mx-1 overflow-x-auto px-1 py-0.5" : "flex-wrap", className)}
    >
      {items.map((item, index) => {
        const selected = isSelected(item.value);
        return (
          <button
            key={item.value}
            type="button"
            data-roving=""
            role={props.type === "single" ? "radio" : undefined}
            aria-checked={props.type === "single" ? selected : undefined}
            aria-pressed={props.type === "multi" ? selected : undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={item.disabled}
            onClick={() => select(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(chipClasses(selected, size), "d-hit")}
          >
            {item.leading}
            {renderIcon(item.icon, 14)}
            <span>{item.label}</span>
            {item.count !== undefined ? <ChipCount count={item.count} selected={selected} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconSlot;
  disabled?: boolean;
  /** Tooltip-free hint for an icon-only option (also its accessible name). */
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name: "Range", "Group by". */
  ariaLabel: string;
  /** sm: 28px options (card headers); md: 32px. */
  size?: "sm" | "md";
  /** Monospace labels for ranges like 24H · 7D · 30D. */
  mono?: boolean;
  fullWidth?: boolean;
  className?: string;
}

const SEG_SIZE = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-8 px-3 text-[13px]",
} as const;

/**
 * A radio group drawn as a pill track with a sliding thumb. The thumb is
 * positioned from the DOM after layout (no state, so no extra render), and
 * only animates after its first placement.
 */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "sm", mono, fullWidth, className }: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    if (!root || !thumb) return;
    const place = () => {
      const active = root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
      if (!active) {
        root.removeAttribute("data-ready");
        return;
      }
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.transform = `translateX(${active.offsetLeft}px)`;
      root.setAttribute("data-ready", "");
    };
    place();
    const frame = requestAnimationFrame(() => root.setAttribute("data-animate", ""));
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, options.length]);

  // One tab stop: the selected option, or the first enabled one when the
  // value matches none (so the group never drops out of the tab order).
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex !== -1 ? selectedIndex : options.findIndex((option) => !option.disabled);

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "d-seg relative inline-flex shrink-0 items-center gap-0.5 rounded-[var(--d-radius-control)] bg-[var(--d-seg-track)] p-[2px]",
        fullWidth && "flex w-full",
        className,
      )}
    >
      <span
        ref={thumbRef}
        aria-hidden
        className="d-seg-thumb bottom-[2px] top-[2px] rounded-[calc(var(--d-radius-control)-2px)] bg-[var(--d-seg-thumb)] shadow-[var(--d-seg-thumb-shadow)]"
      />
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-roving=""
            aria-checked={selected}
            aria-label={option.ariaLabel}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const next = focusRoving(rootRef.current, event.key, index);
              if (next === null) return;
              event.preventDefault();
              const target = options[next];
              if (target) onChange(target.value);
            }}
            className={cn(
              "d-hit relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--d-radius-control)-2px)] font-medium",
              "transition-colors duration-[160ms] ease-[var(--d-ease)] disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-offset-0",
              SEG_SIZE[size],
              mono && "font-mono text-[11.5px] uppercase tracking-[0.04em]",
              fullWidth && "flex-1",
              selected ? "text-fg" : "text-fg-dim hover:text-fg",
            )}
          >
            {renderIcon(option.icon, size === "sm" ? 14 : 16)}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** A count badge after the label. */
  count?: number | string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Shared with each TabPanel's `tabsId` to link tabs and panels. */
  id?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Underline tabs with a sliding brand-gradient ink. */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel, id, size = "md", className }: TabsProps<T>) {
  const autoId = useId();
  const base = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const ink = inkRef.current;
    if (!root || !ink) return;
    const place = () => {
      const active = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) {
        root.removeAttribute("data-ready");
        return;
      }
      ink.style.width = `${active.offsetWidth}px`;
      ink.style.transform = `translateX(${active.offsetLeft}px)`;
      root.setAttribute("data-ready", "");
    };
    place();
    const frame = requestAnimationFrame(() => root.setAttribute("data-animate", ""));
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, items.length]);

  const selectedIndex = items.findIndex((item) => item.value === value);
  const tabStop = selectedIndex !== -1 ? selectedIndex : items.findIndex((item) => !item.disabled);

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "d-tabs d-no-scrollbar relative flex max-w-full items-stretch gap-5 overflow-x-auto border-b border-[var(--d-hairline)]",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-roving=""
            id={tabId(base, item.value)}
            aria-selected={selected}
            aria-controls={panelId(base, item.value)}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              const next = focusRoving(rootRef.current, event.key, index);
              if (next === null) return;
              event.preventDefault();
              const target = items[next];
              if (target) onChange(target.value);
            }}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium tracking-[-0.01em]",
              "transition-colors duration-[160ms] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-offset-[-2px]",
              size === "sm" ? "h-9 text-[13px]" : "h-10 text-[14px]",
              // 44px on touch screens (spec §3). Real height, not d-hit: the
              // tab list scrolls sideways, and a scroller clips any hit area
              // that reaches past its own box.
              "[@media(pointer:coarse)]:h-11",
              selected ? "text-fg" : "text-fg-dim hover:text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums",
                  // fg-muted: fg-dim on the chip was 4.47:1 in dark.
                  selected ? "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]" : "bg-[var(--d-glass-2)] text-fg-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
      <span ref={inkRef} aria-hidden className="d-tabs-ink bottom-0 h-[2px] rounded-full bg-[image:var(--z-accent-gradient)]" />
    </div>
  );
}

function tabId(base: string, value: string) {
  return `${base}-tab-${value}`;
}

function panelId(base: string, value: string) {
  return `${base}-panel-${value}`;
}

export interface TabPanelProps {
  /** The `id` given to <Tabs>. */
  tabsId: string;
  value: string;
  /** Whether this panel's tab is selected (others render hidden). */
  active: boolean;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ tabsId, value, active, children, className }: TabPanelProps) {
  return (
    <div role="tabpanel" id={panelId(tabsId, value)} aria-labelledby={tabId(tabsId, value)} hidden={!active} className={className}>
      {active ? children : null}
    </div>
  );
}
