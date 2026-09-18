/**
 * Turning a planned route into `RoutePreview` rows.
 *
 * One join, done once, because getting it wrong is not cosmetic: a route's hops
 * and its channel links are not the same list. A swap hop moves no packet and
 * has no link, so indexing `links[i]` by hop position marks the swap hop as an
 * unverified channel — the preview then shouts "NOT VERIFIED · shipped default"
 * about a hop that has no channel to verify, and buries the real warning about
 * the hops that do.
 *
 * Links are matched by the chain the hop leaves and the channel it leaves on,
 * which is what identifies a directed link, and consumed as they match so two
 * hops on the same pair cannot both claim the first one.
 *
 * The swap hop is dropped from the preview entirely. It moves no packet and has
 * no channel, but `RoutePreview` puts a trust badge on every row it is given —
 * so a swap hop renders as "NOT VERIFIED", counts towards the "N channels are
 * not verified" callout, and drowns out the hops that genuinely need checking.
 * The swap is still stated, through `requiresIbcHooks` ("contract call on
 * arrival") and `swapVenueName` in the gas note. A `RoutePreviewHop` that opts
 * out of the trust badge would be the better fix and belongs in `@zunialab/ui`.
 */

import type { RoutePreviewHop } from "@zunialab/ui";
import { findChain } from "@/lib/chains";
import type { ChannelLinkWire, RouteHopWire } from "./wire";

function trustFor(link: ChannelLinkWire | undefined): {
  channelSource?: "discovered" | "manual" | "seed";
  channelVerified?: boolean;
  channelState?: ChannelLinkWire["state"];
} {
  if (!link) return {};
  return {
    channelSource:
      link.source === "verified"
        ? "discovered"
        : link.source === "manual"
          ? "manual"
          : "seed",
    // Only an explicit true. The shared component renders anything else as not
    // verified, which is the honest reading of "nobody looked".
    channelVerified: link.source === "verified" && link.state === "open",
    channelState: link.state,
  };
}

export function routePreviewHops(
  hops: readonly RouteHopWire[],
  links: readonly ChannelLinkWire[],
): RoutePreviewHop[] {
  const unconsumed = [...links];

  return hops
    .filter((hop) => hop.channelId.length > 0)
    .map((hop) => {
      const chain = findChain(hop.chainId);
      const counterparty = hop.counterpartyChainId
        ? findChain(hop.counterpartyChainId)
        : undefined;

      const index = unconsumed.findIndex(
        (candidate) =>
          candidate.sourceChainId === hop.chainId &&
          candidate.channelId === hop.channelId,
      );
      // Consumed, so a route that crosses the same pair twice cannot report the
      // first link's trust for both hops.
      const link = index >= 0 ? unconsumed.splice(index, 1)[0] : undefined;

      return {
        chainId: hop.chainId,
        ...(chain?.chainName ? { chainName: chain.chainName } : {}),
        ...(chain?.iconUrl ? { chainIconUrl: chain.iconUrl } : {}),
        counterpartyChainId: hop.counterpartyChainId,
        ...(counterparty?.chainName
          ? { counterpartyChainName: counterparty.chainName }
          : {}),
        ...(counterparty?.iconUrl
          ? { counterpartyChainIconUrl: counterparty.iconUrl }
          : {}),
        channelId: hop.channelId,
        port: hop.port,
        kind: hop.kind,
        ...trustFor(link),
      };
    });
}
