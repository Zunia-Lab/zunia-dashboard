"use client";

/**
 * Cards and sections: the page's building blocks.
 *
 * Card is the surface (spec §3: card fill, 1px hairline, 16px radius,
 * 16px padding, 20px from 1536). CardHeader is the title row with controls on
 * the right; CardBody holds content and can bleed to the card's edges
 * (`flush`) for tables and lists; CardFooter is a quiet bottom row.
 *
 * Headings follow the page outline without each caller counting levels:
 * the top bar owns the page's h1, a PageSection title is an h2, and a card
 * title is an h2 on its own or an h3 inside a PageSection.
 */

import Link from "next/link";
import { createContext, useContext, useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Spinner } from "./Button";
import { InfoTip } from "./Overlay";

type HeadingTag = "h2" | "h3" | "h4";

const HeadingLevel = createContext<HeadingTag>("h2");

interface CardState {
  pending: boolean;
}

const CardContext = createContext<CardState>({ pending: false });

export type CardVariant = "default" | "hero" | "inset" | "interactive";

export interface CardProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  /**
   * - `default`: card fill, hairline, 16px radius.
   * - `hero`: the same plus the brand bloom (top right) and faint grain.
   * - `inset`: a block nested inside a card: raised fill, 12px radius.
   * - `interactive`: hover lift and pointer; pair with `href` or `onClick`.
   */
  variant?: CardVariant;
  /** `default` pads by --d-pad (16 / 20px); `none` for edge-to-edge content. */
  padding?: "default" | "none";
  /** Makes the whole card a link (an `interactive` card). */
  href?: string;
  /**
   * A refetch is in flight: the body dims to 60% and the header shows a
   * spinner, while the previous numbers stay readable (spec §3).
   */
  pending?: boolean;
  /** Render as a section landmark with this element type. */
  as?: "div" | "section" | "article" | "li";
}

export function Card({ variant = "default", padding = "default", href, pending = false, as = "div", className, children, ...rest }: CardProps) {
  const interactive = variant === "interactive" || Boolean(href);
  const classes = cn(
    "relative flex min-w-0 flex-col gap-3 text-fg [overflow:clip]",
    variant === "inset"
      ? "rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)]"
      : "d-card",
    variant === "hero" && "d-card-hero",
    padding === "default" && (variant === "inset" ? "p-3.5" : "p-[var(--d-pad)]"),
    interactive &&
      "cursor-pointer transition-[border-color,background-color,box-shadow] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-card-hover)]",
    className,
  );
  const body = <CardContext.Provider value={{ pending }}>{children}</CardContext.Provider>;

  if (href) {
    return (
      <Link
        href={href}
        className={cn(classes, "no-underline")}
        data-pending={pending || undefined}
        {...(rest as Omit<ComponentPropsWithRef<"a">, "href">)}
      >
        {body}
      </Link>
    );
  }
  // One element type for the type checker: the props are a div's either way.
  const Tag = as as "div";
  return (
    <Tag className={classes} data-pending={pending || undefined} aria-busy={pending || undefined} {...(rest as ComponentPropsWithRef<"div">)}>
      {body}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  /** One line under the title in dim text (a caption, a period, a source). */
  subtitle?: ReactNode;
  icon?: IconName;
  /** Right side: segmented range, menu, buttons. */
  actions?: ReactNode;
  /** An (i) next to the title with this explanation. */
  info?: ReactNode;
  /** Overrides the automatic heading level. */
  titleAs?: HeadingTag;
  /** Shows the refetch spinner even outside a pending Card. */
  refreshing?: boolean;
  id?: string;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, actions, info, titleAs, refreshing, id, className }: CardHeaderProps) {
  const level = useContext(HeadingLevel);
  const { pending } = useContext(CardContext);
  const heading = titleAs ?? level;
  const busy = refreshing ?? pending;
  return (
    // Wraps: on a narrow card the actions drop under the title instead of
    // squeezing it into a column of single words.
    <div className={cn("flex min-h-[28px] flex-wrap items-start gap-x-3 gap-y-2", className)}>
      {icon ? (
        <span className="mt-[1px] flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--d-glass)] text-fg-muted">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <div className="min-w-0 flex-[1_1_10rem]">
        <div className="flex min-h-[28px] items-center gap-1.5">
          <HeadingText as={heading} id={id} className="truncate text-[length:var(--d-type-card-title)] font-medium leading-snug tracking-[-0.015em] text-fg">
            {title}
          </HeadingText>
          {info ? <InfoTip content={info} /> : null}
          {/* Not a live region: a dashboard that polls would otherwise say
              "Refreshing" for every card every 30 s. The card itself carries
              aria-busy while pending. */}
          {busy ? (
            <>
              <Spinner size={12} className="ml-0.5 text-fg-dim" />
              <span className="sr-only">Refreshing</span>
            </>
          ) : null}
        </div>
        {subtitle ? <p className="-mt-0.5 text-[12.5px] leading-snug text-fg-dim">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
}

/** h2 / h3 / h4 by name, without a component created during render. */
function HeadingText({ as, id, className, children }: { as: HeadingTag; id?: string; className?: string; children: ReactNode }) {
  if (as === "h3") return <h3 id={id} className={className}>{children}</h3>;
  if (as === "h4") return <h4 id={id} className={className}>{children}</h4>;
  return <h2 id={id} className={className}>{children}</h2>;
}

export interface CardBodyProps extends ComponentPropsWithRef<"div"> {
  /** Bleed to the card's left, right (and top/bottom when first/last) edges. */
  flush?: boolean;
}

export function CardBody({ flush, className, ...rest }: CardBodyProps) {
  return <div className={cn("d-card-body min-w-0", flush && "d-card-flush", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "-mx-[var(--d-pad)] -mb-[var(--d-pad)] mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-3 text-[13px] text-fg-dim",
        className,
      )}
      {...rest}
    />
  );
}

export interface PageSectionProps extends Omit<ComponentPropsWithRef<"section">, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** An (i) next to the title. */
  info?: ReactNode;
}

/** A titled group of cards (h2), with cards inside titled h3. */
export function PageSection({ title, subtitle, actions, info, className, children, ...rest }: PageSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3", className)} {...rest}>
      {/* Actions centre on a lone title line; with a subtitle they sit on
          the block's last line, as before. Bottom-aligned next to a single
          line they rode 4-7px above the heading's centre. */}
      <div className={cn("flex flex-wrap justify-between gap-x-4 gap-y-2", subtitle ? "items-end" : "items-center")}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 id={id} className="text-[16px] font-semibold leading-snug tracking-[-0.02em] text-fg">
              {title}
            </h2>
            {info ? <InfoTip content={info} /> : null}
          </div>
          {subtitle ? <p className="mt-0.5 text-[13px] text-fg-dim">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <HeadingLevel.Provider value="h3">{children}</HeadingLevel.Provider>
    </section>
  );
}

/** The mono caps label (11px JetBrains Mono, 0.08em, fg-dim). */
export function SectionLabel({ className, ...rest }: ComponentPropsWithRef<"div">) {
  return <div className={cn("d-label", className)} {...rest} />;
}

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  /** Bleed across the parent card's padding. */
  flush?: boolean;
}

export function Divider({ orientation = "horizontal", flush, className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--d-hairline)]",
        orientation === "horizontal" ? "h-px w-auto" : "w-px self-stretch",
        flush && orientation === "horizontal" && "-mx-[var(--d-pad)]",
        className,
      )}
    />
  );
}
