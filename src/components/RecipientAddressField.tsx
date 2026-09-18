"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  cn,
  focusRing,
} from "@zunialab/ui";
import { useStoredValue } from "@/lib/useStoredValue";

const BOOK_KEY = "zunia.dashboard.addressBook";

export type DashboardContact = {
  id: string;
  label: string;
  address: string;
};

export function useDashboardAddressBook() {
  return useStoredValue<DashboardContact[]>(BOOK_KEY, []);
}

export function extractBech32Address(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-z]{2,16}1[0-9a-z]{20,}$/i.test(value)) return value;
  if (value.includes(":")) {
    const after = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "");
    const candidate = after.split(/[/?#\s]/)[0] ?? "";
    if (/^[a-z]{2,16}1[0-9a-z]{20,}$/i.test(candidate)) return candidate;
  }
  const match = value.match(/\b([a-z]{2,16}1[0-9a-z]{20,})\b/i);
  return match?.[1] ?? null;
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2Z" />
      <path d="M18 16H7a2 2 0 0 0-2 2" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="3" height="3" rx="0.5" />
      <rect x="14" y="7" width="3" height="3" rx="0.5" />
      <rect x="7" y="14" width="3" height="3" rx="0.5" />
      <path d="M14 14h3v3h-3z" />
    </svg>
  );
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

// BarcodeDetector support is a property of the browser and cannot change during
// a session, so there is nothing to subscribe to. Reading it through
// useSyncExternalStore keeps it out of an effect, which is where a synchronous
// setState would cause a cascading render.
const noopSubscribe = () => () => {};

function QrDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (address: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const detectorSupported = useSyncExternalStore(
    noopSubscribe,
    () => typeof window.BarcodeDetector === "function",
    () => false,
  );

  useEffect(() => {
    if (!open || !detectorSupported) return;
    const Detector = window.BarcodeDetector;
    if (!Detector) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || !alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (!alive || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes[0]?.rawValue;
            if (raw) {
              const address = extractBech32Address(raw);
              if (address) {
                onScan(address);
                return;
              }
              setError("QR did not contain a bech32 address");
            }
          } catch {
            /* skip frame */
          }
          raf = window.requestAnimationFrame(() => void tick());
        };
        raf = window.requestAnimationFrame(() => void tick());
      } catch {
        setError("Camera unavailable. Upload a QR image instead.");
      }
    })();

    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, detectorSupported, onScan]);

  async function onFile(file: File) {
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      setError("QR decode is not available in this browser");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close();
      const address = extractBech32Address(codes[0]?.rawValue ?? "");
      if (!address) {
        setError("No bech32 address in that QR");
        return;
      }
      onScan(address);
    } catch {
      setError("Could not read that image");
    }
  }

  const message =
    error ??
    (detectorSupported
      ? null
      : "This browser cannot decode QR codes from the camera. Upload a QR image instead.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100%-32px))]">
        <DialogTitle>Scan address</DialogTitle>
        <DialogDescription>
          Point the camera at a wallet QR, or upload a saved image.
        </DialogDescription>
        {detectorSupported ? (
          <div className="mt-4 aspect-square overflow-hidden rounded-[14px] bg-[var(--z-glass-2)]">
            <video ref={videoRef} muted playsInline className="size-full object-cover" />
          </div>
        ) : null}
        {message ? (
          <p className="mt-3 text-[12.5px] text-[var(--z-danger)]">{message}</p>
        ) : null}
        <label
          className={cn(
            "mt-3 flex cursor-pointer items-center justify-center rounded-[12px] border border-[var(--z-line)] py-2.5 text-[13px] text-fg hover:bg-[var(--z-state-hover)]",
            focusRing,
          )}
        >
          Upload QR image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}

function BookDialog({
  open,
  onOpenChange,
  contacts,
  expectedPrefix,
  onPick,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: DashboardContact[];
  expectedPrefix?: string;
  onPick: (address: string) => void;
  onSave: (contact: DashboardContact) => void;
}) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const filtered = expectedPrefix
    ? contacts.filter((c) => c.address.startsWith(`${expectedPrefix}1`))
    : contacts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[min(440px,calc(100%-32px))] flex-col">
        <DialogTitle>Address book</DialogTitle>
        <DialogDescription>
          Saved in this browser only. Nothing is sent to a server.
        </DialogDescription>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-fg-dim">
              {contacts.length === 0
                ? "No saved recipients yet."
                : `No contacts match ${expectedPrefix}1…`}
            </p>
          ) : (
            filtered.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => onPick(contact.address)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-[12px] border border-[var(--z-line)] px-3 py-2.5 text-left hover:bg-[var(--z-state-hover)]",
                  focusRing,
                )}
              >
                <span className="text-[13px] font-medium text-fg">{contact.label}</span>
                <span className="truncate font-mono text-[11px] text-fg-dim">{contact.address}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-3 grid shrink-0 gap-2 border-t border-[var(--z-line)] pt-3">
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Exchange" />
          <Input
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={`${expectedPrefix ?? "cosmos"}1…`}
            spellCheck={false}
          />
          <Button
            disabled={!address.trim()}
            onClick={() => {
              onSave({
                id: crypto.randomUUID(),
                label: label.trim() || address.trim().slice(0, 12),
                address: address.trim(),
              });
              setLabel("");
              setAddress("");
            }}
          >
            Save contact
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Recipient input with QR scan + address book trailing actions.
 *
 * Both overlays run on the shared Dialog primitive rather than a hand-rolled
 * `fixed inset-0` div: that is what supplies role="dialog", aria-modal, the
 * focus trap, Escape, the scroll lock and focus restore to the trigger button.
 * It also replaces the two hardcoded `bg-black/60` overlays with the
 * --z-overlay token DialogOverlay already uses.
 */
export function RecipientAddressField({
  value,
  onChange,
  expectedPrefix,
  state,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  expectedPrefix?: string;
  state?: "default" | "valid" | "error" | null;
  hint?: string;
}) {
  const [contacts, setContacts] = useDashboardAddressBook();
  const [modal, setModal] = useState<"qr" | "book" | null>(null);

  const trailing = (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Scan QR code"
        title="Scan QR"
        onClick={() => setModal("qr")}
        className={cn(
          "flex size-7 items-center justify-center rounded-[8px] text-fg-dim hover:bg-[var(--z-state-hover)] hover:text-fg",
          focusRing,
        )}
      >
        <QrIcon />
      </button>
      <button
        type="button"
        aria-label="Pick from address book"
        title="Address book"
        onClick={() => setModal("book")}
        className={cn(
          "flex size-7 items-center justify-center rounded-[8px] text-fg-dim hover:bg-[var(--z-state-hover)] hover:text-fg",
          focusRing,
        )}
      >
        <BookIcon />
      </button>
    </span>
  );

  const onScan = useCallback(
    (address: string) => {
      onChange(address);
      setModal(null);
    },
    [onChange],
  );

  return (
    <>
      <Input
        label="Recipient"
        placeholder={`${expectedPrefix ?? "cosmos"}1…`}
        value={value}
        spellCheck={false}
        state={state ?? "default"}
        hint={hint}
        onChange={(e) => onChange(e.target.value)}
        trailing={trailing}
      />
      <QrDialog
        open={modal === "qr"}
        onOpenChange={(next) => setModal(next ? "qr" : null)}
        onScan={onScan}
      />
      <BookDialog
        open={modal === "book"}
        onOpenChange={(next) => setModal(next ? "book" : null)}
        contacts={contacts}
        expectedPrefix={expectedPrefix}
        onPick={(address) => {
          onChange(address);
          setModal(null);
        }}
        onSave={(contact) => setContacts([contact, ...contacts])}
      />
    </>
  );
}
