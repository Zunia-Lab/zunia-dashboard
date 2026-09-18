"use client";

/**
 * Let the user set the channel for any leg by hand, and check what they type.
 *
 * Discovery fails routinely: a public LCD paginates badly, or has no client
 * state for a connection, and the wallet then knows of no channel between two
 * chains that are in fact connected. The user often does know the channel. A
 * wallet that cannot be told is a wallet that cannot send.
 *
 * What it must never do is accept the value silently. A channel id that looks
 * right but connects elsewhere does not fail — it succeeds, and mints a token
 * the destination chain has no record of. So every entry is validated against
 * both chains, an unchecked one is marked unchecked, and the reason a check
 * could not run is shown rather than hidden.
 */

import { useState } from "react";
import { Button, Callout, Input, SectionLabel } from "@zunialab/ui";
import { useChannelCheck } from "@/lib/interchain/hooks";
import type { HopOverrideInput } from "@/lib/interchain/client";
import { findChain } from "@/lib/chains";

export interface ChannelLeg {
  /** Stable key: the directed chain pair. */
  readonly key: string;
  readonly fromChainId: string;
  readonly toChainId: string;
  /** What the plan currently uses, when it has one. */
  readonly currentChannelId?: string;
  /** Why this leg needs attention, e.g. a discovery failure. */
  readonly note?: string;
}

function chainName(chainId: string): string {
  return findChain(chainId)?.chainName ?? chainId;
}

function LegField({
  leg,
  value,
  onChange,
}: {
  readonly leg: ChannelLeg;
  readonly value: string;
  readonly onChange: (channelId: string) => void;
}) {
  const typed = value.trim();
  const check = useChannelCheck(
    typed.length > 0
      ? { source: leg.fromChainId, channel: typed, dest: leg.toChainId }
      : null,
  );

  const state = (() => {
    if (typed.length === 0) return "default" as const;
    if (check.loading || check.status === "idle") return "default" as const;
    if (check.status === "error") return "error" as const;
    return check.data?.ok ? ("valid" as const) : ("error" as const);
  })();

  const hint = (() => {
    if (typed.length === 0) {
      return leg.currentChannelId
        ? `Using ${leg.currentChannelId}. Type a channel id to override it.`
        : "Type a channel id, e.g. channel-141.";
    }
    if (check.loading) return "Checking both sides…";
    if (check.status === "error") {
      return check.error?.message ?? "The channel could not be checked.";
    }
    const data = check.data;
    if (!data) return "The channel could not be checked.";
    const counterparty = data.counterparty;
    if (data.ok && counterparty && !counterparty.ok) {
      // Not a failure: `unreachable` and `skipped` mean nothing was learned.
      // Saying so is the honest version of a green tick.
      return `${data.message} · ${counterparty.message}`;
    }
    return data.message;
  })();

  return (
    <Input
      label={`${chainName(leg.fromChainId)} → ${chainName(leg.toChainId)}`}
      placeholder={leg.currentChannelId ?? "channel-141"}
      value={value}
      spellCheck={false}
      autoComplete="off"
      state={state}
      hint={hint}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ChannelOverrides({
  legs,
  overrides,
  onOverridesChange,
  defaultOpen = false,
}: {
  readonly legs: readonly ChannelLeg[];
  readonly overrides: Readonly<Record<string, HopOverrideInput>>;
  readonly onOverridesChange: (next: Record<string, HopOverrideInput>) => void;
  /** Open on mount when discovery failed and manual entry is the only way on. */
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (legs.length === 0) return null;

  const setLeg = (leg: ChannelLeg, channelId: string) => {
    const next = { ...overrides };
    if (channelId.trim().length === 0) {
      delete next[leg.key];
    } else {
      next[leg.key] = {
        fromChainId: leg.fromChainId,
        toChainId: leg.toChainId,
        channelId: channelId.trim().toLowerCase(),
      };
    }
    onOverridesChange(next);
  };

  const setCount = Object.keys(overrides).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Channels</SectionLabel>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="channel-overrides"
        >
          {open ? "Hide" : "Set by hand"}
          {setCount > 0 ? ` (${setCount})` : ""}
        </Button>
      </div>

      {legs.some((leg) => leg.note) && !open ? (
        <Callout tone="warning" title="Channel discovery is incomplete">
          {legs.find((leg) => leg.note)?.note}
        </Callout>
      ) : null}

      {open ? (
        <div id="channel-overrides" className="flex flex-col gap-4">
          <p className="text-[length:var(--z-type-meta)] leading-relaxed text-fg-muted">
            A channel you enter is used as given and marked unchecked in the
            route. Both ends are queried as you type; an open channel that
            connects to a different chain is reported, because that case does
            not fail — it delivers a token the destination has no record of.
          </p>
          {legs.map((leg) => (
            <div key={leg.key} className="flex flex-col gap-2">
              {leg.note ? (
                <p className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
                  {leg.note}
                </p>
              ) : null}
              <LegField
                leg={leg}
                value={overrides[leg.key]?.channelId ?? ""}
                onChange={(channelId) => setLeg(leg, channelId)}
              />
            </div>
          ))}
          {setCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => onOverridesChange({})}>
              Clear {setCount} manual channel{setCount === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
