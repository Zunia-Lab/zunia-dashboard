"use client";

/**
 * Where each rail out of Cosmos stands.
 *
 * This page used to carry a second cross-chain form: its own chain pickers, its
 * own copy of the channel-discovery fetch, its own channel-validation fetch —
 * behind a CTA that was permanently disabled because nothing here could sign.
 * A second implementation of channel discovery that never moved a token is the
 * exact duplication `@zunialab/interchain` exists to remove, so it is gone.
 *
 * What is left is the honest answer to "can I move this?" for each rail, and a
 * route to the screen that actually does it. The IBC rail works: Send does a
 * planned, verified transfer, and Swap does a crosschain swap through Osmosis.
 * The EVM and Solana rails do not, and say why rather than showing a form.
 */

import { useState } from "react";
import Link from "next/link";
import { Button, Callout, Card, SectionLabel, Segmented } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useSwapConfig } from "@/lib/interchain/hooks";

type Rail = "ibc" | "evm" | "solana";

const EXTERNAL_RAIL_REASON =
  "No bridge provider is configured for this deployment. A route across this rail would hand the funds to a third party, so nothing is offered until an operator configures one and it can be named on screen.";

export default function BridgePage() {
  const [rail, setRail] = useState<Rail>("ibc");
  const config = useSwapConfig();

  return (
    <DashboardShell
      title="Bridge"
      description="What can leave Cosmos, and what carries it. Signing always happens in your wallet."
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <Segmented<Rail>
            size="sm"
            className="w-full"
            value={rail}
            onChange={setRail}
            options={[
              { value: "ibc", label: "IBC" },
              { value: "evm", label: "EVM" },
              { value: "solana", label: "Solana" },
            ]}
          />

          {rail === "ibc" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <SectionLabel>Native IBC</SectionLabel>
                <p className="text-[length:var(--z-type-body)] leading-relaxed text-fg-muted">
                  Cosmos-to-Cosmos transfers are native: the chains hold the
                  funds in escrow themselves and no third party is involved. The
                  route is planned against live channel data, a wrapped token is
                  sent back the way it came instead of being wrapped again, and
                  chains with no direct channel are reached with a
                  packet-forward memo.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild className="w-full sm:flex-1">
                  <Link href="/send">Move an asset</Link>
                </Button>
                <Button
                  asChild={config.data?.available === true}
                  variant="secondary"
                  className="w-full sm:flex-1"
                  disabled={config.data?.available !== true}
                  {...(config.data?.available !== true
                    ? { "aria-describedby": "bridge-swap-unavailable" }
                    : {})}
                >
                  {config.data?.available === true ? (
                    <Link href="/swap">Swap while moving</Link>
                  ) : (
                    <span>Swap while moving</span>
                  )}
                </Button>
              </div>
              {config.data?.available !== true ? (
                <p
                  id="bridge-swap-unavailable"
                  className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
                >
                  {config.loading
                    ? "Checking whether a crosschain-swaps contract is configured for this deployment…"
                    : (config.data?.reason ??
                      config.error?.message ??
                      "The swap configuration could not be read, so the swap route is not offered.")}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <SectionLabel>{rail.toUpperCase()}</SectionLabel>
              <Callout tone="warning" title="No route from this dashboard">
                {EXTERNAL_RAIL_REASON}
              </Callout>
              <Button disabled className="w-full" aria-describedby="rail-blocked">
                Review transfer
              </Button>
              <p
                id="rail-blocked"
                className="text-center font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
              >
                Unavailable — nothing here can build or sign a transfer on this
                rail.
              </p>
            </div>
          )}
        </Card>

        <Callout tone="neutral" title="Custody">
          An IBC transfer never leaves Cosmos custody rules: the source chain
          escrows the token and the destination chain mints a voucher against
          it. An external bridge replaces that with whoever operates the bridge.
        </Callout>
      </div>
    </DashboardShell>
  );
}
