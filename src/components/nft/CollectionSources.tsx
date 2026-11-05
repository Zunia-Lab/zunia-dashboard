"use client";

/**
 * Adding a collection by address, and where the list came from.
 *
 * CosmWasm has no chain-level "tokens by owner" index: `tokens` is a query on
 * one contract, so a wallet can only ask about contracts whose address it
 * already has. Adding one is the action that widens the list, so it is the
 * panel; the four ways contracts are found (a list shipped with this
 * deployment, the chain's newest contract codes, an NFT index, addresses you
 * add) sit in a closed "Sources" disclosure, one line each with their real
 * state, off ones included, so a source that never ran is still readable
 * against an empty grid.
 */

import { useState } from "react";
import { checkAddress, type ChainInfoLike } from "@zunialab/interchain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Chip, Disclosure, Input } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { shortenAddress } from "@/lib/format";
import type { NftCollectionsBody, NftConfigWire, NftDiscoverySourceWire } from "@/lib/nft/wire";
import { chainScanRow } from "./scan-row";

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
        ? `${chain.chainName} addresses start with “${check.expectedPrefix}”, not “${check.prefix}”.`
        : check.problem === "bad-checksum"
          ? "Checksum fails: a character is wrong."
          : "Not a valid contract address."
      : duplicate
        ? "Already added."
        : null;

  const rows: ReadonlyArray<{ key: NftDiscoverySourceWire; label: string; state: string; on: boolean; detail: string | null }> = [
    {
      key: "known",
      label: "Listed collections",
      state: config.discovery.knownContractCount > 0 ? `${config.discovery.knownContractCount}` : "None",
      on: config.discovery.knownContractCount > 0,
      // The reader's words, not the operator's: which setting fills this list
      // is deployment documentation (`nft-config.ts`), never page copy.
      detail: null,
    },
    {
      key: "scan",
      label: "Found on chain",
      ...chainScanRow(chain.chainName, config.discovery.chainScan, result),
    },
    {
      key: "indexer",
      label: "NFT index",
      state: config.discovery.indexerConfigured ? (config.discovery.indexerName ?? "Configured") : "Not configured",
      on: config.discovery.indexerConfigured,
      detail: null,
    },
    {
      key: "user",
      label: "Added by you",
      state: userContracts.length > 0 ? `${userContracts.length}` : "None yet",
      on: userContracts.length > 0,
      detail: null,
    },
  ];

  return (
    <Card>
      <CardHeader title="Add a collection" icon="plus" />
      <CardBody className="flex flex-col gap-3">
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
            label="Contract address"
            placeholder={`${chain.bech32Prefix}1…`}
            value={draft}
            mono
            spellCheck={false}
            autoComplete="off"
            error={problem ?? undefined}
            hint={problem ? undefined : "Contract address. Kept on this browser."}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" className="self-start" disabled={!trimmed || problem !== null} iconLeft="plus">
            Check
          </Button>
        </form>

        {result && userContracts.length > result.plan.userContracts.length ? (
          <Callout tone="warning">
            Only {result.plan.userContracts.length} of your {userContracts.length} collections were checked. Remove one to make room.
          </Callout>
        ) : null}

        {result && result.issues.length > 0 ? (
          <Callout tone="warning" title={`${result.issues.length} ${result.issues.length === 1 ? "source" : "sources"} unreadable`}>
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

        <Disclosure summary="Sources">
          <ul className="mt-2 flex flex-col divide-y divide-[var(--d-hairline)]">
            {rows.map((row) => {
              const used = result?.sources.includes(row.key) ?? false;
              return (
                <li key={row.key} title={row.detail ?? undefined} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0">
                  <span className="text-[13px] text-fg">{row.label}</span>
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
                </li>
              );
            })}
          </ul>
        </Disclosure>
      </CardBody>
    </Card>
  );
}
