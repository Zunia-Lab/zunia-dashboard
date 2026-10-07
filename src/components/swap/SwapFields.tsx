"use client";

/**
 * The two halves of the swap card: "You pay" (an amount field, quick shares
 * of the balance, the token picker) and "You receive" (the quote's output,
 * read-only), with the flip button between them.
 *
 * The pay field accepts "." and "," and cuts extra decimals as they are typed
 * (never rounds), like the kit's AmountInput; it is laid out differently
 * because a swap card reads amount-left / token-right. Typed amounts and their
 * fiat value are not masked by privacy mode (the user typed them); balances
 * are.
 */

import { useId, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Skeleton, TokenAmount, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatFiat, formatPercent, formatTokenAmount, sanitizeDecimalInput } from "@/lib/format";
import { fractionDigits } from "./swap-view";

/** Big-figure size by length, so a long amount shrinks instead of being cut. */
function figureSize(text: string): string {
  const length = text.replace(/[^0-9.,]/g, "").length;
  if (length <= 7) return "text-[32px] max-sm:text-[28px]";
  if (length <= 10) return "text-[28px] max-sm:text-[24px]";
  if (length <= 13) return "text-[24px] max-sm:text-[20px]";
  return "text-[20px] max-sm:text-[17px]";
}

/* ------------------------------------------------------------------ shell */

function FieldShell({
  label,
  aside,
  children,
  footer,
  below,
  tone = "default",
  htmlFor,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Notes read after the figures (what stays on Osmosis, why a pair is off). */
  below?: ReactNode;
  tone?: "default" | "error" | "quiet";
  htmlFor?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--d-radius-inner)] border px-4 pb-3 pt-3 transition-[border-color,box-shadow,background-color] duration-[160ms]",
        tone === "quiet"
          ? "border-transparent bg-[var(--d-card-2)]"
          : "border-[var(--d-hairline)] bg-[var(--d-card-2)] focus-within:border-[var(--z-focus-ring)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--z-focus-ring)_18%,transparent)]",
        tone === "error" && "border-[var(--z-danger-line)] focus-within:border-[var(--z-danger)]",
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="d-label">
            {label}
          </label>
        ) : (
          <span className="d-label">{label}</span>
        )}
        {aside}
      </div>
      {children}
      {footer ? <div className="mt-1 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-fg-dim">{footer}</div> : null}
      {below}
    </div>
  );
}

/* ------------------------------------------------------------------ pay */

export interface PayFieldProps {
  amountText: string;
  onAmountChange: (text: string) => void;
  /** The token's exponent; `null` = unknown (Max only). */
  decimals: number | null | undefined;
  picker: ReactNode;
  /** Quick shares of what can be spent; each returns the field text. */
  shares: { label: string; text: string; title?: string }[];
  /** Fiat value of the typed amount, in `currency`; null = no price. */
  fiat: number | null | undefined;
  currency: string;
  balance: { amount: string; decimals: number | null; ticker: string } | null;
  /** A note under the field (fee reserve kept by Max, decimals unknown). */
  note?: ReactNode;
  error?: boolean;
  /**
   * Why the amount is refused ("You hold less OSMO on Osmosis than this
   * amount."). Shown under the form's button; the field also carries it for
   * assistive tech, as its description and announced when it appears.
   */
  errorText?: string | null;
  disabled?: boolean;
}

/**
 * A quick share's accessible name, its visible text first ("Max", "25%"), so
 * speech input finds the button by what it shows.
 */
function shareName(label: string): string {
  return label === "Max" ? "Max, use the most you can spend" : `${label} of what you can spend`;
}

export function PayField({ amountText, onAmountChange, decimals, picker, shares, fiat, currency, balance, note, error, errorText, disabled }: PayFieldProps) {
  const id = useId();
  const unknownDecimals = decimals === null;
  const errorShown = Boolean(error && errorText);
  const describedBy = [note ? `${id}-note` : null, errorShown ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <FieldShell
      label="You pay"
      htmlFor={id}
      tone={error ? "error" : "default"}
      below={
        <>
          {note ? (
            <p id={`${id}-note`} className="mt-2 border-t border-[var(--d-hairline)] pt-2 text-[12px] leading-snug text-fg-dim">
              {note}
            </p>
          ) : null}
          {/* Always in the page, so the reason is announced when it appears
              (a live region added with its text is not read). */}
          <span id={`${id}-error`} className="sr-only" aria-live="polite">
            {errorShown ? errorText : ""}
          </span>
        </>
      }
      aside={
        shares.length > 0 ? (
          <div className="flex items-center gap-1" role="group" aria-label="Amount shortcuts">
            {shares.map((share) => (
              <Tooltip key={share.label} content={share.title}>
                <button
                  type="button"
                  disabled={disabled || !share.text}
                  aria-label={shareName(share.label)}
                  onClick={() => onAmountChange(share.text)}
                  className={cn(
                    "d-hit h-6 rounded-[6px] px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-dim",
                    "transition-colors duration-[160ms] hover:bg-[var(--d-accent-soft)] hover:text-[var(--d-accent-text)]",
                    "disabled:pointer-events-none disabled:opacity-40",
                    amountText !== "" && share.text === amountText && "bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]",
                  )}
                >
                  {share.label}
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null
      }
      footer={
        <>
          <span className="tabular-nums">
            {fiat === undefined || !amountText ? " " : fiat === null ? "No price for this token" : `≈ ${formatFiat(fiat, currency)}`}
          </span>
          {balance ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Icon name="wallet" size={13} className="text-fg-faint" aria-hidden />
              <span className="sr-only">Balance</span>
              <TokenAmount amount={balance.amount} decimals={balance.decimals} symbol={balance.ticker} className="tabular-nums text-fg-muted" />
            </span>
          ) : null}
        </>
      }
    >
      <div className="mt-1 flex items-center gap-3">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0"
          value={amountText}
          readOnly={unknownDecimals}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onAmountChange(sanitizeDecimalInput(event.target.value, decimals ?? undefined))}
          className={cn(
            "h-[37px] min-w-0 flex-1 bg-transparent font-medium leading-[1.15] tracking-[-0.03em] text-fg outline-none tabular-nums",
            figureSize(amountText),
            "placeholder:text-[color-mix(in_srgb,var(--z-fg-dim)_55%,transparent)] disabled:opacity-50",
            error && "text-[var(--z-danger)]",
          )}
        />
        {picker}
      </div>
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ receive */

export interface ReceiveFieldProps {
  picker: ReactNode;
  /** Base units of the To; null = nothing to show yet. */
  amount: string | null;
  decimals: number | null;
  /** The figure is exact (pool-deliver sends exactly the floor). */
  exact?: boolean;
  loading?: boolean;
  /** An answer for an earlier form state: dimmed. */
  stale?: boolean;
  fiat: number | null | undefined;
  currency: string;
  /** Quote against market prices, percent (negative: you get less). */
  vsMarket: number | null;
  /** What stays on Osmosis on pool-deliver (base units of the To). */
  kept?: { amount: string; ticker: string } | null;
  aside?: ReactNode;
  balance: { amount: string; decimals: number | null; ticker: string } | null;
  note?: ReactNode;
}

export function ReceiveField({ picker, amount, decimals, exact, loading, stale, fiat, currency, vsMarket, kept, aside, balance, note }: ReceiveFieldProps) {
  // Cut, never rounded up; the review card shows every digit.
  const shownText = amount === null ? "" : formatTokenAmount(amount, decimals, { maxFraction: fractionDigits(amount, decimals) });
  return (
    <FieldShell
      label={exact ? "You receive exactly" : "You receive"}
      tone="quiet"
      aside={aside}
      below={
        kept || note ? (
          <div className="mt-2 flex flex-col gap-1 border-t border-[var(--d-hairline)] pt-2 text-[12px] leading-snug text-fg-dim">
            {kept ? (
              <p>
                About <TokenAmount amount={kept.amount} decimals={decimals} symbol={kept.ticker} masked={false} className="text-fg-muted" /> more stays in your
                Osmosis balance: the swap pays above the minimum, the transfer sends exactly it.
              </p>
            ) : null}
            {note ? <p>{note}</p> : null}
          </div>
        ) : null
      }
      footer={
        <>
          <span className="inline-flex items-center gap-2 tabular-nums">
            {amount === null || fiat === undefined ? " " : fiat === null ? "No price for this token" : `≈ ${formatFiat(fiat, currency)}`}
            {amount !== null && vsMarket !== null ? (
              <Tooltip content="This quote against the two tokens' market prices: everything the swap costs, the Zunia fee included. An estimate.">
                <span
                  tabIndex={0}
                  className={cn(
                    "rounded-[5px] px-1 text-[12px] font-medium tabular-nums",
                    vsMarket <= -3 ? "bg-[var(--z-warning-fill)] text-[var(--z-warning)]" : "bg-[var(--d-glass-2)] text-fg-muted",
                  )}
                >
                  {formatPercent(vsMarket, { signed: true, digits: 2 })} vs market
                </span>
              </Tooltip>
            ) : null}
          </span>
          {balance ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Icon name="wallet" size={13} className="text-fg-faint" aria-hidden />
              <span className="sr-only">Balance</span>
              <TokenAmount amount={balance.amount} decimals={balance.decimals} symbol={balance.ticker} className="tabular-nums text-fg-muted" />
            </span>
          ) : null}
        </>
      }
    >
      <div className="mt-1 flex items-center gap-3">
        <div className={cn("min-w-0 flex-1 transition-opacity duration-[160ms]", stale && "opacity-55")} aria-live="polite" aria-atomic="true">
          {loading && amount === null ? (
            <Skeleton height={34} width="62%" className="block rounded-[8px]" />
          ) : amount === null ? (
            <span className="block text-[32px] font-medium leading-[1.15] tracking-[-0.03em] text-[color-mix(in_srgb,var(--z-fg-dim)_55%,transparent)] max-sm:text-[28px]">
              0
            </span>
          ) : (
            <span className={cn("block h-[37px] truncate font-medium leading-[1.15] tracking-[-0.03em] text-fg tabular-nums", figureSize(shownText))}>
              {exact ? null : <span className="mr-1 text-fg-dim">≈</span>}
              {shownText}
            </span>
          )}
        </div>
        {picker}
      </div>
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ flip */

export function FlipButton({ onFlip, disabled, reason }: { onFlip: () => void; disabled: boolean; reason: string | null }) {
  return (
    <div className="relative z-[1] -my-[18px] flex justify-center">
      <Tooltip content={disabled ? reason : "Swap the two sides"}>
        <span className="inline-flex rounded-[12px]" tabIndex={disabled ? 0 : -1}>
          <button
            type="button"
            onClick={onFlip}
            disabled={disabled}
            aria-label="Swap the two sides"
            className={cn(
              "d-hit group/flip inline-flex size-9 items-center justify-center rounded-[12px] border-[3px] border-[var(--d-card)] bg-[var(--d-card-2)] text-fg-muted",
              "shadow-[0_0_0_1px_var(--d-hairline)] transition-[color,background-color] duration-[160ms]",
              "hover:bg-[var(--d-glass-2)] hover:text-fg disabled:pointer-events-none disabled:opacity-50 max-sm:size-10",
            )}
          >
            <Icon name="sort" size={17} className="transition-transform duration-[240ms] ease-[var(--d-ease-out)] group-hover/flip:rotate-180" />
          </button>
        </span>
      </Tooltip>
    </div>
  );
}
