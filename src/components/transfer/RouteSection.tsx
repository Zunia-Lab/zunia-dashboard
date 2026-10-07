"use client";

/**
 * The route block of Send (IBC) and Bridge: the planned route with its
 * channel verdicts, then, when the planner found nothing usable, the channel
 * your own history used (one click to try it), and the manual channel
 * fields. The manual fields also show when a channel is already set by hand
 * or when discovery failed on a leg, so a user is never stuck without a way
 * on.
 *
 * "Usable" is stricter than "found": a route over a channel somebody else
 * typed into the planner (`strangerChannels`) is shown but not signed, and
 * the form says to set that channel here. So the field it points to opens
 * for exactly those legs, and the history hint is offered as for no route.
 *
 * While a new plan is worked out for the same pair (an amount or a channel
 * being typed), the last answer stays on screen, dimmed (spec §3: a refetch
 * keeps the previous render). A route that blinked to a skeleton on every
 * keystroke would also unmount the channel field under the caret, and a
 * channel could then only be pasted, never typed.
 */

import { useState } from "react";
import { ChannelOverrides } from "@/components/interchain/ChannelOverrides";
import type { HopOverrideInput } from "@/lib/interchain/client";
import type { AsyncStatus } from "@/lib/interchain/hooks";
import type { InterchainFailure, PlanCandidateWire, PlanResponseBody } from "@/lib/interchain/wire";
import { cn } from "@/lib/cn";
import { channelLegs, strangerChannels, type HistoryChannel, type RouteTiming } from "./logic";
import { HistoryChannelHint, RouteView } from "./RouteView";

interface Settled {
  pair: string;
  data: PlanResponseBody | null;
  candidate: PlanCandidateWire | null;
}

export function RouteSection({
  status,
  data,
  candidate,
  error,
  onRetry,
  observed,
  idleText,
  fromChainId,
  toChainId,
  historyChannel,
  overrides,
  onOverridesChange,
}: {
  status: AsyncStatus;
  data: PlanResponseBody | null;
  candidate: PlanCandidateWire | null;
  error: InterchainFailure | null;
  onRetry: () => void;
  observed: RouteTiming | null;
  idleText?: string;
  fromChainId: string | null;
  toChainId: string | null;
  historyChannel: HistoryChannel | null;
  overrides: Record<string, HopOverrideInput>;
  onOverridesChange: (next: Record<string, HopOverrideInput>) => void;
}) {
  const pair = fromChainId !== null && toChainId !== null ? `${fromChainId}>${toChainId}` : null;
  // The last settled answer for this pair. Kept with a guarded render-time
  // update (React's "information from previous renders" pattern).
  const [kept, setKept] = useState<Settled | null>(null);
  if (status === "ready" && pair !== null && (kept === null || kept.pair !== pair || kept.data !== data || kept.candidate !== candidate)) {
    setKept({ pair, data, candidate });
  }
  const replanning = status === "loading" && kept !== null && kept.pair === pair;
  const shown = status === "ready" ? { data, candidate } : replanning && kept ? { data: kept.data, candidate: kept.candidate } : { data, candidate };
  const ready = (status === "ready" || replanning) && fromChainId !== null && toChainId !== null;

  const manual = Object.keys(overrides).length > 0;
  const strangers = shown.candidate ? strangerChannels(shown.candidate.links, overrides) : [];
  const usable = shown.candidate !== null && strangers.length === 0;
  const failures = shown.data?.discoveryFailures ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("transition-opacity duration-[160ms]", replanning && "opacity-60")} aria-busy={replanning || undefined}>
        <RouteView
          status={replanning ? "ready" : status}
          data={shown.data}
          candidate={shown.candidate}
          error={error}
          onRetry={onRetry}
          observed={observed}
          idleText={idleText}
        />
      </div>
      {ready && !usable && historyChannel && !manual ? (
        <HistoryChannelHint
          hint={historyChannel}
          fromChainId={fromChainId}
          toChainId={toChainId}
          onUse={() =>
            onOverridesChange({
              [`${fromChainId}>${toChainId}`]: { fromChainId, toChainId, channelId: historyChannel.channelId },
            })
          }
        />
      ) : null}
      {ready && (!usable || manual || failures.length > 0) ? (
        <ChannelOverrides
          legs={channelLegs(fromChainId, toChainId, failures, strangers)}
          overrides={overrides}
          onOverridesChange={onOverridesChange}
          defaultOpen={!usable}
        />
      ) : null}
    </div>
  );
}
