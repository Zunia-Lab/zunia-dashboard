/**
 * Resolve an amino signer across the extensions (window.zunia, window.keplr,
 * window.leap, Cosmostation's Keplr provider) and the Zunia Mobile session.
 *
 * @deprecated Pre-v2 path, kept so pages that have not moved yet keep signing.
 * New flows use `useSignAndBroadcast` (`./useSignAndBroadcast`), which picks
 * direct or amino per message and wallet, simulates gas, and confirms.
 */

import type { ConnectedAccount, LegacyMobileSession } from "@/lib/connect/context";
import { getExtensionProvider, walletLabel } from "@/lib/connect/extension";
import type { AminoSignResult } from "./sign-broadcast";
import type { StdSignDoc } from "./amino-tx";

export async function resolveSignAmino(params: {
  account: ConnectedAccount | null;
  session: LegacyMobileSession | null;
  /**
   * Chain the transaction will be signed on, when it is not the chain the
   * wallet is connected to.
   *
   * Crosschain-swap recovery is broadcast on the swap venue, not on the chain
   * the swap started from, and an extension refuses `signAmino` for a chain it
   * has not been enabled for.
   */
  signingChainId?: string;
}): Promise<(chainId: string, signer: string, signDoc: StdSignDoc) => Promise<AminoSignResult>> {
  const { account, session } = params;

  if (session) {
    return async (chainId, signer, signDoc) => {
      const result = await session.signAmino(chainId, signer, signDoc);
      return result as unknown as AminoSignResult;
    };
  }

  if (account?.mode === "extension") {
    const provider = getExtensionProvider(account.wallet);
    const signAmino = provider?.signAmino;
    if (!provider || !signAmino) {
      throw new Error(`Connected wallet cannot signAmino. Unlock ${walletLabel(account.wallet)} and retry.`);
    }
    await provider.enable(params.signingChainId ?? account.chainId);
    return async (chainId, signer, signDoc) => {
      // The chain actually signed on, which since v2 is rarely the primary
      // account's (Safrochain): enabling an approved chain does not prompt.
      if (chainId !== (params.signingChainId ?? account.chainId)) await provider.enable(chainId);
      // The fee on the page is the fee in the prompt.
      const result = await signAmino.call(provider, chainId, signer, signDoc, { preferNoSetFee: true });
      return result as AminoSignResult;
    };
  }

  throw new Error("Connect a wallet that supports signAmino first.");
}
