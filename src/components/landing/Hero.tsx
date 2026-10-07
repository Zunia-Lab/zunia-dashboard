/**
 * The landing hero: the promise, the two ways forward, the three trust
 * facts, and the live preview of public Cosmos data beside them.
 *
 * Server-rendered (the headline is the page's largest paint and its h1);
 * only the calls to action and the lazy preview hydrate.
 */

import Link from "next/link";
import { Icon } from "@/components/icons";
import { LINKS } from "./content";
import { HeroActions } from "./HeroActions";
import { HeroBackdrop } from "./HeroBackdrop";
import { LivePreviewIsland } from "./LivePreviewIsland";
import styles from "./landing.module.css";

/** `</>`: the open-source glyph (the kit's icon set has no code icon). */
function CodeGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5M13.5 5l-3 14" />
    </svg>
  );
}

const DELAY = (ms: number) => ({ animationDelay: `${ms}ms` });

export function Hero({ mainnets }: { mainnets: number }) {
  return (
    // Pulled up under the transparent navigation so the backdrop starts at
    // the top of the window.
    <section aria-labelledby="hero-title" className="relative isolate -mt-16 pt-16">
      <HeroBackdrop />
      {/* Two columns from 1280px, where the headline still fits on two
          lines beside the preview; below that the preview's two cards sit
          side by side under the copy. */}
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 pb-2 pt-8 sm:px-6 sm:pb-6 sm:pt-12 lg:px-8 lg:pb-10 xl:grid-cols-[minmax(0,1fr)_500px] xl:items-center xl:gap-14 xl:pb-8 xl:pt-14">
        <div className="flex min-w-0 max-w-[780px] flex-col gap-6 sm:gap-7">
          <Link
            href="/markets"
            className={`${styles.rise} d-hit group inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-[var(--d-hairline-strong)] bg-[color-mix(in_srgb,var(--d-card)_70%,transparent)] py-1 pl-2.5 pr-3 text-[12.5px] text-fg-muted backdrop-blur-[6px] transition-colors duration-[160ms] hover:border-[var(--d-control-line)] hover:text-fg`}
          >
            <span aria-hidden className={styles.pulse} />
            <span className="font-medium text-fg">Live public data</span>
            <span aria-hidden className="h-3 w-px bg-[var(--d-hairline-strong)]" />
            {/* Server-rendered, so it cannot follow the wallet: words that
                hold with one connected or not ("Explore without a wallet"
                sat beside "Wallet connected."). */}
            <span className="truncate">Explore markets</span>
            <Icon name="arrowRight" size={13} className="shrink-0 transition-transform duration-[160ms] group-hover:translate-x-0.5" />
          </Link>

          {/* No entrance animation on the headline: it is the largest paint, and
              a fade from transparent would hold back Largest Contentful Paint. */}
          <h1 id="hero-title" className={`${styles.headline} text-fg`}>
            Every Cosmos chain.
            <br />
            <span className={styles.headlineAccent}>One decision desk.</span>
          </h1>

          <p className={`${styles.rise} max-w-[56ch] text-[16.5px] leading-[1.6] text-fg-muted sm:text-[18px]`} style={DELAY(120)}>
            Balances, staking, governance, swaps and IBC across {mainnets} networks — analysed, compared, and one click from
            action. Your keys stay in your wallet.
          </p>

          <div className={styles.rise} style={DELAY(180)}>
            <HeroActions />
          </div>

          <ul
            className={`${styles.rise} flex flex-col gap-2.5 border-t border-[var(--d-hairline)] pt-5 text-[13.5px] text-fg-muted sm:flex-row sm:flex-wrap sm:gap-x-6`}
            style={DELAY(240)}
            aria-label="Why it is safe"
          >
            <li className="flex items-center gap-2">
              <Icon name="shield" size={16} className="shrink-0 text-[var(--d-accent-text)]" />
              Non-custodial
            </li>
            <li className="flex items-center gap-2">
              <Icon name="lock" size={16} className="shrink-0 text-[var(--d-accent-text)]" />
              Never asks for a recovery phrase
            </li>
            <li className="flex items-center gap-2">
              <span className="shrink-0 text-[var(--d-accent-text)]">
                <CodeGlyph />
              </span>
              <a
                href={LINKS.source}
                target="_blank"
                rel="noopener noreferrer"
                className="d-hit underline decoration-[var(--d-hairline-strong)] underline-offset-[4px] transition-colors duration-[160ms] hover:text-fg hover:decoration-current"
              >
                Open source
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </div>

        <div className={`${styles.rise} min-w-0`} style={DELAY(160)}>
          <LivePreviewIsland />
        </div>
      </div>
    </section>
  );
}
