"use client";

/**
 * Cross-chain swap over Osmosis ibc-hooks + crosschain-swaps.
 *
 * No aggregator, no bridge, no third party holding the funds. The user signs
 * exactly one `MsgTransfer` on the chain they already hold the asset on, and
 * the memo on that transfer is what makes everything after it happen: a
 * packet-forward hop if the venue is not adjacent, the contract call on
 * Osmosis, and another forward if the payout chain is not adjacent either.
 *
 * The shape of this page follows the two facts that decide whether it is safe:
 *
 * 1. **Gas is paid once, on the source chain, in the source chain's token.**
 *    The contract call runs inside packet processing and a relayer pays for it,
 *    so no Osmosis account and no OSMO are needed. That sentence is on screen
 *    before the user signs, because it is the question this flow generates.
 * 2. **The memo is the security control.** It is composed by a route handler,
 *    so it reaches the browser over the network — and is therefore re-parsed
 *    here, from its own bytes, with the engine's parser, and described in plain
 *    language in the approval dialog. Nothing the planner says about its own
 *    memo is displayed.
 *
 * Everything chain-facing is `@zunialab/interchain`, reached through
 * `/api/interchain/*` so no visitor IP is sent to a long tail of public REST
 * endpoints. There is no route, denom or memo logic in this file.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Callout,
  Card,
  Input,
  RoutePreview,
  SectionLabel,
  Skeleton,
  SwapQuotePanel,
  TokenLogo,
  checkSlippage,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { AssetSelect, assetLabel } from "@/components/interchain/AssetSelect";
import { ChainChooser } from "@/components/interchain/ChainChooser";
import {
  ChannelOverrides,
  type ChannelLeg,
} from "@/components/interchain/ChannelOverrides";
import { TransferApproval } from "@/components/interchain/TransferApproval";
import { TransferProgress } from "@/components/interchain/TransferProgress";
import { reencodeAddress } from "@/lib/address";
import { findChain } from "@/lib/chains";
import {
  exceeds,
  formatToken,
  formatUnits,
  isPositiveAmount,
  rateLine,
  toBaseUnits,
} from "@/lib/interchain/amounts";
import type { HopOverrideInput } from "@/lib/interchain/client";
import { routePreviewHops } from "@/lib/interchain/route-view";
import {
  useBalances,
  usePlan,
  useQuote,
  useSwapConfig,
} from "@/lib/interchain/hooks";
import { memoMatchesIntent } from "@/lib/interchain/memo-summary";
import type { PlanCandidateWire, RoutePlanWire } from "@/lib/interchain/wire";
import {
  defaultIbcTimeoutNs,
  msgExecuteContract,
  msgIbcTransfer,
} from "@/lib/tx/amino-tx";
import { resolveSignAmino } from "@/lib/tx/resolve-sign";
import { feeForChain, signAminoAndBroadcast } from "@/lib/tx/sign-broadcast";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";

/** One `MsgTransfer` with a memo the middleware walks. Simulation is not wired. */
const SWAP_GAS_LIMIT = 350_000;
/** One `MsgExecuteContract` calling `{"recover":{}}`. */
const RECOVER_GAS_LIMIT = 400_000;

const SLIPPAGE_PRESETS = [0.5, 1, 3];

interface SignedSwap {
  readonly txHash: string;
  readonly plan: RoutePlanWire;
  readonly amount: string;
  readonly recoveryAddress: string;
  readonly venueChainId: string;
}

export default function SwapPage() {
  const { account, session } = useWallet();
  const { selectedChainId } = useChainScope();
  const config = useSwapConfig();

  const [sourceChainId, setSourceChainId] = useState(
    () => selectedChainId ?? "cosmoshub-4",
  );
  const [inputDenom, setInputDenom] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [assetChainId, setAssetChainId] = useState("osmosis-1");
  const [destChainId, setDestChainId] = useState("osmosis-1");
  const [slippageInput, setSlippageInput] = useState("");
  const [overrides, setOverrides] = useState<Record<string, HopOverrideInput>>({});
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signed, setSigned] = useState<SignedSwap | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoverTxHash, setRecoverTxHash] = useState<string | null>(null);

  // The connected account decides the source chain, so a rail change that
  // switches chains must not leave the form pointed at the old one. A
  // render-time adjustment rather than an effect: a synchronous setState in an
  // effect body costs a second render pass on every scope change.
  const [lastScoped, setLastScoped] = useState(selectedChainId);
  if (selectedChainId !== lastScoped) {
    setLastScoped(selectedChainId);
    if (selectedChainId) setSourceChainId(selectedChainId);
  }

  const sourceChain = findChain(sourceChainId);
  const destChain = findChain(destChainId);
  const assetChain = findChain(assetChainId);
  const venueChain = config.data ? findChain(config.data.chainId) : undefined;

  const sourceAddress = useMemo(() => {
    if (!account || !sourceChain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    if (accountChain.chainId === sourceChain.chainId) return account.address;
    return reencodeAddress(account.address, sourceChain, accountChain);
  }, [account, sourceChain]);

  const balances = useBalances(sourceChainId, sourceAddress);

  // The first named asset, chosen once the list lands, so the form is usable
  // without a click. Render-time, keyed by the list itself.
  const balanceKey = balances.data?.balances.map((row) => row.denom).join(",") ?? "";
  const [lastBalanceKey, setLastBalanceKey] = useState(balanceKey);
  if (balanceKey !== lastBalanceKey) {
    setLastBalanceKey(balanceKey);
    const rows = balances.data?.balances ?? [];
    if (rows.length > 0 && !rows.some((row) => row.denom === inputDenom)) {
      setInputDenom(rows[0]!.denom);
    }
  }

  const selectedBalance = balances.data?.balances.find(
    (row) => row.denom === inputDenom,
  );
  const inputDecimals = selectedBalance?.decimals ?? null;
  const amountBase =
    inputDecimals === null ? null : toBaseUnits(amountInput, inputDecimals);
  const overBalance =
    amountBase !== null && selectedBalance
      ? exceeds(amountBase, selectedBalance.amount)
      : false;

  const slippage = slippageInput.trim()
    ? Number(slippageInput)
    : (config.data?.defaultSlippagePercent ?? 1);
  const slippageCheck = checkSlippage(slippage);

  const recipient = useMemo(() => {
    if (!account || !destChain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    return reencodeAddress(account.address, destChain, accountChain);
  }, [account, destChain]);

  const recoveryAddress = useMemo(() => {
    if (!account || !venueChain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    return reencodeAddress(account.address, venueChain, accountChain);
  }, [account, venueChain]);

  const sameAsset =
    Boolean(selectedBalance) &&
    selectedBalance?.baseDenom === assetChain?.coinMinimalDenom &&
    selectedBalance?.originChainId === assetChainId;

  /** Everything that must hold before the wallet is asked to do anything. */
  const blockers = useMemo(() => {
    const list: string[] = [];
    if (config.status === "error") {
      list.push(
        config.error?.message ??
          "The swap configuration could not be read, so nothing can be planned.",
      );
    }
    if (config.data && !config.data.available) {
      list.push(config.data.reason ?? "Cross-chain swap is not configured.");
    }
    if (!account) list.push("Connect a wallet to plan a swap.");
    if (account && !sourceAddress) {
      list.push(
        `Your account cannot be re-encoded for ${sourceChain?.chainName ?? sourceChainId}: it uses a different coin type, so it is a different key.`,
      );
    }
    if (account && !recipient) {
      list.push(
        `Your account cannot be re-encoded for ${destChain?.chainName ?? destChainId}: it uses a different coin type, so it is a different key.`,
      );
    }
    if (account && config.data?.available && !recoveryAddress) {
      list.push(
        `Your account cannot be re-encoded for ${venueChain?.chainName ?? config.data.chainId}, so there would be no address that could reclaim a stranded payout. The swap is not offered without one.`,
      );
    }
    if (!inputDenom) list.push("Choose an asset to swap.");
    if (inputDenom && inputDecimals === null) {
      list.push(
        "This build cannot name the token behind that denom, so it cannot convert the amount you type into base units.",
      );
    }
    if (amountInput.trim() && amountBase === null && inputDecimals !== null) {
      list.push(
        `Enter an amount with at most ${inputDecimals} decimal places.`,
      );
    }
    if (!amountInput.trim() || (amountBase !== null && !isPositiveAmount(amountBase))) {
      list.push("Enter an amount greater than zero.");
    }
    if (overBalance) list.push("That is more than this account holds.");
    if (sameAsset) {
      list.push(
        "The asset to receive is the one being sent. Use Send for a plain transfer.",
      );
    }
    if (!slippageCheck.ok) {
      list.push(slippageCheck.message ?? "Enter a slippage percentage.");
    }
    return list;
  }, [
    config.status,
    config.error,
    config.data,
    account,
    sourceAddress,
    sourceChain,
    sourceChainId,
    recipient,
    destChain,
    destChainId,
    recoveryAddress,
    venueChain,
    inputDenom,
    inputDecimals,
    amountInput,
    amountBase,
    overBalance,
    sameAsset,
    slippageCheck,
  ]);

  const planInput = useMemo(() => {
    if (blockers.length > 0) return null;
    if (!amountBase || !sourceAddress || !recipient || !recoveryAddress) return null;
    if (!assetChain || !config.data?.available) return null;
    return {
      sourceChainId,
      destChainId,
      inputDenom,
      amount: amountBase,
      sender: sourceAddress,
      recipient,
      outputAsset: {
        originChainId: assetChainId,
        baseDenom: assetChain.coinMinimalDenom,
      },
      slippagePercent: slippage,
      allowSwap: true,
      recoveryAddress,
      overrides: Object.values(overrides),
    };
  }, [
    blockers.length,
    amountBase,
    sourceAddress,
    recipient,
    recoveryAddress,
    assetChain,
    config.data,
    sourceChainId,
    destChainId,
    inputDenom,
    assetChainId,
    slippage,
    overrides,
  ]);

  const plan = usePlan(planInput);
  const candidates = plan.data?.candidates ?? [];
  const candidate: PlanCandidateWire | null =
    candidates.find((row) => row.id === candidateId) ?? candidates[0] ?? null;

  const quoteInput = useMemo(() => {
    if (!candidate || !amountBase) return null;
    const outputDenom = plan.data?.outputDenom;
    if (!candidate.venueInputDenom || !outputDenom || !candidate.venue) return null;
    if (candidate.venueInputDenom === outputDenom) return null;
    return {
      chainId: candidate.venue.chainId,
      tokenInDenom: candidate.venueInputDenom,
      tokenInAmount: amountBase,
      tokenOutDenom: outputDenom,
      slippagePercent: slippage,
    };
  }, [candidate, amountBase, plan.data?.outputDenom, slippage]);

  const quote = useQuote(quoteInput);

  const outputDecimals = assetChain?.coinDecimals ?? null;
  const quoteView = useMemo(() => {
    const row = quote.data;
    if (!row || !selectedBalance || inputDecimals === null || outputDecimals === null) {
      return null;
    }
    const inputSymbol = selectedBalance.symbol ?? inputDenom;
    const outputSymbol = assetChain?.coinDenom ?? row.outputDenom;
    return {
      inputAmount: formatUnits(row.inputAmount, inputDecimals, 6),
      inputSymbol,
      outputAmount: formatUnits(row.outputAmount, outputDecimals, 6),
      outputSymbol,
      rate: rateLine({
        inputAmount: row.inputAmount,
        inputDecimals,
        inputSymbol,
        outputAmount: row.outputAmount,
        outputDecimals,
        outputSymbol,
      }),
      minReceived: formatToken(row.minReceived, outputDecimals, outputSymbol, 6),
      priceImpact: row.priceImpact,
      poolFee: row.poolFee,
      route: row.route.map((leg) => ({ poolId: leg.poolId })),
    };
  }, [
    quote.data,
    selectedBalance,
    inputDecimals,
    outputDecimals,
    inputDenom,
    assetChain,
  ]);

  const fee = feeForChain(sourceChainId, SWAP_GAS_LIMIT);
  const feeCoin = fee.amount[0];
  const feeLabel = feeCoin
    ? formatToken(
        feeCoin.amount,
        sourceChain?.feeDecimals ?? 6,
        sourceChain?.feeDenom ?? "",
        6,
      )
    : null;

  /** Legs the user can set by hand: the ones this plan uses, plus any that failed. */
  const channelLegs = useMemo<ChannelLeg[]>(() => {
    const legs = new Map<string, ChannelLeg>();
    for (const link of candidate?.links ?? []) {
      const key = `${link.sourceChainId}>${link.destChainId}`;
      legs.set(key, {
        key,
        fromChainId: link.sourceChainId,
        toChainId: link.destChainId,
        currentChannelId: link.channelId,
      });
    }
    for (const failure of plan.data?.discoveryFailures ?? []) {
      const key = `${failure.fromChainId}>${failure.toChainId}`;
      legs.set(key, {
        key,
        fromChainId: failure.fromChainId,
        toChainId: failure.toChainId,
        ...(legs.get(key)?.currentChannelId
          ? { currentChannelId: legs.get(key)!.currentChannelId! }
          : {}),
        note: failure.message,
      });
    }
    return [...legs.values()];
  }, [candidate, plan.data?.discoveryFailures]);

  const routeHops = useMemo(
    () =>
      candidate
        ? routePreviewHops(candidate.plan.hops, candidate.links)
        : [],
    [candidate],
  );

  /** Why the confirm control is unavailable, in one specific sentence. */
  const ctaBlocked = useMemo(() => {
    if (blockers.length > 0) return blockers[0]!;
    if (plan.status === "error") {
      return plan.error?.message ?? "The route could not be planned.";
    }
    if (plan.loading) return "Planning the route…";
    if (plan.data && plan.data.outputDenomReason && !plan.data.outputDenom) {
      return plan.data.outputDenomReason;
    }
    if (!candidate) {
      return (
        plan.data?.warnings[0] ??
        "No route was found between these chains for this asset."
      );
    }
    if (!candidate.venue) {
      return "The best route found is a plain transfer, not a swap. Use Send instead.";
    }
    if (!candidate.venueInputDenom) {
      return (
        candidate.venueDenomReason ??
        "The token arriving at the swap venue could not be named, so the pool cannot be quoted."
      );
    }
    if (quote.status === "error") {
      return quote.error?.message ?? "This pair could not be priced.";
    }
    if (quote.loading || !quote.data) return "Waiting for a quote…";
    if (!candidate.plan.memo) {
      return "The planned transfer carries no memo, so no swap would happen.";
    }
    return null;
  }, [blockers, plan, candidate, quote]);

  const intentMismatch = useMemo(() => {
    if (!candidate?.venue || !recipient || !recoveryAddress) return null;
    const outputDenom = plan.data?.outputDenom;
    if (!outputDenom) return null;
    const result = memoMatchesIntent(candidate.plan.memo, {
      contractAddress: candidate.venue.contractAddress,
      outputDenom,
      recipient,
      recoveryAddress,
    });
    return result.ok ? null : result.reason;
  }, [candidate, recipient, recoveryAddress, plan.data?.outputDenom]);

  async function onConfirm() {
    if (!candidate || !account || !sourceAddress || !amountBase || !recoveryAddress) {
      return;
    }
    setBusy(true);
    setSignError(null);
    try {
      const signAmino = await resolveSignAmino({ account, session });
      const hop = candidate.plan.hops[0];
      if (!hop) throw new Error("The plan has no first hop to sign.");
      const result = await signAminoAndBroadcast({
        chainId: sourceChainId,
        signer: sourceAddress,
        gasLimit: SWAP_GAS_LIMIT,
        signAmino,
        msgs: [
          msgIbcTransfer({
            sourcePort: hop.port,
            sourceChannel: hop.channelId,
            token: { denom: inputDenom, amount: amountBase },
            sender: sourceAddress,
            // ibc-hooks only runs when the ICS20 receiver is "" or the contract
            // address. The planner already set it; it is used as given rather
            // than re-derived, and the approval dialog cross-checks the memo
            // against it.
            receiver: candidate.receiver,
            timeoutTimestamp: defaultIbcTimeoutNs(15),
            memo: candidate.plan.memo,
          }),
        ],
      });
      setSigned({
        txHash: result.txhash,
        plan: candidate.plan,
        amount: amountBase,
        recoveryAddress,
        venueChainId: candidate.venue?.chainId ?? "",
      });
      setReviewOpen(false);
    } catch (error) {
      setSignError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onRecover(recovery: {
    chainId: string;
    contractAddress: string | null;
    recoveryAddress: string | null;
  }) {
    if (!account || !recovery.contractAddress || !recovery.recoveryAddress) return;
    setRecovering(true);
    setRecoverError(null);
    try {
      const signAmino = await resolveSignAmino({
        account,
        session,
        // The recovery is signed on the venue chain, so the extension has to be
        // enabled for it first.
        signingChainId: recovery.chainId,
      });
      const result = await signAminoAndBroadcast({
        // Broadcast on the venue chain, not the chain the swap started from:
        // the funds are sitting in the contract there.
        chainId: recovery.chainId,
        signer: recovery.recoveryAddress,
        gasLimit: RECOVER_GAS_LIMIT,
        signAmino,
        msgs: [
          msgExecuteContract({
            sender: recovery.recoveryAddress,
            contract: recovery.contractAddress,
            msg: { recover: {} },
          }),
        ],
      });
      setRecoverTxHash(result.txhash);
    } catch (error) {
      setRecoverError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecovering(false);
    }
  }

  if (signed) {
    return (
      <DashboardShell
        title="Swap sent"
        description="One transfer was signed. The rest is carried by relayers."
      >
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
          <Card>
            <TransferProgress
              plan={signed.plan}
              sourceTxHash={signed.txHash}
              expectedAmount={signed.amount}
              recoveryAddress={signed.recoveryAddress}
              onRecover={(recovery) => void onRecover(recovery)}
              recovering={recovering}
              recoverError={recoverError}
              recoverTxHash={recoverTxHash}
            />
          </Card>
          <Button
            variant="secondary"
            onClick={() => {
              setSigned(null);
              setAmountInput("");
              setRecoverTxHash(null);
              setRecoverError(null);
            }}
          >
            Start another swap
          </Button>
        </div>
      </DashboardShell>
    );
  }

  const venueName = config.data?.chainName ?? "the swap venue";

  return (
    <DashboardShell
      title="Swap"
      description="One signature on your own chain. The swap runs on Osmosis inside packet processing."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {config.loading ? (
            <Card aria-busy="true">
              <span className="sr-only">Checking the swap configuration</span>
              <Skeleton className="h-24 w-full rounded-[14px]" />
            </Card>
          ) : null}

          {config.data && !config.data.available ? (
            <Callout tone="warning" title="Cross-chain swap is unavailable">
              {config.data.reason}
              {config.data.configured ? null : (
                <>
                  {" "}
                  An operator sets <code>{config.data.configKey}</code> to the
                  crosschain-swaps contract address for {config.data.chainName}.
                  It is never hardcoded: a wrong address sends funds to a
                  contract that will not send them back.
                </>
              )}
            </Callout>
          ) : null}

          {config.status === "error" ? (
            <Callout tone="danger" title="Could not read the swap configuration">
              {config.error?.message}{" "}
              <button
                type="button"
                onClick={config.reload}
                className="underline underline-offset-2"
              >
                Try again
              </button>
            </Callout>
          ) : null}

          <Card className="flex flex-col gap-4">
            <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>From</SectionLabel>
                {selectedBalance ? (
                  <button
                    type="button"
                    onClick={() =>
                      setAmountInput(
                        inputDecimals === null
                          ? selectedBalance.amount
                          : formatUnits(
                              selectedBalance.amount,
                              inputDecimals,
                              inputDecimals,
                            ).replace(/,/g, ""),
                      )
                    }
                    className="font-mono text-[length:var(--z-type-micro)] text-fg-dim underline underline-offset-2"
                  >
                    balance{" "}
                    {inputDecimals === null
                      ? `${selectedBalance.amount} base units`
                      : formatUnits(selectedBalance.amount, inputDecimals, 6)}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <ChainChooser
                  label="Source network"
                  value={sourceChainId}
                  onValueChange={(chainId) => {
                    setSourceChainId(chainId);
                    setInputDenom("");
                    setOverrides({});
                  }}
                />
                <AssetSelect
                  balances={balances}
                  value={inputDenom}
                  onValueChange={setInputDenom}
                  label="Asset to swap"
                  emptyMessage={`This account holds nothing on ${sourceChain?.chainName ?? sourceChainId}.`}
                />
                <Input
                  label={`Amount${selectedBalance?.symbol ? ` (${selectedBalance.symbol})` : ""}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountInput}
                  spellCheck={false}
                  autoComplete="off"
                  state={overBalance || (amountInput.trim() && amountBase === null) ? "error" : "default"}
                  hint={
                    overBalance
                      ? "More than this account holds."
                      : amountInput.trim() && amountBase === null && inputDecimals !== null
                        ? `Use at most ${inputDecimals} decimal places.`
                        : undefined
                  }
                  onChange={(event) => setAmountInput(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
              <SectionLabel>To</SectionLabel>
              <div className="mt-3 flex flex-col gap-3">
                <ChainChooser
                  label="Asset to receive"
                  value={assetChainId}
                  onValueChange={(chainId) => {
                    setAssetChainId(chainId);
                    // Being paid on the asset's own chain is the ordinary case;
                    // the payout chain stays independently changeable below.
                    setDestChainId(chainId);
                    setOverrides({});
                  }}
                />
                <p className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim">
                  Assets are named by the chain that issues them.{" "}
                  {assetChain
                    ? `Buying ${assetChain.coinDenom}.`
                    : "Choose an issuing network."}
                </p>
                <ChainChooser
                  label="Paid on network"
                  value={destChainId}
                  onValueChange={(chainId) => {
                    setDestChainId(chainId);
                    setOverrides({});
                  }}
                />
                <div className="flex items-center gap-2">
                  <TokenLogo
                    src={assetChain?.iconUrl}
                    symbol={assetChain?.coinDenom ?? "?"}
                    size={28}
                  />
                  <span className="min-w-0 truncate font-mono text-[length:var(--z-type-meta)] text-fg-muted">
                    {recipient ?? "No address on this network"}
                  </span>
                </div>
              </div>
            </div>

            <ChannelOverrides
              legs={channelLegs}
              overrides={overrides}
              onOverridesChange={setOverrides}
              defaultOpen={(plan.data?.discoveryFailures.length ?? 0) > 0}
            />

            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                disabled={ctaBlocked !== null}
                onClick={() => {
                  setSignError(null);
                  setReviewOpen(true);
                }}
                {...(ctaBlocked ? { "aria-describedby": "swap-blocked" } : {})}
              >
                Review swap
              </Button>
              {ctaBlocked ? (
                <p
                  id="swap-blocked"
                  className="text-center font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
                >
                  {ctaBlocked}
                </p>
              ) : null}
              {blockers.length > 1 ? (
                <ul className="flex flex-col gap-1">
                  {blockers.slice(1).map((blocker) => (
                    <li
                      key={blocker}
                      className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
                    >
                      {blocker}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <SwapQuotePanel
              quote={quoteView}
              gasChainName={sourceChain?.chainName ?? sourceChainId}
              swapVenueName={venueName}
              gasFeeLabel={feeLabel}
              // The tolerance lives here rather than in the form: this is the
              // panel that shows the minimum received, which is the number the
              // tolerance decides, and the shared control already enforces the
              // 0-100 range the swaprouter actually reads.
              slippagePercent={slippage}
              onSlippageChange={(value) => setSlippageInput(String(value))}
              slippagePresets={SLIPPAGE_PRESETS}
              loading={quote.loading}
              error={
                quote.status === "error"
                  ? (quote.error?.message ?? "This pair could not be priced.")
                  : null
              }
              onRetry={quote.reload}
            />
          </Card>

          <Card>
            <RoutePreview
              hops={routeHops}
              estimatedDurationSeconds={
                candidate?.plan.estimatedDurationSeconds ?? null
              }
              warnings={candidate?.plan.warnings ?? plan.data?.warnings ?? []}
              requiresPfm={candidate?.plan.requiresPfm}
              requiresIbcHooks={candidate?.plan.requiresIbcHooks}
              gasChainName={sourceChain?.chainName}
              swapVenueName={candidate?.venue?.chainName}
              loading={plan.loading}
              error={
                plan.status === "error"
                  ? (plan.error?.message ?? "The route could not be planned.")
                  : null
              }
              onRetry={plan.reload}
              emptyDescription="Pick an asset, an amount and a destination to plan a route."
              footer={
                candidates.length > 1 ? (
                  <div className="flex flex-col gap-2">
                    <SectionLabel>Other routes</SectionLabel>
                    {candidates.map((row) => (
                      <Button
                        key={row.id}
                        variant={row.id === candidate?.id ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start"
                        onClick={() => setCandidateId(row.id)}
                        aria-pressed={row.id === candidate?.id}
                      >
                        {row.packetHopCount} hop
                        {row.packetHopCount === 1 ? "" : "s"}
                        {row.unverifiedChannelCount > 0
                          ? ` · ${row.unverifiedChannelCount} unverified`
                          : " · all verified"}
                      </Button>
                    ))}
                  </div>
                ) : null
              }
            />
          </Card>

          {plan.data?.denomStrategy &&
          plan.data.denomStrategy.strategy !== "direct" ? (
            <Callout tone="info" title="This token is going home first">
              {plan.data.denomStrategy.reason}
            </Callout>
          ) : null}

          <p className="text-[length:var(--z-type-meta)] leading-relaxed text-fg-muted">
            Moving the same asset without swapping?{" "}
            <Link href="/send" className="underline underline-offset-2">
              Send
            </Link>{" "}
            does a plain IBC transfer over the same route planner.
          </p>
        </div>
      </div>

      {candidate ? (
        <TransferApproval
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          title="Approve this swap"
          description={`One transfer on ${sourceChain?.chainName ?? sourceChainId}. Everything after it is carried out by relayers from the memo below.`}
          rows={[
            {
              label: "Sending",
              value:
                inputDecimals === null || !amountBase
                  ? amountInput
                  : formatToken(
                      amountBase,
                      inputDecimals,
                      selectedBalance ? assetLabel(selectedBalance) : "",
                      6,
                    ),
            },
            {
              label: "Receiving at least",
              value:
                quoteView?.minReceived ??
                "not quoted — the control above stays disabled until it is",
            },
            { label: "Paid to", value: recipient ?? "—" },
            { label: "Network fee", value: feeLabel ?? "—" },
            { label: "Gas", value: fee.gas },
            {
              label: "Arrives in about",
              value: `${Math.round(candidate.plan.estimatedDurationSeconds / 60)} min`,
            },
          ]}
          memo={candidate.plan.memo}
          receiver={candidate.receiver}
          chainName={(chainId) => findChain(chainId)?.chainName ?? chainId}
          denomLabel={(denom) =>
            denom === plan.data?.outputDenom && assetChain
              ? `${assetChain.coinDenom} (${denom})`
              : denom
          }
          venueChainId={candidate.venue?.chainId}
          intentMismatch={intentMismatch}
          busy={busy}
          error={signError}
          onConfirm={() => void onConfirm()}
        />
      ) : null}
    </DashboardShell>
  );
}
