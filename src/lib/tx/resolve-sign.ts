/**
 * Resolve signAmino across extension (window.zunia/keplr) and SDK sessions.
 */

import type { ZuniaSession } from "@zunialab/sdk-web";
import type { ConnectedAccount } from "@/providers/WalletProvider";
import { getExtensionProvider } from "@/lib/connect/extension";
import type { AminoSignResult } from "./sign-broadcast";
import type { StdSignDoc } from "./amino-tx";

export async function resolveSignAmino(params: {
  account: ConnectedAccount | null;
  session: ZuniaSession | null;
  /**
   * Chain the transaction will be signed on, when it is not the chain the
   * wallet is connected to.
   *
   * Crosschain-swap recovery is broadcast on the swap venue, not on the chain
   * the swap started from, and an extension refuses `signAmino` for a chain it
   * has not been enabled for. Without this the recovery fails with the
   * extension's own message, which does not say that the chain is the problem.
   */
  signingChainId?: string;
}): Promise<
  (chainId: string, signer: string, signDoc: StdSignDoc) => Promise<AminoSignResult>
> {
  const { account, session } = params;

  if (session?.signAmino) {
    return async (chainId, signer, signDoc) => {
      const result = await session.signAmino(chainId, signer, signDoc);
      return result as AminoSignResult;
    };
  }

  if (account?.mode === "extension") {
    const provider = getExtensionProvider(account.wallet);
    if (!provider?.signAmino) {
      throw new Error(
        "Connected wallet cannot signAmino. Unlock Zunia or Keplr and retry.",
      );
    }
    await provider.enable?.(params.signingChainId ?? account.chainId);
    return async (chainId, signer, signDoc) => {
      const result = await provider.signAmino!(chainId, signer, signDoc);
      return result as AminoSignResult;
    };
  }

  const fallback = getExtensionProvider();
  if (fallback?.signAmino) {
    return async (chainId, signer, signDoc) => {
      const result = await fallback.signAmino!(chainId, signer, signDoc);
      return result as AminoSignResult;
    };
  }

  throw new Error("Connect a wallet that supports signAmino first.");
}
