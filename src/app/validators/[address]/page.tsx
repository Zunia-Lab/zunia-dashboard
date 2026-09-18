"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, ValidatorDetail } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { useChainScope } from "@/lib/useChainScope";
import { useValidators } from "@/lib/useValidators";

function ValidatorDetailBody() {
  const params = useParams<{ address: string }>();
  const search = useSearchParams();
  const address = decodeURIComponent(params.address ?? "");
  const chainIdParam = search.get("chainId");
  const { selectedChain, scopedChainIds } = useChainScope();
  const validators = useValidators(
    chainIdParam ?? (selectedChain ? selectedChain.chainId : scopedChainIds),
  );

  const row = useMemo(
    () =>
      validators.rows.find(
        (v) =>
          v.operatorAddress === address &&
          (!chainIdParam || v.chainId === chainIdParam),
      ),
    [validators.rows, address, chainIdParam],
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <SampleDataBanner show={validators.sample} />
      {validators.loading && !row ? (
        <Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>
      ) : !row ? (
        <EmptyState
          title="Validator not found"
          description="No bonded validator matched this operator address in the current scope."
          action={
            <Button asChild>
              <Link href="/staking">Staking</Link>
            </Button>
          }
        />
      ) : (
        <Card className="p-5 sm:p-6">
          <ValidatorDetail
            name={row.moniker}
            moniker={row.operatorAddress}
            commission={`${(row.commission * 100).toFixed(2)}%`}
            votingPower={`${(row.votingPower * 100).toFixed(2)}%`}
            status={row.jailed ? "jailed" : "bonded"}
            actions={
              <div className="flex flex-wrap gap-2">
                {row.jailed ? (
                  <Button disabled>Jailed</Button>
                ) : (
                  <Button asChild>
                    <Link
                      href={`/staking?validator=${encodeURIComponent(row.operatorAddress)}&chainId=${encodeURIComponent(row.chainId)}`}
                    >
                      Delegate
                    </Link>
                  </Button>
                )}
                <Button asChild variant="secondary">
                  <Link href="/staking">Back to staking</Link>
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function ValidatorDetailPage() {
  return (
    <DashboardShell
      title="Validator"
      description="Staking detail"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/staking">Back</Link>
        </Button>
      }
    >
      <Suspense fallback={<Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>}>
        <ValidatorDetailBody />
      </Suspense>
    </DashboardShell>
  );
}
