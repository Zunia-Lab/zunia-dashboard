"use client";

/**
 * The NFTs an account holds on one network at a time.
 *
 * Three facts shape this page, and all three are on it rather than behind it:
 *
 * 1. Not every chain can hold an NFT. CW721 is a CosmWasm contract, and most
 *    registry chains do not run CosmWasm. `/api/nft/config` answers first and
 *    "this chain cannot hold NFTs", "Zunia cannot tell" and "supported" get
 *    different screens: an empty grid on a chain without CosmWasm would read
 *    as "you own nothing" instead of "there is nothing to own".
 * 2. A list of NFTs cannot be promised complete without an index. `tokens` is
 *    asked of one contract at a time; the panel beside the grid says which
 *    ways of finding contracts ran, and an empty grid over zero queried
 *    contracts says "nothing was checked", never "you own none". Where the
 *    chain was scanned and none of its newest codes is a collection, it says
 *    that instead: the chain was asked, the owner was not.
 * 3. Artwork is a third-party request: the image host sees this device and,
 *    since only held tokens are drawn, what it holds. It stays off until
 *    turned on, next to the sentence saying so, and privacy mode keeps it off.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Page } from "@/components/shell/Page";
import {
  AddressText,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  ChipGroup,
  Combobox,
  EmptyState,
  InlineError,
  Skeleton,
  StatTile,
  Switch,
  useIsPhone,
} from "@/components/ui";
import { CHAINS, findChain, sortChains, type ChainEntry } from "@/lib/chains";
import { shortenAddress } from "@/lib/format";
import { useNftCollections, useNftConfig, useNftTokens } from "@/lib/nft/hooks";
import type { NftCollectionWire, NftConfigWire, NftHoldingWire } from "@/lib/nft/wire";
import { useChainScope } from "@/lib/useChainScope";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { ADD_COLLECTION_INPUT, CollectionSources } from "./CollectionSources";
import { NftCard, NftGrid, NftGridSkeleton, type NftCardItem } from "./NftGallery";

/** Token ids read per request: the cap `/api/nft/tokens` enforces. */
const PAGE_SIZE = 24;

const USER_CONTRACTS_KEY = "zunia.dashboard.nftContracts";
const NO_CONTRACTS: Record<string, string[]> = {};

/** Contract addresses the user added, per chain, kept on this browser only. */
function useUserContracts(chainId: string) {
  const [byChain, setByChain] = useStoredValue<Record<string, string[]>>(USER_CONTRACTS_KEY, NO_CONTRACTS);
  const contracts = useMemo(() => byChain[chainId] ?? [], [byChain, chainId]);
  return {
    contracts,
    add: (address: string) =>
      setByChain((prev) => {
        const current = prev[chainId] ?? [];
        return current.includes(address) ? prev : { ...prev, [chainId]: [...current, address] };
      }),
    remove: (address: string) => setByChain((prev) => ({ ...prev, [chainId]: (prev[chainId] ?? []).filter((row) => row !== address) })),
  };
}

export function collectionLabel(collection: NftCollectionWire | null): string | null {
  if (!collection) return null;
  const name = collection.name?.trim();
  if (name) return collection.symbol ? `${name} (${collection.symbol})` : name;
  return collection.symbol?.trim() || null;
}

export function nftHref(chainId: string, contract: string, tokenId: string): string {
  return `/nfts/${encodeURIComponent(chainId)}/${encodeURIComponent(contract)}/${encodeURIComponent(tokenId)}`;
}

export function NftsPage() {
  return (
    <Page
      title="NFTs"
      access="wallet"
      connectTitle="Your NFT collections, chain by chain"
      connectDescription="Connect a wallet to see and send the NFTs you hold on CosmWasm networks."
    >
      <NftsBody />
    </Page>
  );
}

function NftsBody() {
  const { addressFor } = useWallet();
  const { selectedChainId, followedOnNetwork, network } = useChainScope();
  const { nftMedia, setNftMedia, nftMediaAllowed, nftMediaBlockedReason } = usePrefs();

  const [chainId, setChainId] = useState(() => selectedChainId ?? "safrochain-1");
  // The rail decides the chain when it names one, so a rail change must not
  // leave this page on the old chain. Render-time (not an effect): a setState
  // in an effect costs a second render on every scope change.
  const [lastScoped, setLastScoped] = useState(selectedChainId);
  if (selectedChainId !== lastScoped) {
    setLastScoped(selectedChainId);
    if (selectedChainId) setChainId(selectedChainId);
  }

  const chain = findChain(chainId);
  const config = useNftConfig(chainId);
  const { contracts, add, remove } = useUserContracts(chainId);
  const owner = addressFor(chainId);
  const supported = config.data?.status === "supported";
  const collections = useNftCollections({ chainId, address: owner, userContracts: contracts, enabled: supported });

  const followed = useMemo(() => followedOnNetwork.map((id) => findChain(id)).filter((entry): entry is ChainEntry => Boolean(entry)), [followedOnNetwork]);
  const catalog = useMemo(() => {
    const followedIds = new Set(followed.map((entry) => entry.chainId));
    return [...followed, ...sortChains(CHAINS.filter((entry) => entry.network === network && !followedIds.has(entry.chainId)))];
  }, [followed, network]);
  // Followed networks as chips, plus the current one when it was picked from the catalog.
  const chipChains = useMemo(() => {
    const chips = followed.slice(0, 6);
    return chain && !chips.some((entry) => entry.chainId === chain.chainId) ? [...chips, chain] : chips;
  }, [followed, chain]);

  const requestMedia = nftMediaBlockedReason ? null : () => setNftMedia(true);
  const data = collections.data;
  const tokenCount = data?.holdings.reduce((sum, holding) => sum + holding.tokenIds.length, 0) ?? 0;
  const anyTruncated = data?.holdings.some((holding) => holding.truncated) ?? false;

  return (
    <div className="@container flex flex-col gap-[var(--d-gap)]">
      <Card padding="none" className="gap-0">
        <div className="flex min-w-0 flex-col gap-2 p-[var(--d-pad)] @min-[760px]:flex-row @min-[760px]:items-center @min-[760px]:gap-4">
          <span className="d-label shrink-0">Network</span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <ChipGroup<string>
              type="single"
              ariaLabel="Network"
              value={chainId}
              onChange={setChainId}
              size="md"
              scroll
              className="min-w-0"
              items={chipChains.map((entry) => ({ value: entry.chainId, label: entry.chainName, leading: <ChainLogo chainId={entry.chainId} size={16} /> }))}
            />
            <Combobox<ChainEntry>
              title="Network"
              items={catalog}
              getKey={(entry) => entry.chainId}
              value={chainId}
              onSelect={(entry) => setChainId(entry.chainId)}
              placeholder={`Search ${catalog.length} networks`}
              emptyText="No network matches"
              width={340}
              groupBy={(entry) => (followedOnNetwork.includes(entry.chainId) ? "Followed" : "All networks")}
              filter={(entry, query) =>
                entry.chainName.toLowerCase().includes(query) || entry.chainId.toLowerCase().includes(query) || entry.coinDenom.toLowerCase().includes(query)
              }
              trigger={
                <Button size="sm" variant="ghost" iconRight="chevronDown" className="shrink-0" aria-label="More networks">
                  More
                </Button>
              }
              renderItem={(entry) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  <ChainLogo chainId={entry.chainId} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-fg">{entry.chainName}</span>
                    <span className="block truncate font-mono text-[11px] text-fg-dim">{entry.chainId}</span>
                  </span>
                </span>
              )}
            />
          </div>
        </div>
        <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-3">
          <MediaToggle
            enabled={nftMedia}
            onChange={setNftMedia}
            blockedReason={nftMediaBlockedReason}
            ipfsGatewayCount={config.data?.media.ipfsGatewayCount ?? null}
          />
        </div>
      </Card>

      <Availability config={config.data} loading={config.loading} error={config.status === "error" ? (config.error?.message ?? null) : null} onRetry={config.reload} />

      {supported && !owner ? (
        <Callout tone="warning" title={`No ${chain?.chainName ?? chainId} address`}>
          Your wallet didn&apos;t share one for this network.
        </Callout>
      ) : null}

      {supported && owner && data && data.queriedContractCount > 0 ? (
        <section aria-label="NFT summary" className="grid grid-cols-2 gap-[var(--d-gap)] @min-[760px]:grid-cols-4">
          <StatTile label="Collections" icon="layers" value={data.holdings.length} />
          <StatTile label="Tokens" icon="nfts" value={`${tokenCount}${anyTruncated ? "+" : ""}`} />
          <StatTile label="Contracts checked" icon="search" value={data.queriedContractCount} />
          <StatTile
            label="Coverage"
            icon={data.complete ? "check" : "info"}
            value={data.complete ? "Complete" : "Partial"}
            tone={data.complete ? "positive" : "default"}
          />
        </section>
      ) : null}

      {supported && owner && chain && config.data ? (
        <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] @min-[900px]:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-[var(--d-gap)] @min-[900px]:col-span-7 @min-[1080px]:col-span-8">
            <Holdings chain={chain} chainId={chainId} collections={collections} media={nftMediaAllowed} onRequestMedia={requestMedia} />
          </div>
          <div className="flex min-w-0 flex-col gap-[var(--d-gap)] @min-[900px]:col-span-5 @min-[1080px]:col-span-4">
            <CollectionSources
              chain={chain}
              config={config.data}
              result={data ?? null}
              userContracts={contracts}
              onAddContract={add}
              onRemoveContract={remove}
            />
            {config.data.problems.length > 0 ? (
              <Callout tone="warning" title="Configuration problems">
                <ul className="flex flex-col gap-1">
                  {config.data.problems.map((problem) => (
                    <li key={`${problem.key}-${problem.entry}`}>
                      <code className="font-mono text-[12px] text-fg">{problem.key}</code>: {problem.reason}{" "}
                      <span className="break-all font-mono text-[12px]">{problem.entry}</span>
                    </li>
                  ))}
                </ul>
              </Callout>
            ) : null}
            <p className="px-1 text-[12.5px] leading-[1.5] text-fg-dim">
              Coins move on{" "}
              <Link href="/send" className="font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                Send
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The artwork switch and the sentence that makes it a choice. Disabled, not
 * hidden, in privacy mode: the reason is the point, or the two settings would
 * contradict each other silently.
 */
function MediaToggle({
  enabled,
  onChange,
  blockedReason,
  ipfsGatewayCount,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  blockedReason: string | null;
  /** Null until the deployment's config has answered: unknown is not "none". */
  ipfsGatewayCount: number | null;
}) {
  const on = enabled && !blockedReason;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Switch
        checked={on}
        onCheckedChange={onChange}
        disabled={blockedReason !== null}
        label="Show artwork"
        description={
          blockedReason ? (
            <span className="text-[var(--z-warning)]">{blockedReason}</span>
          ) : (
            "Images load from each token’s host."
          )
        }
      />
      {on && ipfsGatewayCount === 0 ? (
        <p className="text-[12px] leading-snug text-[var(--z-warning)]">No IPFS gateway is set up, so IPFS artwork can&apos;t show.</p>
      ) : null}
    </div>
  );
}

/**
 * The capability gate. `unsupported` and `unverified` are deliberately not
 * the same callout: the first says this chain cannot hold NFTs; the second
 * says this deployment could not find out, and names the key that fixes it.
 */
function Availability({ config, loading, error, onRetry }: { config: NftConfigWire | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) {
    return (
      <Card aria-busy="true">
        <span className="sr-only">Checking whether this network supports NFTs</span>
        <div aria-hidden className="flex items-center gap-3">
          <Skeleton circle width={32} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
      </Card>
    );
  }
  if (error) return <InlineError title="Couldn't check this network" message={error} onRetry={onRetry} />;
  if (!config) return null;
  if (config.status === "unsupported") {
    return (
      <Card>
        <EmptyState inline icon="nfts" title={`${config.chainName} doesn’t support NFTs`} body={config.reason} />
      </Card>
    );
  }
  if (config.status === "unverified") {
    return (
      <Callout tone="warning" title={`Can’t tell if ${config.chainName} supports NFTs`}>
        {config.reason}
      </Callout>
    );
  }
  if (config.note) {
    return (
      <Callout tone="info" title="NFT support confirmed">
        {config.note}
      </Callout>
    );
  }
  return null;
}

/** The collections, one card each, or a short empty state. */
function Holdings({
  chain,
  chainId,
  collections,
  media,
  onRequestMedia,
}: {
  chain: ChainEntry;
  chainId: string;
  collections: ReturnType<typeof useNftCollections>;
  media: boolean;
  onRequestMedia: (() => void) | null;
}) {
  // A row (icon, words, button) where there is width; stacked and centred on
  // a phone, where a button beside the words would squeeze them to a column.
  const compact = !useIsPhone();
  if (collections.loading) {
    return (
      <Card aria-busy="true">
        <CardHeader title="Looking for collections" refreshing />
        <span className="sr-only">Looking for NFTs</span>
        <NftGridSkeleton count={4} />
      </Card>
    );
  }
  if (collections.status === "error") {
    return (
      <InlineError
        title={`Couldn’t reach ${chain.chainName}`}
        message={collections.error?.message ?? "The network didn’t answer."}
        onRetry={collections.reload}
      />
    );
  }
  const data = collections.data;
  if (!data) return null;
  if (data.holdings.length === 0) {
    const scan = data.plan.scan;
    const addCollection = (
      <Button
        size="sm"
        variant="secondary"
        iconLeft="plus"
        onClick={() => {
          const field = document.getElementById(ADD_COLLECTION_INPUT);
          field?.scrollIntoView({ block: "center", behavior: "smooth" });
          field?.focus({ preventScroll: true });
        }}
      >
        Add a collection
      </Button>
    );
    return (
      <Card>
        {data.queriedContractCount === 0 && scan?.status === "ran" && scan.codesChecked > 0 ? (
          <EmptyState
            inline={compact}
            icon="nfts"
            title="No collections found"
            body="Add one by its contract address."
            action={addCollection}
          />
        ) : data.queriedContractCount === 0 && scan?.status === "failed" ? (
          // The chain did not answer, which is not the same as "nothing there".
          <EmptyState
            inline={compact}
            icon="search"
            title={`Couldn’t reach ${chain.chainName}`}
            body="Its contract list didn’t answer."
            action={
              <Button size="sm" variant="secondary" iconLeft="refresh" onClick={collections.reload}>
                Retry
              </Button>
            }
          />
        ) : data.queriedContractCount === 0 ? (
          // The defect this page exists to avoid: an empty grid over zero
          // queries, drawn as though it were an answer.
          <EmptyState inline={compact} icon="search" title="No collections to check" body="Add one by its contract address." action={addCollection} />
        ) : (
          <EmptyState inline={compact} icon="nfts" title="No NFTs yet" body={`Collectibles you own on ${chain.chainName} show up here.`} />
        )}
      </Card>
    );
  }
  return (
    <>
      {data.holdings.map((holding) => (
        <CollectionCard key={holding.contractAddress} chainId={chainId} holding={holding} media={media} onRequestMedia={onRequestMedia} />
      ))}
    </>
  );
}

const SOURCE_LABEL: Record<NftHoldingWire["source"], string> = {
  user: "Added",
  indexer: "Index",
  known: "Listed",
  scan: "On chain",
};

/**
 * One collection's tokens, a page at a time. Token ids come from discovery
 * and are always drawn, even when the per-token read fails: they are what the
 * contract said this address owns, and dropping them because a second query
 * failed would under-report holdings. Names and artwork are the enrichment.
 */
function CollectionCard({
  chainId,
  holding,
  media,
  onRequestMedia,
}: {
  chainId: string;
  holding: NftHoldingWire;
  media: boolean;
  onRequestMedia: (() => void) | null;
}) {
  const [page, setPage] = useState(0);
  const total = holding.tokenIds.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const batch = useMemo(() => holding.tokenIds.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE), [holding.tokenIds, current]);
  const tokens = useNftTokens({ chainId, contract: holding.contractAddress, tokenIds: batch, media });
  const byId = new Map((tokens.data?.tokens ?? []).map((token) => [token.tokenId, token]));
  const label = collectionLabel(holding.collection);
  const items: NftCardItem[] = batch.map((tokenId) => {
    const token = byId.get(tokenId);
    return {
      tokenId,
      name: token?.name ?? null,
      collectionName: label,
      collectionAddress: holding.contractAddress,
      imageUrl: media ? (token?.imageUrl ?? null) : null,
      error: token?.error ?? null,
    };
  });
  const readErrors = (tokens.data?.tokens ?? []).filter((token) => token.error).length;
  const mediaReason = media ? (tokens.data?.tokens ?? []).find((token) => token.imageUrlReason)?.imageUrlReason : null;

  return (
    <Card as="section" aria-label={label ?? holding.contractAddress}>
      <CardHeader
        title={label ?? shortenAddress(holding.contractAddress, 10, 6)}
        subtitle={<AddressText address={holding.contractAddress} head={10} tail={6} />}
        refreshing={tokens.loading}
        actions={
          <>
            <Badge tone="neutral" variant="outline">
              {SOURCE_LABEL[holding.source]}
            </Badge>
            <Badge tone="neutral" className="tabular-nums">
              {total}
              {holding.truncated ? "+" : ""} held
            </Badge>
          </>
        }
      />
      {holding.collection?.error ? (
        <p className="text-[12.5px] text-[var(--z-warning)]">Name unavailable; shown by address.</p>
      ) : null}
      {holding.truncated ? (
        <p className="text-[12.5px] text-[var(--z-warning)]">Showing the first {total} tokens.</p>
      ) : null}
      <NftGrid>
        {items.map((item) => (
          <NftCard key={item.tokenId} item={item} href={nftHref(chainId, holding.contractAddress, item.tokenId)} loadMedia={media} onRequestMedia={onRequestMedia} />
        ))}
      </NftGrid>
      {tokens.status === "error" ? (
        <p className="text-[12.5px] text-[var(--z-warning)]">
          {tokens.error?.message ?? "Names and artwork couldn’t be read."}
        </p>
      ) : null}
      {readErrors > 0 ? (
        <p className="text-[12.5px] text-[var(--z-warning)]">
          {readErrors} {readErrors === 1 ? "token" : "tokens"} shown by id only.
        </p>
      ) : null}
      {mediaReason ? <p className="text-[12.5px] text-[var(--z-warning)]">{mediaReason}</p> : null}
      {pages > 1 ? (
        <CardBody className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--d-hairline)] pt-3">
          <span className="text-[12.5px] tabular-nums text-fg-dim">
            {current * PAGE_SIZE + 1}–{Math.min(total, (current + 1) * PAGE_SIZE)} of {total}
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="secondary" iconLeft="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" iconRight="chevronRight" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </span>
        </CardBody>
      ) : null}
    </Card>
  );
}
