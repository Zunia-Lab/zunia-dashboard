"use client";

/**
 * Send: any token you hold, to anyone, on the same chain or across Cosmos.
 *
 * The recipient decides the route. Its prefix names the chain: the same chain
 * as the token makes a plain bank send; another chain makes an IBC transfer,
 * planned and verified by `/api/interchain/plan` (channels read on both ends,
 * a wrapped token sent home first), with the route shown before anything is
 * signed. Nobody has to pick "Send" or "Cross-send" first.
 *
 * Around the form, what helps decide: what is spendable (liquid balances
 * only, staked tokens cannot move), the fee at three speeds measured on the
 * real transaction, who the recipient is (saved contact, your own account,
 * how often you sent there, an exchange that needs a memo), and the history
 * of transfers read from the chains.
 *
 * Signing goes through `useSignAndBroadcast` with messages from
 * `@/lib/tx/messages`. A planned memo is re-read from its bytes and the
 * route's recipient re-checked right before the wallet is asked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RecipientAddressField } from "@/components/RecipientAddressField";
import { txMemoItem } from "@/components/TxMemoItem";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ChainLogo,
  Input,
  InlineError,
  Money,
  PartialDataBadge,
  RelativeTime,
  TokenAmount,
  toast,
  useReducedMotion,
  type KeyValueItem,
} from "@/components/ui";
import { flowSummary } from "@/lib/activity/analytics";
import type { ChainEntry } from "@/lib/chains";
import { findChain, findChainsByPrefix } from "@/lib/chains";
import { usePortfolio } from "@/lib/data/portfolio";
import { MASK, formatAmount, formatDuration, formatPercent, shortenAddress } from "@/lib/format";
import type { HopOverrideInput } from "@/lib/interchain/client";
import { usePlan } from "@/lib/interchain/hooks";
import { explainMemo } from "@/lib/interchain/memo-summary";
import type { RoutePlanWire } from "@/lib/interchain/wire";
import { maskAmounts } from "@/lib/notifications/text";
import { pendingTransfers } from "@/lib/pending-transfers";
import { memoProblem } from "@/lib/tx/flow";
import { describeTxMemo } from "@/lib/tx/memo";
import { buildSend, buildTransfer } from "@/lib/tx/messages";
import type { FeeTier, SignRequest, TxMemoContext } from "@/lib/tx/types";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { AddressBookCard } from "./AddressBookCard";
import { AddressChunks } from "./AddressChunks";
import { AmountField, useMaxFollowsReserve } from "./AmountField";
import { AssetPicker } from "./AssetPicker";
import { ContactDialog } from "./ContactDialog";
import { FeeTierPicker } from "./FeeTierPicker";
import { FrequentRecipientsCard } from "./FrequentRecipientsCard";
import {
  balanceKey,
  bucketWorth,
  channelFromHistory,
  checkRecipient,
  exceeds,
  feeShare,
  frequentRecipients,
  fromBase,
  historySince,
  historyWith,
  isOutgoing,
  isPositive,
  isTransfer,
  looksLikeExchange,
  maxSendable,
  missingTokenReason,
  pairOwnIbc,
  pickDestination,
  plannableOverrides,
  pricedSum,
  pricedSumByChain,
  routeTiming,
  spendableAssets,
  splitBalanceKey,
  STRANGER_CHANNEL_PROBLEM,
  strangerChannels,
  subtractUnits,
  toBase,
  transferIntentProblem,
  transferStats,
  valueOf,
  withinLoaded,
  type BucketWorth,
  type SpendableAsset,
} from "./logic";
import { MissingTokenNote, missingTokenLabel, missingTokenText, type MissingToken } from "./MissingTokenNote";
import { chainName, sinceText } from "./names";
import { OwnAccountsCard, useOwnAccounts, useOwnAddressSet } from "./OwnAccountsCard";
import type { TransferPrefill } from "./prefill";
import { RecentTransfers } from "./RecentTransfers";
import { QuickRecipients, RecipientInsight } from "./RecipientHelpers";
import { RouteSection } from "./RouteSection";
import { channelVerdict } from "./RouteView";
import { SIDE_STACK, Stat, StatStrip } from "./StatStrip";
import { TransferTracker } from "./TransferTracker";
import { ResultHeader, ReviewPanel, SignProgress } from "./TxFlow";
import { useAddressBook } from "./useAddressBook";
import { useHistoryPrices } from "./useHistoryPrices";
import { useWalletTxPreview } from "./usePreview";

/** Cosmos SDK's default `MaxMemoCharacters`. */
const MAX_MEMO = 256;
const IBC_TIMEOUT_MINUTES = 10;

export function SendPage({ prefill }: { prefill: TransferPrefill }) {
  return (
    <Page
      title="Send"
      subtitle="Any token, to anyone, on the same chain or across Cosmos"
      access="wallet"
      connectTitle="Connect a wallet to send"
      connectDescription="Send any token you hold to an address on the same chain, or to another Cosmos chain over IBC. You review every detail, then approve it in your wallet."
    >
      <SendBody prefill={prefill} />
    </Page>
  );
}

type Step = "form" | "review" | "signing" | "done";

interface Sent {
  chainId: string;
  txHash: string;
  confirmed: boolean;
  amount: string;
  asset: SpendableAsset;
  recipient: string;
  destChainId: string;
  plan: RoutePlanWire | null;
}

function SendBody({ prefill }: { prefill: TransferPrefill }) {
  const { addressFor, canSignOn } = useWallet();
  const { scopedChainIds, selectedChainId, followedOnNetwork, setSelectedChainId } = useChainScope();
  const prefs = usePrefs();
  const portfolio = usePortfolio();
  const currency = portfolio.data?.currency ?? prefs.currency;
  const book = useAddressBook();
  const activity = useActivity();
  const tx = useSignAndBroadcast();

  const assets = useMemo(() => spendableAssets(portfolio.data?.assets ?? []), [portfolio.data]);
  // Figures count the window their "since" caption names (see `withinLoaded`).
  const covered = useMemo(() => withinLoaded(activity.items, activity.loadedUntil), [activity.items, activity.loadedUntil]);
  const transfers = useMemo(() => covered.filter(isTransfer), [covered]);
  const pairedTransfers = useMemo(() => pairOwnIbc(transfers), [transfers]);
  const stats = useMemo(() => transferStats(covered), [covered]);
  const outgoing = useMemo(() => transfers.filter((item) => isOutgoing(item) && item.success), [transfers]);
  const historyPrices = useHistoryPrices(outgoing);
  const sentFlow = useMemo(() => flowSummary(outgoing, { prices: historyPrices.prices }), [outgoing, historyPrices.prices]);

  /* ------------------------------------------------------------- form state */
  const [assetKey, setAssetKey] = useState<string | null>(() =>
    prefill.from && prefill.denom ? balanceKey(prefill.from, prefill.denom) : null,
  );
  const [recipientText, setRecipientText] = useState(prefill.recipient ?? "");
  const [recipientBlurred, setRecipientBlurred] = useState(Boolean(prefill.recipient));
  const [amountText, setAmountText] = useState(prefill.amount ?? "");
  const [memo, setMemo] = useState("");
  const [tier, setTier] = useState<FeeTier>("average");
  const [destChoice, setDestChoice] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, HopOverrideInput>>({});
  const [step, setStep] = useState<Step>("form");
  const [sent, setSent] = useState<Sent | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  /** What the review showed (see `reviewKey`), and the token it showed. */
  const [reviewed, setReviewed] = useState<{ key: string; asset: SpendableAsset } | null>(null);
  /** The review went back to the form because the transfer changed under it. */
  const [reviewDrifted, setReviewDrifted] = useState(false);

  // The token on the form. One the user picked, or a link named, is never
  // swapped for another: when it is not among the balances read (another
  // scope, a chain that did not answer this time, a balance that is gone)
  // the form has no token and says why (`missing`). An amount typed for one
  // balance must never be signed against another, least of all on the open
  // review. Until something is picked the default follows the scope: the
  // prefilled chain's first token, the selected chain's, else the most
  // valuable.
  const asset = useMemo<SpendableAsset | null>(() => {
    if (assetKey) return assets.find((row) => row.key === assetKey) ?? null;
    const onChain = (chainId: string | null | undefined) => (chainId ? assets.find((row) => row.chainId === chainId) : undefined);
    return onChain(prefill.from) ?? onChain(selectedChainId) ?? assets[0] ?? null;
  }, [assetKey, assets, prefill.from, selectedChainId]);

  // Said only about a settled read of the current scope: while a new scope
  // loads, the previous answer is still on screen (`stale`).
  const missing = useMemo<MissingToken | null>(() => {
    if (!assetKey || asset || !portfolio.data || portfolio.stale) return null;
    const { chainId, denom } = splitBalanceKey(assetKey);
    const read = portfolio.data.chains.find((row) => row.chainId === chainId);
    return {
      reason: missingTokenReason(chainId, { scoped: scopedChainIds, followed: followedOnNetwork, chainStatus: read?.status ?? null }),
      chainId,
      token: missingTokenLabel(chainId, denom, portfolio.data.assets),
    };
  }, [assetKey, asset, portfolio.data, portfolio.stale, scopedChainIds, followedOnNetwork]);

  // The default can move while balances refresh (two tokens of similar value
  // swap places); once the user types, the token on screen is their choice.
  const pinAsset = () => {
    if (!assetKey && asset) setAssetKey(asset.key);
  };

  const chain: ChainEntry | undefined = asset ? findChain(asset.chainId) : undefined;
  const sender = asset ? addressFor(asset.chainId) : null;
  const decimals = asset?.decimals ?? null;
  const symbol = asset?.identity.ticker ?? "";

  /* ------------------------------------------------------------- recipient */
  const check = useMemo(
    () => checkRecipient(recipientText, (prefix) => findChainsByPrefix(prefix, asset?.chainId)),
    [recipientText, asset?.chainId],
  );
  const destination = useMemo(
    () => (chain ? pickDestination(check, chain, destChoice) : { chainId: null, options: [] }),
    [check, chain, destChoice],
  );
  const recipient = check.state === "valid" ? check.address : "";
  const destChainId = destination.chainId;
  const mode: "send" | "ibc" | null = !asset || !destChainId ? null : destChainId === asset.chainId ? "send" : "ibc";
  const contact = recipient ? book.byAddress(recipient) : undefined;
  const ownOnDest = destChainId ? addressFor(destChainId) : null;
  const isOwn = Boolean(recipient && ownOnDest && recipient === ownOnDest);
  const history = useMemo(() => (recipient ? historyWith(transfers, recipient) : { count: 0, lastAt: null }), [transfers, recipient]);
  const exchange = looksLikeExchange(contact?.label, contact?.note);

  /* ------------------------------------------------------------- amount */
  const amountBase = asset ? toBase(amountText, decimals) : null;
  const isFeeToken = Boolean(asset && chain && asset.denom === chain.feeMinimalDenom);

  /* ------------------------------------------------------------- route (IBC) */
  const planInput = useMemo(() => {
    if (mode !== "ibc" || !asset || !sender || !destChainId || !recipient) return null;
    // A plan needs an amount; until one is typed, plan for one base unit so
    // the route (and its fee) shows while the user is still deciding.
    const amount = isPositive(amountBase) ? amountBase : "1";
    return {
      sourceChainId: asset.chainId,
      destChainId,
      inputDenom: asset.denom,
      amount,
      sender,
      recipient,
      allowSwap: false,
      overrides: plannableOverrides(overrides),
    };
  }, [mode, asset, sender, destChainId, recipient, amountBase, overrides]);
  const plan = usePlan(planInput);
  const candidate = plan.data?.candidates[0] ?? null;
  const firstHop = candidate?.plan.hops[0] ?? null;

  /* ------------------------------------------------------------- message + fee */
  const sendAmount = isPositive(amountBase) && asset && !exceeds(amountBase, asset.liquid) ? amountBase : null;
  // Built for the fee preview now, and again at signing: an IBC packet's
  // timeout counts from when the message is made, and the review promises
  // the funds come back if nothing delivers them within 10 minutes of the
  // signature, not of the moment the form was filled.
  const makeMessage = useCallback(() => {
    if (!asset || !sender) return null;
    if (mode === "ibc") {
      if (!candidate || !firstHop || !/^channel-\d+$/.test(firstHop.channelId)) return null;
      return buildTransfer({
        sourcePort: firstHop.port,
        sourceChannel: firstHop.channelId,
        token: { denom: asset.denom, amount: sendAmount ?? "1" },
        sender,
        receiver: candidate.receiver,
        ...(candidate.plan.memo ? { memo: candidate.plan.memo } : {}),
        timeoutMinutes: IBC_TIMEOUT_MINUTES,
      });
    }
    // Before a recipient and an amount are in, the fee is measured on a send
    // of one base unit to yourself: the same message type, so the same gas.
    return buildSend({
      fromAddress: sender,
      toAddress: mode === "send" && recipient ? recipient : sender,
      amount: [{ denom: asset.denom, amount: sendAmount ?? "1" }],
    });
  }, [asset, sender, mode, candidate, firstHop, sendAmount, recipient]);
  const message = useMemo(() => makeMessage(), [makeMessage]);
  // What names the default memo when the field is left empty: the token as
  // this page shows it, and where an IBC transfer goes.
  const memoContext = useMemo<TxMemoContext | undefined>(
    () => (asset ? { tokens: [asset.identity], ...(mode === "ibc" && destChainId ? { destinationChainId: destChainId } : {}) } : undefined),
    [asset, mode, destChainId],
  );
  // The memo as it will be signed (the review shows it): the user's, trimmed, or Zunia's default.
  const memoView = useMemo(
    () => (asset && message ? describeTxMemo({ chainId: asset.chainId, messages: [message], memo, memoContext }) : null),
    [asset, message, memo, memoContext],
  );

  const preview = useWalletTxPreview(asset ? { chainId: asset.chainId, messages: message ? [message] : [], memo, memoContext } : null, chain, tier, mode === "ibc" ? "transfer" : "send");
  const reserve = isFeeToken ? preview.reserve : null;
  const maxBase = asset ? maxSendable(asset.liquid, reserve) : "0";
  const feeBase = isFeeToken ? (preview.fee?.amount[0]?.amount ?? null) : null;
  const followMax = useMaxFollowsReserve(asset?.key ?? null, amountBase, maxBase, decimals, setAmountText);

  /* ------------------------------------------------------------- what blocks */
  const intentProblem =
    mode === "ibc" && candidate && destChainId ? transferIntentProblem(candidate, { recipient, destChainId }) : null;
  // Channels typed into somebody else's plan request, served back to this
  // one: not signed over until the user sets them here (`strangerChannels`).
  const strangers = useMemo(() => (mode === "ibc" && candidate ? strangerChannels(candidate.links, overrides) : []), [mode, candidate, overrides]);
  const balancesFailed = portfolio.status === "error" && !portfolio.data;
  const historyFailed = activity.status === "error" && activity.items.length === 0;
  const memoExplanation = useMemo(
    () => (mode === "ibc" && candidate ? explainMemo(candidate.plan.memo, { receiver: candidate.receiver, chainName: (id: string) => chainName(id) }) : null),
    [mode, candidate],
  );
  // What is signed is the trimmed memo, and trimming drops a separator at either end.
  const memoIssue = memoProblem(memo.trim());

  const blocked: string | null = (() => {
    if (!portfolio.data && (portfolio.loading || portfolio.status === "idle")) return "Reading your balances…";
    if (!asset || !chain) {
      if (balancesFailed) return "Balances could not be read.";
      if (missing) return missingTokenText(missing, "send");
      return assets.length === 0 ? "Nothing to send in this scope." : "Choose a token to send.";
    }
    if (!sender) return `Your wallet has no address on ${chain.chainName}.`;
    if (!canSignOn(asset.chainId)) return `Your wallet cannot sign on ${chain.chainName}.`;
    if (check.state === "empty") return "Enter a recipient address.";
    if (check.state === "partial") return "Finish the recipient address.";
    if (check.state !== "valid") return check.message ?? "Check the recipient address.";
    if (!destChainId) return `No network on ${chain.network} uses ${check.prefix}1… addresses.`;
    if (mode === "send" && recipient === sender) return "That is your own address on this chain: sending there only costs a fee.";
    if (!amountText.trim()) return "Enter an amount.";
    if (amountBase === null) return decimals === null ? "Use Max: this token's decimals are unknown." : `Use at most ${decimals} decimal places.`;
    if (!isPositive(amountBase)) return "Enter an amount greater than zero.";
    // The balance is masked in privacy mode, like "Available" above the field.
    if (exceeds(amountBase, asset.liquid)) return `That is more than your ${prefs.mask(formatAmount(fromBase(asset.liquid, decimals), { maxFraction: 6 }))} ${symbol}.`;
    if (reserve && exceeds(amountBase, maxBase)) {
      return `Keep ${formatAmount(fromBase(reserve, decimals), { maxFraction: 6 })} ${symbol} for the network fee (Max does it for you).`;
    }
    if (memo.length > MAX_MEMO) return `Memos are limited to ${MAX_MEMO} characters.`;
    if (memoIssue) return memoIssue;
    if (mode === "ibc") {
      if (plan.status === "loading" || plan.status === "idle") return "Planning the route…";
      if (plan.status === "error") return plan.error?.message ?? "The route could not be planned.";
      if (!candidate) return `No route to ${chainName(destChainId)} was found.`;
      if (strangers.length > 0) return STRANGER_CHANNEL_PROBLEM;
      if (intentProblem) return intentProblem;
      if (memoExplanation?.risk === "danger") return "The planned memo cannot be signed from here.";
    }
    if (!message) return "Preparing the transaction…";
    return null;
  })();

  /* ------------------------------------------------------------- derived view */
  const scopeChains = useMemo(
    () => followedOnNetwork.map((id) => findChain(id)).filter((entry): entry is ChainEntry => Boolean(entry)),
    [followedOnNetwork],
  );
  const ownAccounts = useOwnAccounts(scopeChains);
  const ownAddresses = useOwnAddressSet(ownAccounts);
  const otherAccounts = useMemo(() => ownAccounts.filter((row) => row.chain.chainId !== asset?.chainId), [ownAccounts, asset?.chainId]);
  // What can move from each chain the read covered; null where the chain did
  // not answer. From the balances, not the chain's priced total: that adds
  // up priced tokens only, and read $0.00 on a chain of unpriced ones.
  const chainValues = useMemo(() => {
    const held = pricedSumByChain(assets);
    return new Map((portfolio.data?.chains ?? []).map((row) => [row.chainId, row.status === "ok" ? (held.get(row.chainId) ?? pricedSum([])) : null]));
  }, [portfolio.data, assets]);
  const frequent = useMemo(() => frequentRecipients(transfers, 5), [transfers]);
  // The strip's money figures, each saying what it leaves out: a token
  // without a price is counted, never added as $0 (`pricedSum`, `bucketWorth`).
  const spendable = useMemo(() => pricedSum(assets), [assets]);
  const unreadChains = portfolio.data?.chains.filter((row) => row.status === "error").length ?? 0;
  const locked = useMemo(() => (portfolio.data ? bucketWorth(portfolio.data, ["staked", "unbonding"]) : null), [portfolio.data]);
  const rewards = useMemo(() => (portfolio.data ? bucketWorth(portfolio.data, ["rewards"]) : null), [portfolio.data]);
  const unpricedHeld = useMemo(() => (portfolio.data ? bucketWorth(portfolio.data, ["staked", "unbonding", "rewards"]).unpriced : 0), [portfolio.data]);
  const assetValue = asset && amountBase ? valueOf(amountBase, decimals, asset.price) : null;
  const leftAfter = asset && isPositive(amountBase) && !exceeds(amountBase, asset.liquid) ? subtractUnits(subtractUnits(asset.liquid, amountBase), feeBase ?? "0") : null;
  const feePrice = useMemo(() => {
    if (!chain) return null;
    const feeAsset = (portfolio.data?.assets ?? []).find((row) => row.chainId === chain.chainId && row.identity.denom === chain.feeMinimalDenom);
    return feeAsset?.price?.price ?? null;
  }, [portfolio.data, chain]);
  const since = sinceText(historySince(activity.loadedUntil, stats.since));
  const multiChain = scopedChainIds.length > 1;
  const historyChannel = useMemo(
    () => (mode === "ibc" && asset && destChainId ? channelFromHistory(activity.items, asset.chainId, destChainId) : null),
    [mode, activity.items, asset, destChainId],
  );
  const observedTiming = asset && destChainId ? routeTiming(pairedTransfers.timings, asset.chainId, destChainId) : null;

  /* ------------------------------------------------------------- actions */
  const resetAfterSend = useCallback(() => {
    setAmountText("");
    setMemo("");
    setStep("form");
    setSent(null);
    setReviewed(null);
    tx.reset();
  }, [tx]);

  // Every fact the review shows, as one comparable value. The review is a
  // promise ("this is what your wallet will sign"), so it is frozen: when a
  // background read changes any of it (a balance gone, the scope moved, a
  // chain that did not answer, a new route), the card goes back to the form
  // and says so, and signing refuses anything but what was reviewed.
  const reviewKey = JSON.stringify([
    asset?.key ?? null,
    sender,
    recipient,
    destChainId,
    amountBase,
    memo.trim(),
    tier,
    firstHop?.channelId ?? null,
    candidate?.receiver ?? null,
    candidate?.plan.memo ?? null,
  ]);
  const reviewChanged = reviewed !== null && reviewed.key !== reviewKey;

  // A new scope (or a balance that changed) can make the reviewed transfer
  // impossible or another one; the review then goes back to the form, which
  // says why. Adjusted during render (React's "information from previous
  // renders" pattern), guarded so it runs once.
  if (step === "review" && ((blocked && plan.status !== "loading") || reviewChanged)) {
    setStep("form");
    if (reviewChanged) setReviewDrifted(true);
  }

  const openReview = () => {
    if (blocked || !asset) return;
    pinAsset();
    setReviewed({ key: reviewKey, asset });
    setReviewDrifted(false);
    setStep("review");
  };

  async function sign() {
    if (!reviewed || reviewChanged) {
      toast.error("Not signed", { description: "The transfer changed after you reviewed it. Check it again." });
      setReviewDrifted(true);
      setStep("form");
      return;
    }
    if (!asset || !chain || !sender || !message || !isPositive(amountBase) || !destChainId) return;
    if (mode === "ibc") {
      // Re-read the memo from its bytes and re-check who it pays, now.
      const explanation = candidate ? explainMemo(candidate.plan.memo, { receiver: candidate.receiver }) : null;
      const problem = candidate
        ? (transferIntentProblem(candidate, { recipient, destChainId }) ??
          (strangerChannels(candidate.links, overrides).length > 0 ? STRANGER_CHANNEL_PROBLEM : null))
        : "No route to sign.";
      if (problem || explanation?.risk === "danger") {
        toast.error("Not signed", { description: problem ?? "The planned memo cannot be signed from here." });
        setStep("review");
        return;
      }
    }
    const signed = makeMessage();
    if (!signed) return;
    setStep("signing");
    const request: SignRequest = { chainId: asset.chainId, messages: [signed], memo: memo.trim() || undefined, memoContext, feeTier: tier };
    const result = await tx.submit(request);
    if (!result) return;
    book.touch(recipient);
    const amountLabel = `${prefs.hideAmounts ? MASK : formatAmount(fromBase(amountBase, decimals), { maxFraction: 6 })} ${symbol}`;
    if (mode === "ibc" && candidate) {
      pendingTransfers.add({
        id: result.txHash,
        sourceChainId: asset.chainId,
        destChainId,
        plan: candidate.plan,
        amount: amountBase,
        denom: asset.denom,
        symbol,
        decimals,
        sender,
        recipient,
        origin: "send",
      });
    }
    setSent({
      chainId: asset.chainId,
      txHash: result.txHash,
      confirmed: result.confirmed !== false,
      amount: amountBase,
      asset,
      recipient,
      destChainId,
      plan: mode === "ibc" && candidate ? candidate.plan : null,
    });
    setStep("done");
    const href = `/activity/${result.txHash}?chainId=${encodeURIComponent(asset.chainId)}`;
    if (result.confirmed === false) {
      toast.info("Broadcast, not confirmed yet", { description: `${amountLabel} may still land. Check Activity.`, action: { label: "View", href } });
    } else if (mode === "ibc") {
      // Only a measured time is promised; otherwise say where to follow it.
      toast.success(`${amountLabel} on its way to ${chainName(destChainId)}`, {
        description: observedTiming
          ? `Your transfers on this route usually land in ${formatDuration(observedTiming.median)}. Followed here and in Live.`
          : "Followed here and in Live until it lands.",
        action: { label: "View", href },
      });
    } else {
      toast.success(`Sent ${amountLabel}`, { description: `to ${contact?.label ?? shortenAddress(recipient)}`, action: { label: "View", href } });
    }
  }

  const pickRecipient = (address: string, chainId?: string | null) => {
    pinAsset();
    setRecipientText(address);
    setRecipientBlurred(true);
    setDestChoice(chainId ?? null);
    setOverrides({});
    if (step !== "form") setStep("form");
  };

  /* ------------------------------------------------------------- review */
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
  const tierName = tier === "low" ? "Low" : tier === "high" ? "High" : "Average";
  const reviewRows: KeyValueItem[] =
    asset && chain && destChainId
      ? [
          {
            key: "from",
            label: "From",
            value: (
              <span className="inline-flex items-center justify-end gap-1.5">
                <ChainLogo chainId={asset.chainId} size={16} />
                {chain.chainName}
                <span className="font-mono text-[12px] text-fg-dim">{sender ? shortenAddress(sender, 8, 4) : ""}</span>
              </span>
            ),
          },
          {
            key: "to",
            label: "To",
            value: (
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <ChainLogo chainId={destChainId} size={16} />
                {contact ? <span className="font-medium">{contact.label}</span> : chainName(destChainId)}
                {isOwn ? (
                  <Badge size="sm" tone="accent">
                    Your account
                  </Badge>
                ) : null}
              </span>
            ),
            // The whole address, grouped: the one line worth reading twice.
            sub: <AddressChunks address={recipient} tone="strong" className="text-[12px] leading-relaxed" />,
          },
          mode === "ibc" && candidate
            ? {
                key: "route",
                label: "Route",
                value: `${chainName(asset.chainId)} → ${chainName(destChainId)}`,
                sub: `${candidate.plan.hops.length === 1 ? "1 hop" : `${candidate.plan.hops.length} hops`} · ${candidate.plan.hops[0]?.channelId ?? ""} · ${channelVerdict(candidate.links[0]).label}`,
              }
            : { key: "network", label: "Network", value: chain.chainName, sub: "On-chain send, no bridge" },
          {
            key: "fee",
            label: "Network fee",
            value: preview.fee ? `${formatAmount(preview.fee.display, { maxFraction: 6 })} ${preview.fee.symbol ?? ""}` : "Measured when you sign",
            sub: (
              <>
                {feeFiat !== null ? (
                  <>
                    ≈ <Money value={feeFiat} currency={currency} masked={false} />
                  </>
                ) : (
                  tierName
                )}
                {feePctText ? ` · ${feePctText}` : ""}
              </>
            ),
          },
          ...(memoView ? [txMemoItem(memoView)] : []),
          mode === "ibc" && candidate
            ? {
                key: "time",
                label: "Arrives",
                value: observedTiming
                  ? `Usually in ${formatDuration(observedTiming.median)}`
                  : `In about ${Math.max(1, Math.round(candidate.plan.estimatedDurationSeconds / 60))} min (estimate)`,
                sub: `${observedTiming ? `Your last ${observedTiming.count} on this route. ` : ""}If no relayer delivers it within ${IBC_TIMEOUT_MINUTES} min, it comes back to you`,
              }
            : { key: "time", label: "Arrives", value: "In the next block", sub: "A few seconds" },
          ...(leftAfter !== null
            ? [{ key: "after", label: "Left after", value: <TokenAmount amount={leftAfter} decimals={decimals} symbol={symbol} maxFraction={6} /> }]
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

  const formCard = (
    <Card variant="hero" className="gap-4">
      {step === "form" ? (
        <>
          <CardHeader
            title={mode === "ibc" ? "Send across chains" : "Send"}
            subtitle={
              mode === "ibc"
                ? `${chainName(asset?.chainId)} → ${chainName(destChainId)} over IBC`
                : asset
                  ? `On ${chainName(asset.chainId)}`
                  : "Choose what to send"
            }
            actions={
              <>
                <PartialDataBadge errors={portfolio.data?.errors} />
                {mode ? (
                  <Badge tone={mode === "ibc" ? "info" : "neutral"} size="md" dot>
                    {mode === "ibc" ? "IBC transfer" : "Same chain"}
                  </Badge>
                ) : null}
              </>
            }
          />
          {reviewDrifted ? (
            <Callout tone="warning" title="The transfer changed while you were reviewing it">
              A read in the background changed what would be signed. Check the form, then review it again.
            </Callout>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg-muted">Token</span>
            <AssetPicker
              assets={assets}
              value={asset?.key ?? null}
              onChange={(row) => {
                setAssetKey(row.key);
                setAmountText("");
                setOverrides({});
              }}
              currency={currency}
              loading={portfolio.loading && !portfolio.data}
              groupByChain={multiChain}
              label="Token to send"
              emptyText={balancesFailed ? "Balances could not be read" : "Nothing to send here"}
            />
            {balancesFailed ? (
              <InlineError message={portfolio.error?.message ?? "Balances could not be read."} onRetry={portfolio.refetch} />
            ) : missing ? (
              <MissingTokenNote
                missing={missing}
                verb="send"
                scopeName={selectedChainId ? chainName(selectedChainId) : null}
                onShowAll={() => setSelectedChainId(null)}
                onRetry={portfolio.refetch}
                retrying={portfolio.refreshing}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <RecipientAddressField
              label="To"
              value={recipientText}
              onChange={(value) => {
                pinAsset();
                setRecipientText(value);
                setDestChoice(null);
                setOverrides({});
              }}
              onBlur={() => setRecipientBlurred(true)}
              showBook={false}
              placeholder="Paste or scan an address"
              leading={
                check.state === "valid" && destChainId ? (
                  <ChainLogo chainId={destChainId} size={18} />
                ) : (
                  <Icon name="user" size={16} />
                )
              }
              error={(recipientBlurred || check.state === "operator") && check.state !== "valid" && check.state !== "empty" && check.state !== "partial" ? check.message : undefined}
            />
            <RecipientInsight
              stateValid={check.state === "valid"}
              destChainId={destChainId}
              sourceChainId={asset?.chainId ?? null}
              options={destination.options}
              onChoose={setDestChoice}
              contactLabel={contact?.label ?? null}
              isOwn={isOwn}
              history={history}
              onSave={() => setSaveOpen(true)}
            />
            {check.state === "empty" ? (
              <QuickRecipients book={book} ownAccounts={otherAccounts.slice(0, 2)} onPick={pickRecipient} />
            ) : null}
          </div>

          {mode === "ibc" ? (
            <RouteSection
              status={plan.status}
              data={plan.data}
              candidate={candidate}
              error={plan.error}
              onRetry={plan.reload}
              observed={observedTiming}
              fromChainId={asset?.chainId ?? null}
              toChainId={destChainId}
              historyChannel={historyChannel}
              overrides={overrides}
              onOverridesChange={setOverrides}
            />
          ) : null}

          <AmountField
            asset={asset}
            value={amountText}
            onChange={(value) => {
              pinAsset();
              setAmountText(value);
            }}
            maxBase={maxBase}
            onMax={followMax}
            reserve={reserve}
            leftAfter={leftAfter}
            leftWhere="left after"
            // The field formats money in the stored preference; when the server
            // fell back to another currency the figure would carry the wrong sign.
            fiatValue={currency === prefs.currency ? (amountBase ? assetValue : undefined) : undefined}
            error={amountText && asset && amountBase && exceeds(amountBase, asset.liquid) ? "More than you hold" : undefined}
          />

          <div className="flex flex-col gap-1.5">
            <Input
              label="Memo"
              value={memo}
              maxLength={MAX_MEMO + 40}
              placeholder="Optional. Zunia adds one if empty"
              onChange={(event) => setMemo(event.target.value)}
              error={memo.length > MAX_MEMO ? `${memo.length - MAX_MEMO} characters over the ${MAX_MEMO} a chain accepts` : (memoIssue ?? undefined)}
              hint={
                exchange && !memo.trim()
                  ? undefined
                  : mode === "ibc"
                    ? "Stored on the source chain only. Many exchanges do not credit IBC deposits: check before sending to one."
                    : "Public, on chain forever. Exchanges often need one to credit a deposit."
              }
              trailing={<span className="font-mono text-[11px] tabular-nums text-fg-dim">{memo.length}/{MAX_MEMO}</span>}
            />
            {exchange && !memo.trim() ? (
              <Callout tone="warning" title="This looks like an exchange">
                Most exchanges credit a deposit only with the memo (deposit tag) they give you. Without it, the funds can be lost or
                take weeks to recover.
              </Callout>
            ) : null}
          </div>

          <FeeTierPicker
            tiers={preview.tiers}
            value={tier}
            onChange={setTier}
            loading={preview.loading}
            feePrice={feePrice}
            currency={currency}
            gas={preview.gas}
            problem={preview.problem}
          />

          <div className="flex flex-col gap-2">
            <Button size="lg" variant="primary" fullWidth disabled={blocked !== null} onClick={openReview} aria-describedby="send-blocked">
              {mode === "ibc" ? "Review transfer" : "Review send"}
            </Button>
            <p id="send-blocked" className="min-h-[18px] text-center text-[12.5px] text-fg-dim" aria-live="polite">
              {blocked ?? (mode === "ibc" ? "Nothing is signed until you approve it in your wallet." : "You review everything before your wallet asks.")}
            </p>
          </div>
        </>
      ) : step === "review" && asset ? (
        <>
          <CardHeader title={mode === "ibc" ? "Review transfer" : "Review send"} subtitle="Check each line: this is what your wallet will sign." />
          <ReviewPanel
            heading="You send"
            amount={{ base: amountBase ?? "0", decimals, symbol, value: assetValue, currency }}
            rows={reviewRows}
            memo={memoExplanation}
            problems={[
              ...(intentProblem ? [intentProblem] : []),
              ...(memoExplanation?.risk === "danger" ? ["This memo cannot be signed from here. The line marked above says why."] : []),
            ]}
            notice={
              <>
                {feePct !== null && feePct >= 5 ? (
                  <Callout tone="warning" title={`The fee is ${formatPercent(feePct, { digits: 1 })} of what you send`}>
                    For an amount this small the network fee weighs a lot. Sending more at once costs the same fee.
                  </Callout>
                ) : null}
                {!contact && !isOwn && history.count === 0 ? (
                  <Callout tone="neutral" icon="info">
                    First transfer to this address in your loaded history. Compare its first and last characters with the
                    recipient&apos;s.
                  </Callout>
                ) : null}
              </>
            }
            confirmLabel="Confirm in wallet"
            onBack={() => setStep("form")}
            onConfirm={() => void sign()}
          />
        </>
      ) : step === "signing" && reviewed ? (
        <>
          {/* From what was reviewed: the live row can vanish mid-signing (a "send everything" leaves no balance to list). */}
          <CardHeader title="Approve in your wallet" subtitle={`${mode === "ibc" ? "IBC transfer" : "Send"} on ${chainName(reviewed.asset.chainId)}`} />
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
            title={sent.plan ? <>On its way to {chainName(sent.destChainId)}</> : sent.confirmed ? "Sent" : "Broadcast"}
            detail={
              <>
                <TokenAmount amount={sent.amount} decimals={sent.asset.decimals} symbol={sent.asset.identity.ticker} maxFraction={6} /> to{" "}
                {book.byAddress(sent.recipient)?.label ?? shortenAddress(sent.recipient, 10, 6)}
                {sent.confirmed ? "" : ". Not in a block yet; it may still land."}
              </>
            }
            chainId={sent.chainId}
            hash={sent.txHash}
          />
          {sent.plan ? <TransferTracker plan={sent.plan} sourceTxHash={sent.txHash} expectedAmount={sent.amount} pendingId={sent.txHash} /> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" variant="primary" className="sm:flex-1" onClick={resetAfterSend}>
              Send more
            </Button>
            {!book.byAddress(sent.recipient) && !isOwn ? (
              <Button size="lg" variant="secondary" className="sm:flex-1" iconLeft="star" onClick={() => setSaveOpen(true)}>
                Save recipient
              </Button>
            ) : (
              <Button size="lg" variant="secondary" className="sm:flex-1" href="/activity">
                All activity
              </Button>
            )}
          </div>
        </>
      ) : null}
    </Card>
  );

  const loadingHistory = activity.loading && activity.items.length === 0;
  // The chains answered (rows or not): an empty answer is a real zero.
  const historyRead = !historyFailed && activity.status !== "idle";
  const sentCurrency = historyPrices.currency ?? currency;

  return (
    <div className="grid grid-cols-12 items-start gap-[var(--d-gap)]">
      <StatStrip pending={portfolio.refreshing || activity.refreshing} className="order-2 col-span-12 lg:order-1">
        <Stat
          label="Spendable now"
          value={
            <Money
              // Nothing liquid in a read where every chain answered is a known
              // zero; one that left a chain out is unknown, like a sum of
              // tokens none of which has a price.
              value={balancesFailed || !portfolio.data ? null : spendable.count === 0 && unreadChains > 0 ? null : spendable.value}
              currency={currency}
              compact
              animate
              reason={
                balancesFailed
                  ? "Balances could not be read"
                  : !portfolio.data
                    ? "No balance read in this scope"
                    : spendable.count === 0
                      ? `Balances not read on ${unreadChains} ${unreadChains === 1 ? "network" : "networks"}`
                      : "None of these tokens has a price"
              }
            />
          }
          sub={
            balancesFailed
              ? "Balances unreadable"
              : spendable.count > 0
                ? // Short enough for a phone tile: the label already says "spendable".
                  spendable.unpriced > 0
                  ? `${spendable.count} ${spendable.count === 1 ? "token" : "tokens"} · ${spendable.unpriced} unpriced`
                  : `${spendable.count} token${spendable.count === 1 ? "" : "s"} you can move`
                : portfolio.loading
                  ? "Reading balances…"
                  : unreadChains > 0
                    ? `${unreadChains} ${unreadChains === 1 ? "network" : "networks"} not read`
                    : "No liquid balance"
          }
          loading={portfolio.loading && !portfolio.data}
          info="Liquid balances in this scope, valued at current prices; a token without a price is counted, not valued. Staked and unbonding tokens cannot be sent until they are released."
        />
        {/* Pro only: analysis, not needed to act */}
        {prefs.lite ? null : (
          <Stat
            label="Staked & unbonding"
            value={
              <Money
                value={balancesFailed ? null : (locked?.value ?? null)}
                currency={currency}
                compact
                reason={
                  balancesFailed
                    ? "Balances could not be read"
                    : !locked
                      ? "No staking read yet"
                      : locked.unpriced > 0
                        ? `${locked.unpriced} staked or unbonding ${locked.unpriced === 1 ? "token has" : "tokens have"} no price`
                        : `Staking not read on ${locked.unread} ${locked.unread === 1 ? "network" : "networks"}`
                }
              />
            }
            sub={balancesFailed ? "Balances unreadable" : rewards ? <LockedSub rewards={rewards} unpriced={unpricedHeld} currency={currency} /> : undefined}
            loading={portfolio.loading && !portfolio.data}
            info="Not spendable as is: undelegate (and wait out the unbonding period) or claim the rewards first. Valued at current prices; a token without a price is counted, not valued."
          />
        )}
        <Stat
          label="Last sent"
          value={
            historyFailed ? (
              <Money value={null} reason="History could not be read" />
            ) : stats.lastSent ? (
              <RelativeTime at={Date.parse(stats.lastSent.time)} />
            ) : (
              <span className="text-fg-dim">None</span>
            )
          }
          sub={
            historyFailed
              ? "History unreadable"
              : stats.lastSent
                ? prefs.hideAmounts
                  ? maskAmounts(stats.lastSent.summary, "transfer")
                  : stats.lastSent.summary
                : since
                  ? `Nothing sent ${since}`
                  : activity.loading
                    ? "Reading history…"
                    : "No history loaded"
          }
          loading={loadingHistory}
          info="From the history the chains keep (public nodes prune old transactions)."
        />
        {prefs.lite ? null : (
          <Stat
            label="Sent"
            value={
              <Money
                // Nothing sent in a history that was read is a known zero, not an unknown.
                value={historyFailed ? null : outgoing.length === 0 && historyRead ? 0 : sentFlow.outValue}
                currency={sentCurrency}
                compact
                reason={historyFailed ? "History could not be read" : outgoing.length > 0 ? "None of what you sent has a price" : "No history read yet"}
              />
            }
            sub={
              historyFailed
                ? "History unreadable"
                : `${outgoing.length} transfer${outgoing.length === 1 ? "" : "s"}${outgoing.length > 0 ? " · est." : ""}${sentFlow.unpricedOut > 0 ? ` · ${sentFlow.unpricedOut} unpriced` : ""}`
            }
            loading={loadingHistory || (outgoing.length > 0 && historyPrices.loading)}
            info={`Sends and IBC transfers out ${since ?? "in the loaded history"}. ${sentFlow.method}`}
          />
        )}
      </StatStrip>

      <div className="order-1 col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:order-2 lg:col-span-7">
        <div ref={cardRef} className="scroll-mt-20">
          {formCard}
        </div>
      </div>

      {/* Two stacks side by side on tablets (no row of mismatched heights);
          one column on phones and beside the form. DOM order is reading order. */}
      <div className="order-3 col-span-12 grid min-w-0 grid-cols-1 items-start gap-[var(--d-gap)] md:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
        <div className={SIDE_STACK}>
          <AddressBookCard book={book} activeAddress={recipient} onPick={(entry) => pickRecipient(entry.address, entry.chainId ?? null)} />
          <FrequentRecipientsCard
            rows={frequent}
            contactName={(address) => book.byAddress(address)?.label ?? null}
            isOwn={(address) => ownAddresses.has(address)}
            activeAddress={recipient}
            onPick={pickRecipient}
            since={since}
          />
        </div>
        <div className={SIDE_STACK}>
          <OwnAccountsCard
            accounts={otherAccounts}
            title="Your accounts on other chains"
            subtitle="Tap one to move funds there over IBC"
            activeAddress={recipient}
            onPick={(row) => pickRecipient(row.address, row.chainId)}
            values={chainValues}
            currency={currency}
          />
        </div>
      </div>

      <RecentTransfers
        className="order-4 col-span-12"
        items={pairedTransfers.rows.slice(0, 8)}
        delivered={pairedTransfers.delivered}
        loading={loadingHistory}
        refreshing={activity.refreshing}
        error={activity.error?.message ?? null}
        onRetry={activity.refetch}
        nameFor={(address) => book.byAddress(address)?.label ?? (ownAddresses.has(address) ? "your account" : null)}
        subtitle={since ? `Read from the chains, ${since}` : "Read from the chains"}
        actions={
          <>
            <PartialDataBadge errors={activity.errors} />
            <Button size="sm" variant="ghost" href="/activity" iconRight="arrowRight">
              All activity
            </Button>
          </>
        }
      />

      <ContactDialog open={saveOpen} onOpenChange={setSaveOpen} book={book} initialAddress={sent?.recipient ?? recipient} />
    </div>
  );
}

/**
 * The line under "Staked & unbonding": the rewards, and how many of these
 * holdings (staked, unbonding, rewards) have no price. Said in words because
 * the figure above leaves them out, or is "—" for them; rewards that are all
 * unpriced are among that count, rewards a node did not answer for say so.
 */
function LockedSub({ rewards, unpriced, currency }: { rewards: BucketWorth; unpriced: number; currency: string }) {
  const note = unpriced > 0 ? `${unpriced} unpriced` : null;
  if (rewards.value === null) return <>{[rewards.unpriced > 0 ? null : "Rewards not read", note].filter(Boolean).join(" · ")}</>;
  return (
    <>
      + <Money value={rewards.value} currency={currency} compact /> rewards{note ? ` · ${note}` : ""}
    </>
  );
}
