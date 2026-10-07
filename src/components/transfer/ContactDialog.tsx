"use client";

/**
 * Add or edit one address-book entry.
 *
 * The address is checked as it is typed (checksum, and the network's prefix
 * when one is chosen) with the same rule the book applies on save, so the
 * Save button never fails on something the form could have said. The chain is
 * read off the prefix; picking one pins the contact to it (an exchange
 * deposit address that is only valid on one network).
 */

import { useId, useState } from "react";
import { bech32PrefixOf } from "@zunialab/interchain";
import { Button, ChainLogo, Checkbox, Dialog, Input, Select } from "@/components/ui";
import { contactAddressProblem, MAX_LABEL_LENGTH, MAX_NOTE_LENGTH, type AddressBookEntry } from "@/lib/address-book";
import { findChain, findChainsByPrefix } from "@/lib/chains";
import type { AddressBook } from "./useAddressBook";

const prefixFor = (chainId: string) => findChain(chainId)?.bech32Prefix;

export interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: AddressBook;
  /** Edit this entry; omit to add. */
  entry?: AddressBookEntry | null;
  /** Prefill for a new entry (the recipient just used). */
  initialAddress?: string;
  initialChainId?: string;
  onSaved?: (address: string) => void;
}

export function ContactDialog(props: ContactDialogProps) {
  // Remount the form per opening so it starts from the entry (or blank).
  const key = props.open ? `${props.entry?.id ?? "new"}:${props.initialAddress ?? ""}` : "closed";
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.entry ? "Edit address" : "Save an address"}
      description="Kept in this browser only. Nothing is sent to a server."
      size="sm"
    >
      {props.open ? <ContactForm key={key} {...props} /> : null}
    </Dialog>
  );
}

function ContactForm({ onOpenChange, book, entry, initialAddress, initialChainId, onSaved }: ContactDialogProps) {
  const formId = useId();
  const [label, setLabel] = useState(entry?.label ?? "");
  const [address, setAddress] = useState(entry?.address ?? initialAddress ?? "");
  const [chainId, setChainId] = useState(entry?.chainId ?? initialChainId ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = address.trim();
  const prefix = trimmed ? bech32PrefixOf(trimmed) : null;
  const chains = prefix ? findChainsByPrefix(prefix) : [];
  const problem = trimmed.length >= 20 ? contactAddressProblem(trimmed, chainId || undefined, prefixFor) : null;
  const detected = chains[0];

  const save = () => {
    try {
      if (entry) {
        book.update(entry.id, { label, address: trimmed, chainId: chainId || null, note: note || null });
        if (entry.favorite !== favorite) book.toggleFavorite(entry.id);
      } else {
        book.add({ label, address: trimmed, chainId: chainId || undefined, note: note || undefined, favorite });
      }
      onSaved?.(trimmed);
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <form
      id={formId}
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Input
        label="Name"
        value={label}
        maxLength={MAX_LABEL_LENGTH}
        placeholder="e.g. Mom, Kraken deposit"
        autoFocus={!entry && Boolean(initialAddress)}
        onChange={(event) => {
          setLabel(event.target.value);
          setError(null);
        }}
      />
      <Input
        label="Address"
        mono
        value={address}
        spellCheck={false}
        autoComplete="off"
        placeholder="cosmos1…"
        error={problem ?? undefined}
        hint={
          !problem && detected ? (
            <span className="inline-flex items-center gap-1.5">
              <ChainLogo chainId={detected.chainId} size={14} />
              {chains.length > 1 ? `${detected.chainName} and ${chains.length - 1} more use this prefix` : `${detected.chainName} address`}
            </span>
          ) : undefined
        }
        onChange={(event) => {
          setAddress(event.target.value);
          setError(null);
        }}
      />
      {chains.length > 0 ? (
        <Select
          label="Network"
          value={chainId}
          onChange={setChainId}
          hint="Pin it when the address is only valid on one network, like an exchange deposit."
          options={[
            { value: "", label: `Any network using ${prefix}1…` },
            ...chains.map((chain) => ({ value: chain.chainId, label: `${chain.chainName} only` })),
          ]}
        />
      ) : null}
      <Input
        label="Note"
        value={note}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="Optional, e.g. needs memo 104857"
        onChange={(event) => setNote(event.target.value)}
      />
      <Checkbox checked={favorite} onCheckedChange={setFavorite} label="Favourite" description="Shown first, one tap away on Send." />
      {error ? <p className="text-[12.5px] text-[var(--z-danger)]">{error}</p> : null}
      <div className="mt-1 flex justify-end gap-2 max-sm:[&>*]:flex-1">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!label.trim() || !trimmed || Boolean(problem)}>
          {entry ? "Save changes" : "Save address"}
        </Button>
      </div>
    </form>
  );
}
