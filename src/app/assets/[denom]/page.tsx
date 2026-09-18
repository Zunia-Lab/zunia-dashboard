"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AssetDetail, Button, Card, EmptyState } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import {
  formatAmount,
  formatFiat,
  usePortfolio,
} from "@/lib/usePortfolio";
import { usePrefs } from "@/providers/PrefsProvider";

function AssetDetailBody() {
  const params = useParams<{ denom: string }>();
  const search = useSearchParams();
  const denom = decodeURIComponent(params.denom ?? "");
  const chainId = search.get("chainId");
  const { snapshot, loading, sample } = usePortfolio();
  const { mask } = usePrefs();
  const currency = snapshot?.currency ?? "USD";

  const holding = useMemo(() => {
    const holdings = snapshot?.holdings ?? [];
    return (
      holdings.find(
        (h) =>
          (h.symbol === denom || h.chainId === denom) &&
          (!chainId || h.chainId === chainId),
      ) ??
      holdings.find((h) => h.symbol === denom || h.chainId === denom)
    );
  }, [snapshot, denom, chainId]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <SampleDataBanner show={sample} />
      {loading && !holding ? (
        <Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>
      ) : !holding ? (
        <EmptyState
          title="Asset not found"
          description="No holding matched this denom in the current portfolio scope."
          action={
            <Button asChild>
              <Link href="/portfolio">Portfolio</Link>
            </Button>
          }
        />
      ) : (
        <Card className="p-5 sm:p-6">
          <AssetDetail
            name={holding.chainName}
            symbol={holding.symbol}
            amount={mask(formatAmount(holding.available, holding.decimals))}
            fiat={
              holding.value === null
                ? undefined
                : mask(formatFiat(holding.value, currency))
            }
            chainLabel={holding.chainName}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/send">Send</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href="/receive">Receive</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={`/chains/${encodeURIComponent(holding.chainId)}`}>
                    Chain
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams<{ denom: string }>();
  const denom = decodeURIComponent(params.denom ?? "");

  return (
    <DashboardShell
      title={denom || "Asset"}
      description="Asset detail"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/portfolio">Back</Link>
        </Button>
      }
    >
      <Suspense fallback={<Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>}>
        <AssetDetailBody />
      </Suspense>
    </DashboardShell>
  );
}
