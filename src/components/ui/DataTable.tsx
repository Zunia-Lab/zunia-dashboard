"use client";

/**
 * DataTable: the dashboard's one table.
 *
 * - Sorting by header (aria-sort), unknown values always last
 *   (`table-sort.ts`); controlled or uncontrolled.
 * - Sticky header. While the table fits its box, the scroller is not a
 *   scroll container, so the header sticks to the page as it scrolls; when
 *   columns overflow, the table scrolls sideways under a 6px bar with edge
 *   fades (and an optional sticky first column).
 * - Figures: every cell uses tabular digits; right-aligned columns line up.
 * - Rows: hover, selected (tint + accent edge), click / link with a single
 *   tab stop and arrow-key navigation, Cmd/Ctrl-click opens a new tab,
 *   expandable detail rows.
 * - States: skeleton rows on first load, a compact empty state.
 * - Phones: an optional card layout (`mobileCard`) under 640px, with a sort
 *   control, instead of a squeezed table. The server render (and the
 *   hydrating one) carries both layouts and lets CSS pick, since it cannot
 *   know the screen; once hydrated only the layout on screen is built. On a
 *   phone the hidden desktop table was over half the page's DOM (/markets:
 *   2,487 of 4,265 nodes, 270 sparkline SVGs), rebuilt on every poll.
 *
 * Place it in a Card inside a flush CardBody so its edge padding lines up
 * with the card header.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { EmptyState, Skeleton } from "./Feedback";
import { nextSort, sortRows, type SortState, type SortValue } from "./table-sort";

export type { SortDir, SortState } from "./table-sort";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  /** The value sorted on (defaults to nothing: a sortable column needs it). */
  sortValue?: (row: T) => SortValue;
  /** First click sorts descending. Default: true for right-aligned columns. */
  sortDescFirst?: boolean;
  width?: number | string;
  minWidth?: number | string;
  /** Hide the column under this breakpoint (sm 640, md 768, lg 1024, xl 1280). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /**
   * Keep the column pinned left while the table scrolls sideways. Meant for
   * the first column (the expand toggle, when present, pins with it).
   */
  sticky?: boolean;
  /** Extra classes for this column's cells. */
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  /** The table's accessible name ("Assets", "Validators on Osmosis"). */
  ariaLabel: string;
  onRowClick?: (row: T) => void;
  /** Rows link here (next/router; Cmd/Ctrl-click opens a new tab). */
  rowHref?: (row: T) => string | null | undefined;
  /** First load: skeleton rows while `rows` is empty. A refetch keeps rows. */
  loading?: boolean;
  skeletonRows?: number;
  /** Shown when there are no rows (default: a compact "Nothing to show"). */
  empty?: ReactNode;
  /** comfortable 44px rows (default) or compact 36px. */
  density?: "compact" | "comfortable";
  initialSort?: SortState;
  /** Controlled sort; pair with onSortChange. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** The caller sorts (server-side); the table only reports header clicks. */
  manualSort?: boolean;
  /** Sticky header (default true). */
  stickyHeader?: boolean;
  /** Scroll the body inside this height instead of with the page. */
  maxHeight?: number | string;
  renderExpanded?: (row: T) => ReactNode;
  /** Which rows can expand (default: all, when renderExpanded is set). */
  isExpandable?: (row: T) => boolean;
  /**
   * Card layout under 640px. With `rowHref` each card is a link, with
   * `onRowClick` a button: its content must then hold no buttons or links of
   * its own (put row actions in the desktop columns or the detail view).
   */
  mobileCard?: (row: T) => ReactNode;
  /** Under the table: totals, "Show all", pagination. */
  footer?: ReactNode;
  selectedRowKey?: string | null;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

const HIDE_BELOW = {
  sm: "max-sm:hidden",
  md: "max-md:hidden",
  lg: "max-lg:hidden",
  xl: "max-xl:hidden",
} as const;

/** Width of the expand-toggle column, px. */
const EXPANDER_WIDTH = 40;

/** Which layouts are built: both until hydrated (CSS picks), then one. */
type Layout = "table" | "cards" | "both";

/**
 * Tailwind's `sm` as the compiled CSS writes it: 40rem, not 640px. A rem in a
 * media query follows the browser's default font size, so with a 20px default
 * a 700px window is a phone to the CSS; JS must agree, or it would build only
 * the table while the CSS hides it.
 */
const WIDE_QUERY = "(min-width: 40rem)";

function subscribeWide(onChange: () => void): () => void {
  const list = window.matchMedia(WIDE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** A table without cards never switches layout: nothing to listen to. */
const subscribeNever = (): (() => void) => () => {};
const readLayout = (): Layout => (window.matchMedia(WIDE_QUERY).matches ? "table" : "cards");
const bothLayouts = (): Layout => "both";

/** Clicks on these inside a row are theirs, not the row's. */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role='button'],[role='menuitem'],[data-row-action]";

function lengthStyle(width?: number | string, minWidth?: number | string): CSSProperties | undefined {
  if (width === undefined && minWidth === undefined) return undefined;
  return { width, minWidth };
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  ariaLabel,
  onRowClick,
  rowHref,
  loading,
  skeletonRows = 6,
  empty,
  density = "comfortable",
  initialSort,
  sort: sortProp,
  onSortChange,
  manualSort,
  stickyHeader = true,
  maxHeight,
  renderExpanded,
  isExpandable,
  mobileCard,
  footer,
  selectedRowKey,
  rowClassName,
  className,
}: DataTableProps<T>) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const prefetched = useRef(new Set<string>());
  const detailsId = useId();

  const [sortState, setSortState] = useState<SortState | null>(initialSort ?? null);
  const sort = sortProp !== undefined ? sortProp : sortState;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focusRow, setFocusRow] = useState(0);

  // Server and hydrating render: "both", so the markup matches and CSS picks.
  // Without cards the snapshot stays "both" (the table is the only layout),
  // so a card-less table pays no extra render after hydration.
  const layout = useSyncExternalStore(
    mobileCard ? subscribeWide : subscribeNever,
    mobileCard ? readLayout : bothLayouts,
    bothLayouts,
  );
  const showTable = layout !== "cards";
  const showCards = Boolean(mobileCard) && layout !== "table";

  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  const sorted = useMemo(() => {
    if (manualSort || !sort || !sortColumn?.sortValue) return rows;
    return sortRows(rows, sortColumn.sortValue, sort.dir);
  }, [rows, sort, sortColumn, manualSort]);

  const interactive = Boolean(onRowClick || rowHref || renderExpanded);
  const hasSticky = columns.some((column) => column.sticky);
  // With an expand toggle in front, a pinned column sits after it, and the
  // toggle pins too so the two never overlap while scrolling sideways.
  const stickyLeft = renderExpanded ? EXPANDER_WIDTH : 0;
  const stickyStyle = (column: Column<T>): CSSProperties | undefined => (column.sticky ? { left: stickyLeft } : undefined);
  const expandable = (row: T) => Boolean(renderExpanded) && (isExpandable?.(row) ?? true);
  const columnCount = columns.length + (renderExpanded ? 1 : 0);

  const changeSort = (column: Column<T>) => {
    const next = nextSort(sort, column.key, column.sortDescFirst ?? column.align === "right");
    if (sortProp === undefined) setSortState(next);
    onSortChange?.(next);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activate = (row: T, key: string, event?: MouseEvent | KeyboardEvent) => {
    const href = rowHref?.(row);
    if (href) {
      const newTab = event && ("metaKey" in event) && (event.metaKey || event.ctrlKey);
      if (newTab) window.open(href, "_blank", "noopener");
      else router.push(href);
      return;
    }
    if (onRowClick) {
      onRowClick(row);
      return;
    }
    if (expandable(row)) toggleExpanded(key);
  };

  /**
   * True when the click is not the row's own: it landed on a control inside
   * the row, or outside the row's DOM altogether. React bubbles events
   * through portals along the component tree, so a click on an item of a
   * menu or popover opened from a row reaches the row's handler although the
   * item is rendered at the end of <body>; without this check, choosing
   * "Delegate more" in a row's menu also navigated to the row's page.
   */
  const notTheRows = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Node;
    if (!event.currentTarget.contains(target)) return true;
    const hit = target instanceof Element ? target.closest(INTERACTIVE) : null;
    return hit !== null && hit !== event.currentTarget && event.currentTarget.contains(hit);
  };

  const onRowMouseClick = (event: MouseEvent<HTMLElement>, row: T, key: string) => {
    if (notTheRows(event)) return;
    activate(row, key, event);
  };

  const onRowAuxClick = (event: MouseEvent<HTMLElement>, row: T) => {
    const href = rowHref?.(row);
    if (event.button !== 1 || !href || notTheRows(event)) return;
    window.open(href, "_blank", "noopener");
  };

  const prefetch = (row: T) => {
    const href = rowHref?.(row);
    if (!href || prefetched.current.has(href)) return;
    prefetched.current.add(href);
    router.prefetch(href);
  };

  const onBodyKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = event.target as HTMLElement;
    // Keys pressed in a portal (a row's open menu) bubble here too.
    if (target.tagName !== "TR" || !event.currentTarget.contains(target)) return;
    const all = Array.from(tbodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
    const index = all.indexOf(target as HTMLTableRowElement);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(all.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      target.click();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    all[next]?.focus();
  };

  // Overflow and scroll edges are written straight to the DOM: they change
  // on every scroll frame and nothing in React's output depends on them.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    const update = () => {
      const overflow = scroller.scrollWidth > scroller.clientWidth + 1;
      if (maxHeight === undefined) scroller.toggleAttribute("data-fits", !overflow);
      const left = scroller.scrollLeft;
      root.toggleAttribute("data-scroll-left", overflow && left > 1);
      root.toggleAttribute("data-scroll-right", overflow && left + scroller.clientWidth < scroller.scrollWidth - 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    const table = scroller.firstElementChild;
    if (table) observer.observe(table);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", update);
    };
    // `showTable`: a table built after a rotation from cards (or rebuilt
    // after one) needs its observer and `data-fits`, or its header stops
    // sticking and the edge fades never show.
  }, [maxHeight, columns.length, showTable]);

  const showSkeleton = loading && rows.length === 0;
  const focusIndex = Math.min(focusRow, Math.max(0, sorted.length - 1));

  const header = (
    <thead>
      <tr>
        {renderExpanded ? (
          // Text, not aria-label: an empty header cell fails axe's
          // empty-table-header whatever its label says.
          <th data-sticky-col={hasSticky || undefined} style={{ width: EXPANDER_WIDTH, left: 0 }} className="!pr-0">
            <span className="sr-only">Details</span>
          </th>
        ) : null}
        {columns.map((column) => {
          const active = sort?.key === column.key;
          const ariaSort = column.sortable ? (active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none") : undefined;
          return (
            <th
              key={column.key}
              scope="col"
              aria-sort={ariaSort}
              data-align={column.align}
              data-sticky-col={column.sticky || undefined}
              data-sticky-edge={column.sticky || undefined}
              style={{ ...lengthStyle(column.width, column.minWidth), ...stickyStyle(column) }}
              className={cn(column.hideBelow && HIDE_BELOW[column.hideBelow], column.headerClassName)}
            >
              {column.sortable ? (
                <button type="button" className="d-th-sort" data-active={active || undefined} onClick={() => changeSort(column)}>
                  <span>{column.header}</span>
                  <Icon
                    name={active ? (sort?.dir === "asc" ? "chevronUp" : "chevronDown") : "chevronsUpDown"}
                    size={12}
                    strokeWidth={2}
                    className={cn("shrink-0", !active && "opacity-50")}
                  />
                </button>
              ) : (
                column.header
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );

  let body: ReactNode;
  if (showSkeleton) {
    body = Array.from({ length: skeletonRows }, (_, rowIndex) => (
      <tr key={`skeleton-${rowIndex}`} aria-hidden>
        {renderExpanded ? <td data-sticky-col={hasSticky || undefined} style={{ left: 0 }} /> : null}
        {columns.map((column, columnIndex) => (
          <td key={column.key} data-align={column.align} className={cn(column.hideBelow && HIDE_BELOW[column.hideBelow])}>
            <SkeletonCell align={column.align} first={columnIndex === 0} seed={rowIndex + columnIndex} />
          </td>
        ))}
      </tr>
    ));
  } else if (sorted.length === 0) {
    body = (
      <tr>
        <td colSpan={columnCount} className="!h-auto">
          {empty ?? <EmptyState title="Nothing to show" body="There are no rows for this view yet." />}
        </td>
      </tr>
    );
  } else {
    body = sorted.map((row, index) => {
      const key = getRowKey(row, index);
      const canExpand = expandable(row);
      const open = canExpand && expanded.has(key);
      const selected = selectedRowKey !== undefined && selectedRowKey !== null && selectedRowKey === key;
      return (
        <Fragment key={key}>
        <tr
          data-row=""
          data-interactive={interactive || undefined}
          data-selected={selected || undefined}
          data-expanded={open || undefined}
          tabIndex={interactive ? (index === focusIndex ? 0 : -1) : undefined}
          onFocus={interactive ? () => setFocusRow(index) : undefined}
          onClick={interactive ? (event) => onRowMouseClick(event, row, key) : undefined}
          onAuxClick={rowHref ? (event) => onRowAuxClick(event, row) : undefined}
          onPointerEnter={rowHref ? () => prefetch(row) : undefined}
          className={rowClassName?.(row)}
        >
          {renderExpanded ? (
            <td className="!pr-0" data-sticky-col={hasSticky || undefined} style={{ left: 0 }}>
              {canExpand ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? `${detailsId}-${index}` : undefined}
                  aria-label={open ? "Hide details" : "Show details"}
                  onClick={() => toggleExpanded(key)}
                  className="d-hit inline-flex size-6 items-center justify-center rounded-[6px] text-fg-dim hover:bg-[var(--d-glass-2)] hover:text-fg focus-visible:outline-offset-0"
                >
                  <Icon name="chevronRight" size={14} strokeWidth={2} className={cn("transition-transform duration-[160ms]", open && "rotate-90")} />
                </button>
              ) : null}
            </td>
          ) : null}
          {columns.map((column) => (
            <td
              key={column.key}
              data-align={column.align}
              data-sticky-col={column.sticky || undefined}
              data-sticky-edge={column.sticky || undefined}
              style={{ ...lengthStyle(undefined, column.minWidth), ...stickyStyle(column) }}
              className={cn(column.hideBelow && HIDE_BELOW[column.hideBelow], column.className)}
            >
              {column.cell(row, index)}
            </td>
          ))}
        </tr>
        {open ? (
          <tr id={`${detailsId}-${index}`} className="d-row-expanded">
            <td colSpan={columnCount}>{renderExpanded?.(row)}</td>
          </tr>
        ) : null}
        </Fragment>
      );
    });
  }

  const table = showTable ? (
    <div
      ref={rootRef}
      // Hidden on phones only while both layouts are built (before hydration).
      className={cn("d-table-root", layout === "both" && mobileCard && "max-sm:hidden")}
      data-has-sticky={hasSticky || undefined}
    >
      <div
        ref={scrollRef}
        className={cn("d-table-scroll d-scroll", maxHeight !== undefined && "overflow-y-auto")}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        <table
          className="d-table"
          aria-label={ariaLabel}
          aria-busy={loading || undefined}
          data-density={density}
          data-sticky-header={stickyHeader || undefined}
          style={maxHeight !== undefined ? ({ "--d-sticky-top": "0px" } as CSSProperties) : undefined}
        >
          {header}
          <tbody ref={tbodyRef} onKeyDown={interactive ? onBodyKeyDown : undefined}>
            {body}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <div className={cn("min-w-0", className)}>
      {table}
      {mobileCard && showCards ? (
        <MobileCards
          hideOnWide={layout === "both"}
          rows={sorted}
          loading={showSkeleton}
          skeletonRows={skeletonRows}
          empty={empty}
          getRowKey={getRowKey}
          render={mobileCard}
          interactive={Boolean(onRowClick || rowHref)}
          hrefOf={rowHref}
          selectedRowKey={selectedRowKey}
          onActivate={(row, key, event) => activate(row, key, event)}
          ariaLabel={ariaLabel}
          sortable={columns.filter((column) => column.sortable)}
          sort={sort}
          onSort={(key) => {
            const column = columns.find((c) => c.key === key);
            if (column) changeSort(column);
          }}
        />
      ) : null}
      {footer ? <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-2.5 text-[13px] text-fg-dim">{footer}</div> : null}
    </div>
  );
}

function SkeletonCell({ align, first, seed }: { align?: "left" | "right" | "center"; first: boolean; seed: number }) {
  // Deterministic widths: varied enough to read as rows, stable across renders.
  const widths = [64, 88, 52, 76, 96, 58];
  const width = widths[seed % widths.length];
  if (first) {
    return (
      <span className="flex items-center gap-2.5">
        <Skeleton circle width={24} />
        <Skeleton className="h-3" width={width} />
      </span>
    );
  }
  return (
    <span className={cn("flex", align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start")}>
      <Skeleton className="h-3" width={Math.round((width ?? 64) * 0.75)} />
    </span>
  );
}

interface MobileCardsProps<T> {
  /** Both layouts are built (before hydration): CSS hides the cards on wide screens. */
  hideOnWide: boolean;
  rows: T[];
  loading?: boolean;
  skeletonRows: number;
  empty?: ReactNode;
  getRowKey: (row: T, index: number) => string;
  render: (row: T) => ReactNode;
  interactive: boolean;
  hrefOf?: (row: T) => string | null | undefined;
  selectedRowKey?: string | null;
  onActivate: (row: T, key: string, event: MouseEvent) => void;
  ariaLabel: string;
  sortable: Column<T>[];
  sort: SortState | null;
  onSort: (key: string) => void;
}

function MobileCards<T>({
  hideOnWide,
  rows,
  loading,
  skeletonRows,
  empty,
  getRowKey,
  render,
  interactive,
  hrefOf,
  selectedRowKey,
  onActivate,
  ariaLabel,
  sortable,
  sort,
  onSort,
}: MobileCardsProps<T>) {
  return (
    <div className={hideOnWide ? "sm:hidden" : undefined}>
      {sortable.length > 0 && rows.length > 1 ? (
        <div className="flex items-center justify-end gap-2 px-[var(--d-pad)] pb-2 text-[12.5px] text-fg-dim">
          <label className="flex items-center gap-1.5">
            Sort
            {/* The box is drawn by this wrapper, so the transparent <select>
                inside can be 44px tall on touch screens (spec §3: touch
                targets) while the control still looks 32px: a taller item
                in a fixed-height centred flex box overflows evenly. */}
            <span
              className={cn(
                "relative inline-flex h-8 items-center rounded-[8px] border border-[var(--d-control-line)] bg-[var(--d-input-bg)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--z-focus-ring)] has-[:focus-visible]:outline-solid",
              )}
            >
              <select
                value={sort?.key ?? ""}
                onChange={(event) => onSort(event.target.value)}
                className="h-full cursor-pointer appearance-none bg-transparent pl-2 pr-7 text-[13px] text-fg outline-none [@media(pointer:coarse)]:h-11"
              >
                {sort ? null : <option value="">Default</option>}
                {sortable.map((column) => (
                  <option key={column.key} value={column.key}>
                    {typeof column.header === "string" ? column.header : column.key}
                  </option>
                ))}
              </select>
              <Icon name="chevronsUpDown" size={13} className="pointer-events-none absolute right-2 text-fg-dim" />
            </span>
          </label>
          {sort ? (
            <button
              type="button"
              onClick={() => onSort(sort.key)}
              aria-label={sort.dir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
              className="d-hit inline-flex size-8 items-center justify-center rounded-[8px] border border-[var(--d-control-line)] text-fg-muted"
            >
              <Icon name={sort.dir === "asc" ? "arrowUp" : "arrowDown"} size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="d-table-cards" aria-label={ariaLabel} aria-busy={loading || undefined}>
        {loading
          ? Array.from({ length: Math.min(skeletonRows, 5) }, (_, index) => (
              <li key={`skeleton-${index}`} aria-hidden className="d-table-card flex items-center gap-3">
                <Skeleton circle width={32} />
                <span className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3" width="45%" />
                  <Skeleton className="h-2.5" width="30%" />
                </span>
                <Skeleton className="h-3" width={56} />
              </li>
            ))
          : null}
        {!loading && rows.length === 0 ? <li className="px-[var(--d-pad)]">{empty ?? <EmptyState title="Nothing to show" />}</li> : null}
        {!loading
          ? rows.map((row, index) => {
              const key = getRowKey(row, index);
              const selected = selectedRowKey !== undefined && selectedRowKey !== null && selectedRowKey === key;
              const href = hrefOf?.(row);
              return (
                <li key={key}>
                  {href ? (
                    // A real link: long-press "open in new tab" and the
                    // link role come with it.
                    <Link href={href} className="d-table-card" data-interactive="" data-selected={selected || undefined}>
                      {render(row)}
                    </Link>
                  ) : interactive ? (
                    <button
                      type="button"
                      className="d-table-card"
                      data-interactive=""
                      data-selected={selected || undefined}
                      onClick={(event) => {
                        // A click in a portal opened from the card (a tooltip,
                        // a hover card) bubbles here through React too.
                        if (event.currentTarget.contains(event.target as Node)) onActivate(row, key, event);
                      }}
                    >
                      {render(row)}
                    </button>
                  ) : (
                    <div className="d-table-card" data-selected={selected || undefined}>
                      {render(row)}
                    </div>
                  )}
                </li>
              );
            })
          : null}
      </ul>
    </div>
  );
}
