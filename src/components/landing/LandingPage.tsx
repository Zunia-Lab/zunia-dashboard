/**
 * The public landing page at `/`: the SEO page and the first impression.
 *
 * Full-bleed, outside the app frame. A server component: the copy, the FAQ,
 * the footer and the structured data are HTML from the first byte; the
 * interactive parts hydrate as small islands (navigation, calls to action,
 * the connect cards, the network ticker, the `?connect=` link that opens the
 * connect modal), and the heavier ones — the live preview and the feature
 * pictures — load after hydration.
 *
 * Every figure on it is real: the network count is the catalog's, the fee
 * rate is the compiled swap config's, and the live numbers are public reads.
 */

import Link from "next/link";
import { Icon } from "@/components/icons";
import { ChainMarquee } from "./ChainMarquee";
import { ConnectCta } from "./ConnectCta";
import { ConnectFromUrl } from "./ConnectFromUrl";
import { ConnectOptions } from "./ConnectOptions";
import { LINKS, MARQUEE_ROWS, featuredChains, jsonLdText, landingFaq, landingJsonLd, type FaqEntry } from "./content";
import { Features } from "./Features";
import { Hero } from "./Hero";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { SectionHeading } from "./SectionHeading";
import styles from "./landing.module.css";

export interface LandingPageProps {
  /** Mainnets in the catalog. */
  mainnets: number;
  /** The compiled swap commission, e.g. "0.5%". */
  feeRate: string;
}

const SECTION = "mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8";

export function LandingPage({ mainnets, feeRate }: LandingPageProps) {
  const rows = MARQUEE_ROWS.map((ids) => featuredChains(ids));
  const pictureChains = featuredChains(["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia", "akashnet-2"]);
  return (
    <div className={styles.root}>
      {/* Parked above the window and slid in on focus, as in the app frame.
          Not `sr-only` + `focus:not-sr-only`: @zunialab/ui's unlayered
          `.sr-only` outranks Tailwind's layered focus utilities, so the link
          stayed a clipped 1px box when focused. The shadow is focus-only: off
          screen it would still cast a haze into the top of the page. */}
      <a
        href="#main"
        className="fixed left-4 top-3 z-50 -translate-y-[200%] rounded-[10px] bg-[var(--d-pop-bg)] px-4 py-2 text-[14px] text-fg focus:translate-y-0 focus:shadow-[var(--d-pop-shadow)]"
      >
        Skip to content
      </a>
      <ConnectFromUrl />
      <LandingNav />
      {/* Focusable so the skip link moves focus, not only the scroll; the
          scroll margin keeps the first stop after it clear of the sticky
          navigation (the same 80px as the sections). */}
      <main id="main" tabIndex={-1} className="flex scroll-mt-20 flex-col gap-16 pb-16 outline-none sm:gap-24 sm:pb-24 lg:gap-28">
        <Hero mainnets={mainnets} />

        <section id="connect" aria-labelledby="connect-title" className={`${SECTION} grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16`}>
          <div className="flex flex-col gap-6">
            <SectionHeading id="connect-title" eyebrow="Connect your way" title="Three ways in. Keys never leave your wallet.">
              Connecting shares your public addresses so the dashboard can read balances. Every transaction is approved in your
              wallet or on your phone, one at a time.
            </SectionHeading>
            <p className="flex items-start gap-2.5 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card)] px-4 py-3 text-[13.5px] leading-[1.55] text-fg-muted">
              <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-[var(--d-accent-text)]" />
              <span>
                <span className="font-medium text-fg">Zunia never asks for your recovery phrase.</span> A page that does is not Zunia:
                close it.
              </span>
            </p>
          </div>
          <ConnectOptions />
        </section>

        <Features chains={pictureChains} feeRate={feeRate} />

        <section id="networks" aria-labelledby="networks-title" className="flex flex-col gap-10">
          <div className={`${SECTION} flex flex-col gap-6 md:flex-row md:items-end md:justify-between`}>
            {/* Not "Safrochain at home": "X at home" is the meme for a poor
                substitute, which is the opposite of what the line means. */}
            <SectionHeading id="networks-title" eyebrow="Built for the interchain" title={`${mainnets} networks. Safrochain at the core.`}>
              Follow the chains you use, then switch the whole desk between all of them and one. Chain data comes straight from each
              network&apos;s public nodes.
            </SectionHeading>
            <Link
              href="/chains"
              className="inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-[var(--d-radius-control)] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] px-4 text-[14px] font-medium text-fg transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)]"
            >
              All networks
              <Icon name="arrowRight" size={15} />
            </Link>
          </div>
          <ChainMarquee rows={rows} total={mainnets} />
        </section>

        <section id="faq" aria-labelledby="faq-title" className={SECTION}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
            <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" className="lg:sticky lg:top-24 lg:self-start">
              Anything else: the{" "}
              <a href={LINKS.docs} target="_blank" rel="noopener noreferrer" className="d-hit text-fg underline decoration-[var(--d-hairline-strong)] underline-offset-[4px] hover:decoration-current">
                docs
                <span className="sr-only"> (opens in a new tab)</span>
              </a>{" "}
              cover each flow step by step.
            </SectionHeading>
            <FaqList items={landingFaq({ feeRate })} />
          </div>
        </section>

        <section aria-labelledby="cta-title" className={SECTION}>
          <div className="d-card d-card-hero relative isolate flex flex-col items-start gap-6 overflow-hidden px-6 py-10 sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-[560px] flex-col gap-3">
              <h2 id="cta-title" className="text-[28px] font-medium leading-[1.12] tracking-[-0.035em] text-fg sm:text-[34px]">
                Open your decision desk.
              </h2>
              <p className="text-[15.5px] leading-[1.6] text-fg-muted">
                Free to use, non-custodial, and public pages need no wallet at all.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
              <ConnectCta className="h-12 px-5 text-[15px]" />
              <Link
                href="/markets"
                className="inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--d-radius-control)] px-4 text-[15px] font-medium text-fg transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)]"
              >
                Explore markets
                <Icon name="arrowRight" size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(landingJsonLd({ mainnets })) }} />
    </div>
  );
}

/**
 * Native disclosures: keyboard, screen readers and find-in-page work with no
 * script, and the answers are in the HTML for search engines. `name` makes
 * them an exclusive accordion where the browser supports it. The question is
 * plain text: a heading inside <summary> is flattened by some screen readers
 * (the summary is the disclosure's button).
 */
function FaqList({ items }: { items: FaqEntry[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, index) => (
        <details
          key={item.q}
          name="landing-faq"
          open={index === 0}
          className="group rounded-[var(--d-radius-card)] border border-[var(--d-hairline)] bg-[var(--d-card)] transition-colors duration-[160ms] open:border-[var(--d-hairline-strong)]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-5 rounded-[var(--d-radius-card)] px-5 py-4 text-[16px] font-medium leading-[1.4] tracking-[-0.015em] text-fg transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--d-hairline-strong)] text-fg-dim transition-transform duration-[200ms] ease-[var(--d-ease)] group-open:rotate-45"
            >
              <Icon name="plus" size={14} />
            </span>
          </summary>
          <p className="max-w-[66ch] px-5 pb-5 text-[15px] leading-[1.7] text-fg-muted sm:px-6">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
