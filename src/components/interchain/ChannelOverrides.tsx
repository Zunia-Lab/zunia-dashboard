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

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Button, Callout, Input } from "@/components/ui";
import { chainName } from "@/components/transfer/names";
import { useChannelCheck } from "@/lib/interchain/hooks";
import type { HopOverrideInput } from "@/lib/interchain/client";

export interface ChannelLeg {
  /** Stable key: the directed chain pair. */
  readonly key: string;
  readonly fromChainId: string;
  readonly toChainId: string;
  /** What the plan currently uses, when it has one. */
  readonly currentChannelId?: string;
  /** Why this leg needs attention, e.g. a discovery failure. */
  readonly note?: string;
  /** The heading `note` gets while the fields are folded away (default: discovery failed). */
  readonly noteTitle?: string;
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
  const check = useChannelCheck(typed.length > 0 ? { source: leg.fromChainId, channel: typed, dest: leg.toChainId } : null);

  const verdict = (() => {
    if (typed.length === 0) return { tone: "idle" as const, text: leg.currentChannelId ? `Using ${leg.currentChannelId}. Type a channel id to override it.` : "Type a channel id, e.g. channel-141." };
    if (check.loading || check.status === "idle") return { tone: "idle" as const, text: "Checking both sides…" };
    if (check.status === "error") return { tone: "bad" as const, text: check.error?.message ?? "The channel could not be checked." };
    const data = check.data;
    if (!data) return { tone: "bad" as const, text: "The channel could not be checked." };
    const counterparty = data.counterparty;
    // Not a failure: `unreachable` and `skipped` mean nothing was learned on
    // the far side. Saying so is the honest version of a green tick.
    const text = data.ok && counterparty && !counterparty.ok ? `${data.message} · ${counterparty.message}` : data.message;
    return { tone: data.ok ? ("good" as const) : ("bad" as const), text };
  })();

  return (
    <Input
      label={`${chainName(leg.fromChainId)} → ${chainName(leg.toChainId)}`}
      mono
      placeholder={leg.currentChannelId ?? "channel-141"}
      value={value}
      spellCheck={false}
      autoComplete="off"
      error={verdict.tone === "bad" ? verdict.text : undefined}
      hint={
        verdict.tone === "good" ? (
          <span className="inline-flex items-start gap-1 text-[var(--d-pos)]">
            <Icon name="check" size={13} className="mt-px shrink-0" />
            {verdict.text}
          </span>
        ) : verdict.tone === "idle" ? (
          verdict.text
        ) : undefined
      }
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
  const panelId = useId();

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
  const noted = legs.find((leg) => leg.note);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-fg-dim">
          {setCount > 0 ? `${setCount} channel${setCount === 1 ? "" : "s"} set by hand` : "Know the channel? You can set it yourself."}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={panelId} iconRight={open ? "chevronUp" : "chevronDown"}>
          {open ? "Hide channels" : "Set channel by hand"}
        </Button>
      </div>

      {noted?.note && !open ? (
        <Callout tone="warning" title={noted.noteTitle ?? "Channel discovery is incomplete"}>
          {noted.note}
        </Callout>
      ) : null}

      {open ? (
        <div id={panelId} className="flex flex-col gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] px-3.5 py-3">
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            A channel you enter is used as given and marked as set by hand in the route. Both ends are queried as you type: an open
            channel that connects to a different chain is reported, because that case does not fail, it delivers a token the
            destination has no record of.
          </p>
          {legs.map((leg) => (
            <div key={leg.key} className="flex flex-col gap-1.5">
              {leg.note ? <p className="text-[12px] leading-snug text-[var(--z-warning)]">{leg.note}</p> : null}
              <LegField leg={leg} value={overrides[leg.key]?.channelId ?? ""} onChange={(channelId) => setLeg(leg, channelId)} />
            </div>
          ))}
          {setCount > 0 ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => onOverridesChange({})}>
              Clear {setCount} manual channel{setCount === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
