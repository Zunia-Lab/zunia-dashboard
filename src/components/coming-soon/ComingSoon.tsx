"use client";

/**
 * The designed "coming very soon" page shared by Missions and Apps (spec
 * §6): an animated brand composition, the promise in one paragraph, three
 * out-of-focus preview tiles, and two honest calls to action.
 *
 * "Notify me" is a flag on this device (`zunia.dashboard.notify.<id>`) — the
 * server keeps no list — and the page says exactly that. When this
 * deployment has web push configured, it also points to the notification
 * settings, where push for the wallet can be turned on today.
 */

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { LINKS } from "@/components/landing/content";
import { Page } from "@/components/shell/Page";
import { Badge, Button, Card, CardHeader, PageSection, StatusBadge } from "@/components/ui";
import { usePush } from "@/lib/data/push";
import { useStoredValue } from "@/lib/useStoredValue";
import { BrandOrbit } from "./BrandOrbit";
import { newNotifyFlag, notifyKey, readNotifyFlag, type ComingSoonId, type NotifyFlag } from "./notify";
import { DirectorySketch, LevelsSketch, OpenWithSketch, QuestsSketch, SafetySketch, SeasonsSketch } from "./previews";
import styles from "./coming-soon.module.css";

interface Preview {
  title: string;
  line: string;
  icon: IconName;
  sketch: ReactNode;
}

interface ComingSoonContent {
  title: string;
  promise: string;
  previews: Preview[];
}

export const COMING_SOON: Record<ComingSoonId, ComingSoonContent> = {
  missions: {
    title: "Missions",
    promise: "Quests across the interchain: stake, vote, bridge and explore to earn XP and seasonal rewards.",
    previews: [
      { title: "Quests", line: "Stake, vote, bridge and explore across your chains.", icon: "missions", sketch: <QuestsSketch /> },
      { title: "XP and levels", line: "Every quest adds XP; levels unlock as you go.", icon: "sparkle", sketch: <LevelsSketch /> },
      { title: "Seasons", line: "Seasonal rewards for the most active explorers.", icon: "calendar", sketch: <SeasonsSketch /> },
    ],
  },
  apps: {
    title: "Apps",
    promise: "A curated, safety-checked directory of Cosmos apps that open with Zunia.",
    previews: [
      { title: "Curated directory", line: "Cosmos apps, grouped by what they do.", icon: "apps", sketch: <DirectorySketch /> },
      { title: "Safety checks", line: "Each listing reviewed before it appears.", icon: "shield", sketch: <SafetySketch /> },
      { title: "Opens with Zunia", line: "Connect with the wallet you use here, in one step.", icon: "link", sketch: <OpenWithSketch /> },
    ],
  },
};

/** The whole route body: a public page in the app frame. */
export function ComingSoonPage({ id }: { id: ComingSoonId }) {
  return (
    <Page title={COMING_SOON[id].title} subtitle="Coming very soon" access="public">
      <ComingSoon id={id} />
    </Page>
  );
}

export function ComingSoon({ id }: { id: ComingSoonId }) {
  const content = COMING_SOON[id];
  const heroRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-[var(--d-section-gap)]">
      <Card ref={heroRef} variant="hero" padding="none" className="overflow-hidden">
        {/* Phones: the composition on top, the copy under it. From 768px they
            sit side by side, so the hero never becomes a tall centred
            picture over left-aligned text. */}
        <div className="grid items-center gap-6 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,240px)] md:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-10 lg:p-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="order-2 flex min-w-0 flex-col items-start gap-5 md:order-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--d-accent-line)] bg-[var(--d-accent-soft)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--d-accent-text)]">
              <span aria-hidden className="size-1.5 rounded-full bg-current d-pulse" />
              Coming very soon
            </span>
            <h2 className="text-[length:var(--d-type-hero)] font-semibold leading-[1.02] tracking-[-0.045em] text-fg sm:text-[56px]">{content.title}</h2>
            <p className="max-w-[46ch] text-[16px] leading-[1.6] text-fg-muted sm:text-[17px]">{content.promise}</p>
            <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
              <Icon name="clock" size={16} className="text-[var(--d-accent-text)]" />
              We&apos;re working on it.
            </p>
            <NotifyActions id={id} />
          </div>
          <div className="order-1 md:order-2">
            <BrandOrbit targetRef={heroRef} className="max-w-[224px] sm:max-w-[260px] md:max-w-[240px] lg:max-w-[420px]" />
          </div>
        </div>
      </Card>

      <PageSection title="A first look" subtitle="Sketches of what is being built. Nothing here works yet.">
        <div className="grid gap-[var(--d-gap)] md:grid-cols-3">
          {content.previews.map((preview) => (
            <Card key={preview.title} as="article">
              <CardHeader title={preview.title} subtitle={preview.line} icon={preview.icon} />
              {/* The label sits on the sketch's faded lower edge, where it
                  names the picture without crowding the title row; the box
                  fills the card, so the three labels share one baseline. */}
              <div className="relative flex-1 pb-1 pt-1">
                <div aria-hidden className={`${styles.sketch} pointer-events-none select-none`}>
                  {preview.sketch}
                </div>
                <Badge className="absolute bottom-0 right-0">Preview</Badge>
              </div>
            </Card>
          ))}
        </div>
      </PageSection>
    </div>
  );
}

function NotifyActions({ id }: { id: ComingSoonId }) {
  const [stored, setStored] = useStoredValue<NotifyFlag | null>(notifyKey(id), null);
  const flag = readNotifyFlag(stored);
  const push = usePush();
  const offerPush = push.configStatus === "ready" && push.configured && !push.subscribed;
  // The control under the pointer is replaced on click; keyboard focus
  // follows to its counterpart (Undo, or Notify me again) instead of
  // falling back to the top of the page. Only after a click: a stored flag
  // on page load must not pull focus anywhere.
  const undoRef = useRef<HTMLButtonElement>(null);
  const notifyRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (flag ? undoRef : notifyRef).current?.focus();
  }, [flag]);

  return (
    <div className="flex w-full flex-col gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-2.5">
        {flag ? (
          <>
            <StatusBadge tone="success" size="md" role="status">
              You&apos;re on the list
            </StatusBadge>
            <Button
              ref={undoRef}
              variant="ghost"
              size="sm"
              onClick={() => {
                moveFocus.current = true;
                setStored(null);
              }}
            >
              Undo
            </Button>
          </>
        ) : (
          <Button
            ref={notifyRef}
            variant="primary"
            size="lg"
            iconLeft="notifications"
            className="max-sm:w-full"
            onClick={() => {
              moveFocus.current = true;
              setStored(newNotifyFlag());
            }}
          >
            Notify me
          </Button>
        )}
        <Button variant="secondary" size={flag ? "sm" : "lg"} href={LINKS.x} external iconRight="arrowUpRight" className={flag ? undefined : "max-sm:w-full"}>
          Follow @ZuniaLab
        </Button>
      </div>
      <p className="text-[13px] leading-[1.55] text-fg-dim">
        {flag ? "Saved on this device. Launch news goes out on @ZuniaLab." : "Saved on this device only: no email, no account."}
      </p>
      {flag && offerPush ? (
        // Straight to Settings → Notifications: the preferences left the
        // notification centre (its old #preferences anchor only forwards).
        <Link
          href="/settings#notifications"
          className="d-hit inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors duration-[160ms] hover:text-fg"
        >
          <Icon name="notifications" size={14} />
          Turn on push notifications for your wallet
          <Icon name="arrowRight" size={13} />
        </Link>
      ) : null}
    </div>
  );
}
