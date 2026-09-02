"use client";

import { useState, useSyncExternalStore } from "react";
import { Callout, Button } from "@zunialab/ui";
import { shouldShowIosInstallPrompt } from "@/lib/pwa";

const DISMISS_KEY = "zunia.dashboard.iosInstallDismissed";

// User agent and display mode are external to React and never change within a
// session, so there is nothing to subscribe to.
const noopSubscribe = () => () => {};

export function IosInstallPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const eligible = useSyncExternalStore(
    noopSubscribe,
    () =>
      !window.sessionStorage.getItem(DISMISS_KEY) &&
      shouldShowIosInstallPrompt(),
    () => false,
  );

  if (!eligible || dismissed) return null;

  return (
    <div className="mb-4">
      <Callout tone="info">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Install Zunia: tap Share, then <strong>Add to Home Screen</strong>.
            Required for push on iOS.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              window.sessionStorage.setItem(DISMISS_KEY, "1");
              setDismissed(true);
            }}
          >
            Dismiss
          </Button>
        </div>
      </Callout>
    </div>
  );
}
