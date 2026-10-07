"use client";

/**
 * Following chains from any page (Chains table, a chain's page, Networks).
 *
 * The list itself lives in `useFollowedChains` (browser storage, shared by
 * the rail, the scope and every data hook); this adds the rules from
 * `model.ts` (32 at most, never zero, stale ids dropped) and the feedback:
 * a refusal is always explained, and with `notify` a change confirms itself
 * with an Undo, because a star in a dense table is easy to hit by mistake.
 */

import { useCallback, useMemo } from "react";
import { chainById, toast } from "@/components/ui";
import { DEFAULT_FOLLOWED, useFollowedChains } from "@/lib/useFollowedChains";
import { MAX_FOLLOWED, moveFollowed, toggleFollow, type FollowOutcome } from "./model";

const isKnown = (chainId: string) => Boolean(chainById(chainId));

export interface FollowApi {
  /** Followed catalog chains, in the user's order. */
  followed: string[];
  count: number;
  atCap: boolean;
  isFollowed: (chainId: string) => boolean;
  /** Follow / unfollow; refusals (cap, last chain) toast their reason. */
  toggle: (chainId: string, options?: { notify?: boolean }) => FollowOutcome;
  move: (chainId: string, delta: -1 | 1) => void;
  /** Back to the first-visit defaults, with an Undo. */
  reset: () => void;
  /** The list equals the first-visit defaults. */
  isDefault: boolean;
}

export function useFollow(): FollowApi {
  const [stored, setFollowed] = useFollowedChains();
  const followed = useMemo(() => stored.filter(isKnown), [stored]);
  const set = useMemo(() => new Set(followed), [followed]);

  const toggle = useCallback(
    (chainId: string, options: { notify?: boolean } = {}) => {
      const outcome = toggleFollow(stored, chainId, isKnown);
      if (!outcome.ok) {
        toast.error(outcome.reason === "cap" ? "Follow limit reached" : "Can't unfollow the last network", {
          id: "follow-refused",
          description: outcome.message,
        });
        return outcome;
      }
      const before = stored;
      setFollowed(outcome.next);
      if (options.notify) {
        const name = chainById(chainId)?.chainName ?? chainId;
        toast.success(outcome.following ? `Following ${name}` : `Unfollowed ${name}`, {
          id: "follow-change",
          description: outcome.following ? "It joins your rail and every All chains view." : "It leaves your rail and All chains views.",
          action: { label: "Undo", onClick: () => setFollowed(before) },
        });
      }
      return outcome;
    },
    [stored, setFollowed],
  );

  const move = useCallback(
    (chainId: string, delta: -1 | 1) => {
      const next = moveFollowed(followed, chainId, delta);
      if (next !== followed) setFollowed([...next]);
    },
    [followed, setFollowed],
  );

  const reset = useCallback(() => {
    const before = stored;
    setFollowed([...DEFAULT_FOLLOWED]);
    toast.success("Back to the default networks", {
      id: "follow-change",
      description: `${DEFAULT_FOLLOWED.length} networks followed.`,
      action: { label: "Undo", onClick: () => setFollowed(before) },
    });
  }, [stored, setFollowed]);

  return {
    followed,
    count: followed.length,
    atCap: followed.length >= MAX_FOLLOWED,
    isFollowed: (chainId: string) => set.has(chainId),
    toggle,
    move,
    reset,
    isDefault: followed.length === DEFAULT_FOLLOWED.length && followed.every((id, index) => id === DEFAULT_FOLLOWED[index]),
  };
}
