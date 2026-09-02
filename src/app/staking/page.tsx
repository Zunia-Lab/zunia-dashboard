"use client";

import Link from "next/link";
import {
  Button,
  Card,
  EmptyState,
  SectionLabel,
  Stat,
  ValidatorRow,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useChainScope } from "@/lib/useChainScope";
import { formatAmount, formatFiat, usePortfolio } from "@/lib/usePortfolio";
import { useValidators } from "@/lib/useValidators";
import { usePrefs } from "@/providers/PrefsProvider";

export default function StakingPage() {
  const { snapshot, loading } = usePortfolio();
  const { selectedChain } = useChainScope();
  const validators = useValidators(selectedChain?.chainId);
  const { mask } = usePrefs();
  const currency = snapshot?.currency ?? "USD";
  const positions = (snapshot?.holdings ?? []).filter(
    (h) => Number(h.staked) > 0 || Number(h.rewards) > 0,
  );

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
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Card>
                <Stat
                  label="Staked"
                  value={
                    loading
                      ? "…"
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
              <Button disabled>Claim all</Button>
              <Button asChild variant="secondary" className="shadow-none">
                <Link href="/portfolio">Delegate</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/activity">Restake history</Link>
              </Button>
            </div>

            <Card className="p-2">
              <div className="px-3 py-3">
                <SectionLabel>Positions</SectionLabel>
              </div>
              {positions.length === 0 ? (
                <EmptyState
                  title="No stake found"
                  description="Enable live reads in the wallet and follow a chain you have delegated on."
                />
              ) : (
                <ul className="flex flex-col">
                  {positions.map((row) => (
                    <li
                      key={row.chainId}
                      className="flex items-center justify-between gap-3 rounded-[14px] px-4 py-3.5"
                    >
                      <span>
                        <span className="block text-[15px] font-medium text-fg">
                          {row.chainName}
                        </span>
                        <span className="mt-1 block font-mono text-[12.5px] text-fg-dim">
                          {row.chainId}
                          {Number(row.rewards) > 0
                            ? ` · ${mask(formatAmount(row.rewards, row.decimals))} rewards`
                            : ""}
                        </span>
                      </span>
                      <span className="text-right">
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

        <Card className="p-2">
          <div className="px-3 py-3">
            <SectionLabel>
              {selectedChain
                ? `${selectedChain.chainName} validators`
                : "Validators"}
            </SectionLabel>
          </div>
          {!selectedChain ? (
            <EmptyState
              title="Pick a chain"
              description="Select a network in the rail to load its bonded validator set and logos."
            />
          ) : validators.loading ? (
            <EmptyState
              title="Loading validators"
              description="Reading the public staking endpoint."
            />
          ) : validators.rows.length === 0 ? (
            <EmptyState
              title="No validator set"
              description="This chain's endpoint did not return a bonded validator set."
            />
          ) : (
            <ul className="flex flex-col">
              {validators.rows.slice(0, 40).map((row) => (
                <li key={row.operatorAddress}>
                  <ValidatorRow
                    name={row.moniker}
                    commission={`${(row.commission * 100).toFixed(1)}%`}
                    apr={`${(row.votingPower * 100).toFixed(2)}%`}
                    jailed={row.jailed}
                    logo={{
                      chainId: row.chainId,
                      chainName: row.chainName,
                      operatorAddress: row.operatorAddress,
                      identity: row.identity,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
