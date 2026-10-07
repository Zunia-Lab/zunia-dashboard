"use client";

/**
 * About: the version this deployment runs and where to read, report and
 * check. Links are the landing page's own list (`LINKS`), so both pages
 * point at the same hosts.
 */

import type { ReactElement } from "react";
import { Icon, type IconName } from "@/components/icons";
import { LINKS } from "@/components/landing/content";
import { Badge } from "@/components/ui";
import { SettingsSection } from "./SettingsBlocks";

/** The license file of the repository the dashboard is built from. */
const LICENSE_URL = `${LINKS.source}/blob/main/LICENSE`;

/**
 * X's own mark, the landing footer's glyph: a brand reads as itself, where a
 * generic "external" arrow said nothing the row's arrow does not already say.
 * Filled, as brand marks are, and a size under the stroke icons so it weighs
 * the same.
 */
function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0">
      <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.34l4.37 5.78zm-1.08 16.18h1.7L7.4 4.73H5.58z" />
    </svg>
  );
}

/** One glyph per row, none shared: two rows with one icon read as one kind of thing. */
const ITEMS: ReadonlyArray<{ icon: IconName | ReactElement; label: string; detail: string; href: string }> = [
  { icon: "help", label: "Docs", detail: "docs.zunialab.com", href: LINKS.docs },
  { icon: "sparkle", label: "Updates", detail: "updates.zunialab.com", href: LINKS.updates },
  { icon: "link", label: "Source code", detail: "Zunia-Lab/zunia-dashboard", href: LINKS.source },
  { icon: "layers", label: "License", detail: "Apache 2.0", href: LICENSE_URL },
  { icon: "shield", label: "Report a vulnerability", detail: LINKS.securityEmail, href: LINKS.security },
  { icon: "lock", label: "Privacy", detail: "zunialab.com/legal/privacy", href: LINKS.privacy },
  { icon: "list", label: "Terms", detail: "zunialab.com/legal/terms", href: LINKS.terms },
  { icon: <XGlyph />, label: "X", detail: "@ZuniaLab", href: LINKS.x },
];

export function AboutSection({ version }: { version: string }) {
  return (
    <SettingsSection
      id="about"
      title="About"
      subtitle="Zunia dashboard, by Zunia Lab"
      icon="info"
      actions={
        <Badge tone="neutral" size="md" className="font-mono">
          v{version}
        </Badge>
      }
    >
      <ul className="grid grid-cols-1 gap-2 pb-2 pt-1 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              target={item.href.startsWith("mailto:") ? undefined : "_blank"}
              rel={item.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
              className="group flex min-h-[52px] items-center gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] px-3 py-2.5 transition-[background-color,border-color] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-glass)]"
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--d-glass)] text-fg-muted group-hover:text-fg">
                {typeof item.icon === "string" ? <Icon name={item.icon} size={15} /> : item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-fg">{item.label}</span>
                <span className="block truncate text-[12px] text-fg-dim">{item.detail}</span>
              </span>
              <Icon name={item.href.startsWith("mailto:") ? "arrowRight" : "arrowUpRight"} size={14} className="shrink-0 text-fg-faint group-hover:text-fg-dim" />
            </a>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--d-hairline)] pb-1 pt-3 text-[12.5px] text-fg-dim">
        Open source under the Apache License 2.0. Non-custodial: transactions are signed in your wallet, never here.
      </p>
    </SettingsSection>
  );
}
