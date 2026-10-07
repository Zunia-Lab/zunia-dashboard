/**
 * Direct or amino: which document the wallet is asked to sign.
 *
 * Rules, in order:
 * - A message with no amino form (Osmosis poolmanager) can only be signed
 *   direct. The Zunia extension refuses `osmosis/poolmanager/*` over amino
 *   unless blind signing is on, and its direct path decodes it.
 * - A Ledger account can only sign amino.
 * - Ethereum-key chains (Injective, Evmos, Dymension, …) sign direct when the
 *   wallet can: several of their ante handlers refuse legacy amino JSON with
 *   an `ethsecp256k1` key outside EIP-712.
 * - A non-standard message (a contract call) signs direct when the wallet can,
 *   so its prompt shows the decoded call rather than a JSON blob.
 * - Everything else signs amino. That includes Zunia Mobile: the phone's
 *   amino sheet shows amounts and recipients, its direct sheet shows only
 *   message types, fee and memo (zunia-mobile native_request_sheets.dart), so
 *   amino is the more legible prompt for a standard send, stake or vote.
 */

import { isStandardMessage } from "./messages";
import type { ResolvedSignMode, SignMode, TxMessage } from "./types";

export interface SignerCapabilities {
  amino: boolean;
  direct: boolean;
  /** The key lives on a Ledger: amino only. */
  ledger?: boolean;
}

export class SignModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignModeError";
  }
}

export function chooseSignMode(
  messages: readonly Pick<TxMessage, "typeUrl" | "amino">[],
  capabilities: SignerCapabilities,
  requested: SignMode = "auto",
  options: { ethKeyChain?: boolean } = {},
): ResolvedSignMode {
  if (messages.length === 0) throw new SignModeError("Nothing to sign.");
  const allAmino = messages.every((message) => Boolean(message.amino));
  const direct = capabilities.direct && !capabilities.ledger;

  if (requested === "amino") {
    if (!allAmino) throw new SignModeError("This transaction includes a message that cannot be signed in amino mode.");
    if (!capabilities.amino) throw new SignModeError("This wallet cannot sign in amino mode.");
    return "amino";
  }
  if (requested === "direct") {
    if (capabilities.ledger) throw new SignModeError("A Ledger account can only sign in amino mode.");
    if (!capabilities.direct) throw new SignModeError("This wallet cannot sign in direct mode.");
    return "direct";
  }

  if (!allAmino) {
    if (direct) return "direct";
    throw new SignModeError(
      capabilities.ledger
        ? "A Ledger account cannot sign this transaction: one of its messages has no amino form."
        : "This wallet cannot sign this transaction type.",
    );
  }
  if (capabilities.ledger || !direct) {
    if (capabilities.amino) return "amino";
    throw new SignModeError("This wallet cannot sign this transaction.");
  }
  if (options.ethKeyChain) return "direct";
  if (messages.some((message) => !isStandardMessage(message))) return "direct";
  return capabilities.amino ? "amino" : "direct";
}
