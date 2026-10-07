"use client";

/**
 * The recipient field: an address input with two helpers on its right edge,
 * "scan a QR code" (camera, or an image of one) and "pick from the address
 * book" (the saved contacts this transfer can use).
 *
 * Validation and chain detection belong to the caller, which knows the
 * network: it passes `error` (or, for older callers, `state` + `hint`) and a
 * `leading` slot (the detected chain's logo). The book filters to
 * `expectedPrefix` when given, so a contact saved for another chain is never
 * offered for this one.
 *
 * Both overlays are the kit's Dialog: focus trap, Escape, scroll lock and
 * focus restored to the button that opened them.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { ContactAvatar } from "@/components/transfer/AddressBookCard";
import { useAddressBook } from "@/components/transfer/useAddressBook";
import { Dialog, IconButton, Input, SearchInput } from "@/components/ui";
import { contactsFor, searchContacts } from "@/lib/address-book";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";

/** The bech32 address inside whatever a QR code carried (a bare address, a URI, text). */
export function extractBech32Address(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[a-z][a-z0-9_@-]{0,30}1[0-9a-z]{20,}$/i.test(value)) return value.toLowerCase();
  if (value.includes(":")) {
    const after = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "");
    const candidate = after.split(/[/?#\s]/)[0] ?? "";
    if (/^[a-z][a-z0-9_@-]{0,30}1[0-9a-z]{20,}$/i.test(candidate)) return candidate.toLowerCase();
  }
  const match = value.match(/\b([a-z][a-z0-9_]{0,30}1[0-9a-z]{20,})\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

// Detector support is a property of the browser and cannot change during a
// session, so there is nothing to subscribe to; reading it this way keeps it
// out of an effect (no cascading render) and out of the server render.
const noopSubscribe = () => () => {};

function QrDialog({ open, onOpenChange, onScan }: { open: boolean; onOpenChange: (open: boolean) => void; onScan: (address: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The latest callback, read when a code is found: the camera effect must not
  // restart (and the stream re-open) each time the page around it re-renders.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const video = videoRef.current;
        if (!video || !alive) {
          stream.getTracks().forEach((track) => track.stop());
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
                onScanRef.current(address);
                return;
              }
              setError("That QR code holds no Cosmos address.");
            }
          } catch {
            // A frame the detector could not read; try the next one.
          }
          raf = window.requestAnimationFrame(() => void tick());
        };
        raf = window.requestAnimationFrame(() => void tick());
      } catch {
        setError("The camera is not available. Upload a picture of the QR code instead.");
      }
    })();

    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, detectorSupported]);

  async function onFile(file: File) {
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      setError("This browser cannot read QR codes. Paste the address instead.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close();
      const address = extractBech32Address(codes[0]?.rawValue ?? "");
      if (!address) {
        setError("No Cosmos address in that picture.");
        return;
      }
      onScan(address);
    } catch {
      setError("That picture could not be read.");
    }
  }

  const message =
    error ?? (detectorSupported ? null : "This browser cannot read QR codes from the camera. Upload a picture of one, or paste the address.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Scan an address" description="Point the camera at a wallet's QR code, or upload a picture of one." size="sm">
      <div className="flex flex-col gap-3">
        {detectorSupported ? (
          <div className="relative aspect-square overflow-hidden rounded-[var(--d-radius-inner)] bg-[var(--d-glass-2)]">
            <video ref={videoRef} muted playsInline className="size-full object-cover" />
            <span aria-hidden className="pointer-events-none absolute inset-[18%] rounded-[14px] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        ) : null}
        {message ? <p className="text-[12.5px] leading-snug text-fg-muted">{message}</p> : null}
        <label
          className={cn(
            "d-hit flex h-[var(--d-ctl-lg)] cursor-pointer items-center justify-center gap-2 rounded-[var(--d-radius-control)] border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] text-[14px] font-medium text-fg",
            "transition-colors hover:bg-[var(--d-glass-2)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--z-focus-ring)]",
          )}
        >
          <Icon name="download" size={16} className="rotate-180" />
          Upload a picture
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </Dialog>
  );
}

function BookDialog({
  open,
  onOpenChange,
  expectedPrefix,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expectedPrefix?: string;
  onPick: (address: string) => void;
}) {
  const book = useAddressBook();
  const [query, setQuery] = useState("");
  const usable = expectedPrefix ? contactsFor(book.contacts, { prefix: expectedPrefix }) : book.contacts;
  const rows = searchContacts(usable, query);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title="Address book"
      description={expectedPrefix ? `Saved addresses that start with ${expectedPrefix}1…` : "Saved in this browser only."}
      size="sm"
    >
      <div className="flex flex-col gap-3">
        {usable.length > 6 ? <SearchInput value={query} onChange={setQuery} size="sm" placeholder="Search names and addresses" /> : null}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-dim">
            {book.contacts.length === 0
              ? "No saved addresses yet. Save one from the Send page."
              : query
                ? "Nobody matches."
                : `No saved address starts with ${expectedPrefix}1…`}
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onPick(entry.address)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[var(--d-row-hover)]"
                >
                  <ContactAvatar entry={entry} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{entry.label}</span>
                    <span className="block truncate font-mono text-[11.5px] text-fg-dim">{shortenAddress(entry.address, 12, 6)}</span>
                  </span>
                  {entry.favorite ? <Icon name="star" size={13} fill="currentColor" className="shrink-0 text-[var(--z-warning)]" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export interface RecipientAddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The book only offers addresses with this prefix. */
  expectedPrefix?: string;
  label?: ReactNode;
  /** The reason the address cannot be used. */
  error?: ReactNode;
  hint?: ReactNode;
  /** Left of the text: the detected chain's logo. */
  leading?: ReactNode;
  placeholder?: string;
  id?: string;
  /** Show the address-book button (the Send page has its own book beside the form). */
  showBook?: boolean;
  onBlur?: () => void;
  /** @deprecated Pass `error` instead. "valid" shows a check. */
  state?: "default" | "valid" | "error" | null;
}

export function RecipientAddressField({
  value,
  onChange,
  expectedPrefix,
  label = "Recipient",
  error,
  hint,
  leading,
  placeholder,
  id,
  showBook = true,
  onBlur,
  state,
}: RecipientAddressFieldProps) {
  const [modal, setModal] = useState<"qr" | "book" | null>(null);
  const legacyError = state === "error" && !error ? hint : undefined;

  const pick = useCallback(
    (address: string) => {
      onChange(address);
      setModal(null);
    },
    [onChange],
  );

  return (
    <>
      <Input
        id={id}
        label={label}
        mono
        size="lg"
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder ?? `${expectedPrefix ?? "cosmos"}1…`}
        error={error ?? legacyError}
        hint={legacyError ? undefined : hint}
        leading={leading}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        trailing={
          <span className="-mr-1.5 flex items-center gap-0.5">
            {state === "valid" && !error ? <Icon name="check" size={16} className="mr-1 text-[var(--d-pos)]" /> : null}
            <IconButton label="Scan a QR code" size="sm" onClick={() => setModal("qr")}>
              <Icon name="scan" size={17} />
            </IconButton>
            {showBook ? (
              <IconButton label="Pick from the address book" size="sm" onClick={() => setModal("book")}>
                <Icon name="book" size={17} />
              </IconButton>
            ) : null}
          </span>
        }
      />
      <QrDialog open={modal === "qr"} onOpenChange={(next) => setModal(next ? "qr" : null)} onScan={pick} />
      {showBook ? (
        <BookDialog open={modal === "book"} onOpenChange={(next) => setModal(next ? "book" : null)} expectedPrefix={expectedPrefix} onPick={pick} />
      ) : null}
    </>
  );
}
