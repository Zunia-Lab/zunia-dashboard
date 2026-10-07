"use client";

/**
 * Networks: which chains the dashboard reads, and which slice (mainnet or
 * testnet) the rail and the All-chains totals cover. Following is managed on
 * /networks, where the order and the catalog live; here is the summary.
 */

import { Button, LogoStack, Segmented } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { SettingRow, SettingsSection } from "./SettingsBlocks";

export function NetworksSection() {
  const { network, setNetwork, followedAll } = useChainScope();
  const chains = followedAll.map((chainId) => findChain(chainId)).filter((chain) => chain !== undefined);
  const mainnets = chains.filter((chain) => chain.network === "mainnet").length;
  const testnets = chains.length - mainnets;

  return (
    <SettingsSection id="networks" title="Networks" subtitle="Which chains the dashboard reads" icon="networks">
      <SettingRow
        title="Followed networks"
        description={
          chains.length === 0
            ? "None yet. Follow at least one network to see balances, staking and activity."
            : `${mainnets} ${mainnets === 1 ? "mainnet" : "mainnets"}${testnets > 0 ? ` and ${testnets} ${testnets === 1 ? "testnet" : "testnets"}` : ""}. Choose and order them on Networks.`
        }
        control={
          <>
            {chains.length > 0 ? (
              <LogoStack
                items={chains.map((chain) => ({ src: chain.iconUrl, label: chain.chainName }))}
                size={22}
                max={5}
                label={`${chains.length} followed networks`}
              />
            ) : null}
            <Button size="sm" variant="secondary" href="/networks" iconRight="arrowRight">
              Manage
            </Button>
          </>
        }
      />
      <SettingRow
        title="Mainnet or testnet"
        description="Which slice the rail and the All-chains totals cover. Testnet balances never count toward net worth."
        control={
          <Segmented<"mainnet" | "testnet">
            ariaLabel="Network slice"
            size="md"
            value={network}
            onChange={setNetwork}
            options={[
              { value: "mainnet", label: "Mainnet" },
              { value: "testnet", label: "Testnet" },
            ]}
          />
        }
      />
    </SettingsSection>
  );
}
