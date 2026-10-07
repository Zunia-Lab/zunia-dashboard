"use client";

/**
 * Button and IconButton at desktop density: 32 / 36 / 40px controls with a
 * 10px radius (touch sizes on phones come from the --d-ctl-* tokens), where
 * the @zunialab/ui button is a 44px pill sized for the popup.
 *
 * Primary is the crimson `--z-button-gradient` with white text (8.5:1 and
 * up), never the bright brand ramp: white on the ramp's gold end is 1.6:1.
 */

import Link from "next/link";
import { isValidElement, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Overlay";
import { Slot } from "./Slot";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE = cn(
  "d-hit relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap",
  "rounded-[var(--d-radius-control)] font-medium tracking-[-0.01em]",
  "transition-[background-color,border-color,color,box-shadow,filter,opacity] duration-[160ms] ease-[var(--d-ease)]",
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
  "aria-busy:cursor-progress",
);

const SIZE: Record<ButtonSize, string> = {
  sm: "h-[var(--d-ctl-sm)] gap-1.5 px-3 text-[13px]",
  md: "h-[var(--d-ctl-md)] gap-2 px-3.5 text-[14px]",
  lg: "h-[var(--d-ctl-lg)] gap-2 px-4 text-[14.5px]",
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-[image:var(--z-button-gradient)] text-[var(--z-button-fg)]",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(60,4,8,0.24)]",
    "hover:brightness-[1.12] active:brightness-95",
  ),
  secondary: cn(
    "border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] text-fg",
    "hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass-2)] active:bg-[var(--d-glass-2)]",
  ),
  outline: cn(
    "border border-[var(--d-control-line)] bg-transparent text-fg",
    "hover:bg-[var(--d-glass)] active:bg-[var(--d-glass-2)]",
  ),
  ghost: cn("bg-transparent text-fg-muted", "hover:bg-[var(--d-glass-2)] hover:text-fg active:bg-[var(--d-glass-2)]"),
  danger: cn(
    "border border-[var(--z-danger-line)] bg-[var(--z-danger-fill)] text-[var(--z-danger)]",
    "hover:bg-[color-mix(in_srgb,var(--z-danger)_16%,transparent)] active:bg-[color-mix(in_srgb,var(--z-danger)_22%,transparent)]",
  ),
};

/** An icon by name from the kit's icon set, or any element. */
export type IconSlot = IconName | ReactElement;

function renderIcon(icon: IconSlot | undefined, size: number): ReactNode {
  if (icon === undefined) return null;
  if (isValidElement(icon)) return icon;
  return <Icon name={icon as IconName} size={size} className="shrink-0" />;
}

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("d-spinner", className)}
      style={{ width: size, height: size, borderWidth: size <= 12 ? 1.5 : 2 }}
    />
  );
}

type NativeButtonProps = Omit<ComponentPropsWithRef<"button">, "children">;

export interface ButtonProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks; the label stays. */
  loading?: boolean;
  iconLeft?: IconSlot;
  iconRight?: IconSlot;
  /** Render as a link: next/link for app paths, a new tab for http(s) URLs. */
  href?: string;
  /** Force `href` to open in a new tab with rel=noopener. */
  external?: boolean;
  /**
   * Merge the button's classes and props into the single child element
   * instead (a custom link, a label). The child brings its own content:
   * `iconLeft`, `iconRight`, `loading` and `disabled` do not apply.
   */
  asChild?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  iconLeft,
  iconRight,
  href,
  external,
  asChild,
  fullWidth,
  className,
  disabled,
  type = "button",
  children,
  ref,
  ...rest
}: ButtonProps) {
  // Busy is not unavailable: a loading button keeps full strength (spinner,
  // aria-busy) while its disabled state blocks a second submit.
  const classes = cn(BASE, SIZE[size], BUTTON_VARIANTS[variant], fullWidth && "w-full", loading && "disabled:opacity-100", className);
  const iconSize = ICON_SIZE[size];
  const content = (
    <>
      {loading ? <Spinner size={iconSize - 2} /> : renderIcon(iconLeft, iconSize)}
      {children}
      {renderIcon(iconRight, iconSize)}
    </>
  );

  if (asChild) {
    return (
      <Slot ref={ref as never} className={classes} {...(rest as Record<string, unknown>)}>
        {children}
      </Slot>
    );
  }

  // A disabled link is not a thing: render a disabled button so it cannot
  // be followed and assistive tech hears "dimmed".
  if (href && !disabled && !loading) {
    const isExternal = external ?? /^https?:\/\//.test(href);
    const linkProps = rest as unknown as ComponentPropsWithRef<"a">;
    if (isExternal) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...linkProps} ref={ref as never}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...linkProps} ref={ref as never}>
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {content}
    </button>
  );
}

export interface IconButtonProps extends NativeButtonProps {
  /** Required accessible name; also the default tooltip. */
  label: string;
  icon?: IconSlot;
  /** Tooltip text; defaults to `label`. `false` for none. */
  tooltip?: ReactNode | false;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  size?: ButtonSize;
  variant?: ButtonVariant;
  loading?: boolean;
  href?: string;
  external?: boolean;
  /** Pressed state for toggles (privacy eye, star). */
  pressed?: boolean;
  children?: ReactNode;
}

const ICON_BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "size-[var(--d-ctl-sm)]",
  md: "size-[var(--d-ctl-md)]",
  lg: "size-[var(--d-ctl-lg)]",
};

/** A square icon-only button with a required label and a tooltip. */
export function IconButton({
  label,
  icon,
  tooltip,
  tooltipSide = "top",
  size = "md",
  variant = "ghost",
  loading,
  href,
  external,
  pressed,
  className,
  disabled,
  type = "button",
  children,
  ref,
  ...rest
}: IconButtonProps) {
  const classes = cn(
    BASE,
    ICON_BUTTON_SIZE[size],
    "px-0",
    BUTTON_VARIANTS[variant],
    pressed && "bg-[var(--d-glass-2)] text-fg",
    loading && "disabled:opacity-100",
    className,
  );
  const glyph = loading ? <Spinner size={ICON_SIZE[size] - 2} /> : (children ?? renderIcon(icon, size === "sm" ? 16 : 18));

  let control: ReactElement;
  if (href && !disabled) {
    const isExternal = external ?? /^https?:\/\//.test(href);
    const linkProps = rest as unknown as ComponentPropsWithRef<"a">;
    control = isExternal ? (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={classes} {...linkProps} ref={ref as never}>
        {glyph}
      </a>
    ) : (
      <Link href={href} aria-label={label} className={classes} {...linkProps} ref={ref as never}>
        {glyph}
      </Link>
    );
  } else {
    control = (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={classes}
        {...rest}
      >
        {glyph}
      </button>
    );
  }

  if (tooltip === false) return control;
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {control}
    </Tooltip>
  );
}
