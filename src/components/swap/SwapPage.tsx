"use client";

/**
 * /swap: any Osmosis pair, from the chain the tokens sit on.
 *
 * Left, the swap card: what you pay (your balances in the current scope),
 * what you receive (everything the venue can deliver, gated against what you
 * pay), the tolerance, the path in plain words and one button whose label is
 * always the next thing to do. Right, the analysis: the route and every fee
 * (./RoutePanel) and the pair's implied rate over time (./PairChart). Below,
 * this wallet's recent swaps.
 *
 * The engine decides everything that is signed (src/lib/swap: quote request,
 * frozen review, built messages, pre-sign checks); this file only holds the
 * form's state and wires it. Scope: the pay list is the scope's balances (one
 * chain selected = that chain's tokens); what you receive is never scoped,
 * because a swap delivers across chains.
 *
 * Deep links `?from=<chainId>:<denom>&to=<chainId>:<denom>&amount=` (asset
 * keys work too) open the form on that pair; a page coming back from step 1
 * of a two-step swap (./useSwapIntent) opens on its step 2.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import { Button, Callout, Card, CardHeader, EmptyState, InlineError, PartialDataBadge, type Step } from "@/components/ui";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { findChain } from "@/lib/chains";
import { walletKindLabel } from "@/lib/connect/context";
import { usePortfolio } from "@/lib/data/portfolio";
import { useSpotPrices } from "@/lib/data/prices";
import {
  amountUnitsOf,
  buyOptions,
  DEFAULT_SLIPPAGE_PERCENT,
  freezeReview,
  heldFromPortfolio,
  quoteRequestFor,
  rememberSwapIntent,
  sellOptions,
  slippageNotice,
  useSwapAssets,
  useSwapQuote,
  type AssetOption,
  type SwapQuoteOk,
  type SwapReview,
} from "@/lib/data/swap";
import { formatFiat, formatTokenAmount } from "@/lib/format";
import { fromBaseUnits } from "@/lib/interchain/amounts";
import { swapFeeFor } from "@/lib/swap/fee";
import { tickerAmount } from "@/lib/swap/format";
import { explainError } from "@/lib/tx/errors";
import { useChainScope } from "@/lib/useChainScope";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { LastSwapCard } from "./LastSwapCard";
import { PairChart } from "./PairChart";
import { PathBanner } from "./PathBanner";
import { RecentSwaps } from "./RecentSwaps";
import { ReviewDialog, type SignedSwap } from "./ReviewDialog";
import { RoutePanel, type NetworkFeeView } from "./RoutePanel";
import type { VenueToken } from "./RouteDiagram";
import { SlippageControl } from "./SlippageControl";
import { FlipButton, PayField, ReceiveField } from "./SwapFields";
import { SwapStrip } from "./SwapStrip";
import { TokenPicker } from "./TokenPicker";
import {
  defaultFromKey,
  defaultToKey,
  displayValue,
  feeForNet,
  feeReserve,
  formCta,
  fractionDigits,
  indicativeAmount,
  listedVenueDenoms,
  marketRate,
  opensInOneSignature,
  pathCopy,
  quoteMatchesPair,
  receiveView,
  resolveLinkedOption,
  shareText,
  spendableUnits,
  swapHref,
  swapLinkKey,
  versus,
  type FeeReserve,
  type SwapLink,
} from "./swap-view";
import { useSwapFeePreview } from "./useSwapFeePreview";
import { useSwapIntent } from "./useSwapIntent";
import { useTicker } from "./useTicker";

const VENUE = SWAP_VENUE_CHAIN_ID;
/** The viewer's tolerance, remembered in this browser only. */
const SLIPPAGE_KEY = "zunia.dashboard.swap.slippage";
const ZERO = BigInt(0);

export function SwapPage({ link }: { link: SwapLink }) {
  return (
    <Page
      title="Swap"
      subtitle="Any Osmosis pair, from the chain you hold it on"
      access="wallet"
      connectTitle="Swap any Osmosis pair"
      connectDescription="Connect a wallet to swap tokens you hold on any Cosmos chain. Zunia routes through Osmosis pools or its verified cross-chain contract, shows every fee before you sign, and never holds your keys."
    >
      <SwapDesk link={link} />
    </Page>
  );
}

function SwapDesk({ link }: { link: SwapLink }) {
  const router = useRouter();
  const wallet = useWallet();
  const { addressFor, ensureChain, canSignOn, walletKind } = wallet;
  const scope = useChainScope();
  const prefs = usePrefs();
  const portfolio = usePortfolio();
  const now = useTicker(1_000);

  // A return from step 1 of a two-step swap opens on its step 2 (a deep link
  // for another pair wins over it).
  const { intent, forget: forgetIntent } = useSwapIntent(link);
  const [fromPick, setFromPick] = useState<string | null>(link.from ?? intent?.fromKey ?? null);
  const [toPick, setToPick] = useState<string | null>(link.to ?? intent?.toKey ?? null);
  const [amountText, setAmountText] = useState(link.amount ?? "");
  // A link that arrives while the page is open (a "Swap" action elsewhere)
  // is applied on top of the form; the same page refreshed with the address
  // this form wrote itself changes nothing (same pair, no amount).
  const linkKey = swapLinkKey(link);
  const [seenLink, setSeenLink] = useState(linkKey);
  if (seenLink !== linkKey) {
    setSeenLink(linkKey);
    if (link.from) setFromPick(link.from);
    if (link.to) setToPick(link.to);
    if (link.amount) setAmountText(link.amount);
  }
  const [storedSlippage, setStoredSlippage] = useStoredValue<number>(SLIPPAGE_KEY, DEFAULT_SLIPPAGE_PERCENT);
  const slippage = typeof storedSlippage === "number" && slippageNotice(storedSlippage).valid ? storedSlippage : DEFAULT_SLIPPAGE_PERCENT;

  /* ------------------------------------------------------------ the lists */

  const swapAssets = useSwapAssets(scope.scopedChainIds[0] ?? null);
  const assetRows = swapAssets.data?.assets;
  const held = useMemo(() => heldFromPortfolio(portfolio.data?.assets ?? []), [portfolio.data]);
  const listed = useMemo(() => (assetRows ? listedVenueDenoms(assetRows) : null), [assetRows]);
  const sell = useMemo(() => sellOptions(held, assetRows ?? []), [held, assetRows]);
  const valueByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of portfolio.data?.assets ?? []) {
      if (asset.value === null || asset.total === null || asset.total <= 0) continue;
      const liquid = displayValue(asset.amounts.liquid, asset.identity.decimals);
      if (liquid !== null) map.set(`${asset.chainId}:${asset.identity.denom}`, (asset.value * liquid) / asset.total);
    }
    return map;
  }, [portfolio.data]);
  const valueOf = useCallback((option: AssetOption) => valueByKey.get(option.key) ?? null, [valueByKey]);

  // A page opens on a pair signed once when the wallet has one (a small
  // wallet's largest token may only swap after moving to Osmosis).
  const routeTable = swapAssets.data?.routeTable ?? null;
  const atomOnVenue = useMemo(
    () =>
      assetRows?.find((asset) => asset.kind === "venue" && asset.identity.originChainId === "cosmoshub-4" && asset.identity.originDenom === "uatom")
        ?.osmosisDenom ?? null,
    [assetRows],
  );
  const oneSignature = useCallback((option: AssetOption) => opensInOneSignature(option, routeTable, atomOnVenue), [routeTable, atomOnVenue]);

  const linkedFrom = resolveLinkedOption(sell, fromPick);
  const from = linkedFrom ?? sell.find((option) => option.key === defaultFromKey(sell, listed, valueOf, oneSignature));
  // Only a link's pick is reported missing; a pick the scope no longer lists falls back quietly.
  const fromMissing = link.from !== null && fromPick === link.from && !linkedFrom && portfolio.data !== null && !portfolio.stale;

  const buy = useMemo(() => buyOptions(held, { from, swapAssets: assetRows ?? [], routeTable }), [held, from, assetRows, routeTable]);
  const linkedTo = resolveLinkedOption(buy, toPick);
  // Nothing is offered by default for a token Osmosis does not trade: every
  // row would be refused, and the form says why instead.
  const to = linkedTo ?? (from?.osmosisDenom ? buy.find((option) => option.key === defaultToKey(from, buy)) : undefined);
  const toMissing = link.to !== null && toPick === link.to && !linkedTo && swapAssets.data !== null;

  const venueTokens = useMemo(() => {
    const map = new Map<string, VenueToken>();
    for (const asset of assetRows ?? []) {
      if (asset.kind !== "venue" || map.has(asset.osmosisDenom)) continue;
      map.set(asset.osmosisDenom, { ticker: asset.identity.ticker, ...(asset.identity.logoUrl ? { logoUrl: asset.identity.logoUrl } : {}) });
    }
    return map;
  }, [assetRows]);
  const venueToken = useCallback((denom: string) => venueTokens.get(denom) ?? null, [venueTokens]);

  /* ------------------------------------------------------------ prices */

  const feeChain = from ? findChain(from.chainId) : undefined;
  const feeKey = feeChain ? `${feeChain.chainId}:${feeChain.feeMinimalDenom}` : null;
  const priceKeys = [from?.identity.key, to?.identity.key, feeKey].filter((key): key is string => Boolean(key));
  const spot = useSpotPrices(priceKeys);
  const currency = spot.data?.currency ?? prefs.currency;
  const priceOf = (key: string | null | undefined) => (key ? (spot.data?.prices[key]?.price ?? null) : null);
  const fromPrice = priceOf(from?.identity.key);
  const toPrice = priceOf(to?.identity.key);
  const feePrice = priceOf(feeKey);
  const priceLabels = [...new Set([from, to].map((side) => (side ? spot.data?.prices[side.identity.key]?.label : undefined)).filter((label): label is string => Boolean(label)))];

  /* ------------------------------------------------------------ amount and quote */

  const amountUnits = amountUnitsOf(from, amountText);
  const typed = amountUnits !== null && amountUnits > ZERO;
  // Priced before anything is typed: about 100 in the user's currency, or
  // the whole balance when it is worth less.
  const balance = from && /^\d+$/.test(from.amount) ? BigInt(from.amount) : ZERO;
  const indicativeSize = from ? indicativeAmount(from.decimals, fromPrice, balance) : null;
  const indicativeAll = indicativeSize?.units ?? null;
  const indicative = typed ? null : indicativeAll;
  const pricedUnits = typed ? amountUnits : indicative;
  const quotable = Boolean(from && to && to.disabledReason === null && from.osmosisDenom);
  const quoteInput = quotable ? quoteRequestFor({ from, to, amountUnits: pricedUnits, slippagePercent: slippage }) : null;
  const quoteState = useSwapQuote(quoteInput?.request ?? null);
  // An answer kept on screen while the next one loads is shown (dimmed) only
  // when it is for this pair.
  const indicativeFee = from && indicativeAll !== null ? swapFeeFor(from.chainId, indicativeAll) : null;
  const indicativeNet = indicativeFee ? indicativeFee.net.toString() : null;
  const forPair = <T extends { venueInputDenom: string; venueOutputDenom: string; delivery?: SwapQuoteOk["delivery"] }>(quote: T | null | undefined): T | null =>
    quote && from && to && (!quoteState.stale || quoteMatchesPair(quote, from, to)) ? quote : null;
  const rawShown = quoteState.data && !quoteState.data.blocked ? (quoteState.data as SwapQuoteOk) : null;
  const shown = forPair(rawShown);
  const preview = forPair(quoteState.data?.blocked ? (quoteState.data.preview ?? null) : null);
  const quoteOnScreen = shown ?? preview;
  const live = quoteState.quote;
  // The answer on screen is named by the amount it was priced for (every
  // quote carries it, net of the fee: `amountIn`), never by the form: right
  // after typing, the indicative answer stays on screen (dimmed) until the
  // typed amount's own lands, and after clearing the field the last typed
  // answer stays until the indicative one does.
  const isIndicative = quoteOnScreen !== null && quoteOnScreen.amountIn === indicativeNet && (!typed || quoteState.stale);
  // The Zunia fee, and so what was spent in all, for that same amount: the
  // panel's costs are read against what the quote sold, never against an
  // amount typed since (an indicative quote for 2,900 OSMO set against 0.5
  // typed read "+572,138% vs market").
  const pricedFee =
    !quoteOnScreen || !from
      ? null
      : isIndicative
        ? indicativeFee
        : quoteInput && quoteOnScreen.amountIn === quoteInput.fee.net.toString()
          ? quoteInput.fee
          : feeForNet(from.chainId, quoteOnScreen.amountIn);
  // A typed amount never shows the indicative answer as its own.
  const typedShown = typed && shown && !(quoteState.stale && indicativeNet !== null && shown.amountIn === indicativeNet) ? shown : null;

  /* ------------------------------------------------------------ review, preview, fee */

  const [maxKept, setMaxKept] = useState<{ text: string; reserve: FeeReserve; fromKey: string } | null>(null);
  const [review, setReview] = useState<SwapReview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [lastSwap, setLastSwap] = useState<SignedSwap | null>(null);
  const reviewSeq = useRef(0);

  const signerAddress = live ? addressFor(live.signingChainId) : null;
  const recipientAddress = to ? addressFor(to.chainId) : null;
  const venueAddress = addressFor(VENUE);
  const { request: previewRequest, preview: txPreview } = useSwapFeePreview({
    dialogReview: dialogOpen ? review : null,
    // Nothing to measure for more than the balance: the chain would refuse it.
    typed: typed && from !== undefined && /^\d+$/.test(from.amount) && amountUnits <= BigInt(from.amount),
    quote: live,
    from,
    to,
    amountUnits,
    slippagePercent: slippage,
    signer: signerAddress,
    recipient: recipientAddress,
    venue: venueAddress,
  });
  const measuredFee = txPreview.preview?.fee ?? null;
  const measuredUnits = measuredFee?.amount[0]?.amount ? BigInt(measuredFee.amount[0].amount) : null;

  const reserve = from ? feeReserve(from.denom, feeChain, measuredFee && measuredUnits !== null ? { denom: measuredFee.denom, amount: measuredUnits } : null) : null;
  const spendable = spendableUnits(balance, reserve);
  const feeBalance = feeChain ? (held.find((token) => token.chainId === feeChain.chainId && token.denom === feeChain.feeMinimalDenom)?.amount ?? "0") : "0";
  const feeShort =
    typed && measuredUnits !== null && feeChain !== undefined && from !== undefined
      ? BigInt(feeBalance) < measuredUnits + (from.denom === feeChain.feeMinimalDenom ? amountUnits : ZERO)
      : false;

  const networkFee: NetworkFeeView = (() => {
    if (!typed) return { state: "none", reason: isIndicative ? "Measured once you enter an amount" : "Enter an amount" };
    if (quoteOnScreen?.path === "move-first") return { state: "none", reason: "Step 1 is priced on the Bridge page" };
    if (from && amountUnits > balance) return { state: "none", reason: "Measured once the amount fits your balance" };
    if (txPreview.preview) {
      const fee = txPreview.preview.fee;
      const display = Number(fee.display);
      return {
        state: "ready",
        amount: fee.display,
        symbol: fee.symbol ?? feeChain?.feeDenom ?? "",
        fiat: feePrice !== null && Number.isFinite(display) ? display * feePrice : null,
        measured: txPreview.preview.gas.method === "simulated",
        stale: txPreview.stale,
      };
    }
    if (txPreview.error) return { state: "error", reason: txPreview.error.title };
    if (previewRequest) return { state: "loading" };
    if (live && (!signerAddress || !recipientAddress)) {
      const missing = !signerAddress ? live.signingChainId : (to?.chainId ?? "");
      return { state: "none", reason: `Connect ${findChain(missing)?.chainName ?? missing} in your wallet to measure it` };
    }
    return { state: "none", reason: live ? "Not measurable for this quote" : "Waiting for a price" };
  })();

  /* ------------------------------------------------------------ the button */

  const cta = formCta({
    holdingsLoading: portfolio.loading || (portfolio.status === "idle" && portfolio.accounts.param !== null),
    sellCount: sell.length,
    from,
    to,
    amountText,
    amountUnits,
    slippageValid: slippageNotice(slippage).valid,
    requestReady: quoteInput !== null,
    quote: {
      loading: quoteState.loading,
      stale: quoteState.stale,
      refreshing: quoteState.refreshing,
      error: quoteState.error,
      blocked: quoteState.blocked,
      current: live,
    },
    feeShort,
    now,
  });

  /* ------------------------------------------------------------ actions */

  // Picking another pair abandons a pending step 2.
  const pickFrom = (option: AssetOption) => {
    setFormProblem(null);
    if (intent && option.key !== intent.fromKey) forgetIntent();
    if (to && option.key === to.key && from) setToPick(from.key);
    setFromPick(option.key);
    setAmountText((text) => (option.decimals === null ? "" : text));
  };
  const pickTo = (option: AssetOption) => {
    setFormProblem(null);
    if (intent && option.key !== intent.toKey) forgetIntent();
    if (from && option.key === from.key && to && sell.some((row) => row.key === to.key)) setFromPick(to.key);
    setToPick(option.key);
  };
  const toSellable = to ? sell.find((row) => row.key === to.key) : undefined;
  const flip = () => {
    if (!from || !to || !toSellable) return;
    // The two sides trade places with their amounts: what this quote would
    // buy becomes what is sold (the button then says if the balance is short).
    const output = typedShown && !quoteState.stale ? receiveView(typedShown).amount : null;
    const nextText = output && toSellable.decimals !== null && /^\d+$/.test(output) ? fromBaseUnits(output, toSellable.decimals) : "";
    setFromPick(to.key);
    setToPick(from.key);
    setAmountText(nextText === "0" ? "" : nextText);
    setFormProblem(null);
    if (intent) forgetIntent();
  };

  const freeze = (quote: SwapQuoteOk, addresses: { signer: string; recipient: string; recovery: string | null }) => {
    if (!from || !to || amountUnits === null) return null;
    reviewSeq.current += 1;
    return freezeReview({
      id: reviewSeq.current,
      from,
      to,
      amountUnits,
      quote,
      slippagePercent: slippage,
      signer: addresses.signer,
      recipient: addresses.recipient,
      recoveryAddress: addresses.recovery,
    });
  };

  const startReview = async () => {
    const quote = live;
    if (!quote || !from || !to) return;
    setFormProblem(null);
    try {
      const signer = addressFor(quote.signingChainId) ?? (await ensureChain(quote.signingChainId));
      const recipient = addressFor(to.chainId) ?? (await ensureChain(to.chainId));
      const recovery = quote.path === "contract" ? (addressFor(VENUE) ?? (await ensureChain(VENUE))) : null;
      const frozen = freeze(quote, { signer, recipient, recovery });
      if (!frozen) return;
      if ("problem" in frozen) {
        setFormProblem(frozen.problem);
        return;
      }
      setReview(frozen.review);
      setDialogOpen(true);
    } catch (error) {
      setFormProblem(explainError(error).message);
    }
  };

  const acceptNewPrice = () => {
    if (!review || !live) return;
    const frozen = freeze(live, { signer: review.signer, recipient: review.recipient, recovery: live.path === "contract" ? (review.recoveryAddress ?? venueAddress) : null });
    if (!frozen) return;
    if ("problem" in frozen) {
      setFormProblem(frozen.problem);
      setDialogOpen(false);
      return;
    }
    setReview(frozen.review);
  };

  const startMoveFirst = () => {
    const quote = live;
    if (!quote || quote.path !== "move-first" || !from || !to) return;
    rememberSwapIntent({ fromKey: `${VENUE}:${quote.venueInputDenom}`, toKey: to.key });
    const query = new URLSearchParams({ from: from.key, to: VENUE });
    if (amountText.trim()) query.set("amount", amountText.trim());
    router.push(`/bridge?${query.toString()}`);
  };

  const onCta = () => {
    if (cta.action === "review") void startReview();
    else if (cta.action === "move-first") startMoveFirst();
    else if (cta.action === "retry") quoteState.requote();
  };

  // Keep the address bar on the pair asked for, so a reload or a shared link
  // reopens it: the rows on screen, or a pick still waiting for its balance
  // (step 2 of a two-step swap, a link's token not held in this scope), never
  // the fallback shown meanwhile. No amount: a link should not carry one.
  const fromKey = linkedFrom?.key ?? fromPick ?? from?.key ?? null;
  const toKey = linkedTo?.key ?? toPick ?? to?.key ?? null;
  useEffect(() => {
    if (!fromKey || !toKey) return;
    const href = swapHref(fromKey, toKey);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [fromKey, toKey]);

  /* ------------------------------------------------------------ derived view */

  // `null` (no figure) without a price or an exponent: never a made-up $0.00.
  const worth = (units: bigint | string, decimals: number | null, price: number | null) => {
    const whole = displayValue(units, decimals);
    return whole === null || price === null ? null : whole * price;
  };
  const fiatTyped = typed && from ? worth(amountUnits, from.decimals, fromPrice) : undefined;
  const received = typedShown ? receiveView(typedShown) : null;
  const receiveFiat = received && to ? worth(received.amount, to.decimals, toPrice) : undefined;
  const market = marketRate(fromPrice, toPrice);
  const vsMarket = typedShown?.rate.toPerFrom ? versus(Number(typedShown.rate.toPerFrom), market) : null;

  const shares = from?.osmosisDenom
    ? from.decimals === null
      ? [{ label: "Max", text: spendable > ZERO ? spendable.toString() : "" }]
      : [
          { label: "25%", text: shareText(spendable, 25, from.decimals) },
          { label: "50%", text: shareText(spendable, 50, from.decimals) },
          {
            label: "Max",
            text: shareText(spendable, 100, from.decimals),
            ...(reserve ? { title: `Keeps ${tickerAmount(reserve.units, from)} for the network fee` } : {}),
          },
        ]
    : [];
  const maxText = shares[shares.length - 1]?.text ?? "";
  // What Max kept when it filled the field. The reserve can change after that
  // (a measured fee replaces the first estimate): the amount is not rewritten
  // under the user, and the note keeps describing the amount on screen.
  const maxNote = maxKept && maxKept.text === amountText && maxKept.fromKey === from?.key ? maxKept : null;
  const payNote =
    from?.decimals === null
      ? "This token's decimals are unknown, so only Max can be used."
      : maxNote && from
        ? `Max keeps ${tickerAmount(maxNote.reserve.units, from)} for the network fee${maxNote.reserve.measured ? "" : " (estimate)"}.`
        : null;

  const pathQuote = typedShown;
  const copy =
    pathQuote && from && to
      ? pathCopy({
          path: pathQuote.path,
          from,
          to,
          minimumText: pathQuote.minOut ? tickerAmount(pathQuote.minOut, to) : null,
          delivery: pathQuote.delivery ?? null,
          inbound: pathQuote.inbound ?? null,
        })
      : null;

  const intentResolved = intent !== null && from?.key === intent.fromKey;
  const intentTicker = intent ? (venueTokens.get(intent.fromKey.slice(intent.fromKey.indexOf(":") + 1))?.ticker ?? null) : null;
  const intentTo = intent ? (buy.find((option) => option.key === intent.toKey)?.ticker ?? null) : null;
  const intentWaiting = intent !== null && !intentResolved && fromPick === intent.fromKey;
  const pathSteps: Step[] | undefined =
    pathQuote?.path === "move-first" && from
      ? [
          { label: `Move ${from.ticker} to Osmosis`, state: "current", description: "With Bridge, signed on its own" },
          { label: "Swap on Osmosis", state: "todo", description: "Back here once it arrives" },
        ]
      : intentResolved && from
        ? [
            { label: `Move to Osmosis`, state: "done", description: "Arrived" },
            { label: `Swap ${from.ticker}`, state: "current", description: "One transaction on Osmosis" },
          ]
        : undefined;

  const scopeName = scope.selectedChain?.chainName ?? null;
  const contractReason = swapAssets.data?.contract.reason ?? null;

  const clockState = !quoteInput ? "idle" : quoteState.loading ? "loading" : quoteState.refreshing ? "refreshing" : quoteState.expired ? "expired" : live ? "live" : "idle";

  // From the indicative amount itself (not `indicative`, which is null once
  // something is typed: the indicative answer then stays on screen, dimmed,
  // until the typed amount's own lands).
  const indicativeText = (() => {
    if (!isIndicative || !from || !indicativeSize) return null;
    const whole = displayValue(indicativeSize.units, from.decimals);
    // A balance has every digit: cut like the page's other amounts (a round indicative amount has few).
    const digits = indicativeSize.ofBalance ? fractionDigits(indicativeSize.units, from.decimals) : 6;
    const amount = `${formatTokenAmount(indicativeSize.units, from.decimals, { maxFraction: digits })} ${from.ticker}`;
    if (indicativeSize.ofBalance) {
      return `your balance, ${amount}${whole !== null && fromPrice !== null ? ` (≈ ${formatFiat(whole * fromPrice, currency)})` : ""}`;
    }
    return `${amount}${fromPrice !== null ? ` (≈ ${formatFiat(100, currency, { precision: 0 })})` : ""}`;
  })();

  /* ------------------------------------------------------------ render */

  const holdingsError = portfolio.error && !portfolio.data;
  const noHoldings = !portfolio.loading && portfolio.data !== null && sell.length === 0;

  const swapCard = (
    <Card as="section" variant="hero" aria-labelledby="swap-card-title" className="gap-3.5">
      <CardHeader
        id="swap-card-title"
        title="Swap tokens"
        subtitle="Through Osmosis · 0.5% Zunia fee"
        actions={
          <>
            <PartialDataBadge errors={portfolio.data?.errors ?? null} />
            <SlippageControl value={slippage} onChange={setStoredSlippage} twapWindowSeconds={live?.path === "contract" ? (live.twapWindowSeconds ?? null) : null} />
          </>
        }
      />

      {holdingsError ? (
        <InlineError title="Couldn't load your balances" message={portfolio.error?.message ?? "The balance read failed."} onRetry={portfolio.refetch} />
      ) : noHoldings ? (
        <EmptyState
          icon="wallet"
          title={scopeName ? `Nothing to swap on ${scopeName}` : "Nothing to swap yet"}
          body={scopeName ? "No liquid balance on this chain. Show every chain, or receive tokens first." : "No liquid balance on your followed chains. Receive tokens first."}
          action={
            scopeName ? (
              <Button size="sm" onClick={() => scope.setSelectedChainId(null)}>
                Show all chains
              </Button>
            ) : (
              <Button size="sm" href="/receive" iconLeft="receive">
                Receive
              </Button>
            )
          }
        />
      ) : (
        <>
          {fromMissing && !intentWaiting ? (
            <Callout
              tone="neutral"
              icon="info"
              title="The token from the link isn't in your balances here"
              action={
                scopeName ? (
                  <Button size="sm" onClick={() => scope.setSelectedChainId(null)}>
                    Show all chains
                  </Button>
                ) : undefined
              }
            >
              {scopeName ? `Only your ${scopeName} balances are listed in this scope.` : "Pick a token you hold below."}
            </Callout>
          ) : null}
          {intentWaiting && intent ? (
            <Callout
              tone="info"
              icon="hourglass"
              title={`Step 2: waiting for your ${intentTicker ?? "tokens"} on Osmosis`}
              action={
                <Button size="sm" iconLeft="refresh" loading={portfolio.refreshing} onClick={portfolio.refetch}>
                  Check balances
                </Button>
              }
            >
              {`When the transfer from step 1 lands, ${intentTicker ?? "they"} ${intentTicker ? "shows" : "show"} up here, ready to swap${intentTo ? ` for ${intentTo}` : ""}. Transfers usually take a minute or two.`}
            </Callout>
          ) : null}
          {toMissing ? (
            <Callout tone="neutral" icon="info">
              The token to receive from the link can&apos;t be delivered here, so the usual pair is shown.
            </Callout>
          ) : null}

          <div className="flex flex-col gap-1">
            <PayField
              amountText={amountText}
              onAmountChange={(text) => {
                setFormProblem(null);
                setAmountText(text);
                if (reserve && text !== "" && text === maxText && from) setMaxKept({ text, reserve, fromKey: from.key });
              }}
              decimals={from?.decimals}
              disabled={!from}
              shares={shares}
              fiat={fiatTyped}
              currency={currency}
              balance={from ? { amount: from.amount, decimals: from.decimals, ticker: from.ticker } : null}
              error={cta.label.startsWith("Insufficient")}
              errorText={cta.reason}
              note={payNote}
              picker={
                <TokenPicker
                  side="pay"
                  options={sell}
                  value={from}
                  onSelect={pickFrom}
                  listed={listed}
                  worth={valueOf}
                  currency={portfolio.data?.currency ?? currency}
                  loading={portfolio.loading}
                />
              }
            />
            <FlipButton
              onFlip={flip}
              disabled={!toSellable}
              reason={to ? `You hold no ${to.ticker} on ${to.chainName} to sell.` : "Choose a token to receive first."}
            />
            <ReceiveField
              amount={received ? received.amount : null}
              decimals={to?.decimals ?? null}
              exact={received?.exact}
              loading={typed && quotable && quoteState.loading}
              stale={quoteState.stale}
              fiat={receiveFiat}
              currency={currency}
              vsMarket={vsMarket}
              kept={received?.kept && to ? { amount: received.kept, ticker: to.ticker } : null}
              balance={toSellable ? { amount: toSellable.amount, decimals: toSellable.decimals, ticker: toSellable.ticker } : null}
              // Said once: under the button when it is also the button's reason.
              note={to?.disabledReason && to.disabledReason !== cta.reason ? to.disabledReason : null}
              picker={
                <TokenPicker
                  side="receive"
                  options={buy}
                  value={to}
                  onSelect={pickTo}
                  listed={listed}
                  currency={currency}
                  loading={swapAssets.loading}
                  disabled={!from}
                />
              }
            />
          </div>

          {swapAssets.error && !swapAssets.data ? (
            <InlineError title="Couldn't load what Osmosis trades" message={swapAssets.error.message} onRetry={swapAssets.refetch} />
          ) : null}

          {copy && pathQuote ? (
            <PathBanner path={pathQuote.path} copy={copy} steps={pathSteps} pending={quoteState.stale} />
          ) : intentResolved && pathSteps && from && to ? (
            <PathBanner
              path="pool"
              copy={{ title: "Step 2 of 2: swap on Osmosis", body: `Your ${from.ticker} arrived on Osmosis. Enter the amount to swap for ${to.ticker}.` }}
              steps={pathSteps}
            />
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              // Crimson once the form is complete (an action, or its price on
              // the way); loading the balances is a neutral wait.
              variant={cta.action !== null || (cta.busy && from !== undefined) ? "primary" : "secondary"}
              size="lg"
              fullWidth
              loading={cta.busy}
              disabled={cta.action === null}
              onClick={onCta}
              iconRight={cta.action === "move-first" ? "arrowRight" : undefined}
              className="h-12 text-[15px] max-sm:h-[52px]"
            >
              {cta.label}
            </Button>
            {formProblem ? (
              <p role="alert" className="flex items-start gap-1.5 text-[12.5px] leading-snug text-[var(--z-danger)]">
                <Icon name="warning" size={14} className="mt-px shrink-0" />
                {formProblem}
              </p>
            ) : cta.reason ? (
              <p className="text-[12.5px] leading-snug text-fg-dim">{cta.reason}</p>
            ) : cta.action === "review" ? (
              <p className="text-[12.5px] leading-snug text-fg-dim">You check every figure before your wallet opens. Nothing moves until you approve it there.</p>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );

  const notices =
    contractReason && (live?.path === "contract" || quoteState.blocked?.code === "venue-unavailable") ? (
      <Callout tone="warning" title="Cross-chain contract unavailable">
        {contractReason} Swaps of tokens already on Osmosis still work.
      </Callout>
    ) : null;

  return (
    <div className="flex flex-col gap-[var(--d-gap)]">
      {/* Desktop: the figures across the top, then the swap card (sticky
          while the analysis scrolls) beside the route and the chart. The card
          keeps a form's width (380-460 px) and the analysis takes the rest, so
          it stays the wider column at 1280 with the sidebar open. Phones and
          tablets: the swap card first, then the figures, then the rest. */}
      <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)] min-[90rem]:grid-cols-[440px_minmax(0,1fr)] 2xl:grid-cols-[460px_minmax(0,1fr)]">
        {/* Nothing to count without balances or the venue's listing: the swap
            card says which is missing on its own. Lite leaves the counts out. */}
        {prefs.lite || holdingsError || noHoldings || (swapAssets.error && !swapAssets.data) ? null : (
          <SwapStrip
            sell={sell}
            listed={listed}
            valueOf={valueOf}
            currency={portfolio.data?.currency ?? currency}
            loading={(portfolio.loading && !portfolio.data) || (swapAssets.loading && !swapAssets.data)}
            pending={portfolio.refreshing}
            className="order-2 lg:order-1 lg:col-span-2"
          />
        )}
        <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-[calc(var(--d-sticky-top)+16px)]">{swapCard}</div>
        <div className="order-3 flex min-w-0 flex-col gap-[var(--d-gap)]">
          {lastSwap && !dialogOpen ? <LastSwapCard swap={lastSwap} onDismiss={() => setLastSwap(null)} /> : null}
          <RoutePanel
            from={from}
            to={to}
            quote={quoteOnScreen}
            indicative={indicativeText}
            pricingTyped={typed && quoteState.stale}
            stale={quoteState.stale}
            error={quoteState.error && !quoteState.data ? quoteState.error.message : null}
            blocked={
              quoteState.blocked && !quoteState.stale
                ? quoteState.blocked
                : from && !from.osmosisDenom
                  ? { message: `${from.ticker} is not traded on Osmosis, so Zunia cannot swap it.`, title: `${from.ticker} can't be swapped here` }
                  : !quotable && from && to?.disabledReason
                    ? { message: to.disabledReason }
                    : null
            }
            blockedAction={
              from && !from.osmosisDenom ? (
                from.identity.kind === "native" && from.identity.originChainId === from.chainId ? (
                  <Button size="sm" href="/staking" iconLeft="staking">
                    Stake {from.ticker}
                  </Button>
                ) : (
                  <Button size="sm" href="/bridge" iconLeft="bridge">
                    Move it with Bridge
                  </Button>
                )
              ) : undefined
            }
            onRetry={quoteState.requote}
            clock={{ state: clockState, secondsLeft: quoteState.secondsLeft, onRefresh: quoteState.requote }}
            fee={pricedFee}
            spentUnits={pricedFee ? pricedFee.net + pricedFee.fee : null}
            prices={{ from: fromPrice, to: toPrice, currency, source: priceLabels.length > 0 ? priceLabels.join(" + ") : null, at: spot.updatedAt }}
            networkFee={networkFee}
            venueToken={venueToken}
            slippagePercent={slippage}
            notices={notices}
            waiting={portfolio.loading || swapAssets.loading}
            nothingToSell={holdingsError ? "error" : noHoldings ? "empty" : null}
            now={now}
          />
          {from && to && !prefs.lite ? (
            <PairChart from={from} to={to} quoteRate={typedShown && !quoteState.stale && typedShown.rate.toPerFrom ? Number(typedShown.rate.toPerFrom) : null} />
          ) : null}
          {/* Lite: recent swaps take the chart's place beside the card. */}
          {prefs.lite ? <RecentSwaps /> : null}
        </div>
      </div>

      {prefs.lite ? null : <RecentSwaps />}

      <ReviewDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // A signed swap leaves the form empty for the next one (kept while
          // its card is open, so the card's figures stay measured).
          if (!open && lastSwap && review && lastSwap.review.id === review.id) setAmountText("");
        }}
        review={review}
        live={{ fromKey: from?.key ?? null, toKey: to?.key ?? null, amountUnits, slippagePercent: slippage, path: live?.path ?? null }}
        freshQuote={live}
        liveRefreshing={quoteState.refreshing || quoteState.loading}
        onAcceptNewPrice={acceptNewPrice}
        prices={{ from: fromPrice, to: toPrice, currency }}
        networkFee={networkFee}
        feeShort={feeShort}
        cannotSign={
          review && !canSignOn(review.quote.signingChainId)
            ? `This wallet session can't sign on ${findChain(review.quote.signingChainId)?.chainName ?? review.quote.signingChainId}. Approve that chain in your wallet, then review again.`
            : null
        }
        walletName={walletKind ? walletKindLabel(walletKind) : "your wallet"}
        icons={{ from: from?.iconUrl ?? null, to: to?.iconUrl ?? null }}
        onSigned={(swap) => {
          setLastSwap(swap);
          // Step 2 is done once its swap is signed.
          if (intent) forgetIntent();
        }}
      />
    </div>
  );
}
