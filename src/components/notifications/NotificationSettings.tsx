"use client";

/**
 * Notification preferences and channels: what to be told about, and where.
 * Lives in Settings → Notifications (product decision, 2026-10-07, as in the
 * extension: the notification centre only lists), so it is drawn as settings
 * rows — title and sentence on the left, the control on the right, hairlines
 * between, a small label over each group — with the dashboard kit's controls.
 *
 * Every state is said as it is. Push shows "not available on this server"
 * when the server has no keys, the browser's own refusal when permission is
 * blocked, the iOS install requirement, "only test notifications" when the
 * server is not watching chains, and that it needs a connected wallet (it
 * watches addresses) instead of disappearing without one. Kinds that push
 * cannot deliver yet (rewards, validator alerts) are labelled as in-app and
 * browser alerts only. Everything else works without a wallet.
 *
 * Prefs live in the notice store (`useNoticeFeed`), shared with the feed. While
 * this browser is subscribed, a change of prefs or accounts is re-sent to the
 * server (`usePushSync`, debounced; an unchanged registration is not re-sent).
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Badge, Button, Callout, Segmented, Select, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  requestNotificationPermission,
  showNativeNotification,
  useAlertSupport,
  usePush,
  type PushAccount,
} from "@/lib/data/push";
import { testNotice } from "@/lib/notifications/payload";
import type { NotifyPrefs, QuietHours, RewardReminder } from "@/lib/notifications/types";
import { useNoticeFeed, usePushSync } from "@/lib/useNotifications";

export interface NotificationSettingsProps {
  /** Addresses push should watch: the connected wallet's address on each followed chain (max 32 used). */
  accounts: readonly PushAccount[];
  className?: string;
}

const REWARD_OPTIONS: Array<{ value: RewardReminder; label: string }> = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Off" },
];

// Ported from zunia-extension NotificationSettingsScreen.tsx @ 1453e7a.
const REWARD_HINT: Record<RewardReminder, string> = {
  once: "One notification when rewards can be claimed. After you claim, the next one waits until a whole token is ready.",
  daily: "A reminder once a day while rewards are waiting to be claimed.",
  weekly: "A reminder once a week while rewards are waiting to be claimed.",
  off: "No notifications for staking rewards. Staking still shows what you can claim.",
};

const DEFAULT_QUIET: QuietHours = { start: 22, end: 7 };
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }));

/** A labelled group of rows (an h3 under the settings card's own heading). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="d-label pb-1 pt-4">
        {title}
      </h3>
      <div className="flex flex-col divide-y divide-[var(--d-hairline)]">{children}</div>
    </section>
  );
}

/**
 * One setting: what it is and does on the left, its control on the right.
 * With `controlId` the title is that control's <label>. A switch stays beside
 * the text on phones; a wider control (`stack`) drops under it there.
 */
function Row({
  controlId,
  title,
  description,
  badge,
  control,
  stack = false,
  children,
}: {
  controlId?: string;
  title: string;
  description?: ReactNode;
  /** Which channels carry this kind ("Push", "App & alerts"). */
  badge?: string;
  control?: ReactNode;
  stack?: boolean;
  children?: ReactNode;
}) {
  const heading = (
    <>
      {title}
      {badge ? (
        <Badge size="sm" tone="neutral" className="font-normal">
          {badge}
        </Badge>
      ) : null}
    </>
  );
  const headingClass = "flex flex-wrap items-center gap-2 text-[14px] font-medium leading-snug text-fg";
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className={cn("flex gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6", stack ? "flex-col" : "flex-row items-start justify-between gap-4")}>
        <div className="min-w-0 flex-1">
          {controlId ? (
            <label htmlFor={controlId} className={headingClass}>
              {heading}
            </label>
          ) : (
            <div className={headingClass}>{heading}</div>
          )}
          {description ? <div className="mt-0.5 max-w-[62ch] text-[13px] leading-[1.5] text-fg-dim">{description}</div> : null}
        </div>
        {control ? <div className={cn("flex shrink-0 flex-wrap items-center gap-2", !stack && "pt-0.5 sm:pt-0")}>{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** A short line under a row: a note, a refusal, a confirmation. */
function Note({ tone = "dim", children, live = false }: { tone?: "dim" | "warning" | "danger"; children: ReactNode; live?: boolean }) {
  return (
    <p
      role={live ? "status" : undefined}
      className={cn(
        "text-[12.5px] leading-snug",
        tone === "dim" && "text-fg-dim",
        tone === "warning" && "text-[var(--z-warning)]",
        tone === "danger" && "text-[var(--z-danger)]",
      )}
    >
      {children}
    </p>
  );
}

export function NotificationSettings({ accounts, className }: NotificationSettingsProps) {
  const { prefs, setPrefs, ready } = useNoticeFeed();
  const push = usePush();
  const alertSupport = useAlertSupport();
  const ids = useId();
  const [alertError, setAlertError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState<"push" | "alert" | null>(null);
  const set = (patch: Partial<NotifyPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }));
  const chainsWatched = new Set(accounts.map((account) => account.chainId)).size;

  // Keep the server's copy of prefs and accounts current while subscribed.
  usePushSync(accounts);

  useEffect(() => {
    if (!testSent) return;
    const timer = window.setTimeout(() => setTestSent(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [testSent]);

  async function toggleBrowserAlerts(next: boolean) {
    setAlertError(null);
    if (!next) {
      set({ browserAlerts: false });
      return;
    }
    // First thing in the handler: the prompt needs the click's user activation.
    const permission = await requestNotificationPermission();
    if (permission === "granted") set({ browserAlerts: true });
    else if (permission === "denied") {
      setAlertError("Notifications are blocked for this site. Allow them in your browser's site settings.");
    } else setAlertError("Notifications were not allowed.");
  }

  async function sendTestAlert() {
    setAlertError(null);
    const shown = await showNativeNotification(testNotice(Date.now()), prefs, { force: true });
    if (shown) setTestSent("alert");
    else setAlertError("This browser did not show the alert. Check that notifications are allowed for this site.");
  }

  async function sendTestPush() {
    if (await push.sendTest()) setTestSent("push");
  }

  const alertsOn = prefs.browserAlerts && push.permission === "granted";
  const quiet = prefs.quietHours;
  const kindSwitch = (key: "transfers" | "governance" | "unbonding" | "validator", id: string) => (
    <Switch
      id={id}
      checked={prefs[key]}
      disabled={!ready}
      onCheckedChange={(on) => setPrefs((prev) => ({ ...prev, [key]: on }))}
    />
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <Group title="Channels">
        <Row
          title="In the app"
          description="The bell and the notification center. Always on: everything lands there."
          control={
            <Badge size="sm" tone="success" dot>
              On
            </Badge>
          }
        />

        <Row
          controlId={`${ids}-alerts`}
          title="Browser alerts"
          description="Alerts from an open Zunia tab, even when it is in the background."
          control={
            <Switch
              id={`${ids}-alerts`}
              checked={alertsOn}
              disabled={!ready || !alertSupport || push.permission === "denied"}
              onCheckedChange={(next) => void toggleBrowserAlerts(next)}
            />
          }
        >
          {!alertSupport ? (
            <Note>This browser cannot show notifications here.</Note>
          ) : push.permission === "denied" ? (
            <Note tone="warning">Blocked in this browser. Allow notifications for this site in its settings to use alerts.</Note>
          ) : null}
          {alertError ? <Note tone="danger">{alertError}</Note> : null}
          {alertsOn ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" iconLeft="notifications" onClick={() => void sendTestAlert()}>
                Send a test alert
              </Button>
              {testSent === "alert" ? <Note live>Sent.</Note> : null}
            </div>
          ) : null}
        </Row>

        <Row title="Push to this device" description="Incoming transfers, votes ending and finished unbondings, even with Zunia closed.">
          <PushState
            push={push}
            accountsCount={accounts.length}
            chainsWatched={chainsWatched}
            testSent={testSent === "push"}
            onSubscribe={() => void push.subscribe(accounts, prefs)}
            onUnsubscribe={() => void push.unsubscribe()}
            onTest={() => void sendTestPush()}
          />
        </Row>
      </Group>

      <Group title="What to tell you about">
        <Row
          controlId={`${ids}-transfers`}
          title="Transfers"
          badge="Push"
          description="Tokens arriving, IBC transfers landing, and swap results."
          control={kindSwitch("transfers", `${ids}-transfers`)}
        />
        <Row
          title="Staking rewards"
          badge="App & alerts"
          description={REWARD_HINT[prefs.rewards]}
          stack
          control={
            <Segmented<RewardReminder>
              ariaLabel="Staking rewards reminders"
              size="md"
              value={prefs.rewards}
              onChange={(rewards) => set({ rewards })}
              options={REWARD_OPTIONS.map((option) => ({ ...option, disabled: !ready }))}
            />
          }
        />
        <Row
          controlId={`${ids}-governance`}
          title="Governance"
          badge="Push"
          description="Open votes on chains where you stake and have not voted, and a reminder when one ends within 24 hours."
          control={kindSwitch("governance", `${ids}-governance`)}
        />
        <Row
          controlId={`${ids}-unbonding`}
          title="Unbonding complete"
          badge="Push"
          description="When stake you unbonded is liquid again."
          control={kindSwitch("unbonding", `${ids}-unbonding`)}
        />
        <Row
          controlId={`${ids}-validator`}
          title="Validator alerts"
          badge="App & alerts"
          description="A validator you delegate to is jailed, leaves the active set or raises its commission."
          control={kindSwitch("validator", `${ids}-validator`)}
        />
      </Group>

      <Group title="Quiet hours">
        <Row
          controlId={`${ids}-quiet`}
          title="Quiet hours"
          description="No browser alerts or push in this window, in your time zone. The list in the app still updates."
          control={
            <Switch
              id={`${ids}-quiet`}
              checked={Boolean(quiet)}
              disabled={!ready}
              onCheckedChange={(on) => set({ quietHours: on ? DEFAULT_QUIET : undefined })}
            />
          }
        >
          {quiet ? (
            <div className="grid max-w-[320px] grid-cols-2 gap-3">
              <Select
                label="From"
                size="sm"
                value={String(quiet.start)}
                options={HOUR_OPTIONS.map((option) => ({ ...option, disabled: Number(option.value) === quiet.end }))}
                onChange={(value) => set({ quietHours: { ...quiet, start: Number(value) } })}
              />
              <Select
                label="To"
                size="sm"
                value={String(quiet.end)}
                options={HOUR_OPTIONS.map((option) => ({ ...option, disabled: Number(option.value) === quiet.start }))}
                onChange={(value) => set({ quietHours: { ...quiet, end: Number(value) } })}
              />
            </div>
          ) : null}
        </Row>
      </Group>
    </div>
  );
}

function PushState({
  push,
  accountsCount,
  chainsWatched,
  testSent,
  onSubscribe,
  onUnsubscribe,
  onTest,
}: {
  push: ReturnType<typeof usePush>;
  accountsCount: number;
  chainsWatched: number;
  testSent: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onTest: () => void;
}) {
  const connect = useConnectModal();
  if (!push.supported) {
    return push.unsupportedReason ? <Callout tone="neutral">{push.unsupportedReason}</Callout> : null;
  }
  if (push.configured === null) {
    return push.configStatus === "error" ? (
      <div className="flex flex-wrap items-center gap-2">
        <Note live>Could not check whether this server can send push.</Note>
        <Button size="sm" variant="ghost" iconLeft="refresh" onClick={push.retryConfig}>
          Retry
        </Button>
      </div>
    ) : (
      <Note live>Checking whether this server can send push…</Note>
    );
  }
  if (push.configured === false) {
    return (
      <Callout tone="neutral" title="Not available on this server">
        {push.configReason ?? "Push is not configured on this server"}. Alerts in the app and in an open tab still work.
      </Callout>
    );
  }

  const error = push.error ? <Callout tone="danger">{push.error}</Callout> : null;

  if (push.subscribed) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
          <Badge size="sm" tone="success" dot>
            On for this browser
          </Badge>
          <span>
            Watching {accountsCount} {accountsCount === 1 ? "address" : "addresses"} on {chainsWatched}{" "}
            {chainsWatched === 1 ? "network" : "networks"}.
          </span>
        </p>
        {push.watching === false ? (
          <Callout tone="warning">This server is not watching chains right now, so only test notifications will arrive.</Callout>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={push.busy} onClick={onTest}>
            Send a test
          </Button>
          <Button size="sm" variant="ghost" disabled={push.busy} onClick={onUnsubscribe}>
            Turn off
          </Button>
          {testSent ? <Note live>Sent. It should arrive within a few seconds.</Note> : null}
        </div>
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {push.permission === "denied" ? (
        <Note tone="warning">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then turn push on.</Note>
      ) : null}
      {accountsCount === 0 ? (
        // Push watches addresses: without a wallet there is nothing to watch,
        // so the way forward is connecting one, not a disabled button alone.
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" iconLeft="wallet" onClick={() => connect.open()}>
            Connect a wallet
          </Button>
          <Note>Push watches your addresses, so it needs a connected wallet.</Note>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            iconLeft="notifications"
            loading={push.busy}
            disabled={push.checking || push.permission === "denied"}
            onClick={onSubscribe}
          >
            Turn on push
          </Button>
        </div>
      )}
      {error}
    </div>
  );
}
