"use client";

/**
 * <Toaster/>: renders the toast queue (src/components/ui/toast-store.ts).
 *
 * Bottom-right from 768px, top on phones (spec §2), newest nearest the edge;
 * it steps aside from an open right sheet or dialog (src/styles/ui.css).
 * A polite live region announces each toast, and an error interrupts
 * (assertive): a failed transaction must not wait behind other speech.
 * Hovering or focusing the stack pauses auto-dismiss so nobody loses a
 * message they are reading. Mount it once near the root; a second instance
 * renders nothing, so mounting it in a page as well is harmless.
 */

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { Spinner } from "./Button";
import { toastStore, type ToastRecord } from "./toast-store";

export { toast, type ToastAction, type ToastKind, type ToastOptions } from "./toast-store";

/* Only the first mounted Toaster renders. */
let owners: string[] = [];
const ownerListeners = new Set<() => void>();

function subscribeOwners(listener: () => void) {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

function emitOwners() {
  for (const listener of ownerListeners) listener();
}

const emptyList: readonly ToastRecord[] = [];

export function Toaster() {
  const id = useId();
  const owner = useSyncExternalStore(subscribeOwners, () => owners[0] ?? null, () => null);
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => emptyList);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    owners = [...owners, id];
    emitOwners();
    return () => {
      owners = owners.filter((entry) => entry !== id);
      emitOwners();
    };
  }, [id]);

  if (owner !== id) return null;

  return (
    // Not "Notifications": that is the notification centre's name (and a
    // Settings section's), and two landmarks may not share one.
    <section aria-label="Status messages">
      <ol
        className="d-toaster"
        aria-live="polite"
        aria-relevant="additions text"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        {toasts.map((record) => (
          <ToastItem key={record.id} record={record} paused={paused} />
        ))}
      </ol>
    </section>
  );
}

const KIND_ICON = {
  success: { name: "success", className: "text-[var(--z-success)]" },
  error: { name: "danger", className: "text-[var(--z-danger)]" },
  info: { name: "info", className: "text-[var(--z-info)]" },
} as const;

function ToastItem({ record, paused }: { record: ToastRecord; paused: boolean }) {
  const { id, kind, message, description, action, duration, version, leaving } = record;

  // Restarts on every update (version), so loading → success gets its full time.
  useEffect(() => {
    if (duration === null || paused || leaving) return;
    const timer = setTimeout(() => toastStore.dismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, paused, leaving, version]);

  const icon = kind === "loading" ? null : KIND_ICON[kind];
  const external = action?.href ? /^https?:\/\//.test(action.href) : false;
  const actionClass = cn(
    "d-hit inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12.5px] font-medium text-[var(--d-accent-text)]",
    "transition-colors duration-[160ms] hover:bg-[var(--d-accent-soft)] focus-visible:outline-offset-0",
  );

  return (
    <li
      className={cn(
        "d-toast flex items-start gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline-strong)] bg-[var(--d-pop-bg)]",
        "py-3 pl-3.5 pr-2 text-fg shadow-[var(--d-pop-shadow)]",
      )}
      // Its own live region, so the list's polite one does not also read it.
      // An attribute, not role="alert": a list item must keep its role.
      aria-live={kind === "error" ? "assertive" : undefined}
      aria-atomic={kind === "error" || undefined}
      data-leaving={leaving || undefined}
    >
      <span className="mt-[1px] flex size-5 shrink-0 items-center justify-center">
        {icon ? <Icon name={icon.name} size={18} className={icon.className} /> : <Spinner size={16} className="text-fg-muted" />}
      </span>
      <div className="min-w-0 flex-1 pt-[1px]">
        <p className="text-[14px] font-medium leading-snug tracking-[-0.01em] text-fg">{message}</p>
        {description ? <p className="mt-0.5 text-[13px] leading-[1.45] text-fg-muted">{description}</p> : null}
        {action ? (
          <div className="-ml-2 mt-1.5">
            {action.href ? (
              external ? (
                <a href={action.href} target="_blank" rel="noopener noreferrer" className={actionClass} onClick={() => toastStore.dismiss(id)}>
                  {action.label}
                  <Icon name="arrowUpRight" size={13} />
                </a>
              ) : (
                <Link href={action.href} className={actionClass} onClick={() => toastStore.dismiss(id)}>
                  {action.label}
                  <Icon name="arrowRight" size={13} />
                </Link>
              )
            ) : (
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  action.onClick?.();
                  toastStore.dismiss(id);
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => toastStore.dismiss(id)}
        className="d-hit inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] text-fg-dim transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg focus-visible:outline-offset-0"
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}
