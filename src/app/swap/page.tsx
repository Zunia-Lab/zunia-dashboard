"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Callout,
  Card,
  FeeSummary,
  Input,
  SectionLabel,
  Segmented,
  TokenLogo,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { ChainSelect } from "@/components/ChainSelect";
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

const SLIPPAGE_OPTIONS = ["0.1", "0.5", "1.0"];

export default function SwapPage() {
  const { account } = useWallet();
  const { selectedChainId, followedOnNetwork } = useChainScope();
  const { mask } = usePrefs();
  const fallbackId = followedOnNetwork[0] ?? "osmosis-1";
  const [fromChain, setFromChain] = useState(selectedChainId ?? fallbackId);
  const [toChain, setToChain] = useState(
    () => followedOnNetwork.find((id) => id !== (selectedChainId ?? fallbackId)) ?? "safrochain-1",
  );
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");

  useEffect(() => {
    if (selectedChainId) setFromChain(selectedChainId);
  }, [selectedChainId]);

  useEffect(() => {
    if (
      followedOnNetwork.length > 0 &&
      !followedOnNetwork.includes(fromChain)
    ) {
      setFromChain(followedOnNetwork[0]!);
    }
    if (
      followedOnNetwork.length > 0 &&
      !followedOnNetwork.includes(toChain)
    ) {
      const next =
        followedOnNetwork.find((id) => id !== fromChain) ??
        followedOnNetwork[0]!;
      setToChain(next);
    }
  }, [followedOnNetwork, fromChain, toChain]);

  const from = findChain(fromChain);
  const to = findChain(toChain);

  const feeRows = useMemo(
    () => [
      { label: "Rate", value: "—" },
      { label: "Price impact", value: "—" },
      { label: "Slippage", value: `${slippage}%` },
      { label: "Network fee", value: `— ${from?.feeDenom ?? ""}`.trim() },
      { label: "Route", value: "no aggregator connected" },
    ],
    [slippage, from?.feeDenom],
  );

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
  };

  return (
    <DashboardShell
      title="Swap"
      description="Quote across pools and sign in your wallet. The dashboard never holds a key."
      live={
        <div className="flex flex-col gap-3">
          <SectionLabel>Routes</SectionLabel>
          <p className="text-[14px] leading-relaxed text-fg-dim">
            Route comparison appears here once an aggregator is configured for
            this deployment. Nothing is quoted from the browser.
          </p>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-3">
          <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>From</SectionLabel>
              <span className="font-mono text-[13px] text-fg-dim">
                balance {mask("—")}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex min-w-[190px] flex-1 items-center gap-2">
                <TokenLogo
                  src={from?.iconUrl}
                  symbol={from?.coinDenom ?? "?"}
                  size={36}
                />
                <ChainSelect
                  value={fromChain}
                  onValueChange={setFromChain}
                  ariaLabel="Swap from chain"
                />
              </div>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                aria-label="Amount to swap"
                className="w-[160px] text-right text-[28px] tracking-tight"
              />
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={flip}
              aria-label="Flip direction"
              className="rounded-full px-3"
            >
              ⇅
            </Button>
          </div>

          <div className="rounded-[14px] bg-[var(--z-glass)] p-4">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>To</SectionLabel>
              <span className="font-mono text-[13px] text-fg-dim">
                {to?.chainId ?? "—"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex min-w-[190px] flex-1 items-center gap-2">
                <TokenLogo
                  src={to?.iconUrl}
                  symbol={to?.coinDenom ?? "?"}
                  size={36}
                />
                <ChainSelect
                  value={toChain}
                  onValueChange={setToChain}
                  ariaLabel="Swap to chain"
                />
              </div>
              <div className="w-[160px] text-right font-mono text-[28px] tracking-tight text-fg-dim">
                {mask("—")}
              </div>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-3">
            <SectionLabel>Slippage</SectionLabel>
            <Segmented
              value={slippage}
              onChange={setSlippage}
              options={SLIPPAGE_OPTIONS.map((value) => ({
                value,
                label: `${value}%`,
              }))}
            />
          </div>

          <Button className="mt-2 w-full" disabled>
            {account ? "Review swap" : "Connect a wallet"}
          </Button>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionLabel>Quote</SectionLabel>
            <FeeSummary className="mt-3" rows={feeRows} />
          </Card>
          <Callout tone="neutral" title="No aggregator connected">
            Quotes and route comparison need a swap provider on the backend.
            Until then the form validates input only and never signs.
          </Callout>
        </div>
      </div>
    </DashboardShell>
  );
}
