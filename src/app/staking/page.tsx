"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Input,
  SectionLabel,
  Stat,
  ValidatorRow,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { useChainScope } from "@/lib/useChainScope";
import { formatAmount, formatFiat, usePortfolio } from "@/lib/usePortfolio";
import { useValidators } from "@/lib/useValidators";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { findChain } from "@/lib/chains";
import { msgDelegate, msgWithdrawReward } from "@/lib/tx/amino-tx";
import { feeForChain, signAminoAndBroadcast } from "@/lib/tx/sign-broadcast";
import { resolveSignAmino } from "@/lib/tx/resolve-sign";

function StakingBody() {
  const search = useSearchParams();
  const { snapshot, loading, sample, status, error } = usePortfolio();
  const failed = status === "error";
  const { selectedChain, scopedChainIds } = useChainScope();
  const validators = useValidators(
    selectedChain ? selectedChain.chainId : scopedChainIds,
  );
  const { mask } = usePrefs();
  const { account, session } = useWallet();
  const currency = snapshot?.currency ?? "USD";
  const positions = (snapshot?.holdings ?? []).filter(
    (h) => Number(h.staked) > 0 || Number(h.rewards) > 0,
  );

  const [sheet, setSheet] = useState<"claim" | "delegate" | null>(null);
  /**
   * A validator the user tapped in the list. Null means "follow the URL".
   *
   * The deep link is derived rather than copied into state: the query string is
   * already the source of truth, and syncing it across with an effect made the
   * selection lag one render behind the URL and re-fire on every `search`
   * identity change.
   */
  const [chosenValidator, setChosenValidator] = useState<{
    chainId: string;
    operatorAddress: string;
    moniker: string;
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Deep-link from the /validators/[address] Delegate CTA.
  const linkedValidator = useMemo(() => {
    const operator = search.get("validator");
    const chainIdParam = search.get("chainId");
    if (!operator) return null;
    const match = validators.rows.find(
      (v) =>
        v.operatorAddress === operator &&
        (!chainIdParam || v.chainId === chainIdParam),
    );
    return match
      ? {
          chainId: match.chainId,
          operatorAddress: match.operatorAddress,
          moniker: match.moniker,
        }
      : null;
  }, [search, validators.rows]);

  // An explicit tap wins over the link that opened the page.
  const pickedValidator = chosenValidator ?? linkedValidator;

  const chainId =
    pickedValidator?.chainId ??
    selectedChain?.chainId ??
    account?.chainId ??
    scopedChainIds[0] ??
    "";
  const chain = findChain(chainId);
  const fee = feeForChain(chainId || "cosmoshub-4", 250_000);

  const claimTargets = useMemo(() => {
    if (pickedValidator) return [pickedValidator];
    return validators.rows.slice(0, 1).map((v) => ({
      chainId: v.chainId,
      operatorAddress: v.operatorAddress,
      moniker: v.moniker,
    }));
  }, [pickedValidator, validators.rows]);

  function toBaseUnits(input: string, decimals: number): string | null {
    if (!/^\d*\.?\d*$/.test(input) || input === "" || input === ".") return null;
    const [whole = "0", fraction = ""] = input.split(".");
    if (fraction.length > decimals) return null;
    return BigInt(whole + fraction.padEnd(decimals, "0")).toString();
  }

  async function confirmClaim() {
    if (!account || claimTargets.length === 0) return;
    setBusy(true);
    setTxError(null);
    try {
      const signAmino = await resolveSignAmino({ account, session });
      const target = claimTargets[0]!;
      const result = await signAminoAndBroadcast({
        chainId: target.chainId,
        signer: account.address,
        msgs: [
          msgWithdrawReward({
            delegatorAddress: account.address,
            validatorAddress: target.operatorAddress,
          }),
        ],
        gasLimit: 250_000,
        signAmino,
      });
      setTxHash(result.txhash);
      setSheet(null);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelegate() {
    if (!account || !pickedValidator || !chain) return;
    const units = toBaseUnits(amount, chain.coinDecimals);
    if (!units || units === "0") {
      setTxError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setTxError(null);
    try {
      const signAmino = await resolveSignAmino({ account, session });
      const result = await signAminoAndBroadcast({
        chainId: pickedValidator.chainId,
        signer: account.address,
        msgs: [
          msgDelegate({
            delegatorAddress: account.address,
            validatorAddress: pickedValidator.operatorAddress,
            amount: { denom: chain.coinMinimalDenom, amount: units },
          }),
        ],
        gasLimit: 250_000,
        signAmino,
      });
      setTxHash(result.txhash);
      setSheet(null);
      setAmount("");
    } catch (err) {
      setTxError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardShell
      title="Staking"
      description={
        selectedChain
          ? `Delegations on ${selectedChain.chainName}.`
          : "Delegations and claimable rewards across followed chains."
      }
    >
      <div className="flex flex-col gap-5">
        <SampleDataBanner show={sample || validators.sample} />

        {failed ? (
          <Callout tone="danger" title="Positions unavailable">
            The balance read failed
            {error?.message ? ` (${error.message})` : ""}, so staked and
            claimable are unknown rather than zero.
          </Callout>
        ) : null}

        {txHash ? (
          <Callout tone="info" title="Broadcast accepted">
            {txHash}
          </Callout>
        ) : null}

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Card>
            <Stat
              label="Staked"
              value={
                loading
                  ? "…"
                  : failed
                    ? "—"
                    : mask(formatFiat(snapshot?.staked ?? 0, currency))
              }
            />
          </Card>
          <Card tone="hero">
            <Stat
              label="Claimable"
              value={
                loading
                  ? "…"
                  : failed
                    ? "—"
                    : mask(formatFiat(snapshot?.claimable ?? 0, currency))
              }
              delta={`${positions.length} position${positions.length === 1 ? "" : "s"}`}
            />
          </Card>
          <Card>
            <Stat label="Unbonding" value={mask("—")} delta="no unbond feed" />
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!account}
            onClick={() => {
              setTxError(null);
              setSheet("claim");
            }}
          >
            Claim all
          </Button>
          <Button
            variant="secondary"
            className="shadow-none"
            disabled={!account || !pickedValidator}
            onClick={() => {
              setTxError(null);
              setSheet("delegate");
            }}
          >
            Delegate
          </Button>
          <Button asChild variant="ghost">
            <Link href="/activity">Open activity</Link>
          </Button>
        </div>
        <p className="font-mono text-[length:var(--z-type-micro)] text-fg-dim">
          {account
            ? pickedValidator
              ? `Selected ${pickedValidator.moniker}. Review opens a wallet signature.`
              : "Select a validator below, then Claim or Delegate."
            : "Connect a wallet to sign claim and delegate transactions."}
        </p>

        <Card className="overflow-x-auto p-2">
          <div className="px-3 py-3">
            <SectionLabel>Positions</SectionLabel>
          </div>
          {positions.length === 0 ? (
            <EmptyState
              title="No stake found"
              description="Enable live reads in the wallet and follow a chain you have delegated on."
            />
          ) : (
            <ul className="flex min-w-[280px] flex-col">
              {positions.map((row) => (
                <li
                  key={row.chainId}
                  className="flex items-center justify-between gap-3 rounded-[14px] px-3 py-3 sm:px-4 sm:py-3.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-fg">
                      {row.chainName}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[12.5px] text-fg-dim">
                      {row.chainId}
                      {Number(row.rewards) > 0
                        ? ` · ${mask(formatAmount(row.rewards, row.decimals))} rewards`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[16px] font-bold tracking-[-0.03em] tabular-nums text-fg">
                      {mask(
                        row.value === null
                          ? "—"
                          : formatFiat(row.value, currency),
                      )}
                    </span>
                    <span className="mt-1 block font-mono text-[12px] font-semibold tabular-nums text-fg-muted">
                      {mask(
                        `${formatAmount(row.staked, row.decimals)} ${row.symbol}`,
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-x-auto p-2">
          <div className="px-3 py-3">
            <SectionLabel>
              {selectedChain
                ? `${selectedChain.chainName} validators`
                : "Validators across followed networks"}
            </SectionLabel>
          </div>
          {scopedChainIds.length === 0 ? (
            <EmptyState
              title="No networks followed"
              description="Follow at least one chain from Networks to load validator sets."
            />
          ) : validators.loading ? (
            <EmptyState
              title="Loading validators"
              description="Reading public staking endpoints."
            />
          ) : validators.rows.length === 0 ? (
            <EmptyState
              title="No validator set"
              description="Followed chains did not return a bonded validator set."
            />
          ) : (
            <ul className="flex min-w-[300px] flex-col">
              {validators.rows.slice(0, 60).map((row) => {
                const selected =
                  pickedValidator?.operatorAddress === row.operatorAddress &&
                  pickedValidator.chainId === row.chainId;
                const detailHref = `/validators/${encodeURIComponent(row.operatorAddress)}?chainId=${encodeURIComponent(row.chainId)}`;
                return (
                  <li
                    key={`${row.chainId}:${row.operatorAddress}`}
                    className={`flex items-stretch gap-1 rounded-[12px] ${
                      selected ? "bg-[var(--z-state-selected)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-[12px] text-left transition-colors hover:bg-[var(--z-state-hover)]"
                      onClick={() =>
                        setChosenValidator({
                          chainId: row.chainId,
                          operatorAddress: row.operatorAddress,
                          moniker: row.moniker,
                        })
                      }
                    >
                      <ValidatorRow
                        name={
                          selectedChain
                            ? row.moniker
                            : `${row.moniker} · ${row.chainName}`
                        }
                        commission={`${(row.commission * 100).toFixed(1)}%`}
                        apr={`${(row.votingPower * 100).toFixed(2)}%`}
                        jailed={row.jailed}
                        logo={{
                          chainId: row.chainId,
                          chainName: row.chainName,
                          operatorAddress: row.operatorAddress,
                          identity: row.identity,
                          logoUrl: row.logoUrl,
                        }}
                      />
                    </button>
                    <Link
                      href={detailHref}
                      className="flex shrink-0 items-center px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim hover:text-fg"
                      title="Validator detail"
                    >
                      Detail
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Dialog
        open={sheet === "claim"}
        onOpenChange={(next) => !next && setSheet(null)}
      >
        <DialogContent>
          <DialogTitle>Claim rewards</DialogTitle>
          <DialogDescription>
            Withdraws rewards from the selected validator via MsgWithdrawDelegationReward.
            Multi-validator claim-all is richer in the extension Earn screen.
          </DialogDescription>
          <p className="mt-3 font-mono text-[13px] text-fg-muted">
            {claimTargets[0]
              ? `${claimTargets[0].moniker} · fee ~${fee.amount[0]?.amount} ${chain?.feeDenom ?? ""}`
              : "Select a validator first."}
          </p>
          {txError ? (
            <Callout tone="danger" title="Could not claim" className="mt-3">
              {txError}
            </Callout>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              disabled={!account || busy || claimTargets.length === 0}
              onClick={() => void confirmClaim()}
            >
              {busy ? "Signing…" : "Sign and broadcast"}
            </Button>
            <Button variant="secondary" onClick={() => setSheet(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sheet === "delegate"}
        onOpenChange={(next) => !next && setSheet(null)}
      >
        <DialogContent>
          <DialogTitle>Confirm delegate</DialogTitle>
          <DialogDescription>
            {pickedValidator
              ? `Delegate to ${pickedValidator.moniker} on ${pickedValidator.chainId}.`
              : "Select a validator first."}
          </DialogDescription>
          <Input
            className="mt-3"
            label={`Amount${chain ? ` (${chain.coinDenom})` : ""}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
          <p className="mt-2 font-mono text-[12px] text-fg-dim">
            Est. fee {fee.amount[0]?.amount} {chain?.feeDenom ?? ""} · gas {fee.gas}
          </p>
          {txError ? (
            <Callout tone="danger" title="Could not delegate" className="mt-3">
              {txError}
            </Callout>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              disabled={!account || busy || !amount}
              onClick={() => void confirmDelegate()}
            >
              {busy ? "Signing…" : "Sign and broadcast"}
            </Button>
            <Button variant="secondary" onClick={() => setSheet(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

export default function StakingPage() {
  return (
    <Suspense
      fallback={
        <DashboardShell title="Staking" description="Loading staking…">
          <Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>
        </DashboardShell>
      }
    >
      <StakingBody />
    </Suspense>
  );
}
