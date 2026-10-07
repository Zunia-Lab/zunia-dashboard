"use client";

/**
 * Opens the staking sheets from anywhere under it: `useStakingFlows().open(…)`.
 *
 * The Staking page and the validator page both mount it; the KPI tile, a row
 * menu, the idle-balance card, a deep link or a validator's "Delegate"
 * button all end in the same four sheets. Without a wallet, opening a flow
 * opens the connect modal instead (the validator page is public).
 *
 * One sheet at a time. Each open gets a fresh key, so a sheet never shows
 * the previous flow's amount; the last flow stays mounted while it closes
 * so the exit animation (and a transaction still waiting on the wallet,
 * whose toast reports the outcome) is not cut short.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { useWallet } from "@/lib/connect/context";
import { useScopeAccounts } from "@/lib/data/staking";
import { ClaimSheet } from "./ClaimSheet";
import { DelegateSheet } from "./DelegateSheet";
import { RedelegateSheet } from "./RedelegateSheet";
import { UndelegateSheet } from "./UndelegateSheet";

export type StakingFlow =
  /**
   * Claim on one chain (`chainIds` of one) or choose among several; without
   * `chainIds`, every chain of the current scope (followed live, so a link
   * opened while the wallet is still sharing its chains catches up).
   */
  | { kind: "claim"; chainIds?: string[]; validator?: string }
  | { kind: "delegate"; chainId?: string; validator?: string; amount?: string }
  | { kind: "undelegate"; chainId: string; validator: string }
  | { kind: "redelegate"; chainId: string; src?: string; dst?: string };

interface StakingFlowsApi {
  open: (flow: StakingFlow) => void;
}

const StakingFlowsContext = createContext<StakingFlowsApi | null>(null);

export function useStakingFlows(): StakingFlowsApi {
  const api = useContext(StakingFlowsContext);
  if (!api) throw new Error("useStakingFlows must be used inside StakingFlowsProvider");
  return api;
}

export function StakingFlowsProvider({ children }: { children: ReactNode }) {
  const { account } = useWallet();
  const connect = useConnectModal();
  const scope = useScopeAccounts();
  const [state, setState] = useState<{ flow: StakingFlow | null; open: boolean; key: number }>({ flow: null, open: false, key: 0 });

  const open = useCallback(
    (flow: StakingFlow) => {
      if (!account) {
        connect.open();
        return;
      }
      setState((prev) => ({ flow, open: true, key: prev.key + 1 }));
    },
    [account, connect],
  );
  const onOpenChange = useCallback((next: boolean) => setState((prev) => ({ ...prev, open: next })), []);
  const api = useMemo(() => ({ open }), [open]);

  const chainOptions = useMemo(() => scope.accounts.map((entry) => entry.chainId), [scope.accounts]);
  const { flow } = state;

  return (
    <StakingFlowsContext.Provider value={api}>
      {children}
      {flow && account ? (
        flow.kind === "claim" ? (
          <ClaimSheet key={state.key} open={state.open} onOpenChange={onOpenChange} chainIds={flow.chainIds} validator={flow.validator} />
        ) : flow.kind === "delegate" ? (
          <DelegateSheet
            key={state.key}
            open={state.open}
            onOpenChange={onOpenChange}
            chainId={flow.chainId}
            // Live, not a snapshot: accounts the wallet shares after the
            // sheet opened still become choices.
            chainOptions={flow.chainId ? [flow.chainId] : chainOptions}
            unavailable={flow.chainId ? [] : scope.skipped}
            validator={flow.validator}
            amount={flow.amount}
          />
        ) : flow.kind === "undelegate" ? (
          <UndelegateSheet key={state.key} open={state.open} onOpenChange={onOpenChange} chainId={flow.chainId} validator={flow.validator} />
        ) : (
          <RedelegateSheet key={state.key} open={state.open} onOpenChange={onOpenChange} chainId={flow.chainId} src={flow.src} dst={flow.dst} />
        )
      ) : null}
    </StakingFlowsContext.Provider>
  );
}
