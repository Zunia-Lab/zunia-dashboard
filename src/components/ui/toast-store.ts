/**
 * The toast queue, outside React so anything can call it: an event handler,
 * a signing helper, a data hook. `<Toaster/>` subscribes and renders.
 *
 * Pure apart from one timer (the exit animation's removal delay), which the
 * factory takes as a parameter so tests run without waiting.
 */

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastAction {
  label: string;
  /** Navigate (internal path, or http(s) URL opened in a new tab). */
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  /**
   * Reuse an id to update a toast in place: `toast.loading("Submitting…",
   * { id })` then `toast.success("Confirmed", { id })` turns the same toast
   * green instead of stacking a second one.
   */
  id?: string;
  description?: string;
  action?: ToastAction;
  /** Auto-dismiss after ms; `null` keeps it until dismissed. */
  duration?: number | null;
}

export interface ToastRecord {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  action?: ToastAction;
  duration: number | null;
  /** Bumped on every update, so timers restart when a toast changes. */
  version: number;
  /** Playing its exit animation; removed shortly after. */
  leaving: boolean;
}

/** Success and info read in 5 s; errors stay longer; loading waits for its outcome. */
export const DEFAULT_DURATION: Readonly<Record<ToastKind, number | null>> = {
  success: 5_000,
  info: 5_000,
  error: 8_000,
  loading: null,
};

/** Toasts kept at once (see {@link capToasts} for which one goes). */
export const MAX_TOASTS = 4;

/**
 * Trims the queue to MAX_TOASTS after `added` joined it. What goes first: a
 * toast already leaving, then the oldest settled one (success, error,
 * info), and a loading toast only when nothing else is left. A loading toast
 * stands for a transaction still waiting for its outcome; a burst of other
 * notices must not silently erase "Waiting for confirmation…". The toast
 * just added is never the one dropped.
 */
function capToasts(list: readonly ToastRecord[], added: ToastRecord): readonly ToastRecord[] {
  let next = list;
  while (next.length > MAX_TOASTS) {
    const older = next.filter((toast) => toast !== added);
    const victim = older.find((toast) => toast.leaving) ?? older.find((toast) => toast.kind !== "loading") ?? older[0];
    if (!victim) break;
    next = next.filter((toast) => toast !== victim);
  }
  return next;
}

export interface ToastStore {
  getSnapshot: () => readonly ToastRecord[];
  subscribe: (listener: () => void) => () => void;
  show: (kind: ToastKind, message: string, options?: ToastOptions) => string;
  /** Dismiss one toast, or all of them without an id. */
  dismiss: (id?: string) => void;
}

export function createToastStore(exitMs = 180): ToastStore {
  let toasts: readonly ToastRecord[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  const remove = (ids: ReadonlySet<string>) => {
    toasts = toasts.filter((toast) => !(ids.has(toast.id) && toast.leaving));
    emit();
  };

  return {
    getSnapshot: () => toasts,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    show(kind, message, options = {}) {
      sequence += 1;
      const id = options.id ?? `toast-${sequence}`;
      const record: ToastRecord = {
        id,
        kind,
        message,
        description: options.description,
        action: options.action,
        duration: options.duration === undefined ? DEFAULT_DURATION[kind] : options.duration,
        version: sequence,
        leaving: false,
      };
      const index = toasts.findIndex((toast) => toast.id === id);
      if (index >= 0) {
        toasts = toasts.map((toast, i) => (i === index ? record : toast));
      } else {
        toasts = capToasts([...toasts, record], record);
      }
      emit();
      return id;
    },
    dismiss(id) {
      const ids = new Set(toasts.filter((toast) => id === undefined || toast.id === id).map((toast) => toast.id));
      if (ids.size === 0) return;
      toasts = toasts.map((toast) => (ids.has(toast.id) ? { ...toast, leaving: true } : toast));
      emit();
      if (exitMs <= 0) remove(ids);
      else setTimeout(() => remove(ids), exitMs);
    },
  };
}

/** The app's queue. */
export const toastStore = createToastStore();

/**
 * Show a toast from anywhere: `toast.success("Sent 12.5 ATOM", { action:
 * { label: "View", href: "/activity/…" } })`. Returns the toast's id.
 * Amounts in a toast are the caller's to mask (PrefsProvider.mask) when the
 * user hides balances.
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => toastStore.show("success", message, options),
  error: (message: string, options?: ToastOptions) => toastStore.show("error", message, options),
  info: (message: string, options?: ToastOptions) => toastStore.show("info", message, options),
  loading: (message: string, options?: ToastOptions) => toastStore.show("loading", message, options),
  dismiss: (id?: string) => toastStore.dismiss(id),
};
