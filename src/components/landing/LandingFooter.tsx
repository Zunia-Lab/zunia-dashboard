/**
 * The landing footer: where the product lives, where Zunia Lab lives, how to
 * reach it, and the legal pages (hosted on zunialab.com).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { SITE_HOST } from "@/lib/site";
import { LINKS } from "./content";
import { ZuniaLockup } from "./ZuniaMark";

function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.34l4.37 5.78zm-1.08 16.18h1.7L7.4 4.73H5.58z" />
    </svg>
  );
}

const LINK = "d-hit inline-flex items-center gap-1.5 text-[13.5px] text-fg-muted transition-colors duration-[160ms] hover:text-fg";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <Icon name="arrowUpRight" size={12} className="opacity-60" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Column({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h2 className="d-label">{title}</h2>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[var(--d-hairline)]">
      {/* Phones: brand, then Product | Zunia side by side, then Contact (the
          address needs the full width). From 640px the brand sits on top of
          three link columns; from 1024px it takes the first column. */}
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-2 gap-x-6 gap-y-10 px-4 py-12 sm:grid-cols-3 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] lg:px-8 lg:py-16">
        <div className="col-span-2 flex flex-col gap-3 sm:col-span-3 lg:col-span-1">
          {/* Named from the lock-up's words, as the navigation's; d-hit for a
              44px touch target. */}
          <Link href="/" aria-label="Zunia dashboard home" className="d-hit w-fit rounded-[10px]">
            <ZuniaLockup id="footer-mark" size={18} />
          </Link>
          <p className="max-w-[34ch] text-[13.5px] leading-[1.6] text-fg-dim">
            The Cosmos decision desk by Zunia Lab. Non-custodial: your keys stay in your wallet.
          </p>
        </div>
        <Column title="Product">
          <li>
            <Link href="/markets" className={LINK}>Markets</Link>
          </li>
          <li>
            <Link href="/chains" className={LINK}>Chains</Link>
          </li>
          <li>
            <Link href="/governance" className={LINK}>Governance</Link>
          </li>
          <li>
            <Link href="/validators" className={LINK}>Validators</Link>
          </li>
        </Column>
        <Column title="Zunia">
          <li>
            <Out href={LINKS.zunialab}>zunialab.com</Out>
          </li>
          <li>
            <Out href={LINKS.docs}>Docs</Out>
          </li>
          <li>
            <Out href={LINKS.updates}>Updates</Out>
          </li>
          <li>
            <Out href={LINKS.mapZone}>Map Zone</Out>
          </li>
        </Column>
        <Column title="Contact" className="col-span-2 sm:col-span-1">
          <li>
            <a href={LINKS.x} target="_blank" rel="noopener noreferrer" className={LINK}>
              <XGlyph />
              @ZuniaLab
              <span className="sr-only"> on X (opens in a new tab)</span>
            </a>
          </li>
          <li>
            <a href={LINKS.security} className={LINK}>
              <Icon name="shield" size={14} className="opacity-80" />
              {LINKS.securityEmail}
            </a>
          </li>
        </Column>
      </div>
      <div className="border-t border-[var(--d-hairline)]">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-4 py-5 text-[12.5px] text-fg-dim sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {year} Zunia Lab · {SITE_HOST}</p>
          <nav aria-label="Legal" className="flex gap-5">
            <Out href={LINKS.privacy}>Privacy</Out>
            <Out href={LINKS.terms}>Terms</Out>
          </nav>
        </div>
      </div>
    </footer>
  );
}
