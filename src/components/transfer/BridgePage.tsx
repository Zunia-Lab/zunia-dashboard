"use client";

/**
 * Bridge: move a token between Cosmos chains over IBC, and watch it land.
 *
 * Native IBC only: the source chain escrows the token, the destination mints
 * a voucher against it (or releases the original when a voucher goes home),
 * and no third party holds anything. There are no EVM or Solana rails here,
 * because nothing in this dashboard can carry funds across one honestly yet.
 *
 * Left, the transfer: from → to (swap them with one click), the token (only
 * what you hold on the source chain, each saying how it will move), the
 * amount, the recipient (your own address on the destination unless you
 * change it), the planned route with every channel's verdict, the time
 * (measured on your own past transfers when there are some) and the fee.
 * Right, what is moving now (persisted, so a reload or another page does not
 * lose it), the routes your holdings and habits suggest, where your tokens
 * are and how long your routes take. Below, the IBC transfers the chains
 * have recorded.
 *
 * Scope: balances are read on every followed chain (a transfer has two
 * ends); the selected chain is the default source, and the history figures
 * and lists keep to transfers that touch it.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Page } from "@/components/shell/Page";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ChainLogo,
  EmptyState,
  FIELD_FRAME,
  IconButton,
  Input,
  InlineError,
  Money,
  PartialDataBadge,
  TokenAmount,
  toast,
  useNow,
  useReducedMotion,
  type KeyValueItem,
} from "@/components/ui";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { CHAINS, findChain, findChainsByPrefix, sortChains, type ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { usePortfolio } from "@/lib/data/portfolio";
import { MASK, formatAmount, formatDuration, formatFiat, formatPercent, shortenAddress } from "@/lib/format";
import type { HopOverrideInput } from "@/lib/interchain/client";
import { usePlan } from "@/lib/interchain/hooks";
import { explainMemo } from "@/lib/interchain/memo-summary";
import type { RoutePlanWire } from "@/lib/interchain/wire";
import { countInFlight, pendingTransfers, usePendingTransfers } from "@/lib/pending-transfers";
import { SWAP_INTENT_KEY, takeSwapIntent, type SwapIntent } from "@/lib/swap/intent";
import { buildTransfer } from "@/lib/tx/messages";
import type { FeeTier, SignRequest } from "@/lib/tx/types";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { AddressChunks } from "./AddressChunks";
import { AmountField, useMaxFollowsReserve } from "./AmountField";
import { AssetPicker } from "./AssetPicker";
import { ChainSpreadCard, DeliveryTimesCard, InFlightCard, RouteSuggestionsCard } from "./BridgeCards";
import { ChainPicker } from "./ChainPicker";
import { FeeTierPicker } from "./FeeTierPicker";
import { Glyph } from "./glyphs";
import {
  awayFromHome,
  balanceKey,
  checkRecipient,
  exceeds,
  fallbackDestination,
  feeShare,
  fromBase,
  isPositive,
  maxSendable,
  missingTokenReason,
  moveKind,
  plannableOverrides,
  spendableAssets,
  splitBalanceKey,
  STRANGER_CHANNEL_PROBLEM,
  strangerChannels,
  subtractUnits,
  toBase,
  transferIntentProblem,
  valueOf,
  type RouteSuggestion,
  type SpendableAsset,
} from "./logic";
import { MissingTokenNote, missingTokenLabel, missingTokenText, type MissingToken } from "./MissingTokenNote";
import { chainName } from "./names";
import type { TransferPrefill } from "./prefill";
import { RecentTransfers } from "./RecentTransfers";
import { RouteSection } from "./RouteSection";
import { channelVerdict } from "./RouteView";
import { SIDE_STACK, Stat, StatStrip } from "./StatStrip";
import { TransferTracker } from "./TransferTracker";
import { ResultHeader, ReviewPanel, SignProgress } from "./TxFlow";
import { useBridgeHistory } from "./useBridgeHistory";
import { useWalletTxPreview } from "./usePreview";

const IBC_TIMEOUT_MINUTES = 10;

export function BridgePage({ prefill }: { prefill: TransferPrefill }) {
  return (
    <Page
      title="Bridge"
      subtitle="Move tokens between Cosmos chains over IBC"
      access="wallet"
      connectTitle="Connect a wallet to bridge"
      connectDescription="Move tokens between Cosmos chains over native IBC: the route is planned and every channel checked before you sign, and the transfer is followed until it lands."
    >
      <BridgeBody prefill={prefill} />
    </Page>
  );
}

/** The swap page's "move first" intent, read without consuming it (Swap takes it when the user returns). */
const noopSubscribe = () => () => {};
function readIntentRaw(): string | null {
  try {
    return window.sessionStorage.getItem(SWAP_INTENT_KEY);
  } catch {
    return null;
  }
}
function useSwapIntent(): SwapIntent | null {
  const raw = useSyncExternalStore(noopSubscribe, readIntentRaw, () => null);
  const now = useNow();
  return useMemo(() => {
    if (!raw || now === null) return null;
    // `takeSwapIntent` validates shape and age; the storage given to it
    // forgets nothing, so Swap still finds the intent when the user returns.
    return takeSwapIntent(now, { getItem: () => raw, setItem: () => {}, removeItem: () => {} });
  }, [raw, now]);
}

type Step = "form" | "review" | "signing" | "done";

interface Sent {
  txHash: string;
  confirmed: boolean;
  fromChainId: string;
  toChainId: string;
  amount: string;
  asset: SpendableAsset;
  recipient: string;
  plan: RoutePlanWire;
}

function BridgeBody({ prefill }: { prefill: TransferPrefill }) {
  const { addressFor, canSignOn } = useWallet();
  const { selectedChainId, followedOnNetwork, network } = useChainScope();
  const prefs = usePrefs();
  // Bridging is between chains, so every followed chain is read whatever the
  // rail has selected; the selection only picks the default source.
  const portfolio = usePortfolio({ scope: "followed" });
  const currency = portfolio.data?.currency ?? prefs.currency;
  const activity = useActivity({ chains: followedOnNetwork });
  const pending = usePendingTransfers();
  const intent = useSwapIntent();
  const tx = useSignAndBroadcast();
  const recipientInputId = useId();

  const assets = useMemo(() => spendableAssets(portfolio.data?.assets ?? []), [portfolio.data]);
  const followedChains = useMemo(
    () => sortChains(followedOnNetwork.map((id) => findChain(id)).filter((chain): chain is ChainEntry => Boolean(chain))),
    [followedOnNetwork],
  );
  const otherChains = useMemo(
    () => sortChains(CHAINS.filter((chain) => chain.network === network && !followedOnNetwork.includes(chain.chainId))),
    [network, followedOnNetwork],
  );
  const liquidByChain = useMemo(() => {
    const map = new Map<string, { value: number | null; count: number }>();
    for (const row of assets) {
      const entry = map.get(row.chainId) ?? { value: null, count: 0 };
      entry.count += 1;
      if (row.value !== null) entry.value = (entry.value ?? 0) + row.value;
      map.set(row.chainId, entry);
    }
    return map;
  }, [assets]);

  /* ------------------------------------------------------------- form state */
  const intentChain = intent ? intent.fromKey.split(":")[0] : null;
  const [fromChoice, setFromChoice] = useState<string | null>(prefill.from ?? null);
  const [toChoice, setToChoice] = useState<string | null>(prefill.to ?? intentChain ?? null);
  const [assetChoice, setAssetChoice] = useState<string | null>(
    prefill.from && prefill.denom ? balanceKey(prefill.from, prefill.denom) : null,
  );
  const [amountText, setAmountText] = useState(prefill.amount ?? "");
  const [recipientEdit, setRecipientEdit] = useState<string | null>(null);
  const [tier, setTier] = useState<FeeTier>("average");
  const [overrides, setOverrides] = useState<Record<string, HopOverrideInput>>({});
  const [step, setStep] = useState<Step>("form");
  const [sent, setSent] = useState<Sent | null>(null);
  /** What the review showed (see `reviewKey`), and the token it showed. */
  const [reviewed, setReviewed] = useState<{ key: string; asset: SpendableAsset } | null>(null);
  /** The review went back to the form because the transfer changed under it. */
  const [reviewDrifted, setReviewDrifted] = useState(false);

  const history = useBridgeHistory({
    items: activity.items,
    loadedUntil: activity.loadedUntil,
    assets,
    followed: followedOnNetwork,
    selectedChainId,
  });
  const { routes, paired: pairedIbc, counts, movedOut, movedOutItems, historyPrices, since, routeTimings, allSince, timingFor } = history;

  // With nothing chosen and nothing in the link, the form opens on the
  // user's most used route (when they still hold its token), else on the
  // selected chain or the most valuable balance, sent to the swap venue.
  const usual = useMemo(
    () => routes.find((route) => route.reason === "used" && (!selectedChainId || route.fromChainId === selectedChainId)) ?? null,
    [routes, selectedChainId],
  );

  const fromChainId = useMemo(() => {
    const held = (id: string | null | undefined) => (id && liquidByChain.has(id) ? id : null);
    return (
      (fromChoice && findChain(fromChoice) ? fromChoice : null) ??
      held(usual?.fromChainId) ??
      held(selectedChainId) ??
      assets[0]?.chainId ??
      followedChains[0]?.chainId ??
      null
    );
  }, [fromChoice, liquidByChain, usual, selectedChainId, assets, followedChains]);

  const assetsHere = useMemo(() => assets.filter((row) => row.chainId === fromChainId), [assets, fromChainId]);
  const usualHere = usual && usual.fromChainId === fromChainId ? usual : null;
  // From the swap venue nothing goes "to the venue": without a usual route
  // from there, the form opens on a token held there away from home, sent
  // home (its canonical route, the one the token itself proves).
  const homeHere = useMemo(
    () =>
      fromChainId === SWAP_VENUE_CHAIN_ID && !usualHere
        ? (routes.find((route) => route.reason === "home" && route.fromChainId === fromChainId && (!toChoice || toChoice === route.toChainId)) ?? null)
        : null,
    [fromChainId, usualHere, routes, toChoice],
  );

  // The token on the form. One the user picked (or a link or a suggestion
  // named) is never swapped for another: when it is not among the balances
  // read (spent, or its chain did not answer this time) the form has no
  // token and says why (`missing`). An amount typed for one balance must
  // never be signed against another, least of all on the open review.
  const asset: SpendableAsset | null = assetChoice
    ? (assetsHere.find((row) => row.key === assetChoice) ?? null)
    : (usualHere?.asset ?? homeHere?.asset ?? assetsHere[0] ?? null);

  const toChainId = useMemo(() => {
    if (toChoice && toChoice !== fromChainId && findChain(toChoice)) return toChoice;
    if (!fromChoice && usualHere) return usualHere.toChainId;
    if (fromChainId !== SWAP_VENUE_CHAIN_ID && followedOnNetwork.includes(SWAP_VENUE_CHAIN_ID)) return SWAP_VENUE_CHAIN_ID;
    if (homeHere && (!assetChoice || assetChoice === homeHere.asset.key)) return homeHere.toChainId;
    return fallbackDestination(
      fromChainId,
      asset,
      followedChains.map((chain) => chain.chainId),
      (chainId) => liquidByChain.get(chainId)?.value ?? null,
    );
  }, [toChoice, fromChoice, fromChainId, usualHere, followedOnNetwork, homeHere, assetChoice, asset, followedChains, liquidByChain]);

  const fromChain = fromChainId ? findChain(fromChainId) : undefined;
  const toChain = toChainId ? findChain(toChainId) : undefined;
  const balancesFailed = portfolio.status === "error" && !portfolio.data;
  const historyFailed = activity.status === "error" && activity.items.length === 0;
  // Said only about a settled read: while a new one loads, the previous answer is still on screen.
  const missing = useMemo<MissingToken | null>(() => {
    if (!assetChoice || asset || !portfolio.data || portfolio.stale) return null;
    const { chainId, denom } = splitBalanceKey(assetChoice);
    const read = portfolio.data.chains.find((row) => row.chainId === chainId);
    return {
      // Bridge reads every followed chain, whatever the rail selects.
      reason: missingTokenReason(chainId, { scoped: followedOnNetwork, followed: followedOnNetwork, chainStatus: read?.status ?? null }),
      chainId,
      token: missingTokenLabel(chainId, denom, portfolio.data.assets),
    };
  }, [assetChoice, asset, portfolio.data, portfolio.stale, followedOnNetwork]);

  /**
   * The defaults above can still move while the reads land (the history
   * arrives after the balances). Once the user starts filling the form, what
   * is on screen becomes their choice, so an amount never ends up attached to
   * a token they did not pick.
   */
  const pinDefaults = () => {
    if (fromChoice === null && fromChainId) setFromChoice(fromChainId);
    if (toChoice === null && toChainId) setToChoice(toChainId);
    if (assetChoice === null && asset) setAssetChoice(asset.key);
  };
  const decimals = asset?.decimals ?? null;
  const symbol = asset?.identity.ticker ?? "";
  const sender = fromChainId ? addressFor(fromChainId) : null;
  const ownOnDest = toChainId ? addressFor(toChainId) : null;

  /* ------------------------------------------------------------- recipient */
  const recipientText = recipientEdit ?? ownOnDest ?? "";
  const usingOwn = recipientEdit === null && Boolean(ownOnDest);
  const check = useMemo(() => checkRecipient(recipientText, (prefix) => findChainsByPrefix(prefix, toChainId)), [recipientText, toChainId]);
  const prefixOk = check.state === "valid" && toChain ? check.prefix === toChain.bech32Prefix : false;
  const recipient = prefixOk ? check.address : "";
  const isOwn = Boolean(recipient && recipient === ownOnDest);
  const recipientProblem =
    check.state === "empty"
      ? null
      : check.state === "valid" && toChain && !prefixOk
        ? `${toChain.chainName} addresses start with ${toChain.bech32Prefix}1…`
        : check.state === "partial"
          ? null
          : check.message;

  /* ------------------------------------------------------------- amount + route */
  const amountBase = asset ? toBase(amountText, decimals) : null;
  const isFeeToken = Boolean(asset && fromChain && asset.denom === fromChain.feeMinimalDenom);
  const planInput = useMemo(() => {
    if (!asset || !sender || !toChainId || !recipient || asset.chainId === toChainId) return null;
    return {
      sourceChainId: asset.chainId,
      destChainId: toChainId,
      inputDenom: asset.denom,
      amount: isPositive(amountBase) ? amountBase : "1",
      sender,
      recipient,
      allowSwap: false,
      overrides: plannableOverrides(overrides),
    };
  }, [asset, sender, toChainId, recipient, amountBase, overrides]);
  const plan = usePlan(planInput);
  const candidate = plan.data?.candidates[0] ?? null;
  const hop = candidate?.plan.hops[0] ?? null;
  const sendAmount = isPositive(amountBase) && asset && !exceeds(amountBase, asset.liquid) ? amountBase : null;
  // Built for the fee preview now, and again at signing: the packet's
  // timeout counts from when the message is made, and the review promises
  // the funds come back if nothing delivers them within 10 minutes of the
  // signature, not of the moment the form was filled.
  const makeMessage = useCallback(() => {
    if (!asset || !sender || !candidate || !hop || !/^channel-\d+$/.test(hop.channelId)) return null;
    return buildTransfer({
      sourcePort: hop.port,
      sourceChannel: hop.channelId,
      token: { denom: asset.denom, amount: sendAmount ?? "1" },
      sender,
      receiver: candidate.receiver,
      ...(candidate.plan.memo ? { memo: candidate.plan.memo } : {}),
      timeoutMinutes: IBC_TIMEOUT_MINUTES,
    });
  }, [asset, sender, candidate, hop, sendAmount]);
  const message = useMemo(() => makeMessage(), [makeMessage]);
  const preview = useWalletTxPreview(asset && message ? { chainId: asset.chainId, messages: [message] } : null, fromChain, tier, "transfer");
  const reserve = isFeeToken ? preview.reserve : null;
  const maxBase = asset ? maxSendable(asset.liquid, reserve) : "0";
  const feeBase = isFeeToken ? (preview.fee?.amount[0]?.amount ?? null) : null;
  const followMax = useMaxFollowsReserve(asset?.key ?? null, amountBase, maxBase, decimals, setAmountText);
  const intentProblem = candidate && toChainId ? transferIntentProblem(candidate, { recipient, destChainId: toChainId }) : null;
  // Channels typed into somebody else's plan request, served back to this
  // one: not signed over until the user sets them here (`strangerChannels`).
  const strangers = useMemo(() => (candidate ? strangerChannels(candidate.links, overrides) : []), [candidate, overrides]);
  const memoExplanation = useMemo(
    () => (candidate ? explainMemo(candidate.plan.memo, { receiver: candidate.receiver, chainName: (id: string) => chainName(id) }) : null),
    [candidate],
  );

  const blocked: string | null = (() => {
    if (!portfolio.data && (portfolio.loading || portfolio.status === "idle")) return "Reading your balances…";
    if (!fromChain) return "Choose the chain to send from.";
    if (!toChain) return "Choose the chain to send to.";
    if (!asset) {
      if (balancesFailed) return "Balances could not be read.";
      if (missing) return missingTokenText(missing, "move");
      return `You hold nothing to move on ${fromChain.chainName}.`;
    }
    if (!sender) return `Your wallet has no address on ${fromChain.chainName}.`;
    if (!canSignOn(fromChain.chainId)) return `Your wallet cannot sign on ${fromChain.chainName}.`;
    if (!recipientText.trim()) return `Enter the recipient on ${toChain.chainName}.`;
    if (!recipient) return recipientProblem ?? "Finish the recipient address.";
    if (!amountText.trim()) return "Enter an amount.";
    if (amountBase === null) return decimals === null ? "Use Max: this token's decimals are unknown." : `Use at most ${decimals} decimal places.`;
    if (!isPositive(amountBase)) return "Enter an amount greater than zero.";
    // The balance is masked in privacy mode, like "Available" above the field.
    if (exceeds(amountBase, asset.liquid)) return `That is more than your ${prefs.mask(formatAmount(fromBase(asset.liquid, decimals), { maxFraction: 6 }))} ${symbol}.`;
    if (reserve && exceeds(amountBase, maxBase)) {
      return `Keep ${formatAmount(fromBase(reserve, decimals), { maxFraction: 6 })} ${symbol} for the network fee (Max does it for you).`;
    }
    if (plan.status === "loading" || plan.status === "idle") return "Planning the route…";
    if (plan.status === "error") return plan.error?.message ?? "The route could not be planned.";
    if (!candidate) return `No route from ${fromChain.chainName} to ${toChain.chainName} was found.`;
    if (strangers.length > 0) return STRANGER_CHANNEL_PROBLEM;
    if (intentProblem) return intentProblem;
    if (memoExplanation?.risk === "danger") return "The planned memo cannot be signed from here.";
    if (!message) return "Preparing the transaction…";
    return null;
  })();

  // Every fact the review shows, as one comparable value. The review is a
  // promise ("this is what your wallet will sign"), so it is frozen: when a
  // background read changes any of it (a balance gone, a chain that did not
  // answer, a new route), the card goes back to the form and says so, and
  // signing refuses anything but what was reviewed.
  const reviewKey = JSON.stringify([
    asset?.key ?? null,
    sender,
    recipient,
    toChainId,
    amountBase,
    tier,
    hop?.channelId ?? null,
    candidate?.receiver ?? null,
    candidate?.plan.memo ?? null,
  ]);
  const reviewChanged = reviewed !== null && reviewed.key !== reviewKey;

  // A refresh that makes the reviewed transfer impossible (a balance moved,
  // the scope changed) or another one sends the review back to the form,
  // which says why. Adjusted during render, guarded so it runs once.
  if (step === "review" && ((blocked && plan.status !== "loading") || reviewChanged)) {
    setStep("form");
    if (reviewChanged) setReviewDrifted(true);
  }

  const openReview = () => {
    if (blocked || !asset) return;
    pinDefaults();
    setReviewed({ key: reviewKey, asset });
    setReviewDrifted(false);
    setStep("review");
  };

  /* ------------------------------------------------------------- history */
  const away = useMemo(() => awayFromHome(assets), [assets]);
  const scopeName = selectedChainId ? chainName(selectedChainId) : null;
  const observedTiming = fromChainId && toChainId ? timingFor(fromChainId, toChainId) : null;
  const channelFor = history.channelFor;
  const historyChannel = useMemo(() => (fromChainId && toChainId ? channelFor(fromChainId, toChainId) : null), [channelFor, fromChainId, toChainId]);

  const moneyFormat = useCallback(
    (value: number) => (prefs.hideAmounts ? MASK : formatFiat(value, currency, { compact: true })),
    [prefs.hideAmounts, currency],
  );
  const chainBars = useMemo(
    () =>
      (portfolio.data?.chains ?? [])
        .filter((row) => row.status === "ok" && row.liquid !== null && row.liquid > 0)
        .map((row) => {
          const count = liquidByChain.get(row.chainId)?.count ?? 0;
          return {
            id: row.chainId,
            label: row.chainName,
            value: row.liquid ?? 0,
            icon: <ChainLogo chainId={row.chainId} size={18} />,
            detail: `${count} token${count === 1 ? "" : "s"} you can move`,
          };
        }),
    [portfolio.data, liquidByChain],
  );

  /* ------------------------------------------------------------- actions */
  async function sign() {
    if (!reviewed || reviewChanged) {
      toast.error("Not signed", { description: "The transfer changed after you reviewed it. Check it again." });
      setReviewDrifted(true);
      setStep("form");
      return;
    }
    if (!asset || !sender || !candidate || !message || !toChainId || !isPositive(amountBase)) return;
    // Re-read the memo from its bytes and re-check who it pays and over which channels, now.
    const problem =
      transferIntentProblem(candidate, { recipient, destChainId: toChainId }) ??
      (strangerChannels(candidate.links, overrides).length > 0 ? STRANGER_CHANNEL_PROBLEM : null);
    const explanation = explainMemo(candidate.plan.memo, { receiver: candidate.receiver });
    if (problem || explanation.risk === "danger") {
      toast.error("Not signed", { description: problem ?? "The planned memo cannot be signed from here." });
      return;
    }
    const signed = makeMessage();
    if (!signed) return;
    setStep("signing");
    const request: SignRequest = { chainId: asset.chainId, messages: [signed], feeTier: tier };
    const result = await tx.submit(request);
    if (!result) return;
    pendingTransfers.add({
      id: result.txHash,
      sourceChainId: asset.chainId,
      destChainId: toChainId,
      plan: candidate.plan,
      amount: amountBase,
      denom: asset.denom,
      symbol,
      decimals,
      sender,
      recipient,
      origin: "bridge",
    });
    setSent({
      txHash: result.txHash,
      confirmed: result.confirmed !== false,
      fromChainId: asset.chainId,
      toChainId,
      amount: amountBase,
      asset,
      recipient,
      plan: candidate.plan,
    });
    setStep("done");
    const label = `${prefs.hideAmounts ? MASK : formatAmount(fromBase(amountBase, decimals), { maxFraction: 6 })} ${symbol}`;
    const href = `/activity/${result.txHash}?chainId=${encodeURIComponent(asset.chainId)}`;
    if (result.confirmed === false) {
      toast.info("Broadcast, not confirmed yet", { description: `${label} may still leave ${chainName(asset.chainId)}.`, action: { label: "View", href } });
    } else {
      // Only a measured time is promised; otherwise say where to follow it.
      toast.success(`${label} on its way to ${chainName(toChainId)}`, {
        description: observedTiming
          ? `Your transfers on this route usually land in ${formatDuration(observedTiming.median)}. Followed under In flight and in Live.`
          : "Followed under In flight and in Live until it lands.",
        action: { label: "View", href },
      });
    }
  }

  const applyRoute = (route: RouteSuggestion) => {
    setFromChoice(route.fromChainId);
    setToChoice(route.toChainId);
    setAssetChoice(route.asset.key);
    setAmountText("");
    setRecipientEdit(null);
    setOverrides({});
    setStep("form");
  };

  const flip = () => {
    if (!fromChainId || !toChainId) return;
    // The way back: the same token (by identity) where it now is, the voucher
    // going home or the native going out, with the amount while it still fits
    // that balance. Not held there: the new source's default.
    const back = asset ? (assets.find((row) => row.chainId === toChainId && row.identity.key === asset.identity.key) ?? null) : null;
    const backBase = back ? toBase(amountText, back.decimals) : null;
    setFromChoice(toChainId);
    setToChoice(fromChainId);
    setAssetChoice(back?.key ?? null);
    setAmountText(back && isPositive(backBase) && !exceeds(backBase, back.liquid) ? amountText : "");
    setRecipientEdit(null);
    setOverrides({});
  };

  const moveLine = (row: SpendableAsset): string => {
    if (!toChainId) return "";
    const kind = moveKind(row.identity, toChainId);
    if (kind === "home") return `Goes home: arrives as native ${row.identity.ticker} on ${chainName(toChainId)}`;
    if (kind === "away") return `Goes home to ${chainName(row.identity.originChainId)} first, then on to ${chainName(toChainId)}`;
    return `Arrives on ${chainName(toChainId)} as an IBC voucher`;
  };

  /* ------------------------------------------------------------- review */
  const assetValue = asset && amountBase ? valueOf(amountBase, decimals, asset.price) : null;
  const leftAfter = asset && isPositive(amountBase) && !exceeds(amountBase, asset.liquid) ? subtractUnits(subtractUnits(asset.liquid, amountBase), feeBase ?? "0") : null;
  const feePrice = useMemo(() => {
    if (!fromChain) return null;
    const row = (portfolio.data?.assets ?? []).find((entry) => entry.chainId === fromChain.chainId && entry.identity.denom === fromChain.feeMinimalDenom);
    return row?.price?.price ?? null;
  }, [portfolio.data, fromChain]);
  const showIntent = Boolean(intent && intentChain && toChainId === intentChain);
  const feeFiat = preview.fee && feePrice !== null ? Number(preview.fee.display) * feePrice : null;
  const feePct =
    asset && preview.fee
      ? feeShare({
          feeBase: preview.fee.amount[0]?.amount ?? null,
          feeDenom: preview.fee.amount[0]?.denom ?? null,
          amountBase,
          denom: asset.denom,
          feeValue: feeFiat,
          amountValue: assetValue,
        })
      : null;
  const feePctText = feePct === null ? null : `${formatPercent(feePct, { digits: feePct < 0.01 ? 4 : 2 })} of the amount`;
  const reviewRows: KeyValueItem[] =
    asset && fromChain && toChain && candidate
      ? [
          {
            key: "from",
            label: "From",
            value: (
              <span className="inline-flex items-center justify-end gap-1.5">
                <ChainLogo chainId={fromChain.chainId} size={16} />
                {fromChain.chainName}
                <span className="font-mono text-[12px] text-fg-dim">{sender ? shortenAddress(sender, 8, 4) : ""}</span>
              </span>
            ),
          },
          {
            key: "to",
            label: "To",
            value: (
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <ChainLogo chainId={toChain.chainId} size={16} />
                {toChain.chainName}
                {isOwn ? (
                  <Badge size="sm" tone="accent">
                    Your account
                  </Badge>
                ) : null}
              </span>
            ),
            sub: <AddressChunks address={recipient} tone="strong" className="text-[12px] leading-relaxed" />,
          },
          {
            key: "route",
            label: "Route",
            value: `${candidate.plan.hops.length === 1 ? "Direct, 1 hop" : `${candidate.plan.hops.length} hops`} · ${hop?.channelId ?? ""}`,
            sub: channelVerdict(candidate.links[0]).label,
          },
          {
            key: "fee",
            label: "Network fee",
            value: preview.fee ? `${formatAmount(preview.fee.display, { maxFraction: 6 })} ${preview.fee.symbol ?? ""}` : "Measured when you sign",
            sub: (
              <>
                {feeFiat !== null ? (
                  <>
                    ≈ <Money value={feeFiat} currency={currency} masked={false} /> ·{" "}
                  </>
                ) : null}
                {feePctText ? `${feePctText} · ` : ""}paid on {fromChain.chainName}
              </>
            ),
          },
          {
            key: "arrives",
            label: "You receive",
            value: <TokenAmount amount={amountBase ?? "0"} decimals={decimals} symbol={symbol} maxFraction={6} />,
            sub: candidate.plan.requiresPfm
              ? "Relayers charge you nothing; a forwarding chain may keep a fee if it sets one"
              : "IBC moves the token 1:1; relayers charge you nothing",
          },
          {
            key: "time",
            label: "Arrives",
            value: observedTiming
              ? `Usually in ${formatDuration(observedTiming.median)}`
              : `In about ${Math.max(1, Math.round(candidate.plan.estimatedDurationSeconds / 60))} min (estimate)`,
            sub: `${observedTiming ? `Your last ${observedTiming.count} on this route. ` : ""}If no relayer delivers it within ${IBC_TIMEOUT_MINUTES} min, it comes back to you`,
          },
          ...(leftAfter !== null
            ? [{ key: "after", label: `Left on ${fromChain.chainName}`, value: <TokenAmount amount={leftAfter} decimals={decimals} symbol={symbol} maxFraction={6} /> }]
            : []),
        ]
      : [];

  // Review, signing and the result replace the form in place; bring the
  // card's top into view so a step never opens scrolled past its first line.
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const node = cardRef.current;
    if (!node || step === "form") return;
    if (node.getBoundingClientRect().top < 64) node.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
  }, [step, reducedMotion]);

  const recipientLabel = (
    <span className="inline-flex items-center gap-1.5">
      Recipient on {chainName(toChainId)}
      {isOwn ? (
        <Badge size="sm" tone="accent">
          Your address
        </Badge>
      ) : null}
    </span>
  );

  const transferCard = (
    <Card variant="hero" className="gap-4">
      {step === "form" ? (
        <>
          <CardHeader
            title="Transfer"
            subtitle="Native IBC: the chains hold the funds, no third party"
            actions={
              <>
                <PartialDataBadge errors={portfolio.data?.errors} />
                <Badge tone="info" size="md" dot>
                  IBC
                </Badge>
              </>
            }
          />
          {reviewDrifted ? (
            <Callout tone="warning" title="The transfer changed while you were reviewing it">
              A read in the background changed what would be signed. Check the form, then review it again.
            </Callout>
          ) : null}
          {showIntent ? (
            <Callout tone="accent" icon="swap" title="Step 1 of 2: move to Osmosis">
              Your swap needs the tokens on {chainName(intentChain)} first. Send them here; the Swap page then picks up where you left off.
            </Callout>
          ) : null}

          <div className="relative grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
            <ChainPicker
              variant="tile"
              label="From"
              value={fromChainId}
              onChange={(id) => {
                pinDefaults();
                setFromChoice(id);
                setAssetChoice(null);
                setAmountText("");
                setOverrides({});
                if (id === toChainId) setToChoice(fromChainId);
              }}
              chains={followedChains}
              isDisabled={(chain) => !liquidByChain.has(chain.chainId)}
              meta={(chain) => {
                const held = liquidByChain.get(chain.chainId);
                return held ? (
                  <>
                    <Money value={held.value} currency={currency} compact reason="Unpriced" /> · {held.count} token{held.count === 1 ? "" : "s"}
                  </>
                ) : balancesFailed ? (
                  "Balance unknown"
                ) : (
                  "Nothing to move"
                );
              }}
            />
            <div className="flex items-center justify-center">
              <IconButton label="Swap direction" variant="secondary" size="md" onClick={flip} className="rounded-full max-sm:rotate-90">
                <Glyph name="flip" size={16} className="rotate-90" />
              </IconButton>
            </div>
            <ChainPicker
              variant="tile"
              label="To"
              value={toChainId}
              onChange={(id) => {
                pinDefaults();
                setToChoice(id);
                setRecipientEdit(null);
                setOverrides({});
                if (id === fromChainId) setFromChoice(toChainId);
              }}
              chains={followedChains}
              more={otherChains}
              isDisabled={(chain) => chain.chainId === fromChainId}
              meta={(chain) => {
                const own = addressFor(chain.chainId);
                return own ? shortenAddress(own, 8, 4) : "No address of yours";
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg-muted">Token</span>
            <AssetPicker
              assets={assetsHere}
              value={asset?.key ?? null}
              onChange={(row) => {
                setAssetChoice(row.key);
                setAmountText("");
                setOverrides({});
              }}
              currency={currency}
              loading={portfolio.loading && !portfolio.data}
              detail={moveLine}
              label={`Token on ${chainName(fromChainId)}`}
              emptyText={balancesFailed ? "Balances could not be read" : `Nothing to move on ${chainName(fromChainId)}`}
            />
            {asset ? <p className="text-[12px] text-fg-dim">{moveLine(asset)}</p> : null}
            {balancesFailed ? (
              <InlineError message={portfolio.error?.message ?? "Balances could not be read."} onRetry={portfolio.refetch} />
            ) : missing ? (
              <MissingTokenNote missing={missing} verb="move" onRetry={portfolio.refetch} retrying={portfolio.refreshing} />
            ) : null}
          </div>

          <AmountField
            asset={asset}
            value={amountText}
            onChange={(value) => {
              pinDefaults();
              setAmountText(value);
            }}
            maxBase={maxBase}
            onMax={followMax}
            reserve={reserve}
            leftAfter={leftAfter}
            leftWhere={`left on ${chainName(fromChainId)}`}
            // The field formats money in the stored preference; when the server
            // fell back to another currency the figure would carry the wrong sign.
            fiatValue={currency === prefs.currency ? (amountBase ? assetValue : undefined) : undefined}
            error={amountText && asset && amountBase && exceeds(amountBase, asset.liquid) ? "More than you hold" : undefined}
          />

          {usingOwn && ownOnDest && toChainId ? (
            <OwnRecipient label={recipientLabel} chainId={toChainId} address={ownOnDest} onChange={() => setRecipientEdit("")} />
          ) : (
            <Input
              id={recipientInputId}
              label={recipientLabel}
              mono
              size="lg"
              value={recipientText}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              // Focus lands here when "Change" swaps the own-address row for the field.
              autoFocus={recipientEdit === "" && Boolean(ownOnDest)}
              placeholder={toChain ? `${toChain.bech32Prefix}1…` : "Address"}
              leading={toChainId ? <ChainLogo chainId={toChainId} size={18} /> : undefined}
              error={recipientProblem ?? undefined}
              hint={
                !ownOnDest
                  ? `Your wallet has no address on ${chainName(toChainId)}: enter one.`
                  : recipient && !isOwn
                    ? "Not one of your addresses. Check it before you send."
                    : undefined
              }
              onChange={(event) => {
                pinDefaults();
                setRecipientEdit(event.target.value);
              }}
              trailing={
                ownOnDest ? (
                  <Button size="sm" variant="ghost" onClick={() => setRecipientEdit(null)}>
                    Use mine
                  </Button>
                ) : undefined
              }
            />
          )}

          <RouteSection
            status={plan.status}
            data={plan.data}
            candidate={candidate}
            error={plan.error}
            onRetry={plan.reload}
            observed={observedTiming}
            idleText={!asset ? "Pick a token to plan the route." : !recipient ? `Enter a ${chainName(toChainId)} address to plan the route.` : "Planning…"}
            fromChainId={fromChainId}
            toChainId={toChainId}
            historyChannel={historyChannel}
            overrides={overrides}
            onOverridesChange={setOverrides}
          />

          <FeeTierPicker
            tiers={preview.tiers}
            value={tier}
            onChange={setTier}
            loading={preview.loading && Boolean(message)}
            feePrice={feePrice}
            currency={currency}
            gas={preview.gas}
            problem={message ? preview.problem : "Shown once the route is planned."}
          />

          <div className="flex flex-col gap-2">
            <Button size="lg" variant="primary" fullWidth disabled={blocked !== null} onClick={openReview} aria-describedby="bridge-blocked">
              Review transfer
            </Button>
            <p id="bridge-blocked" className="min-h-[18px] text-center text-[12.5px] text-fg-dim" aria-live="polite">
              {blocked ?? "Nothing is signed until you approve it in your wallet."}
            </p>
          </div>
        </>
      ) : step === "review" && asset ? (
        <>
          <CardHeader title="Review transfer" subtitle="Check each line: this is what your wallet will sign." />
          <ReviewPanel
            heading={`${chainName(fromChainId)} → ${chainName(toChainId)}`}
            amount={{ base: amountBase ?? "0", decimals, symbol, value: assetValue, currency }}
            rows={reviewRows}
            memo={memoExplanation}
            problems={[
              ...(intentProblem ? [intentProblem] : []),
              ...(memoExplanation?.risk === "danger" ? ["This memo cannot be signed from here. The line marked above says why."] : []),
            ]}
            notice={
              feePct !== null && feePct >= 5 ? (
                <Callout tone="warning" title={`The fee is ${formatPercent(feePct, { digits: 1 })} of what you send`}>
                  For an amount this small the network fee weighs a lot. Moving more at once costs the same fee.
                </Callout>
              ) : null
            }
            confirmLabel="Confirm in wallet"
            onBack={() => setStep("form")}
            onConfirm={() => void sign()}
          />
        </>
      ) : step === "signing" && reviewed ? (
        <>
          {/* From what was reviewed: the live row can vanish mid-signing (moving everything leaves no balance to list). */}
          <CardHeader title="Approve in your wallet" subtitle={`IBC transfer from ${chainName(reviewed.asset.chainId)}`} />
          <SignProgress
            stage={tx.stage}
            chainName={chainName(reviewed.asset.chainId)}
            explained={tx.explained}
            txHash={tx.txHash}
            onRetry={() => void sign()}
            onBack={() => {
              tx.reset();
              setStep("review");
            }}
          />
        </>
      ) : sent ? (
        <>
          <ResultHeader
            tone={sent.confirmed ? "success" : "pending"}
            title={<>On its way to {chainName(sent.toChainId)}</>}
            detail={
              <>
                <TokenAmount amount={sent.amount} decimals={sent.asset.decimals} symbol={sent.asset.identity.ticker} maxFraction={6} /> to{" "}
                {sent.recipient === addressFor(sent.toChainId) ? "your account" : shortenAddress(sent.recipient, 10, 6)}. It keeps being
                followed under In flight, even if you leave this page.
              </>
            }
            chainId={sent.fromChainId}
            hash={sent.txHash}
          />
          <TransferTracker plan={sent.plan} sourceTxHash={sent.txHash} expectedAmount={sent.amount} pendingId={sent.txHash} />
          <div className="flex flex-col gap-2 sm:flex-row">
            {showIntent && sent.toChainId === intentChain ? (
              <Button size="lg" variant="primary" className="sm:flex-1" href="/swap" iconRight="arrowRight">
                Continue to swap
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={showIntent ? "secondary" : "primary"}
              className="sm:flex-1"
              onClick={() => {
                setAmountText("");
                setStep("form");
                setSent(null);
                setReviewed(null);
                tx.reset();
              }}
            >
              New transfer
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );

  const loadingHistory = activity.loading && activity.items.length === 0;
  // The chains answered (rows or not): an empty answer is a real zero.
  const historyRead = !historyFailed && activity.status !== "idle";
  const countParts = [
    // "to yourself": short enough for a phone tile; the (i) says it means your own accounts.
    counts.own > 0 ? `${counts.own} to yourself` : null,
    counts.out > 0 ? `${counts.out} out` : null,
    counts.in > 0 ? `${counts.in} in` : null,
  ].filter(Boolean);
  const arrivedToday = pending.filter((row) => row.status === "arrived").length;
  const inFlight = countInFlight(pending);

  return (
    <div className="grid grid-cols-12 items-start gap-[var(--d-gap)]">
      <StatStrip pending={portfolio.refreshing || activity.refreshing} className="order-2 col-span-12 lg:order-1">
        <Stat
          label="In flight"
          value={
            <span className="inline-flex items-center gap-2">
              {inFlight}
              {inFlight > 0 ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-[var(--z-info)]" /> : null}
            </span>
          }
          sub={pending.length > 0 ? `${arrivedToday} arrived in the last 24 h` : "Nothing moving"}
          info="Transfers signed from this browser in the last 24 hours, followed hop by hop on the chains."
        />
        <Stat
          label="IBC transfers"
          value={historyFailed ? <Money value={null} reason="History could not be read" /> : `${counts.total}`}
          sub={
            historyFailed
              ? "History unreadable"
              : countParts.length > 0
                ? countParts.join(" · ")
                : since
                  ? `None ${since}`
                  : activity.loading
                    ? "Reading history…"
                    : "No history loaded"
          }
          loading={loadingHistory}
          info={`Counted from the history public nodes keep${since ? ` (loaded ${since})` : ""}${scopeName ? `, touching ${scopeName}` : ""}. A move between two of your own accounts ("to yourself") counts once.`}
        />
        <Stat
          label="Away from home"
          value={
            balancesFailed ? (
              <Money value={null} reason="Balances could not be read" />
            ) : away.count > 0 ? (
              <Money value={away.value} currency={currency} compact reason="None of them is priced" />
            ) : (
              <span className="text-fg-dim">None</span>
            )
          }
          sub={
            balancesFailed
              ? "Balances unreadable"
              : away.count > 0
                ? `${away.count} IBC token${away.count === 1 ? "" : "s"} off their home chain${away.unpriced > 0 ? ` · ${away.unpriced} unpriced` : ""}`
                : portfolio.data
                  ? "All on their home chains"
                  : undefined
          }
          loading={portfolio.loading && !portfolio.data}
          info="IBC vouchers held on a chain other than the one that issues them. Sending one home turns it back into the native token."
        />
        <Stat
          label="Moved out"
          value={
            <Money
              // Nothing moved out in a history that was read is a known zero, not an unknown.
              value={historyFailed ? null : movedOutItems.length === 0 && historyRead ? 0 : movedOut.outValue}
              currency={historyPrices.currency ?? currency}
              compact
              reason={historyFailed ? "History could not be read" : movedOutItems.length > 0 ? "None of what moved has a price" : "No history read yet"}
            />
          }
          sub={
            historyFailed
              ? "History unreadable"
              : `${movedOutItems.length} transfer${movedOutItems.length === 1 ? "" : "s"}${movedOutItems.length > 0 ? " · est." : ""}${movedOut.unpricedOut > 0 ? ` · ${movedOut.unpricedOut} unpriced` : ""}`
          }
          loading={loadingHistory || (movedOutItems.length > 0 && historyPrices.loading)}
          info={`IBC transfers out ${since ?? "in the loaded history"}${scopeName ? `, touching ${scopeName}` : ""}. ${movedOut.method}`}
        />
      </StatStrip>

      <div className="order-1 col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:order-2 lg:col-span-7">
        <div ref={cardRef} className="scroll-mt-20">
          {transferCard}
        </div>
      </div>

      {/* Two stacks side by side on tablets; one column on phones and beside the form. DOM order is reading order. */}
      <div className="order-3 col-span-12 grid min-w-0 grid-cols-1 items-start gap-[var(--d-gap)] md:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
        <div className={SIDE_STACK}>
          <InFlightCard pending={pending} />
          <ChainSpreadCard
            items={chainBars}
            loading={portfolio.loading && !portfolio.data}
            refreshing={portfolio.refreshing}
            valueFormatter={moneyFormat}
            error={balancesFailed ? (portfolio.error?.message ?? "Balances could not be read.") : null}
            onRetry={portfolio.refetch}
          />
        </div>
        <div className={SIDE_STACK}>
          <RouteSuggestionsCard
            routes={routes}
            loading={portfolio.loading && !portfolio.data}
            timingFor={timingFor}
            currency={currency}
            onPick={applyRoute}
            error={balancesFailed ? (portfolio.error?.message ?? "Balances could not be read.") : null}
            onRetry={portfolio.refetch}
          />
          {routeTimings.length > 0 ? <DeliveryTimesCard rows={routeTimings} since={allSince} /> : null}
        </div>
      </div>

      <RecentTransfers
        className="order-4 col-span-12"
        title="Recent IBC transfers"
        items={pairedIbc.rows.slice(0, 10)}
        delivered={pairedIbc.delivered}
        loading={loadingHistory}
        refreshing={activity.refreshing}
        error={activity.error?.message ?? null}
        onRetry={activity.refetch}
        subtitle={`${scopeName ? `Touching ${scopeName}` : "On your followed chains"}${since ? `, ${since}` : ""}`}
        nameFor={(address) => (followedOnNetwork.some((id) => addressFor(id) === address) ? "your account" : null)}
        empty={
          <EmptyState
            inline
            icon="bridge"
            title={scopeName ? `No IBC transfers touching ${scopeName}` : "No IBC transfers in the loaded history"}
            body="Transfers between chains show here once the chains report them."
          />
        }
        actions={
          <>
            <PartialDataBadge errors={activity.errors} />
            <Button size="sm" variant="ghost" href="/activity" iconRight="arrowRight">
              All activity
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * The recipient when it is your own address on the destination: a quiet,
 * read-only row (the full address never fits a phone-width field, and there
 * is nothing to type), with "Change" for sending to someone else.
 */
function OwnRecipient({ label, chainId, address, onChange }: { label: ReactNode; chainId: string; address: string; onChange: () => void }) {
  const labelId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-[12.5px] font-medium text-fg-muted">
        {label}
      </span>
      <div className={cn(FIELD_FRAME, "h-[var(--d-ctl-lg)] gap-2.5 pr-1.5")}>
        <ChainLogo chainId={chainId} size={18} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg" title={address}>
          <span className="sm:hidden">{shortenAddress(address, 10, 6)}</span>
          <span className="hidden sm:inline">{address}</span>
        </span>
        {/* Named by its visible word first (speech input), then what it does. */}
        <Button size="sm" variant="ghost" onClick={onChange}>
          Change<span className="sr-only"> recipient: send to another address on {chainName(chainId)}</span>
        </Button>
      </div>
    </div>
  );
}
