"use client";

/**
 * What an empty wallet sees instead of a dashboard of zeros: where its
 * address is, how tokens get there, and how to bring in chains it already
 * holds tokens on. Shown only when every chain in scope answered and none
 * holds anything (a failed read is never mistaken for an empty wallet).
 */

import { Icon, type IconName } from "@/components/icons";
import { AddressText, Button, Card, ChainLogo, LogoStack } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";

interface Step {
  icon: IconName;
  title: string;
  body: string;
  action: { label: string; href: string; primary?: boolean };
}

export function OverviewOnboarding({
  scope,
  address,
}: {
  /** Chains that were read (all empty). */
  scope: { selected: ChainEntry | null; chains: readonly ChainEntry[] };
  /** The wallet's address on the first scoped chain, to copy. */
  address: { chainId: string; address: string } | null;
}) {
  const where = scope.selected ? scope.selected.chainName : `${scope.chains.length} ${scope.chains.length === 1 ? "network" : "networks"}`;
  const steps: Step[] = [
    {
      icon: "receive",
      title: "Receive",
      body: "Share your address or its QR code. Tokens sent there land in your wallet's keys directly; Zunia never holds them.",
      action: { label: "Show my addresses", href: "/receive", primary: true },
    },
    {
      icon: "markets",
      title: "Buy elsewhere, withdraw here",
      body: "Zunia doesn't sell crypto. Buy on an exchange that lists the token, then withdraw to your address on the matching network.",
      action: { label: "See Cosmos markets", href: "/markets" },
    },
    {
      icon: "networks",
      title: "Follow your other chains",
      body: "Already hold tokens on another Cosmos chain? Follow it and its balances appear here.",
      action: { label: "Manage networks", href: "/networks" },
    },
  ];

  return (
    <Card variant="hero" className="gap-5 p-5 sm:p-6" aria-labelledby="overview-onboarding-title">
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[image:var(--z-accent-gradient)] text-white shadow-[0_8px_24px_rgba(255,45,31,0.22)]">
          <Icon name="wallet" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="overview-onboarding-title" className="text-[20px] font-semibold tracking-[-0.025em] text-fg">
            Your wallet is ready for its first tokens
          </h2>
          <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-fg-muted">
            Every chain answered, and your address holds nothing on {where} yet. Once tokens arrive, this page shows
            your net worth, staking yield, allocation and what needs attention.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {scope.selected ? (
              <ChainLogo chainId={scope.selected.chainId} size={20} />
            ) : (
              <LogoStack size={20} max={5} items={scope.chains.map((chain) => ({ src: chain.iconUrl, label: chain.chainName }))} />
            )}
            {address ? <AddressText address={address.address} className="text-fg-muted" /> : null}
          </div>
        </div>
      </div>
      <ol className="grid gap-[var(--d-gap)] sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2.5 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card)] p-4">
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[10px] bg-[var(--d-glass-2)] text-fg-muted">
                <Icon name={step.icon} size={16} />
              </span>
              <span className="d-label">Step {index + 1}</span>
            </span>
            <h3 className="text-[15px] font-medium tracking-[-0.01em] text-fg">{step.title}</h3>
            <p className="text-[13px] leading-[1.5] text-fg-muted">{step.body}</p>
            <Button
              href={step.action.href}
              size="sm"
              variant={step.action.primary ? "primary" : "secondary"}
              iconRight="arrowRight"
              className="mt-auto self-start"
            >
              {step.action.label}
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
