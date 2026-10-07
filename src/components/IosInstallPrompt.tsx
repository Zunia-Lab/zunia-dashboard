"use client";

/**
 * iPhone and iPad only: Safari delivers web push only to a site added to the
 * Home Screen and opened from there. A tip on the notification centre for a
 * reader who never opens the settings, until they dismiss it for this
 * session; nothing elsewhere.
 *
 * Not in Settings → Notifications: push is set up there, and its row already
 * says the same thing in place of the switch it cannot offer yet. Shown only
 * when this server can send push at all, so it never asks anyone to install
 * the site for a notification that would not come.
 */

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button, Callout } from "@/components/ui";
import { usePush } from "@/lib/data/push";
import { shouldShowIosInstallPrompt } from "@/lib/pwa";

const DISMISS_KEY = "zunia.dashboard.iosInstallDismissed";

// User agent and display mode are external to React and never change within a
// session, so there is nothing to subscribe to.
const noopSubscribe = () => () => {};

function eligible(): boolean {
  try {
    return !window.sessionStorage.getItem(DISMISS_KEY) && shouldShowIosInstallPrompt();
  } catch {
    return shouldShowIosInstallPrompt();
  }
}

export interface IosInstallPromptProps {
  /** Where push is turned on once the site is installed. */
  settingsHref: string;
  className?: string;
}

export function IosInstallPrompt({ settingsHref, className }: IosInstallPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const show = useSyncExternalStore(noopSubscribe, eligible, () => false);
  if (!show || dismissed) return null;
  // Only on iOS Safari does the tip ask the server whether push exists.
  return (
    <InstallTip
      settingsHref={settingsHref}
      className={className}
      onDismiss={() => {
        try {
          window.sessionStorage.setItem(DISMISS_KEY, "1");
        } catch {
          /* private mode: dismissed for this page view only */
        }
        setDismissed(true);
      }}
    />
  );
}

function InstallTip({ settingsHref, className, onDismiss }: IosInstallPromptProps & { onDismiss: () => void }) {
  const { configured } = usePush();
  // Unknown (still checking, or the check failed) is not "available".
  if (configured !== true) return null;

  return (
    <Callout
      tone="info"
      icon="mobile"
      title="Add Zunia to your Home Screen for push"
      className={className}
      action={
        <Button size="sm" variant="ghost" aria-label="Dismiss the Home Screen tip" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      On iPhone and iPad, Safari sends notifications only to installed sites: tap Share, then Add to Home Screen, open Zunia from there
      and turn push on in{" "}
      <Link href={settingsHref} className="font-medium text-fg underline underline-offset-2 hover:no-underline">
        Settings
      </Link>
      .
    </Callout>
  );
}
