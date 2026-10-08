"use client";

/**
 * The review card and the signature.
 *
 * Draws only from the frozen review (src/lib/swap/review.ts): what is shown
 * is what the messages are built from, and the live form moving underneath
 * (balances, a new price, an edit) never changes it. A review that no longer
 * matches the form says what moved (`reviewDrift`); a price past its 20
 * seconds offers the form's newer one, which is a new review the user looks
 * at again. Problems are never folded away; the decoded messages are, under
 * "Transaction details".
 *
 * Right before the wallet is asked, the transaction is built again and
 * `checkSwapTx` reads it back against the review (amounts, denoms, the fee,
 * the recipient, the price's age); any problem stops the signature. The sign
 * mode is the wallet's policy (`chooseSignMode`), not this card's: Keplr and
 * Zunia Mobile sign every swap path direct (each carries a non-standard
 * message: a poolmanager swap, a contract call, or a transfer whose memo
 * runs the swap contract), while the Zunia extension signs the contract call
 * from Osmosis in amino, the one mode in which it can show that call.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { txMemoItem } from "@/components/TxMemoItem";
import {
  AddressText,
  AssetLogo,
  Button,
  Callout,
  Dialog,
  Disclosure,
  ExternalLink,
  KeyValueList,
  StatusBadge,
  Stepper,
  TokenAmount,
  chainById,
  toast,
  useReducedMotion,
  type KeyValueItem,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatFiat, formatPercent } from "@/lib/format";
import {
  buildSwapTx,
  checkSwapTx,
  explorerTxUrl,
  minimumReceived,
  reviewDrift,
  signBlock,
  swapFeeLine,
  swapFeeOutcome,
  type LiveSwap,
  type SwapQuoteOk,
  type SwapReview,
  type SwapTx,
} from "@/lib/data/swap";
import { feeFromWire } from "@/lib/swap/fee";
import { tickerAmount } from "@/lib/swap/format";
import { explainError, TxError } from "@/lib/tx/errors";
import { describeTxMemo } from "@/lib/tx/memo";
import type { SignStage } from "@/lib/tx/types";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { usePrefs } from "@/providers/PrefsProvider";
import type { NetworkFeeView } from "./RoutePanel";
import { SwapTracker } from "./SwapTracker";
import { failedAt, impactView, receiveView, signSteps, trackingPlan } from "./swap-view";
import { useTicker } from "./useTicker";

export interface SignedSwap {
  review: SwapReview;
  txHash: string;
  chainId: string;
  confirmed: boolean;
  at: number;
}

export interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: SwapReview | null;
  /** The form as it is now, to tell when the review no longer matches it. */
  live: LiveSwap;
  /** The form's current signable quote, offered when the review's price expires. */
  freshQuote: SwapQuoteOk | null;
  liveRefreshing: boolean;
  onAcceptNewPrice: () => void;
  prices: { from: number | null; to: number | null; currency: string };
  networkFee: NetworkFeeView;
  feeShort: boolean;
  /** Why this wallet cannot sign on the review's chain, if it cannot. */
  cannotSign: string | null;
  walletName: string;
  /** Token logos for the two sides (the review keeps only what signs). */
  icons: { from: string | null; to: string | null };
  onSigned: (swap: SignedSwap) => void;
}

export function ReviewDialog(props: ReviewDialogProps) {
  const { open, onOpenChange, review } = props;
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open && review !== null}
      onOpenChange={(next) => {
        // Not while the wallet window is up: closing would hide the outcome.
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="Review swap"
      description="Check every line. Your wallet shows the same transaction before you approve it."
      size="md"
      hideClose={busy}
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      {review ? <ReviewContent key={review.id} {...props} review={review} onBusyChange={setBusy} /> : null}
    </Dialog>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "preparing":
      return "Preparing…";
    case "awaiting-signature":
      return "Confirm in your wallet…";
    case "broadcasting":
      return "Broadcasting…";
    case "confirming":
      return "Confirming…";
    default:
      return "Working…";
  }
}

function ReviewContent({
  review,
  live,
  freshQuote,
  liveRefreshing,
  onAcceptNewPrice,
  prices,
  networkFee,
  feeShort,
  cannotSign,
  walletName,
  icons,
  onSigned,
  onOpenChange,
  onBusyChange,
}: ReviewDialogProps & { review: SwapReview; onBusyChange: (busy: boolean) => void }) {
  const signer = useSignAndBroadcast();
  const { mask } = usePrefs();
  const now = useTicker(1_000);
  const [signProblems, setSignProblems] = useState<string[]>([]);
  const [signed, setSigned] = useState<SignedSwap | null>(null);
  // The stage an attempt last reached, to mark where a failure stopped it.
  const [lastActive, setLastActive] = useState<SignStage>("idle");
  if (signer.stage !== "failed" && signer.stage !== lastActive) setLastActive(signer.stage);
  const progressRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // Bring the progress into view as the signature moves on.
  useEffect(() => {
    if (signer.stage !== "idle") progressRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [signer.stage, reducedMotion]);

  const { quote, from, to } = review;
  const fee = feeFromWire(review.fee);
  const built = useMemo<{ tx: SwapTx | null; problem: string | null }>(() => {
    try {
      return { tx: buildSwapTx(review, { now: review.frozenAt }), problem: null };
    } catch (error) {
      return { tx: null, problem: error instanceof Error ? error.message : "The swap could not be built." };
    }
  }, [review]);
  // Term checks against the review (the price's age is the sign block's job).
  const termProblems = useMemo(
    () => (built.tx ? checkSwapTx(review, built.tx.messages, { now: review.frozenAt, chainId: built.tx.chainId }) : []),
    [built.tx, review],
  );
  // The body memo the swap signs: Zunia's default naming the pair (the swap
  // has no memo field), the same string the sign flow writes.
  const memoView = useMemo(
    () => (built.tx ? describeTxMemo({ chainId: built.tx.chainId, messages: built.tx.messages, memoContext: built.tx.memoContext }) : null),
    [built.tx],
  );
  const problems = [...(built.problem ? [built.problem] : []), ...termProblems, ...(cannotSign ? [cannotSign] : []), ...signProblems];
  const drift = signed ? null : reviewDrift(review, live);
  const expired = now >= quote.expiresAt;
  const block = signed
    ? null
    : signBlock({
        problem: problems[0] ?? null,
        drift,
        quote,
        refreshing: expired && liveRefreshing,
        now,
        feeShort,
      });
  const canAccept = expired && !drift && problems.length === 0 && freshQuote !== null && freshQuote !== quote && now < freshQuote.expiresAt;

  const receive = receiveView(quote);
  const minimum = minimumReceived(quote, { ticker: to.ticker, decimals: to.decimals });
  const impact = impactView(quote.priceImpact);
  const feeLine = fee ? swapFeeLine(fee, from) : null;
  const chainOf = (chainId: string) => chainById(chainId);
  const signingChain = chainOf(quote.signingChainId)?.chainName ?? quote.signingChainId;
  const spent = review.amountUnits;
  const payFiat = prices.from !== null && from.decimals !== null ? (Number(spent) / 10 ** from.decimals) * prices.from : null;
  const getFiat = prices.to !== null && to.decimals !== null ? (Number(receive.amount) / 10 ** to.decimals) * prices.to : null;
  const plan = trackingPlan(review);
  const busy = signer.busy;

  const sign = async () => {
    setSignProblems([]);
    let tx: SwapTx;
    try {
      tx = buildSwapTx(review);
    } catch (error) {
      setSignProblems([error instanceof Error ? error.message : "The swap could not be built."]);
      return;
    }
    const found = checkSwapTx(review, tx.messages, { chainId: tx.chainId });
    if (found.length > 0) {
      setSignProblems(found);
      return;
    }
    onBusyChange(true);
    const sentence = mask(`${tickerAmount(spent, from)} for about ${tickerAmount(receive.amount, to)}`);
    try {
      const result = await signer.run({ chainId: tx.chainId, messages: tx.messages, memoContext: tx.memoContext });
      const swap: SignedSwap = { review, txHash: result.txHash, chainId: result.chainId, confirmed: result.confirmed !== false, at: Date.now() };
      setSigned(swap);
      onSigned(swap);
      const href = `/activity/${result.txHash}?chainId=${encodeURIComponent(result.chainId)}`;
      if (result.confirmed === false) {
        toast.info("Swap submitted", { description: `${sentence}. Not in a block yet: check Activity in a minute.`, action: { label: "View", href } });
      } else {
        toast.success(plan ? "Swap signed, delivery on its way" : "Swap confirmed", { description: `Swapped ${sentence}.`, action: { label: "View", href } });
      }
    } catch (error) {
      const explained = error instanceof TxError ? error.explained : explainError(error);
      toast.error(explained.title, { description: explained.message });
    } finally {
      onBusyChange(false);
    }
  };

  const items: KeyValueItem[] = [
    {
      key: "min",
      label: "Minimum received",
      info: minimum.exact ? "A number in the signed message: below it the whole transaction is refused." : (minimum.rule ?? undefined),
      value: minimum.amount ?? "—",
      sub: minimum.exact ? "Exact" : "Estimate of the contract's rule",
    },
    {
      key: "rate",
      label: "Rate",
      value: quote.rate.toPerFrom ? `1 ${from.ticker} = ${quote.rate.toPerFrom} ${to.ticker}` : "—",
      ...(quote.rate.fromPerTo ? { sub: `1 ${to.ticker} = ${quote.rate.fromPerTo} ${from.ticker}` } : {}),
    },
    {
      key: "impact",
      label: "Price impact",
      value: (
        <span className="inline-flex items-center gap-2">
          {quote.priceImpact === null ? "—" : formatPercent(quote.priceImpact, { digits: 2 })}
          <StatusBadge tone={impact.tone === "neutral" ? "neutral" : impact.tone}>{impact.label}</StatusBadge>
        </span>
      ),
    },
    {
      key: "zunia",
      label: "Zunia fee",
      info: "Paid in the token you sell, in this transaction. It is included in the amount you pay.",
      value: feeLine ? feeLine.value : "None on this amount",
    },
    {
      key: "network",
      label: "Network fee",
      value:
        networkFee.state === "ready" ? (
          <span className={cn(networkFee.stale && "opacity-60")}>
            {networkFee.amount} {networkFee.symbol}
          </span>
        ) : networkFee.state === "loading" ? (
          "Measuring…"
        ) : (
          "—"
        ),
      sub:
        networkFee.state === "ready"
          ? `${networkFee.fiat !== null && networkFee.fiat !== undefined ? `≈ ${formatFiat(networkFee.fiat, prices.currency)} · ` : ""}${networkFee.measured ? "simulated, measured again at signing" : "estimate"}`
          : networkFee.reason,
    },
    ...(review.signer === review.recipient
      ? [
          {
            key: "account",
            label: "Signs and receives",
            value: <AddressText address={review.signer} head={10} tail={6} />,
            sub: `Your ${signingChain} address, with ${walletName}`,
          },
        ]
      : [
          {
            key: "recipient",
            label: "Recipient",
            value: <AddressText address={review.recipient} head={10} tail={6} />,
            sub: `Your address on ${to.chainName}`,
          },
          {
            key: "signer",
            label: "Signs on",
            value: <AddressText address={review.signer} head={10} tail={6} />,
            sub: `${signingChain}, with ${walletName}`,
          },
        ]),
    ...(review.path === "contract" && review.recoveryAddress
      ? [
          {
            key: "recovery",
            label: "Recovery address",
            info: "If the delivery fails after the swap, the output waits in the contract and only this address can pull it out.",
            value: <AddressText address={review.recoveryAddress} head={10} tail={6} />,
            sub: "Your Osmosis address",
          },
        ]
      : []),
    ...(memoView ? [txMemoItem(memoView)] : []),
  ];

  const steps =
    signer.stage !== "idle"
      ? signSteps(signer.stage, signingChain, signer.stage === "failed" ? failedAt(signer.explained?.kind, signer.txHash, lastActive) : null)
      : null;
  const explorer = signed ? explorerTxUrl(signed.chainId, signed.txHash) : null;

  let primary: ReactNode;
  if (signed) {
    primary = (
      <Button variant="primary" onClick={() => onOpenChange(false)}>
        Done
      </Button>
    );
  } else if (busy) {
    primary = (
      <Button variant="primary" loading>
        {stageLabel(signer.stage)}
      </Button>
    );
  } else if (canAccept) {
    primary = (
      <Button variant="primary" iconLeft="refresh" onClick={onAcceptNewPrice}>
        Review the new price
      </Button>
    );
  } else if (block) {
    primary = (
      <Button variant="primary" disabled>
        {block.label}
      </Button>
    );
  } else {
    primary = (
      <Button variant="primary" onClick={() => void sign()}>
        {signer.stage === "failed" ? "Try again" : `Swap ${from.ticker} for ${to.ticker}`}
      </Button>
    );
  }

  return (
    <>
      <div className="d-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
        <div className="flex flex-col gap-4">
          {/* Where the signature is: at the top, where it is seen without scrolling. */}
          {steps ? (
            <div ref={progressRef} className="flex flex-col gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] p-3.5" aria-live="polite">
              {signed ? (
                <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
                  <Icon name="success" size={18} className="text-[var(--d-pos)]" />
                  {signed.confirmed ? (plan ? "Swap signed and confirmed. Delivery on its way." : "Swap confirmed") : "Swap submitted. Not in a block yet."}
                </p>
              ) : null}
              <Stepper steps={steps} orientation="vertical" />
              {signer.stage === "failed" && signer.explained ? (
                <p className="text-[12.5px] leading-snug text-fg-muted">
                  <span className="font-medium text-[var(--z-danger)]">{signer.explained.title}.</span> {signer.explained.message}
                </p>
              ) : null}
              {signed && plan ? (
                <SwapTracker
                  plan={plan}
                  txHash={signed.txHash}
                  expectedAmount={review.path === "pool-deliver" ? (quote.minOut ?? undefined) : review.fee.net}
                  recoveryAddress={review.recoveryAddress}
                  contractAddress={quote.contract?.address ?? null}
                />
              ) : null}
              {signed ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <Link href={`/activity/${signed.txHash}?chainId=${encodeURIComponent(signed.chainId)}`} className="text-[var(--d-accent-text)] underline-offset-[3px] hover:underline">
                    Open in Activity
                  </Link>
                  {explorer ? <ExternalLink href={explorer}>View on explorer</ExternalLink> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Pay / receive */}
          <div className="overflow-hidden rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)]">
            <Side
              label="You pay"
              logo={icons.from}
              side={from}
              amount={spent}
              approx={false}
              fiat={payFiat}
              currency={prices.currency}
              sub={fee && fee.fee > BigInt(0) ? `Includes the ${tickerAmount(fee.fee, from)} Zunia fee` : `On ${from.chainName}`}
            />
            <div className="relative h-px bg-[var(--d-hairline)]">
              <span className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)] text-fg-dim">
                <Icon name="arrowDown" size={14} />
              </span>
            </div>
            <Side
              label={receive.exact ? "You receive exactly" : "You receive"}
              logo={icons.to}
              side={to}
              amount={receive.amount}
              approx={!receive.exact}
              fiat={getFiat}
              currency={prices.currency}
              sub={
                receive.kept
                  ? `On ${to.chainName}. About ${tickerAmount(receive.kept, to)} above the minimum stays on Osmosis.`
                  : `On ${to.chainName}`
              }
            />
          </div>

          <KeyValueList items={items} divided />

          <Callout tone="neutral" icon="shield" title="If it doesn't go through">
            {swapFeeOutcome(review.path, from.chainId, fee?.bps ?? 0)}
          </Callout>

          {quote.priceImpact !== null && impact.level === "warning" && !signed ? (
            <Callout tone="danger" title="High price impact">
              This order moves the price by {formatPercent(quote.priceImpact, { digits: 2 })}. A smaller amount, or another pair, usually does better.
            </Callout>
          ) : null}

          {/* Problems are never folded. */}
          {!signed && (problems.length > 0 || drift) ? (
            <Callout tone="danger" title={drift ? "This review is out of date" : "This swap can't be signed"}>
              <ul className="flex flex-col gap-1">
                {drift ? <li>{drift} Close and review again.</li> : null}
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <Disclosure summary={`Transaction details${built.tx ? ` · ${built.tx.messages.length} message${built.tx.messages.length === 1 ? "" : "s"}` : ""}`}>
            {built.tx ? (
              <div className="flex flex-col gap-2">
                <ol className="flex flex-col gap-1.5">
                  {built.tx.messages.map((message, index) => (
                    <li key={`${message.typeUrl}-${index}`} className="rounded-[10px] bg-[var(--d-card-2)] px-3 py-2">
                      <p className="text-[13px] leading-snug text-fg">
                        <span className="mr-1.5 font-mono text-[11px] text-fg-dim">{index + 1}.</span>
                        {message.summary ?? message.typeUrl}
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-fg-dim">{message.typeUrl}</p>
                    </li>
                  ))}
                </ol>
                {memoView ? (
                  <p className="text-[12px] text-fg-dim">
                    Memo <span className="font-mono text-fg-muted">{memoView.memo}</span>
                    {memoView.automatic ? " (added automatically)" : null}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[12.5px] text-fg-dim">Nothing was built for this review.</p>
            )}
          </Disclosure>
        </div>
      </div>
      <div className="flex shrink-0 flex-col-reverse items-stretch gap-2 border-t border-[var(--d-hairline)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end">
        {!signed && !busy ? (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        ) : null}
        {primary}
        {!signed ? (
          <span
            className={cn(
              "inline-flex items-center justify-center gap-1.5 text-[12.5px] tabular-nums sm:order-first sm:mr-auto sm:justify-start",
              expired ? "text-[var(--z-warning)]" : "text-fg-dim",
            )}
          >
            <Icon name="clock" size={14} />
            {expired ? "Price expired" : `Price valid ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s`}
          </span>
        ) : null}
      </div>
    </>
  );
}

function Side({
  label,
  logo,
  side,
  amount,
  approx,
  fiat,
  currency,
  sub,
}: {
  label: string;
  logo: string | null;
  side: SwapReview["from"];
  amount: string;
  approx: boolean;
  fiat: number | null;
  currency: string;
  sub: string;
}) {
  const chain = chainById(side.chainId);
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <AssetLogo src={logo} symbol={side.ticker} size={36} badgeSrc={chain?.iconUrl ?? null} badgeLabel={side.chainName} />
      <div className="min-w-0 flex-1">
        <p className="d-label">{label}</p>
        <p className="mt-0.5 truncate text-[20px] font-semibold tracking-[-0.025em] text-fg tabular-nums">
          {approx ? <span className="mr-1 text-fg-dim">≈</span> : null}
          <TokenAmount amount={amount} decimals={side.decimals} symbol={side.ticker} masked={false} symbolClassName="text-[15px] font-medium" />
        </p>
        <p className="text-[12px] leading-snug text-fg-dim">{sub}</p>
      </div>
      <span className="shrink-0 text-right text-[13px] tabular-nums text-fg-muted">{fiat === null ? "—" : `≈ ${formatFiat(fiat, currency)}`}</span>
    </div>
  );
}
