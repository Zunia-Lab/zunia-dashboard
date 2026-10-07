"use client";

/**
 * One NFT: what it is, who owns it, and how to move it.
 *
 * Everything is read from the chain through `/api/nft/tokens` (`all_nft_info`),
 * so the owner shown is the owner the contract reports now, not the one this
 * browser assumed when it listed the token. That is what makes the move
 * button safe to enable: a token that has already moved is a disabled button
 * with a sentence, not a transaction the chain rejects after the wallet has
 * opened.
 *
 * Off-chain metadata is read only with artwork on. Without it, name and
 * description come from the contract's on-chain `extension`, which is often
 * empty: an unnamed token here is normal and is said to be normal, so it does
 * not look like a failed load.
 *
 * The page renders without a wallet (a token is public); moving it needs one.
 */

import { useMemo, useState } from "react";
import { NFT_MEDIA_PRIVACY_NOTE, nftTitle } from "@zunialab/ui";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
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
  CopyButton,
  EmptyState,
  InlineError,
  KeyValueList,
  Skeleton,
  type KeyValueItem,
} from "@/components/ui";
import { findChain } from "@/lib/chains";
import { shortenAddress } from "@/lib/format";
import { useNftConfig, useNftTokens } from "@/lib/nft/hooks";
import { fillTemplate } from "@/lib/nft/parse-config";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { NftMedia } from "./NftGallery";
import { NftTransferProgress } from "./NftTransferProgress";
import { NftTransferSheet, type NftSignedTransfer } from "./NftTransferSheet";

export interface NftDetailPageProps {
  chainId: string;
  contract: string;
  tokenId: string;
}

export function NftDetailPage({ chainId, contract, tokenId }: NftDetailPageProps) {
  const { account, addressFor } = useWallet();
  const connect = useConnectModal();
  const { nftMedia, setNftMedia, nftMediaAllowed, nftMediaBlockedReason } = usePrefs();
  const [sheet, setSheet] = useState({ open: false, key: 0 });
  const [signed, setSigned] = useState<NftSignedTransfer | null>(null);

  const chain = findChain(chainId);
  const config = useNftConfig(chainId);
  const supported = config.data?.status === "supported";
  const tokenIds = useMemo(() => (tokenId ? [tokenId] : []), [tokenId]);
  const page = useNftTokens({
    chainId: supported ? chainId : null,
    contract: supported ? contract : null,
    tokenIds,
    media: nftMediaAllowed,
    withCollection: true,
  });
  const token = page.data?.tokens[0] ?? null;
  const collection = page.data?.collection ?? null;
  const collectionName = collection?.name?.trim() || collection?.symbol?.trim() || null;
  const owner = account ? addressFor(chainId) : null;
  const yours = Boolean(owner && token?.owner && token.owner === owner);

  /** Why this account may not move this token, in one sentence, or null. */
  const blocked = useMemo(() => {
    if (!account) return "Connect a wallet to move this token.";
    if (!chain) return `${chainId} is not in this build's chain catalog, so no transaction can be built for it.`;
    if (!owner) return `Your wallet has no address on ${chain.chainName}: it did not share one, and your account uses another key type there.`;
    if (page.loading) return "Reading who owns this token…";
    if (token?.error) return `${token.error} Zunia will not offer to move a token whose owner it could not read.`;
    if (!token?.owner) return "The contract reports no owner for this token, so Zunia cannot confirm it is yours.";
    if (token.owner !== owner) return `This token belongs to ${shortenAddress(token.owner, 12, 6)}, not to the connected account.`;
    return null;
  }, [account, chain, chainId, owner, page.loading, token]);

  const explorerUrl = config.data?.explorer.nftTemplate ? fillTemplate(config.data.explorer.nftTemplate, { contract, tokenId, chainId }) : null;
  const title = token?.name?.trim() || `#${tokenId}`;
  const crumbCollection = collectionName ?? shortenAddress(contract, 10, 4);

  const facts: KeyValueItem[] = [
    {
      key: "owner",
      label: "Owner",
      value: token?.owner ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {yours ? <Badge tone="success">You</Badge> : null}
          <AddressText address={token.owner} head={12} tail={6} />
        </span>
      ) : page.loading ? (
        <Skeleton className="inline-block h-3 w-28 align-middle" />
      ) : (
        <span className="text-fg-dim">Not reported</span>
      ),
    },
    {
      key: "collection",
      label: "Collection",
      value: (
        <span className="inline-flex flex-col items-end">
          {collectionName ? <span className="text-fg">{collectionName}</span> : null}
          <AddressText address={contract} head={12} tail={6} />
        </span>
      ),
    },
    {
      key: "id",
      label: "Token id",
      value: (
        <span className="inline-flex items-center gap-1">
          <span className="max-w-[220px] truncate font-mono text-[12.5px]" title={tokenId}>
            {tokenId}
          </span>
          <CopyButton value={tokenId} label="token id" />
        </span>
      ),
    },
    {
      key: "network",
      label: "Network",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <ChainLogo chainId={chainId} size={16} />
          {chain?.chainName ?? chainId}
        </span>
      ),
    },
    {
      key: "metadata",
      label: "Metadata",
      info: "Name, description and traits come from the contract's on-chain record; with artwork on, Zunia's server also reads the token's own metadata document. What the contract stores on chain wins.",
      value: token?.metadataSource === "remote" ? "On chain + token's host" : token?.metadataSource === "inline" ? "On chain" : <span className="text-fg-dim">—</span>,
      sub: token?.tokenUri ? (
        <span className="block max-w-[320px] truncate font-mono text-[11.5px]" title={token.tokenUri}>
          {token.tokenUri}
        </span>
      ) : undefined,
    },
  ];

  return (
    <Page
      title={title}
      access="public"
      breadcrumbs={[{ label: "NFTs", href: "/nfts" }, { label: crumbCollection }, { label: tokenId.length > 14 ? `#${tokenId.slice(0, 12)}…` : `#${tokenId}` }]}
    >
      <div className="@container flex flex-col gap-[var(--d-gap)]">
        {config.loading ? (
          <Card aria-busy="true">
            <span className="sr-only">Checking this network</span>
            <Skeleton className="h-12 w-full rounded-[var(--d-radius-inner)]" />
          </Card>
        ) : config.status === "error" ? (
          <InlineError title="Couldn't check this network" message={config.error?.message ?? "The check failed."} onRetry={config.reload} />
        ) : config.data?.status === "unsupported" ? (
          <Card>
            <EmptyState inline icon="nfts" title={`${config.data.chainName} cannot hold NFTs`} body={config.data.reason} />
          </Card>
        ) : config.data?.status === "unverified" ? (
          <Callout tone="warning" title="Zunia cannot tell whether this network runs CosmWasm">
            {config.data.reason} Nothing was asked, so nothing here is a claim about this token.
          </Callout>
        ) : null}

        {supported ? (
          page.status === "error" ? (
            <InlineError title="Couldn't read this token" message={page.error?.message ?? "This token could not be read from the chain."} onRetry={page.reload} />
          ) : (
            <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] @min-[880px]:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-3 @min-[880px]:col-span-5">
                <Card padding="none" className="p-2">
                  <NftMedia
                    tokenId={tokenId}
                    imageUrl={nftMediaAllowed ? (token?.imageUrl ?? null) : null}
                    loadMedia={nftMediaAllowed}
                    onRequestMedia={nftMediaBlockedReason ? null : () => setNftMedia(true)}
                    alt={nftTitle(tokenId, token?.name)}
                    size="detail"
                  />
                </Card>
                {nftMediaBlockedReason ? (
                  <p className="px-1 text-[12.5px] leading-snug text-[var(--z-warning)]">{nftMediaBlockedReason}</p>
                ) : !nftMedia ? (
                  <p className="px-1 text-[12.5px] leading-snug text-fg-dim">{NFT_MEDIA_PRIVACY_NOTE}</p>
                ) : null}
                {nftMediaAllowed && token?.imageUrlReason ? <p className="px-1 text-[12.5px] text-[var(--z-warning)]">{token.imageUrlReason}</p> : null}
              </div>

              <div className="flex min-w-0 flex-col gap-[var(--d-gap)] @min-[880px]:col-span-7">
                <Card>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="d-label truncate">{collectionName ?? "Collection"}</span>
                    <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-fg">
                      {page.loading && !token ? <Skeleton className="h-7 w-48 rounded-[8px]" /> : title}
                    </h2>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-dim">
                      <span className="font-mono">Token {tokenId.length > 24 ? `${tokenId.slice(0, 24)}…` : tokenId}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <ChainLogo chainId={chainId} size={14} />
                        {chain?.chainName ?? chainId}
                      </span>
                      {yours ? <Badge tone="success">In your wallet</Badge> : null}
                    </p>
                  </div>
                  {token?.error ? (
                    <Callout tone="warning" title="This token could not be read">
                      {token.error} Only its id is known here: the owner, name and traits come from that read.
                    </Callout>
                  ) : token?.description ? (
                    <p className="max-w-[70ch] whitespace-pre-line text-[14px] leading-relaxed text-fg-muted">{token.description}</p>
                  ) : !page.loading && token && !token.name ? (
                    <p className="text-[13px] text-fg-dim">
                      This contract stores no name or description on chain{nftMediaAllowed ? "" : "; turn artwork on to read the token's own metadata"}.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {account ? (
                      <Button variant="primary" iconLeft="send" disabled={blocked !== null} onClick={() => setSheet((prev) => ({ open: true, key: prev.key + 1 }))}>
                        Move this NFT
                      </Button>
                    ) : (
                      <Button variant="primary" iconLeft="wallet" onClick={() => connect.open()}>
                        Connect to move it
                      </Button>
                    )}
                    {explorerUrl ? (
                      <Button variant="secondary" href={explorerUrl} external iconRight="arrowUpRight">
                        Open in explorer
                      </Button>
                    ) : null}
                  </div>
                  {blocked && account ? (
                    <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
                      <Icon name="info" size={14} className="mt-px shrink-0" />
                      {blocked}
                    </p>
                  ) : null}
                  {!explorerUrl && config.data ? (
                    <p className="text-[12px] leading-snug text-fg-dim">
                      This deployment has no explorer for {chain?.chainName ?? chainId}, so there is no link rather than a guessed one.
                    </p>
                  ) : null}
                </Card>

                <Card>
                  <CardHeader title="Details" icon="list" />
                  <CardBody>
                    <KeyValueList divided items={facts} />
                  </CardBody>
                  {token?.metadataError ? (
                    <p className="text-[12.5px] text-[var(--z-warning)]">{token.metadataError} What is shown is what the contract stores on chain.</p>
                  ) : null}
                  {collection?.error ? <p className="text-[12.5px] text-[var(--z-warning)]">{collection.error} The collection is shown by its address.</p> : null}
                </Card>

                <Card>
                  <CardHeader title="Traits" icon="grid" subtitle={token && token.traits.length > 0 ? `${token.traits.length} on this token` : undefined} />
                  {page.loading && !token ? (
                    <div aria-hidden className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-14 rounded-[var(--d-radius-inner)]" />
                      ))}
                    </div>
                  ) : token && token.traits.length > 0 ? (
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {token.traits.map((trait, index) => (
                        <div key={`${trait.traitType}-${index}`} className="min-w-0 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3 py-2.5">
                          <dt className="d-label truncate">{trait.traitType}</dt>
                          <dd className="mt-1 truncate text-[14px] font-medium text-fg" title={trait.value}>
                            {trait.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-[13px] text-fg-dim">
                      No traits{nftMediaAllowed ? "" : " on chain; turn artwork on to read the token's own metadata, where most collections keep them"}.
                    </p>
                  )}
                </Card>
              </div>
            </div>
          )
        ) : null}

        {signed && chain ? (
          <NftTransferProgress
            chainId={signed.chainId}
            chainName={chain.chainName}
            txHash={signed.txHash}
            destChainId={signed.destChainId}
            destChainName={signed.destChainId ? (findChain(signed.destChainId)?.chainName ?? null) : null}
            bridgeContract={signed.bridgeContract}
            recipient={signed.recipient}
            txExplorerTemplate={config.data?.explorer.txTemplate ?? null}
            onReread={page.reload}
          />
        ) : null}

        {supported && chain && config.data && owner && token ? (
          <NftTransferSheet
            key={sheet.key}
            open={sheet.open}
            onOpenChange={(open) => setSheet((prev) => ({ ...prev, open }))}
            chain={chain}
            config={config.data}
            token={{ tokenId, collectionAddress: contract, collectionName, tokenName: token.name }}
            owner={owner}
            ownerMismatch={blocked}
            onSigned={(transfer) => {
              setSigned(transfer);
              page.reload();
            }}
          />
        ) : null}
      </div>
    </Page>
  );
}
