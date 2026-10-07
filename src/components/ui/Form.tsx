"use client";

/**
 * Form controls: Input, SearchInput, AmountInput, Select, Switch, Checkbox.
 *
 * Fields are 32 / 36 / 40px on desktop and a step taller on phones, where the
 * text is 16px so iOS does not zoom the page on focus. Focus is drawn on the
 * field's frame (border + soft ring), not on the bare <input> inside it.
 */

import {
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { MASK, formatAmount, formatFiat, formatTokenAmount, sanitizeDecimalInput } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { Kbd } from "./Badge";
import { composeRefs } from "./hooks";

type FieldSize = "sm" | "md" | "lg";

const FIELD_HEIGHT: Record<FieldSize, string> = {
  sm: "h-[var(--d-ctl-sm)]",
  md: "h-[var(--d-ctl-md)]",
  lg: "h-[var(--d-ctl-lg)]",
};

/**
 * The field frame: fill, edge, hover, focus ring, error state.
 *
 * The disabled look keys on the field's own control only. A bare
 * `:has(:disabled)` also matches a disabled <option> (every Select
 * placeholder is one) or a disabled button inside the frame (AmountInput's
 * Max), and then `pointer-events: none` turns a working field into a dead
 * one: clicks fall through and the native list never opens.
 */
export const FIELD_FRAME = cn(
  "flex min-w-0 items-center gap-2 rounded-[var(--d-radius-control)] border border-[var(--d-control-line)] bg-[var(--d-input-bg)] px-3",
  "transition-[border-color,box-shadow] duration-[160ms] ease-[var(--d-ease)]",
  "hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)]",
  "focus-within:border-[var(--z-focus-ring)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--z-focus-ring)_20%,transparent)]",
  "has-[:is(input,select,textarea):disabled]:pointer-events-none has-[:is(input,select,textarea):disabled]:opacity-50",
);

const FIELD_ERROR = "border-[var(--z-danger)] hover:border-[var(--z-danger)] focus-within:border-[var(--z-danger)] focus-within:shadow-[0_0_0_3px_var(--z-danger-fill)]";

const INPUT_TEXT = cn(
  "min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none max-sm:text-[16px]",
  "placeholder:text-[color-mix(in_srgb,var(--z-fg-dim)_80%,transparent)]",
);

interface FieldChromeProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right side of the label row (a balance, a link). */
  labelAside?: ReactNode;
  className?: string;
  children: ReactNode;
}

function FieldChrome({ id, label, hint, error, labelAside, className, children }: FieldChromeProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label || labelAside ? (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={id} className="text-[12.5px] font-medium text-fg-muted">
              {label}
            </label>
          ) : (
            <span />
          )}
          {labelAside ? <span className="text-[12.5px] text-fg-dim">{labelAside}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-[var(--z-danger)]">
          <Icon name="warning" size={14} className="mt-px shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] leading-snug text-fg-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ input */

export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  /** An error message; also sets aria-invalid. */
  error?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  size?: FieldSize;
  /** Monospace text (addresses, memos, hashes). */
  mono?: boolean;
  /** Class for the outer wrapper; `inputClassName` for the <input>. */
  className?: string;
  inputClassName?: string;
}

export function Input({ label, hint, error, leading, trailing, size = "md", mono, className, inputClassName, id, ...rest }: InputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldChrome id={fieldId} label={label} hint={hint} error={error} className={className}>
      <div className={cn(FIELD_FRAME, FIELD_HEIGHT[size], error && FIELD_ERROR)}>
        {leading ? <span className="flex shrink-0 items-center text-fg-dim">{leading}</span> : null}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(INPUT_TEXT, mono && "font-mono text-[13px] max-sm:text-[16px]", inputClassName)}
          {...rest}
        />
        {trailing ? <span className="flex shrink-0 items-center gap-1 text-fg-dim">{trailing}</span> : null}
      </div>
    </FieldChrome>
  );
}

/* ------------------------------------------------------------------ search */

export interface SearchInputProps extends Omit<ComponentPropsWithRef<"input">, "size" | "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** A key hint shown while the field is empty: "/" or "⌘K". */
  shortcutHint?: string;
  /** Called after the clear button or Escape empties the field. */
  onClear?: () => void;
  size?: FieldSize;
  className?: string;
}

/** A search field: icon, clear button, optional shortcut hint; Escape clears. */
export function SearchInput({
  value,
  onChange,
  shortcutHint,
  onClear,
  size = "md",
  placeholder = "Search",
  className,
  ref,
  onKeyDown,
  "aria-label": ariaLabel,
  ...rest
}: SearchInputProps) {
  const innerRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange("");
    onClear?.();
    innerRef.current?.focus();
  };
  return (
    // No role="search" here: a landmark per table filter would bury the page's
    // real search in landmark navigation. Wrap the main one in <search>.
    <div className={cn(FIELD_FRAME, FIELD_HEIGHT[size], "pl-2.5", className)}>
      <Icon name="search" size={16} className="shrink-0 text-fg-dim" />
      <input
        ref={composeRefs(innerRef, ref as Ref<HTMLInputElement> | undefined)}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          onKeyDown?.(event);
          // Escape empties first; on an empty field it is left to the
          // surrounding popover / dialog to close.
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
        className={cn(INPUT_TEXT, "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none")}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="d-hit -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-fg-dim hover:bg-[var(--d-glass-2)] hover:text-fg focus-visible:outline-offset-0"
        >
          <Icon name="close" size={14} />
        </button>
      ) : shortcutHint ? (
        <Kbd className="hidden sm:inline-flex">{shortcutHint}</Kbd>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ amount */

export interface AmountInputProps {
  /**
   * The text in the field: display units with "." as the separator, or the
   * raw base-unit integer when `decimals` is null (only Max can fill it).
   * Not masked by privacy mode: it is what the user typed or chose.
   */
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  /**
   * The token's exponent: caps the fraction digits that can be typed (cut,
   * never rounded). `null` means unknown, and then only Max can be used,
   * because a typed "1.5" has no meaning in base units.
   */
  decimals?: number | null;
  /**
   * The spendable amount in display units (base units when `decimals` is
   * null); enables the Max button. A decimal string; exponent notation from
   * `String(n)` is expanded exactly, never stripped to its digits.
   */
  max?: string;
  onMax?: () => void;
  /** The typed amount's value; null = no price (said, not shown as $0). */
  fiatValue?: number | null;
  /**
   * The ISO currency `fiatValue` is in (default: the user's preference). A
   * price the server answered in another currency (its fallback) is then
   * written in that currency instead of being labelled as the user's.
   */
  currency?: string;
  error?: ReactNode;
  disabled?: boolean;
  label?: ReactNode;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * The amount field of Send / Swap / Stake. Accepts "." and ",", strips
 * anything else as it is typed or pasted, and never rounds: what the field
 * shows is what will be converted to base units.
 */
export function AmountInput({
  value,
  onChange,
  symbol,
  decimals,
  max,
  onMax,
  fiatValue,
  currency: fiatCurrency,
  error,
  disabled,
  label = "Amount",
  id,
  placeholder = "0",
  autoFocus,
  className,
}: AmountInputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const { hideAmounts, currency } = usePrefs();
  const unknownDecimals = decimals === null;
  const canMax = max !== undefined || Boolean(onMax);

  const applyMax = () => {
    if (max !== undefined) onChange(sanitizeDecimalInput(max, decimals));
    onMax?.();
  };

  // With unknown decimals `max` is the raw integer, so it reads as base
  // units; with a ticker after it, it would read as whole tokens.
  const available =
    max !== undefined ? (
      <span>
        Available{" "}
        <span className="tabular-nums text-fg-muted">
          {hideAmounts ? MASK : unknownDecimals ? formatTokenAmount(max, null) : formatAmount(max, { maxFraction: 6 })}
        </span>
        {symbol && !unknownDecimals ? ` ${symbol}` : null}
      </span>
    ) : null;

  return (
    <FieldChrome id={fieldId} label={label} labelAside={available} error={error} className={className}>
      <div
        className={cn(
          FIELD_FRAME,
          "h-auto flex-col items-stretch gap-1 rounded-[var(--d-radius-inner)] px-3.5 py-2.5",
          error && FIELD_ERROR,
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <div className="flex items-center gap-3">
          <input
            id={fieldId}
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={placeholder}
            value={value}
            readOnly={unknownDecimals}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : unknownDecimals ? `${fieldId}-note` : undefined}
            onChange={(event) => onChange(sanitizeDecimalInput(event.target.value, decimals))}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[24px] font-medium leading-[1.2] tracking-[-0.025em] text-fg outline-none tabular-nums",
              "placeholder:text-[color-mix(in_srgb,var(--z-fg-dim)_60%,transparent)]",
            )}
          />
          {unknownDecimals ? (
            // The field then holds a raw integer of base units: a bare ticker
            // after it would read as that many whole tokens.
            <span className="shrink-0 text-right leading-tight">
              {symbol ? <span className="block text-[13px] font-medium text-fg-muted">{symbol}</span> : null}
              <span className="block text-[11.5px] text-fg-dim">base units</span>
            </span>
          ) : symbol ? (
            <span className="shrink-0 text-[15px] font-medium text-fg-muted">{symbol}</span>
          ) : null}
          {canMax ? (
            <button
              type="button"
              onClick={applyMax}
              disabled={disabled}
              className={cn(
                "d-hit h-7 shrink-0 rounded-[7px] bg-[var(--d-glass-2)] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted",
                "transition-colors duration-[160ms] hover:bg-[var(--d-accent-soft)] hover:text-[var(--d-accent-text)] focus-visible:outline-offset-0",
              )}
            >
              Max
            </button>
          ) : null}
        </div>
        <div className="flex min-h-[18px] items-center justify-between gap-3 text-[12.5px] text-fg-dim">
          <span className="tabular-nums">
            {fiatValue === undefined ? null : fiatValue === null ? (
              "No price for this token"
            ) : (
              <>≈ {formatFiat(fiatValue, fiatCurrency ?? currency)}</>
            )}
          </span>
          {unknownDecimals ? (
            <span id={`${fieldId}-note`} className="text-right">
              Decimals unknown: only Max can be used
            </span>
          ) : null}
        </div>
      </div>
    </FieldChrome>
  );
}

/* ------------------------------------------------------------------ select */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "size" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** A first, unselectable "Choose…" row while `value` is empty. */
  placeholder?: string;
  size?: FieldSize;
  className?: string;
}

/**
 * A native <select> in the field frame: the OS list on phones, full keyboard
 * and screen-reader support for free. Use Combobox when options need logos,
 * search or groups.
 *
 * The <select> is transparent and spans the whole frame, chevron included
 * (a tap on the chevron used to land on the frame and open nothing), and on
 * touch screens it is 44px tall whatever the frame's drawn height (spec §3):
 * a taller item in the frame's fixed-height, centred row overhangs evenly.
 */
export function Select({ value, onChange, options, label, hint, error, placeholder, size = "md", className, id, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldChrome id={fieldId} label={label} hint={hint} error={error} className={className}>
      <div className={cn(FIELD_FRAME, FIELD_HEIGHT[size], "relative pr-8", error && FIELD_ERROR)}>
        <select
          id={fieldId}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            INPUT_TEXT,
            // -ml-3/-mr-8 reach the frame's padding (px-3, pr-8); pl-3/pr-9 put
            // the text exactly where it was.
            "-ml-3 -mr-8 h-full cursor-pointer appearance-none pl-3 pr-9 [@media(pointer:coarse)]:h-11",
            !value && placeholder && "text-fg-dim",
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronsUpDown" size={14} className="pointer-events-none absolute right-2.5 text-fg-dim" />
      </div>
    </FieldChrome>
  );
}

/* ------------------------------------------------------------------ switch */

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/** An on/off switch (role=switch). With a label it lays out as a settings row. */
export function Switch({ checked, onCheckedChange, label, description, disabled, size = "md", ariaLabel, id, className }: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? `${switchId}-description` : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "d-hit relative inline-flex shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-[160ms] ease-[var(--d-ease)]",
        "disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-[18px] w-8" : "h-5 w-9",
        checked
          ? "border-transparent bg-[image:var(--z-button-gradient)]"
          : "border-[var(--d-control-line)] bg-[var(--d-glass-2)] hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-[2px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-[180ms] ease-[var(--d-ease-out)]",
          size === "sm" ? "size-3" : "size-3.5",
          checked ? cn("bg-white", size === "sm" ? "translate-x-[14px]" : "translate-x-4") : "translate-x-0 bg-[var(--z-fg-dim)]",
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={switchId} className="block cursor-pointer text-[14px] leading-snug text-fg">
          {label}
        </label>
        {description ? (
          <p id={`${switchId}-description`} className="mt-0.5 text-[12.5px] leading-snug text-fg-dim">
            {description}
          </p>
        ) : null}
      </div>
      <span className="pt-px">{control}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ checkbox */

export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/** A native checkbox, restyled; supports the indeterminate state. */
export function Checkbox({ checked, onCheckedChange, label, description, disabled, ariaLabel, id, className }: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;
  const ref = useRef<HTMLInputElement>(null);
  const indeterminate = checked === "indeterminate";

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const on = checked === true || indeterminate;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <span className="relative mt-[2px] inline-flex size-4 shrink-0">
        <input
          ref={ref}
          id={boxId}
          type="checkbox"
          checked={checked === true}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={description ? `${boxId}-description` : undefined}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className={cn(
            "peer size-4 cursor-pointer appearance-none rounded-[4px] border transition-[background-color,border-color] duration-[160ms]",
            "disabled:cursor-default disabled:opacity-45 focus-visible:outline-offset-2",
            on
              ? "border-transparent bg-[image:var(--z-button-gradient)]"
              : "border-[color-mix(in_srgb,var(--z-fg)_30%,transparent)] bg-[var(--d-input-bg)] hover:border-[color-mix(in_srgb,var(--z-fg)_45%,transparent)]",
          )}
        />
        {on ? (
          <Icon
            name={indeterminate ? "minus" : "check"}
            size={12}
            strokeWidth={2.4}
            className="pointer-events-none absolute left-[2px] top-[2px] text-white"
          />
        ) : null}
      </span>
      {label ? (
        <div className="min-w-0">
          <label htmlFor={boxId} className={cn("block cursor-pointer text-[14px] leading-snug text-fg", disabled && "opacity-45")}>
            {label}
          </label>
          {description ? (
            <p id={`${boxId}-description`} className="mt-0.5 text-[12.5px] leading-snug text-fg-dim">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
