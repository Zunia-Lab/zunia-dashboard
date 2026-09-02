"use client";

import { useState, useSyncExternalStore } from "react";
import { Button, Callout } from "@zunialab/ui";
import { shouldShowIosInstallPrompt } from "@/lib/pwa";

const noopSubscribe = () => () => {};

function readPushSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushSubscribe() {
  const [result, setResult] = useState<"idle" | "subscribed" | "denied">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const showIos = useSyncExternalStore(
    noopSubscribe,
    shouldShowIosInstallPrompt,
    () => false,
  );
  const supported = useSyncExternalStore(
    noopSubscribe,
    readPushSupported,
    () => true,
  );
  const status = supported ? result : "unsupported";

  async function enable() {
    setMessage(null);
    if (!vapid) {
      setMessage("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.");
      return;
    }
    if (showIos) {
      setMessage(
        "Install this site to Home Screen first (iOS Safari requirement).",
      );
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setResult("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(`Subscribe failed (${res.status})`);
      setResult("subscribed");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Push subscribe failed");
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {showIos ? (
        <Callout tone="info">
          On iOS Safari, add Zunia to your Home Screen, open the installed app,
          then enable notifications.
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          disabled={status === "unsupported" || status === "subscribed"}
          onClick={() => void enable()}
        >
          {status === "subscribed" ? "Subscribed" : "Enable notifications"}
        </Button>
        {status === "unsupported" ? (
          <span className="font-mono text-[12px] text-fg-dim">
            Not supported in this browser
          </span>
        ) : null}
      </div>
      {status === "denied" ? (
        <p className="font-mono text-[12px] text-[var(--z-danger)]">
          Permission denied in browser settings.
        </p>
      ) : null}
      {message ? (
        <p className="font-mono text-[12px] text-fg-muted">{message}</p>
      ) : null}
    </div>
  );
}
