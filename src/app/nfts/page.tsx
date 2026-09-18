"use client";

/**
 * The NFTs an account holds on one chain.
 *
 * Three facts shape this screen, and all three are on it rather than behind it:
 *
 * 1. **Not every chain can hold an NFT.** CW721 is a CosmWasm contract, and 118
 *    of the registry's 332 chains declare `cosmwasm`. On the rest there is
 *    nothing to own, and an empty grid there would read as "you own nothing"
 *    rather than "there is nothing to own". `/api/nft/config` answers first and
 *    the two cases get different screens — as does the third, "nobody has said",
 *    which is what this build's chain catalog currently reports for every chain
 *    because its generator drops the registry's `features[]` array.
 *
 * 2. **A list of NFTs can never be promised to be complete without an index.**
 *    CosmWasm has no chain-wide "tokens by owner" query; `tokens` is asked of
 *    one contract at a time. All three ways of getting a contract address are
 *    wired up — a shipped list, an index, an address the user pastes — and the
 *    panel beside the grid says which of them actually ran. An empty grid over
 *    zero queried contracts says "nothing was checked", never "you own none".
 *
 * 3. **Artwork is a third-party request.** `token_uri` and `image` point
 *    wherever the minter chose. The metadata document is read server-side, so
 *    that host sees this deployment; the image is loaded by the browser, so that
 *    host sees the visitor — and because it only happens for tokens this
 *    account holds, the request itself is a statement about holdings. It is off
 *    until the user turns it on, next to the sentence explaining that.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  NftGrid,
  NFT_MEDIA_PRIVACY_NOTE,
  Pill,
  Skeleton,
  Switch,
  truncateAddress,
  type NftCardItem,
} from "@zunialab/ui";
import { ChainChooser } from "@/components/interchain/ChainChooser";
import { CollectionSources } from "@/components/nft/CollectionSources";
import { DashboardShell } from "@/components/DashboardShell";
import { reencodeAddress } from "@/lib/address";
import { findChain, type ChainEntry } from "@/lib/chains";
import {
  useNftCollections,
  useNftConfig,
  useNftTokens,
} from "@/lib/nft/hooks";
import type {
  NftCollectionWire,
  NftConfigWire,
  NftHoldingWire,
} from "@/lib/nft/wire";
import { useChainScope } from "@/lib/useChainScope";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

/** Token ids read per request. Matches the cap `/api/nft/tokens` enforces. */
const PAGE_SIZE = 24;

const USER_CONTRACTS_KEY = "zunia.dashboard.nftContracts";

/** Contract addresses the user added, per chain, kept in this browser only. */
function useUserContracts(chainId: string): {
  readonly contracts: readonly string[];
  readonly add: (address: string) => void;
  readonly remove: (address: string) => void;
} {
  const [byChain, setByChain] = useStoredValue<Record<string, string[]>>(
    USER_CONTRACTS_KEY,
    {},
  );
  const contracts = useMemo(() => byChain[chainId] ?? [], [byChain, chainId]);

  return {
    contracts,
    add: (address) =>
      setByChain((prev) => {
        const current = prev[chainId] ?? [];
        if (current.includes(address)) return prev;
        return { ...prev, [chainId]: [...current, address] };
      }),
    remove: (address) =>
      setByChain((prev) => ({
        ...prev,
        [chainId]: (prev[chainId] ?? []).filter((row) => row !== address),
      })),
  };
}

export default function NftsPage() {
  const { account } = useWallet();
  const { selectedChainId } = useChainScope();
  const { nftMedia, setNftMedia, nftMediaAllowed, nftMediaBlockedReason } =
    usePrefs();

  const [chainId, setChainId] = useState(() => selectedChainId ?? "safrochain-1");

  // The left rail decides the chain, so a rail change must not leave this page
  // pointed at the old one. Render-time rather than an effect: a setState in an
  // effect body costs a second render pass on every scope change.
  const [lastScoped, setLastScoped] = useState(selectedChainId);
  if (selectedChainId !== lastScoped) {
    setLastScoped(selectedChainId);
    if (selectedChainId) setChainId(selectedChainId);
  }

  const chain = findChain(chainId);
  const config = useNftConfig(chainId);
  const { contracts, add, remove } = useUserContracts(chainId);

  const owner = useMemo(() => {
    if (!account || !chain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    if (accountChain.chainId === chain.chainId) return account.address;
    return reencodeAddress(account.address, chain, accountChain);
  }, [account, chain]);

  const supported = config.data?.status === "supported";
  const collections = useNftCollections({
    chainId,
    address: owner,
    userContracts: contracts,
    enabled: supported,
  });

  return (
    <DashboardShell
      title="NFTs"
      description="CW721 collections this account holds, on one chain at a time."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <ChainChooser
              label="Network"
              value={chainId}
              onValueChange={setChainId}
            />
            <MediaSwitch
              enabled={nftMedia}
              onChange={setNftMedia}
              blockedReason={nftMediaBlockedReason}
              ipfsGatewayCount={config.data?.media.ipfsGatewayCount ?? 0}
              ipfsConfigKey={config.data?.configKeys.ipfsGateways ?? null}
            />
          </Card>

          <Availability
            config={config.data}
            loading={config.loading}
            error={config.status === "error" ? config.error?.message ?? null : null}
            onRetry={config.reload}
          />

          {supported && !account ? (
            <Callout tone="neutral" title="Connect a wallet">
              Zunia has to know which address to ask about. Nothing is queried
              until you connect one.
            </Callout>
          ) : null}

          {supported && account && !owner ? (
            <Callout tone="warning" title="This account has no address here">
              The connected account cannot be re-encoded for{" "}
              {chain?.chainName ?? chainId}: it uses a different coin type, so it
              is a different key. Nothing was queried.
            </Callout>
          ) : null}

          {supported && owner ? (
            <Holdings
              chain={chain}
              chainId={chainId}
              collections={collections}
              media={nftMediaAllowed}
              owner={owner}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {config.data && chain ? (
            <Card>
              <CollectionSources
                chain={chain}
                config={config.data}
                result={collections.data}
                userContracts={contracts}
                onAddContract={add}
                onRemoveContract={remove}
              />
            </Card>
          ) : null}

          {config.data && config.data.problems.length > 0 ? (
            <Callout tone="warning" title="Some configuration could not be read">
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {config.data.problems.map((problem) => (
                  <li key={`${problem.key}-${problem.entry}`}>
                    <code>{problem.key}</code>: {problem.reason}{" "}
                    <span className="font-mono break-all">{problem.entry}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <p className="text-[length:var(--z-type-meta)] leading-relaxed text-fg-muted">
            Moving a token is a contract call, not a transfer of coins. Open one
            to see what the call says before it is signed. Sending fungible
            assets is over on{" "}
            <Link href="/send" className="underline underline-offset-2">
              Send
            </Link>
            .
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}

/**
 * The artwork switch, and the sentence that makes it a choice rather than a
 * default.
 *
 * Disabled — not hidden — while privacy mode is on, because the reason is the
 * point: the two settings would otherwise contradict each other silently.
 */
function MediaSwitch({
  enabled,
  onChange,
  blockedReason,
  ipfsGatewayCount,
  ipfsConfigKey,
}: {
  readonly enabled: boolean;
  readonly onChange: (value: boolean) => void;
  readonly blockedReason: string | null;
  readonly ipfsGatewayCount: number;
  readonly ipfsConfigKey: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--z-glass)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[length:var(--z-type-row)] font-medium text-fg">
            Show artwork
          </span>
          <span className="mt-0.5 block font-mono text-[length:var(--z-type-micro)] text-fg-dim">
            {enabled && !blockedReason ? "on" : "off"}
          </span>
        </span>
        <Switch
          checked={enabled && !blockedReason}
          onCheckedChange={onChange}
          disabled={blockedReason !== null}
          aria-label="Show NFT artwork"
          {...(blockedReason ? { "aria-describedby": "nft-media-blocked" } : {})}
        />
      </div>
      <p className="m-0 text-[length:var(--z-type-micro)] leading-relaxed text-fg-muted">
        {NFT_MEDIA_PRIVACY_NOTE}
      </p>
      <p className="m-0 text-[length:var(--z-type-micro)] leading-relaxed text-fg-muted">
        The metadata document is read by Zunia&rsquo;s server, so that host sees
        this deployment rather than you. The image file is loaded by this
        browser, so that host does see your IP address.
      </p>
      {blockedReason ? (
        <p
          id="nft-media-blocked"
          className="m-0 text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]"
        >
          {blockedReason}
        </p>
      ) : null}
      {enabled && !blockedReason && ipfsGatewayCount === 0 && ipfsConfigKey ? (
        <p className="m-0 text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          No IPFS gateway is configured for this deployment ({ipfsConfigKey}), so
          artwork stored on IPFS still cannot be shown. Zunia will not pick a
          public gateway for you: that would hand one operator the list of
          everything you hold.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The capability gate, rendered as three different screens.
 *
 * `unsupported` and `unverified` are deliberately not the same callout. The
 * first says this chain cannot hold NFTs; the second says this build could not
 * find out, which is a statement about the build and comes with the key that
 * fixes it.
 */
function Availability({
  config,
  loading,
  error,
  onRetry,
}: {
  readonly config: NftConfigWire | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}) {
  if (loading) {
    return (
      <Card aria-busy="true">
        <span className="sr-only">Checking whether this chain supports NFTs</span>
        <Skeleton className="h-16 w-full rounded-[14px]" />
      </Card>
    );
  }

  if (error) {
    return (
      <Callout tone="danger" title="Could not check this chain">
        {error}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2"
        >
          Try again
        </button>
      </Callout>
    );
  }

  if (!config) return null;

  if (config.status === "unsupported") {
    return (
      <Callout tone="neutral" title="This chain cannot hold NFTs">
        {config.reason}
      </Callout>
    );
  }

  if (config.status === "unverified") {
    return (
      <Callout tone="warning" title="Zunia cannot tell whether this chain runs CosmWasm">
        {config.reason} Nothing was queried, so nothing below is a claim about
        what this account holds.
      </Callout>
    );
  }

  if (config.note) {
    return (
      <Callout tone="info" title="Support confirmed by asking the chain">
        {config.note}
      </Callout>
    );
  }

  return null;
}

/** The grid, one section per collection, plus the honest empty state. */
function Holdings({
  chain,
  chainId,
  collections,
  media,
  owner,
}: {
  readonly chain: ChainEntry | undefined;
  readonly chainId: string;
  readonly collections: ReturnType<typeof useNftCollections>;
  readonly media: boolean;
  readonly owner: string;
}) {
  if (collections.loading) {
    // NftGrid owns the aria-busy region and the "Loading NFTs" announcement;
    // a second one here would be read twice.
    return (
      <Card>
        <NftGrid items={[]} loading title="Looking for collections" />
      </Card>
    );
  }

  if (collections.status === "error") {
    return (
      <Callout tone="danger" title="Could not look for NFTs">
        {collections.error?.message ??
          "The chain did not answer, so nothing was checked."}{" "}
        <button
          type="button"
          onClick={collections.reload}
          className="underline underline-offset-2"
        >
          Try again
        </button>
      </Callout>
    );
  }

  const data = collections.data;
  if (!data) return null;

  if (data.holdings.length === 0) {
    return (
      <Card>
        {data.queriedContractCount === 0 ? (
          // The defect this whole surface was written to avoid: an empty grid
          // over zero queries, rendered as though it were an answer.
          <Callout tone="warning" title="Nothing was checked">
            No collection address was available for {chain?.chainName ?? chainId},
            so no contract was queried and this is not a statement about what{" "}
            {truncateAddress(owner)} holds. Add a collection address on the right,
            or configure a known-collection list or an NFT index.
          </Callout>
        ) : (
          <Callout tone="neutral" title="No tokens in the collections that were checked">
            {data.queriedContractCount} collection
            {data.queriedContractCount === 1 ? " was" : "s were"} queried on{" "}
            {chain?.chainName ?? chainId} and {truncateAddress(owner)} holds
            nothing in {data.queriedContractCount === 1 ? "it" : "them"}.{" "}
            {data.limitation ?? ""}
          </Callout>
        )}
      </Card>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {data.holdings.map((holding) => (
        <Card key={holding.contractAddress}>
          <CollectionSection
            chainId={chainId}
            chainName={chain?.chainName ?? chainId}
            holding={holding}
            media={media}
          />
        </Card>
      ))}
    </div>
  );
}

/**
 * One collection's tokens.
 *
 * Token ids come from the discovery pass and are always rendered, even when the
 * per-token read fails: the ids are what the contract said this address owns,
 * and dropping them because a second query failed would under-report holdings.
 * Names and artwork are the enrichment, and their failure is a separate line.
 */
function CollectionSection({
  chainId,
  chainName,
  holding,
  media,
}: {
  readonly chainId: string;
  readonly chainName: string;
  readonly holding: NftHoldingWire;
  readonly media: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const total = holding.tokenIds.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const batch = holding.tokenIds.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const tokens = useNftTokens({
    chainId,
    contract: holding.contractAddress,
    tokenIds: batch,
    media,
  });

  const byId = new Map(
    (tokens.data?.tokens ?? []).map((token) => [token.tokenId, token]),
  );

  const items: NftCardItem[] = batch.map((tokenId) => {
    const token = byId.get(tokenId);
    return {
      tokenId,
      name: token?.name ?? null,
      collectionAddress: holding.contractAddress,
      collectionName: collectionLabel(holding.collection),
      chainId,
      imageUrl: media ? (token?.imageUrl ?? null) : null,
    };
  });

  const readErrors = (tokens.data?.tokens ?? []).filter((token) => token.error);
  const mediaBlocked = (tokens.data?.tokens ?? []).find(
    (token) => token.imageUrlReason !== null,
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[length:var(--z-type-row)] font-medium text-fg">
            {collectionLabel(holding.collection) ??
              truncateAddress(holding.contractAddress, 8, 6)}
          </h2>
          <p
            className="m-0 mt-0.5 truncate font-mono text-[length:var(--z-type-micro)] text-fg-dim"
            title={holding.contractAddress}
          >
            {truncateAddress(holding.contractAddress, 10, 8)} · {chainName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={holding.source === "user" ? "accent" : "neutral"}>
            {holding.source === "user"
              ? "you added"
              : holding.source === "indexer"
                ? "from the index"
                : "shipped list"}
          </Pill>
          <span className="font-mono text-[length:var(--z-type-micro)] text-fg-dim">
            {total} held
          </span>
        </div>
      </div>

      {holding.collection?.error ? (
        <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          {holding.collection.error} The collection is shown by its address.
        </p>
      ) : null}

      {holding.truncated ? (
        <Callout tone="warning" title="This list was cut short">
          The contract returned more tokens than Zunia reads in one pass, so{" "}
          {total} is a floor, not a total.
        </Callout>
      ) : null}

      <NftGrid
        items={items}
        loadMedia={media}
        loading={tokens.loading}
        onSelect={(item) =>
          router.push(
            `/nfts/${encodeURIComponent(chainId)}/${encodeURIComponent(holding.contractAddress)}/${encodeURIComponent(item.tokenId)}`,
          )
        }
        emptyTitle="Nothing in this page"
        emptyDescription="The contract listed no token ids for this page."
      />

      {tokens.status === "error" ? (
        <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          {tokens.error?.message ??
            "The names and artwork for this page could not be read."}{" "}
          The token ids above still came from the contract.
        </p>
      ) : null}

      {readErrors.length > 0 ? (
        <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          {readErrors.length} token
          {readErrors.length === 1 ? "" : "s"} on this page could not be read
          from the contract and {readErrors.length === 1 ? "is" : "are"} shown by
          id only.
        </p>
      ) : null}

      {media && mediaBlocked?.imageUrlReason ? (
        <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          {mediaBlocked.imageUrlReason}
        </p>
      ) : null}

      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            Previous {PAGE_SIZE}
          </Button>
          <span className="font-mono text-[length:var(--z-type-micro)] text-fg-dim">
            {safePage * PAGE_SIZE + 1}–
            {Math.min(total, (safePage + 1) * PAGE_SIZE)} of {total}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next {PAGE_SIZE}
          </Button>
        </div>
      ) : null}

    </div>
  );
}

function collectionLabel(collection: NftCollectionWire | null): string | null {
  if (!collection) return null;
  const name = collection.name?.trim();
  if (name) return collection.symbol ? `${name} (${collection.symbol})` : name;
  return collection.symbol?.trim() || null;
}
