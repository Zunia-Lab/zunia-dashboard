/**
 * Direct or amino: which document the wallet is asked to sign.
 *
 * Rules, in order:
 * - A message with no amino form can only be signed direct.
 * - A Ledger account can only sign amino.
 * - Ethereum-key chains (Injective, Evmos, Dymension, …) sign direct when the
 *   wallet can: several of their ante handlers refuse legacy amino JSON with
 *   an `ethsecp256k1` key outside EIP-712.
 * - The Zunia extension has its own rule (`zuniaMode` below): direct for
 *   everything except a contract call, which signs amino unless its document
 *   holds `&`, `<` or `>`.
 * - A non-standard message (a contract call, Osmosis's poolmanager, a
 *   transfer whose memo runs a contract) signs direct when the wallet can, so
 *   its prompt shows the decoded call rather than a JSON blob.
 * - Everything else signs amino. That includes Zunia Mobile: the phone's
 *   amino sheet shows amounts and recipients, its direct sheet shows only
 *   message types, fee and memo (zunia-mobile native_request_sheets.dart), so
 *   amino is the more legible prompt for a standard send, stake or vote.
 *
 * An explicit `requested` mode is honoured or refused, never silently
 * changed: the policy only decides `"auto"`.
 */

import { isStandardMessage } from "./messages";
import type { ResolvedSignMode, SignMode, TxMessage } from "./types";

/** Which wallet signs (`TxSigner.kind`). */
export type SignerKind = "zunia" | "keplr" | "zunia-mobile";

export interface SignerCapabilities {
  amino: boolean;
  direct: boolean;
  /** The key lives on a Ledger: amino only. */
  ledger?: boolean;
}

export interface SignModeOptions {
  /** The chain signs with an Ethereum key (`isEthKeyChain`). */
  ethKeyChain?: boolean;
  /** The wallet that signs; the Zunia extension has rules of its own. */
  wallet?: SignerKind;
  /** The transaction memo: part of the amino document, so part of the decision. */
  memo?: string;
}

export class SignModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignModeError";
  }
}

const EXECUTE_CONTRACT_TYPE_URL = "/cosmwasm.wasm.v1.MsgExecuteContract";
const POOLMANAGER_PREFIX = "/osmosis.poolmanager.";

/** The three characters the chain escapes in an amino document (`&`, `<`, `>`). */
const AMINO_ESCAPED = /[&<>]/;

/**
 * Whether the amino document would hold `&`, `<` or `>`.
 *
 * The chain rebuilds an amino document with Go's JSON encoder, which writes
 * those three as `&`, `<` and `>`; CosmJS, Keplr and Zunia
 * Mobile escape them the same way before signing. The Zunia extension does
 * not (zunia-extension lib/kernel.ts `serializeAminoSignDoc` @ 1453e7a, and
 * zunia-core crates/cosmos/src/amino.rs by design), so its amino signature
 * over such a document is over bytes the chain never rebuilds: refused at
 * broadcast as "signature verification failed", and no retry can help. Only
 * free text can carry them: the memo, a contract call's body, a packet memo.
 * Fees, chain ids and denoms cannot.
 */
export function aminoNeedsEscaping(
  messages: readonly Pick<TxMessage, "typeUrl" | "amino">[],
  memo: string | undefined,
): boolean {
  if (memo && AMINO_ESCAPED.test(memo)) return true;
  return messages.some((message) => message.amino !== undefined && AMINO_ESCAPED.test(JSON.stringify(message.amino)));
}

/**
 * The Zunia extension (0.1.3 on the Chrome Web Store, 0.1.4 built), until
 * zunia-core is fixed. Both of its modes have a gap, and they do not overlap:
 *
 * - Direct: its kernel decodes every message the dashboard sends (Osmosis
 *   poolmanager swaps from 0.1.4 on) except `MsgExecuteContract` to a normal
 *   32-byte CosmWasm contract, which its address check demotes to "unknown";
 *   the prompt is then refused before it opens ("Blind signing disabled for
 *   unknown messages") unless the user turned blind signing on.
 * - Amino: its summary names a contract call (`Execute "osmosis_swap" on
 *   osmo1…`, both builds), but it signs without the chain's `&<>` escaping
 *   (`aminoNeedsEscaping`).
 *
 * So a contract call signs amino (the XCS swap from Osmosis, a swap
 * recovery, an NFT transfer), and everything else signs direct, where the
 * prompt is the decoded transaction and a memo like "rent & food" is just
 * bytes. A contract call whose document holds `&<>` signs direct too: refused
 * in words before anything is signed (or blind-signed by a user who chose
 * that), never a signature the chain throws away.
 */
function zuniaMode(messages: readonly Pick<TxMessage, "typeUrl" | "amino">[], memo: string | undefined): ResolvedSignMode {
  // Poolmanager over amino is refused (its amino names are not "Msg…" types,
  // which the extension's amino summary treats as unknown); direct decodes it.
  if (messages.some((message) => message.typeUrl.startsWith(POOLMANAGER_PREFIX))) return "direct";
  const contractCall = messages.some((message) => message.typeUrl === EXECUTE_CONTRACT_TYPE_URL);
  if (contractCall && !aminoNeedsEscaping(messages, memo)) return "amino";
  return "direct";
}

export function chooseSignMode(
  messages: readonly Pick<TxMessage, "typeUrl" | "amino">[],
  capabilities: SignerCapabilities,
  requested: SignMode = "auto",
  options: SignModeOptions = {},
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
  if (options.wallet === "zunia") return capabilities.amino ? zuniaMode(messages, options.memo) : "direct";
  if (messages.some((message) => !isStandardMessage(message))) return "direct";
  return capabilities.amino ? "amino" : "direct";
}
