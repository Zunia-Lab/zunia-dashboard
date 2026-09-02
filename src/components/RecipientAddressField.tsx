"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
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

function QrModal({
  onScan,
  onClose,
}: {
  onScan: (address: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      setError("Use Upload QR image in this browser");
      return;
    }

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
  }, [onScan]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-[18px] border border-[var(--z-line)] bg-bg p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-fg">Scan address</h2>
          <button type="button" aria-label="Close" onClick={onClose} className={cn("rounded-full p-1.5 text-fg-dim hover:bg-[var(--z-state-hover)]", focusRing)}>
            <CloseIcon />
          </button>
        </div>
        <div className="aspect-square overflow-hidden rounded-[14px] bg-black">
          <video ref={videoRef} muted playsInline className="size-full object-cover" />
        </div>
        {error ? <p className="text-[12.5px] text-[var(--z-danger)]">{error}</p> : null}
        <label className="flex cursor-pointer items-center justify-center rounded-[12px] border border-[var(--z-line)] py-2.5 text-[13px] text-fg hover:bg-[var(--z-state-hover)]">
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
      </div>
    </div>
  );
}

function BookModal({
  contacts,
  expectedPrefix,
  onPick,
  onClose,
  onSave,
}: {
  contacts: DashboardContact[];
  expectedPrefix?: string;
  onPick: (address: string) => void;
  onClose: () => void;
  onSave: (contact: DashboardContact) => void;
}) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const filtered = expectedPrefix
    ? contacts.filter((c) => c.address.startsWith(`${expectedPrefix}1`))
    : contacts;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-[18px] border border-[var(--z-line)] bg-bg p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-fg">Address book</h2>
          <button type="button" aria-label="Close" onClick={onClose} className={cn("rounded-full p-1.5 text-fg-dim hover:bg-[var(--z-state-hover)]", focusRing)}>
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
        <div className="grid gap-2 border-t border-[var(--z-line)] pt-3">
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
      </div>
    </div>
  );
}

/** Recipient input with QR scan + address book trailing actions. */
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
      {modal === "qr" ? (
        <QrModal onClose={() => setModal(null)} onScan={onScan} />
      ) : null}
      {modal === "book" ? (
        <BookModal
          contacts={contacts}
          expectedPrefix={expectedPrefix}
          onClose={() => setModal(null)}
          onPick={(address) => {
            onChange(address);
            setModal(null);
          }}
          onSave={(contact) => setContacts([contact, ...contacts])}
        />
      ) : null}
    </>
  );
}
