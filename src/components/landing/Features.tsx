/**
 * "What you get": six tiles, one per thing the desk does that a wallet
 * popup cannot, each with a picture drawn from the real kit (lazy, see
 * FeatureVisual) and a link to the page that does it.
 */

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import type { FeaturedChain } from "./content";
import { FeatureVisual } from "./FeatureVisual";
import type { FeatureKind } from "./FeatureVisuals";
import { SectionHeading } from "./SectionHeading";

interface Feature {
  kind: FeatureKind;
  icon: IconName;
  title: string;
  body: string;
  href: string;
  cta: string;
}

function features(feeRate: string): Feature[] {
  return [
    {
      kind: "scope",
      icon: "networks",
      title: "Every chain, or just one",
      body: "Pick the Zunia mark to see everything you hold across your networks, or one chain for its own details. Every page follows the scope you choose.",
      href: "/chains",
      cta: "Browse chains",
    },
    {
      kind: "analytics",
      icon: "compare",
      title: "Analysis that compares",
      body: "Indexed price performance, actual APR, real yield and validator concentration side by side, each figure with its source and age.",
      href: "/compare",
      cta: "Compare side by side",
    },
    {
      kind: "swap",
      icon: "swap",
      title: "Swap any Osmosis pair",
      body: `Quotes from the Osmosis router for any pair it trades. The ${feeRate} Zunia fee is its own line in the quote, before you sign.`,
      href: "/swap",
      cta: "Open swap",
    },
    {
      kind: "ibc",
      icon: "bridge",
      title: "IBC you can follow",
      body: "Move assets between chains over IBC and watch each packet travel: sent, received on the other side, acknowledged.",
      href: "/bridge",
      cta: "Open bridge",
    },
    {
      kind: "staking",
      icon: "staking",
      title: "Staking with the risks in view",
      body: "Actual APR per validator, the commission it can still rise to, uptime in the signing window, and who holds the top third of the vote.",
      href: "/validators",
      cta: "Compare validators",
    },
    {
      kind: "governance",
      icon: "governance",
      title: "Governance across chains",
      body: "Every proposal on your chains in one list: time left, the live tally against quorum, and whether you have voted yet.",
      href: "/governance",
      cta: "See proposals",
    },
  ];
}

export function Features({ chains, feeRate }: { chains: FeaturedChain[]; feeRate: string }) {
  return (
    <section id="features" aria-labelledby="features-title" className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
      <SectionHeading id="features-title" eyebrow="What you get" title="Analysed, compared, one click from action" split>
        One desk for everything you hold across Cosmos: what it is worth, how it earns, what needs you, and the action that
        follows.
      </SectionHeading>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features(feeRate).map((feature) => (
          <li key={feature.kind} className="d-card group flex min-w-0 flex-col overflow-hidden transition-[border-color] duration-[160ms] hover:border-[var(--d-hairline-strong)]">
            <div className="relative m-2 mb-0 h-[156px] overflow-hidden rounded-[12px] border border-[var(--d-hairline)] bg-[var(--d-card-2)]">
              <FeatureVisual kind={feature.kind} chains={chains} feeRate={feeRate} />
            </div>
            <div className="flex flex-1 flex-col gap-2 px-5 pb-5 pt-4">
              <h3 className="flex items-center gap-2 text-[16px] font-medium tracking-[-0.02em] text-fg">
                <Icon name={feature.icon} size={17} className="shrink-0 text-[var(--d-accent-text)]" />
                {feature.title}
              </h3>
              <p className="text-[14px] leading-[1.6] text-fg-muted">{feature.body}</p>
              <Link
                href={feature.href}
                className="d-hit mt-auto inline-flex w-fit items-center gap-1 pt-2 text-[13.5px] font-medium text-fg transition-colors duration-[160ms] hover:text-[var(--d-accent-text)]"
              >
                {feature.cta}
                <Icon name="arrowRight" size={14} className="transition-transform duration-[160ms] group-hover:translate-x-0.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-[12.5px] text-fg-dim">
        <Icon name="info" size={14} className="shrink-0" />
        The pictures are illustrations of the dashboard&apos;s views, not live figures.
      </p>
    </section>
  );
}
