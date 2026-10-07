"use client";

/**
 * Where the NFT list came from, and how to widen it.
 *
 * CosmWasm has no chain-level "tokens by owner" index: `tokens` is a query on
 * one contract, so a wallet can only ask about contracts whose address it
 * already has, and a list can never be promised complete unless a real index
 * answered. The three ways in (a list shipped with this deployment, an NFT
 * index, addresses you add) are shown with their real state, including the
 * ones that are off: "no index is configured" is what an empty grid has to be
 * read against, and hiding it is how "you own no NFTs" gets drawn over a
 * query that never ran.
 */

import { useState } from "react";
import { checkAddress, type ChainInfoLike } from "@zunialab/interchain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Chip, Input } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { shortenAddress } from "@/lib/format";
import type { NftCollectionsBody, NftConfigWire, NftDiscoverySourceWire } from "@/lib/nft/wire";

/** The address field's id: the page's empty state focuses it. */
export const ADD_COLLECTION_INPUT = "nft-add-collection";

export interface CollectionSourcesProps {
  chain: ChainEntry;
  config: NftConfigWire;
  /** Null until discovery has answered; the panel still says what is configured. */
  result: NftCollectionsBody | null;
  userContracts: readonly string[];
  onAddContract: (address: string) => void;
  onRemoveContract: (address: string) => void;
}

export function CollectionSources({ chain, config, result, userContracts, onAddContract, onRemoveContract }: CollectionSourcesProps) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const check = trimmed ? checkAddress(trimmed, chain as ChainInfoLike) : null;
  const duplicate = trimmed.length > 0 && userContracts.includes(trimmed);
  const problem = !trimmed
    ? null
    : check && !check.ok
      ? check.problem === "wrong-prefix"
        ? `That is a “${check.prefix}” address; ${chain.chainName} uses “${check.expectedPrefix}”.`
        : check.problem === "bad-checksum"
          ? "That address fails its own checksum: a character is wrong."
          : "That is not a bech32 contract address."
      : duplicate
        ? "That collection is already in the list."
        : null;

  const rows: ReadonlyArray<{ key: NftDiscoverySourceWire; label: string; state: string; on: boolean; detail: string | null }> = [
    {
      key: "known",
      label: "Collections this deployment lists",
      state: config.discovery.knownContractCount > 0 ? `${config.discovery.knownContractCount}` : "None",
      on: config.discovery.knownContractCount > 0,
      // The reader's words, not the operator's: which setting fills this list
      // is deployment documentation (`nft-config.ts`), never page copy.
      detail:
        config.discovery.knownContractCount > 0
          ? null
          : `This deployment lists no collections for ${chain.chainName}, so none are asked this way.`,
    },
    {
      key: "indexer",
      label: "NFT index",
      state: config.discovery.indexerConfigured ? (config.discovery.indexerName ?? "Configured") : "Not configured",
      on: config.discovery.indexerConfigured,
      detail: config.discovery.indexerConfigured
        ? "An index can say which contracts hold your tokens: the only way this list can be complete."
        : "No NFT index on this deployment. Without one, the list covers only contracts whose address is known.",
    },
    {
      key: "user",
      label: "Collections you added",
      state: userContracts.length > 0 ? `${userContracts.length}` : "None yet",
      on: userContracts.length > 0,
      detail: null,
    },
  ];

  return (
    <Card>
      <CardHeader title="Where this list comes from" subtitle={`How Zunia looks for NFTs on ${chain.chainName}`} icon="search" />
      <CardBody className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
          {rows.map((row) => {
            const used = result?.sources.includes(row.key) ?? false;
            return (
              <li key={row.key} className="flex flex-col gap-1 py-2.5 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-[13.5px] font-medium text-fg">{row.label}</span>
                  <span className="flex items-center gap-1.5">
                    {used ? (
                      <Badge tone="success" icon="check">
                        Found tokens
                      </Badge>
                    ) : null}
                    <Badge tone="neutral" variant={row.on ? "soft" : "outline"}>
                      {row.state}
                    </Badge>
                  </span>
                </div>
                {row.detail ? <p className="text-[12.5px] leading-snug text-fg-dim">{row.detail}</p> : null}
              </li>
            );
          })}
        </ul>

        {userContracts.length > 0 ? (
          <ul aria-label="Collections you added" className="flex flex-wrap gap-1.5">
            {userContracts.map((address) => (
              <li key={address} title={address}>
                <Chip onRemove={() => onRemoveContract(address)} removeLabel={`Stop checking ${address}`}>
                  <span className="font-mono text-[12px]">{shortenAddress(address, 10, 6)}</span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || problem) return;
            onAddContract(trimmed);
            setDraft("");
          }}
        >
          <Input
            id={ADD_COLLECTION_INPUT}
            label="Add a collection by contract address"
            placeholder={`${chain.bech32Prefix}1…`}
            value={draft}
            mono
            spellCheck={false}
            autoComplete="off"
            error={problem ?? undefined}
            hint={problem ? undefined : "Zunia asks that contract whether your address holds anything in it. Kept on this browser only."}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" className="self-start" disabled={!trimmed || problem !== null} iconLeft="plus">
            Check this collection
          </Button>
        </form>

        {result && userContracts.length > result.plan.userContracts.length ? (
          <Callout tone="warning" title="Not every collection you added was checked">
            {result.plan.userContracts.length} of your {userContracts.length} were asked in this pass. The rest are not part of the list either
            way: remove one to make room.
          </Callout>
        ) : null}

        {result ? (
          result.complete ? (
            <Callout tone="success" title="This list is complete">
              An index answered for this address, so every collection it holds something in is listed.
            </Callout>
          ) : (
            <Callout tone="neutral" title="This list may not be complete">
              {result.limitation ?? "Only contracts Zunia already knows about were checked."}
            </Callout>
          )
        ) : null}

        {result && result.issues.length > 0 ? (
          <Callout tone="warning" title={`${result.issues.length} ${result.issues.length === 1 ? "source" : "sources"} could not be read`}>
            <ul className="flex flex-col gap-1">
              {result.issues.map((issue) => (
                <li key={`${issue.contractAddress ?? "source"}-${issue.message}`}>
                  <span className="font-mono text-[12px] text-fg">{issue.contractAddress ? shortenAddress(issue.contractAddress, 10, 6) : "Index"}</span> —{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}
