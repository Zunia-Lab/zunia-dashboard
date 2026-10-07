"use client";

/**
 * Why the token the user picked, or a link named, is not on the form.
 *
 * Send and Bridge never put another token in its place: an amount typed for
 * one balance must not end up signed against another (least of all on the
 * review, which promises "this is what your wallet will sign"). So the form
 * has no token until the picked one is back, and this note says why it is
 * gone and offers the one way back there is: show every chain, retry a chain
 * that did not answer, follow the network. The same words fill the line
 * under the Review button (`missingTokenText`).
 */

import { Button, Callout } from "@/components/ui";
import { findChain } from "@/lib/chains";
import type { PortfolioAsset } from "@/lib/token/wire";
import type { MissingTokenReason } from "./logic";
import { chainName } from "./names";

export interface MissingToken {
  reason: MissingTokenReason;
  chainId: string;
  /** A ticker when one is known ("ATOM"), else "That token". */
  token: string;
}

/**
 * A name for a balance that is not in the read: its ticker from any row of
 * the read (a staked-only balance still has one), else the chain's own coin
 * when the denom is it. Never a guess from the denom's spelling.
 */
export function missingTokenLabel(chainId: string, denom: string, assets: readonly PortfolioAsset[]): string {
  const held = assets.find((row) => row.chainId === chainId && row.identity.denom === denom);
  if (held) return held.identity.ticker;
  const chain = findChain(chainId);
  if (chain && denom === chain.coinMinimalDenom) return chain.coinDenom;
  if (chain && denom === chain.feeMinimalDenom) return chain.feeDenom;
  return "That token";
}

/** The one sentence: the note's title, and the reason the form cannot go on. */
export function missingTokenText(missing: MissingToken, verb: "send" | "move"): string {
  const chain = chainName(missing.chainId);
  switch (missing.reason) {
    case "unfollowed":
      return `${chain} isn't one of the networks you follow.`;
    case "scope":
      return `${missing.token} on ${chain} isn't in this scope.`;
    case "unread":
      return `${chain} could not be read just now.`;
    case "empty":
      return `No ${missing.token === "That token" ? "balance of that token" : missing.token} to ${verb} on ${chain}.`;
  }
}

export function MissingTokenNote({
  missing,
  verb,
  scopeName,
  onShowAll,
  onRetry,
  retrying,
}: {
  missing: MissingToken;
  verb: "send" | "move";
  /** The selected chain's name, when the rail has one. */
  scopeName?: string | null;
  onShowAll?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const chain = chainName(missing.chainId);
  const title = missingTokenText(missing, verb).replace(/\.$/, "");
  const { body, action } = (() => {
    switch (missing.reason) {
      case "unfollowed":
        return {
          body: `Follow ${chain} to ${verb} from it, or choose another token.`,
          action: (
            <Button size="sm" variant="secondary" href="/networks">
              Manage networks
            </Button>
          ),
        };
      case "scope":
        return {
          body: `${scopeName ? `Only your ${scopeName} balances are listed while ${scopeName} is selected.` : "Only the selected chain's balances are listed."} Show every chain to ${verb} it, or choose another token.`,
          action: onShowAll ? (
            <Button size="sm" variant="secondary" onClick={onShowAll}>
              Show all chains
            </Button>
          ) : null,
        };
      case "unread":
        return {
          body: `Your ${missing.token === "That token" ? "balance" : missing.token} there shows again once it answers; nothing is ${verb === "send" ? "sent" : "moved"} until then.`,
          action: onRetry ? (
            <Button size="sm" variant="secondary" iconLeft="refresh" loading={retrying} onClick={onRetry}>
              Retry
            </Button>
          ) : null,
        };
      case "empty":
        return {
          body: `The latest read of ${chain} shows none of it you can ${verb} (spent, or staked). Choose another token.`,
          action: null,
        };
    }
  })();
  return (
    <Callout tone="neutral" icon="info" title={title} action={action}>
      {body}
    </Callout>
  );
}
