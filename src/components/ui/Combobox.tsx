"use client";

/**
 * Combobox: a searchable picker (tokens, chains, validators).
 *
 * A popover under the trigger on tablets and up, a bottom sheet on phones
 * (spec §2). The search field keeps focus while arrows move the active
 * option (aria-activedescendant), so typing and choosing never fight; Enter
 * picks, Escape closes. Rendering is capped (default 400 rows) with a note to
 * keep typing, which is enough for every list the dashboard has without a
 * virtualizer.
 */

import { Popover as PopoverRoot, PopoverContent, PopoverTrigger } from "@zunialab/ui";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { SearchInput } from "./Form";
import { useIsPhone } from "./hooks";
import { Sheet } from "./Overlay";

export interface ComboboxItemState {
  active: boolean;
  selected: boolean;
  disabled: boolean;
}

export interface ComboboxProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, state: ComboboxItemState) => ReactNode;
  /** Keep items matching the query (lowercased, trimmed). Default: key contains it. */
  filter?: (item: T, query: string) => boolean;
  /** A group label per item ("Your assets", "All assets"); first-seen order. */
  groupBy?: (item: T) => string | null | undefined;
  /** Same as `groupBy` (the name the design brief used). */
  groups?: (item: T) => string | null | undefined;
  onSelect: (item: T) => void;
  /** The element that opens the picker. */
  trigger: ReactElement;
  /** Key of the selected item (shows a check, aria-selected). */
  value?: string | null;
  isDisabled?: (item: T) => boolean;
  /** Sheet title on phones and the list's accessible name. */
  title: string;
  placeholder?: string;
  emptyText?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Popover width in px (default 360). */
  width?: number;
  /** List height cap in px on desktop (default 340). */
  maxHeight?: number;
  /** Rows rendered at most (default 400). */
  limit?: number;
  footer?: ReactNode;
  align?: "start" | "center" | "end";
}

type Row<T> = { kind: "group"; label: string; key: string } | { kind: "item"; item: T; index: number; key: string };

export function Combobox<T>({
  items,
  getKey,
  renderItem,
  filter,
  groupBy: groupByProp,
  groups,
  onSelect,
  trigger,
  value,
  isDisabled,
  title,
  placeholder = "Search",
  emptyText = "No matches",
  open: openProp,
  onOpenChange,
  width = 360,
  maxHeight = 340,
  limit = 400,
  footer,
  align = "start",
}: ComboboxProps<T>) {
  const groupBy = groupByProp ?? groups;
  const phone = useIsPhone();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [openState, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const open = openProp ?? openState;

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
    if (next) {
      // Start on the current choice: Enter keeps it, and the list opens
      // scrolled to it (see revealActive) instead of at the top.
      const current = value === undefined || value === null ? -1 : items.findIndex((item) => getKey(item) === value);
      setActive(current >= 0 && current < limit ? current : 0);
    } else {
      setQuery("");
      setActive(0);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => (filter ? filter(item, q) : getKey(item).toLowerCase().includes(q)));
  }, [items, query, filter, getKey]);

  const shown = filtered.length > limit ? filtered.slice(0, limit) : filtered;

  const rows = useMemo<Row<T>[]>(() => {
    if (!groupBy) return shown.map((item, index) => ({ kind: "item", item, index, key: getKey(item) }));
    const order: string[] = [];
    const buckets = new Map<string, number[]>();
    shown.forEach((item, index) => {
      const label = groupBy(item) ?? "";
      if (!buckets.has(label)) {
        buckets.set(label, []);
        order.push(label);
      }
      buckets.get(label)?.push(index);
    });
    const out: Row<T>[] = [];
    for (const label of order) {
      if (label) out.push({ kind: "group", label, key: `group:${label}` });
      for (const index of buckets.get(label) ?? []) {
        const item = shown[index] as T;
        out.push({ kind: "item", item, index, key: getKey(item) });
      }
    }
    return out;
  }, [shown, groupBy, getKey]);

  // Keyboard order follows the rendered (grouped) order, not the input order.
  const order = useMemo(() => rows.flatMap((row) => (row.kind === "item" ? [row.index] : [])), [rows]);
  const disabledAt = (index: number) => {
    const item = shown[index];
    return item === undefined || (isDisabled?.(item) ?? false);
  };
  const optionId = (index: number) => `${listId}-option-${index}`;

  const move = (to: number) => {
    setActive(to);
    document.getElementById(optionId(to))?.scrollIntoView({ block: "nearest" });
  };

  /** Called once the list is in the DOM (open auto-focus). */
  const revealActive = () => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  };

  const pick = (index: number) => {
    const item = shown[index];
    if (item === undefined || disabledAt(index)) return;
    onSelect(item);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (order.length === 0) return;
    const position = Math.max(0, order.indexOf(active));
    let target: number | null = null;
    const step = (dir: 1 | -1, from: number) => {
      for (let i = 1; i <= order.length; i += 1) {
        const candidate = order[(((from + dir * i) % order.length) + order.length) % order.length];
        if (candidate !== undefined && !disabledAt(candidate)) return candidate;
      }
      return null;
    };
    switch (event.key) {
      case "ArrowDown":
        target = step(1, position);
        break;
      case "ArrowUp":
        target = step(-1, position);
        break;
      case "Home":
        target = step(1, -1);
        break;
      case "End":
        target = step(-1, order.length);
        break;
      case "Enter":
        event.preventDefault();
        pick(active);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (target !== null) move(target);
  };

  const activeVisible = order.includes(active);

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("shrink-0", phone ? "pb-2" : "border-b border-[var(--d-hairline)] p-2")}>
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={(next) => {
            setQuery(next);
            setActive(0);
          }}
          placeholder={placeholder}
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeVisible ? optionId(active) : undefined}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        role="listbox"
        id={listId}
        aria-label={title}
        className={cn("d-scroll min-h-0 overflow-y-auto overscroll-contain", phone ? "flex-1" : "p-1")}
        style={phone ? undefined : { maxHeight }}
      >
        {rows.map((row) => {
          if (row.kind === "group") {
            return (
              <div key={row.key} role="presentation" className="d-label px-2.5 pb-1 pt-2.5">
                {row.label}
              </div>
            );
          }
          const disabled = disabledAt(row.index);
          const selected = value !== undefined && value !== null && row.key === value;
          const isActive = row.index === active;
          return (
            <div
              key={row.key}
              id={optionId(row.index)}
              role="option"
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              data-active={isActive || undefined}
              onMouseMove={() => {
                if (!disabled && active !== row.index) setActive(row.index);
              }}
              onClick={() => pick(row.index)}
              className={cn(
                "flex min-h-[40px] cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13.5px] text-fg",
                "data-[active]:bg-[var(--d-glass-2)]",
                disabled && "cursor-default opacity-45",
              )}
            >
              <div className="min-w-0 flex-1">{renderItem(row.item, { active: isActive, selected, disabled })}</div>
              {selected ? <Icon name="check" size={16} className="shrink-0 text-[var(--d-accent-text)]" /> : null}
            </div>
          );
        })}
        {shown.length === 0 ? <div className="px-3 py-8 text-center text-[13px] text-fg-dim">{emptyText}</div> : null}
        {filtered.length > shown.length ? (
          <div className="px-3 py-2 text-[12px] text-fg-dim">
            Showing {shown.length.toLocaleString("en-US")} of {filtered.length.toLocaleString("en-US")}. Keep typing to narrow.
          </div>
        ) : null}
      </div>
      {footer ? <div className="shrink-0 border-t border-[var(--d-hairline)] p-2">{footer}</div> : null}
    </div>
  );

  return (
    <>
      <PopoverRoot open={open && !phone} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {!phone ? (
          <PopoverContent
            align={align}
            sideOffset={6}
            collisionPadding={12}
            // Default focus (the search field, the first focusable) stays;
            // this only scrolls the current choice into view.
            onOpenAutoFocus={revealActive}
            style={{ width }}
            className={cn(
              "d-pop z-[60] flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[var(--d-radius-inner)] p-0",
              // Never taller than the room Radix measured beside the trigger:
              // in a short window (or a sheet low on the page) the list,
              // which can shrink (min-h-0), scrolls instead of the popover
              // running off-screen with its footer.
              "max-h-[var(--radix-popover-content-available-height)]",
              "border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] text-fg shadow-[var(--d-pop-shadow)]",
            )}
          >
            {panel}
          </PopoverContent>
        ) : null}
      </PopoverRoot>
      {phone ? (
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          side="bottom"
          bodyClassName="flex flex-col px-3 pb-3"
          className="h-[85dvh]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
            revealActive();
          }}
        >
          {panel}
        </Sheet>
      ) : null}
    </>
  );
}
