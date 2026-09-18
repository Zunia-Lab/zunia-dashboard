"use client";

/**
 * One NFT: what it is, who owns it, and how to move it.
 *
 * Everything on this page is read from the chain through `/api/nft/tokens`,
 * which runs `all_nft_info` — so the owner shown is the owner the contract
 * reports, not the owner this browser assumed when it listed the token. That
 * distinction is what makes the transfer control safe to enable: a token that
 * has already moved is a disabled button with a sentence, not a transaction the
 * chain rejects after the wallet has been opened.
 *
 * Off-chain metadata is read only when the user has turned artwork on. Without
 * it, name and description come from the contract's on-chain `extension`, which
 * is often empty — so an unnamed token here is normal and is said to be normal,
 * rather than looking like a failed load.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  NftDetail,
  NFT_MEDIA_PRIVACY_NOTE,
  Skeleton,
  truncateAddress,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import {
  NftTransferDialog,
  type NftSignedTransfer,
} from "@/components/nft/NftTransferDialog";
import { NftTransferProgress } from "@/components/nft/NftTransferProgress";
import { reencodeAddress } from "@/lib/address";
import { findChain } from "@/lib/chains";
import { useNftConfig, useNftTokens } from "@/lib/nft/hooks";
import { fillTemplate } from "@/lib/nft/parse-config";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function NftDetailPage() {
  const params = useParams();
  const chainId = decodeURIComponent(param(params.chainId));
  const contract = decodeURIComponent(param(params.contract));
  const tokenId = decodeURIComponent(param(params.tokenId));

  const { account } = useWallet();
  const { nftMedia, setNftMedia, nftMediaAllowed, nftMediaBlockedReason } =
    usePrefs();

  const [transferOpen, setTransferOpen] = useState(false);
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

  const owner = useMemo(() => {
    if (!account || !chain) return null;
    const accountChain = findChain(account.chainId);
    if (!accountChain) return null;
    if (accountChain.chainId === chain.chainId) return account.address;
    return reencodeAddress(account.address, chain, accountChain);
  }, [account, chain]);

  /** Why this account may not move this token, in one sentence, or null. */
  const ownerBlocked = useMemo(() => {
    if (!account) return "Connect a wallet to move this token.";
    if (!chain) {
      return `${chainId} is not in this build's chain catalog, so no transaction can be built for it.`;
    }
    if (!owner) {
      return `The connected account cannot be re-encoded for ${chain.chainName}: it uses a different coin type, so it is a different key.`;
    }
    if (page.loading) return "Reading who owns this token…";
    if (token?.error) {
      return `${token.error} Zunia will not offer to move a token whose owner it could not read.`;
    }
    if (!token?.owner) {
      return "The contract did not report an owner for this token, so Zunia cannot confirm it is yours.";
    }
    if (token.owner !== owner) {
      return `This token belongs to ${truncateAddress(token.owner)}, not to the connected account.`;
    }
    return null;
  }, [account, chain, chainId, owner, page.loading, token]);

  const collectionName =
    collection?.name?.trim() ||
    collection?.symbol?.trim() ||
    null;

  const explorerUrl = config.data?.explorer.nftTemplate
    ? fillTemplate(config.data.explorer.nftTemplate, {
        contract,
        tokenId,
        chainId,
      })
    : null;

  const title = token?.name?.trim() || `#${tokenId}`;

  return (
    <DashboardShell
      title={title}
      description={`${collectionName ?? truncateAddress(contract, 8, 6)} · ${chain?.chainName ?? chainId}`}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Link
          href="/nfts"
          className="self-start font-mono text-[length:var(--z-type-micro)] uppercase tracking-wider text-fg-muted underline underline-offset-2 hover:text-fg"
        >
          ← All NFTs
        </Link>

        {config.loading ? (
          <Card>
            <div aria-busy="true">
              <span className="sr-only">Checking this chain</span>
              <Skeleton className="h-16 w-full rounded-[14px]" />
            </div>
          </Card>
        ) : null}

        {config.status === "error" ? (
          <Callout tone="danger" title="Could not check this chain">
            {config.error?.message}{" "}
            <button
              type="button"
              onClick={config.reload}
              className="underline underline-offset-2"
            >
              Try again
            </button>
          </Callout>
        ) : null}

        {config.data && config.data.status === "unsupported" ? (
          <Callout tone="neutral" title="This chain cannot hold NFTs">
            {config.data.reason}
          </Callout>
        ) : null}

        {config.data && config.data.status === "unverified" ? (
          <Callout
            tone="warning"
            title="Zunia cannot tell whether this chain runs CosmWasm"
          >
            {config.data.reason} Nothing was queried, so nothing below is a claim
            about this token.
          </Callout>
        ) : null}

        {supported ? (
          <Card>
            <NftDetail
              tokenId={tokenId}
              name={token?.name ?? null}
              collectionAddress={contract}
              collectionName={collectionName}
              chainId={chainId}
              imageUrl={nftMediaAllowed ? (token?.imageUrl ?? null) : null}
              description={token?.description ?? null}
              owner={token?.owner ?? null}
              traits={token?.traits ?? []}
              loadMedia={nftMediaAllowed}
              {...(nftMediaBlockedReason
                ? {}
                : { onRequestMedia: () => setNftMedia(true) })}
              tokenUri={token?.tokenUri ?? null}
              loading={page.loading}
              error={
                page.status === "error"
                  ? (page.error?.message ??
                    "This token could not be read from the chain.")
                  : null
              }
              actions={
                <>
                  <Button
                    onClick={() => setTransferOpen(true)}
                    disabled={ownerBlocked !== null}
                    {...(ownerBlocked
                      ? { "aria-describedby": "nft-transfer-reason" }
                      : {})}
                  >
                    Move this NFT
                  </Button>
                  {explorerUrl ? (
                    <Button variant="secondary" asChild>
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open in explorer
                      </a>
                    </Button>
                  ) : null}
                </>
              }
            />

            <div className="mt-3 flex flex-col gap-2">
              {ownerBlocked ? (
                <p
                  id="nft-transfer-reason"
                  className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
                >
                  {ownerBlocked}
                </p>
              ) : null}

              {!explorerUrl ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim">
                  No explorer is configured for {chain?.chainName ?? chainId} (
                  <code>{config.data?.configKeys.nftExplorer}</code>), so there
                  is no link. Zunia will not guess an explorer domain and point
                  your token at it.
                </p>
              ) : null}

              {nftMediaBlockedReason ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
                  {nftMediaBlockedReason}
                </p>
              ) : !nftMedia ? (
                <p className="m-0 text-[length:var(--z-type-micro)] leading-relaxed text-fg-muted">
                  {NFT_MEDIA_PRIVACY_NOTE}
                </p>
              ) : null}

              {token?.metadataError ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
                  {token.metadataError} What is shown above is what the contract
                  stores on chain.
                </p>
              ) : null}

              {token?.imageUrlReason ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
                  {token.imageUrlReason}
                </p>
              ) : null}

              {nftMediaAllowed && token?.metadataSource === "remote" ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim">
                  Name, description and traits were read from the token&rsquo;s
                  own metadata host by Zunia&rsquo;s server. Anything the
                  contract stores on chain takes precedence over it.
                </p>
              ) : null}

              {collection?.error ? (
                <p className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
                  {collection.error} The collection is shown by its address.
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {signed && chain ? (
          <Card>
            <NftTransferProgress
              chainId={signed.chainId}
              chainName={chain.chainName}
              txHash={signed.txHash}
              destChainId={signed.destChainId}
              destChainName={
                signed.destChainId
                  ? (findChain(signed.destChainId)?.chainName ?? null)
                  : null
              }
              bridgeContract={signed.bridgeContract}
              recipient={signed.recipient}
              txExplorerTemplate={config.data?.explorer.txTemplate ?? null}
            />
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={page.reload}>
                Re-read this token from the chain
              </Button>
            </div>
          </Card>
        ) : null}

        {supported && chain && config.data && owner && token ? (
          <NftTransferDialog
            open={transferOpen}
            onOpenChange={setTransferOpen}
            chain={chain}
            config={config.data}
            token={{
              tokenId,
              collectionAddress: contract,
              collectionName,
              tokenName: token.name,
            }}
            owner={owner}
            ownerMismatch={ownerBlocked}
            onSigned={(transfer) => {
              setSigned(transfer);
              page.reload();
            }}
          />
        ) : null}
      </div>
    </DashboardShell>
  );
}
