"use client";

/**
 * Settings (design spec §6): general display choices, networks, the wallet
 * connection, notifications (every notification preference lives here),
 * data & privacy, and about.
 *
 * A public page: everything but the connection and push works without a
 * wallet, and those say what a wallet adds instead. One column of sections,
 * with an index beside it on wide screens (it follows the scroll) and a row
 * of section links above it on narrow ones. A link to a section
 * (`/settings#notifications`) lands on it (see `useLandOnSection`).
 */

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import { useReducedMotion } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AboutSection } from "./AboutSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { GeneralSection } from "./GeneralSection";
import { NetworksSection } from "./NetworksSection";
import { NotificationsSection } from "./NotificationsSection";
import { PrivacySection } from "./PrivacySection";

const SECTIONS: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "networks", label: "Networks", icon: "networks" },
  { id: "connections", label: "Connections", icon: "wallet" },
  { id: "notifications", label: "Notifications", icon: "notifications" },
  { id: "privacy", label: "Data & privacy", icon: "lock" },
  { id: "about", label: "About", icon: "info" },
];

export function SettingsPage({ version }: { version: string }) {
  return (
    <Page title="Settings" access="public" subtitle="Display, networks, connection, notifications and privacy">
      <SettingsBody version={version} />
    </Page>
  );
}

function SettingsBody({ version }: { version: string }) {
  const active = useActiveSection();
  const reduced = useReducedMotion();
  const column = useRef<HTMLDivElement>(null);
  useLandOnSection(column);

  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-[var(--d-gap)] @min-[1000px]:grid-cols-[188px_minmax(0,1fr)] @min-[1000px]:gap-7">
        <nav aria-label="Settings sections" className="hidden @min-[1000px]:block">
          <ul className="sticky top-[calc(var(--d-sticky-top)+16px)] flex flex-col gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={jump(section.id)}
                  aria-current={active === section.id ? "true" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-[var(--d-radius-control)] px-2.5 text-[13.5px] transition-colors duration-[160ms]",
                    active === section.id ? "bg-[var(--d-glass-2)] font-medium text-fg" : "text-fg-muted hover:bg-[var(--d-glass)] hover:text-fg",
                  )}
                >
                  <Icon name={section.icon} size={15} className={cn("shrink-0", active === section.id ? "text-fg" : "text-fg-dim")} />
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div ref={column} className="flex min-w-0 max-w-[920px] flex-col gap-[var(--d-gap)]">
          <nav aria-label="Settings sections" className="@min-[1000px]:hidden">
            <ul className="d-no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
              {SECTIONS.map((section) => (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    onClick={jump(section.id)}
                    className="d-hit inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--d-hairline)] bg-[var(--d-glass)] px-3 text-[13px] text-fg-muted transition-colors duration-[160ms] hover:text-fg"
                  >
                    <Icon name={section.icon} size={14} className="shrink-0" />
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <GeneralSection />
          <NetworksSection />
          <ConnectionsSection />
          <NotificationsSection />
          <PrivacySection />
          <AboutSection version={version} />
        </div>
      </div>
    </div>
  );
}

/** Anything the reader does to move or act on the page ends the landing below. */
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * How long a landing keeps its section in place while the page settles. An
 * extension answers its restore in well under a second; a Zunia Mobile
 * session restores over the relay and can take a few on a phone network.
 */
const LANDING_MS = 5_000;

/**
 * A link to a section (`/settings#notifications`: the gear on the bell and on
 * the notification centre, the command palette, old `#preferences` links)
 * puts that section under the sticky top bar (its `scroll-mt`) once the page
 * is drawn, and keeps it there while what is above it settles: a restoring
 * wallet grows Connections, push answers its check. The browser jumps to the
 * hash once, before any of that, and the section would end up wherever the
 * late content pushed it; a client-side navigation scrolls once too.
 *
 * Re-lands on every size change of the column, and once more when the
 * page's entrance animation ends (after a client-side navigation the page
 * rises 6 px into place, and a landing measured mid-rise ends 6 px high),
 * for {@link LANDING_MS} at most. Stops at the reader's first scroll, tap,
 * click or key, so it never fights them.
 */
function useLandOnSection(column: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!SECTIONS.some((section) => section.id === id)) return;
    const target = document.getElementById(id);
    const root = column.current;
    if (!target || !root) return;
    const land = () => target.scrollIntoView({ block: "start" });
    land();
    // Fires once on observe (a second landing, harmless), then on each change.
    const observer = new ResizeObserver(land);
    observer.observe(root);
    let timer = 0;
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("animationend", land);
      for (const type of READER_INPUT) window.removeEventListener(type, stop);
    };
    timer = window.setTimeout(stop, LANDING_MS);
    // `animationend` bubbles from the page's wrapper; endless ones (shimmer, spinners) never fire it.
    window.addEventListener("animationend", land);
    for (const type of READER_INPUT) window.addEventListener(type, stop, { passive: true });
    return stop;
  }, [column]);
}

/**
 * The section the reader is in: the last one whose top has passed a line
 * just under the sticky top bar (where an index link scrolls a section to),
 * or the last section once the page is scrolled to its end (a short last
 * section never reaches that line). The document scrolls (see AppFrame), so
 * the window's scroll drives it.
 */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0]?.id ?? "");
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = 120;
      const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      let current = SECTIONS[0]?.id ?? "";
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= line) current = section.id;
      }
      setActive(atEnd ? (SECTIONS[SECTIONS.length - 1]?.id ?? current) : current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return active;
}
