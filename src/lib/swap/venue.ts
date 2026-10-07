/**
 * The verdict on the crosschain-swaps contract the venue check read, as pure
 * rules: what the Osmosis LCD must answer for a contract address before Zunia
 * puts that address in a swap memo.
 *
 * The reading (and its cache) is src/lib/server/swap/venue.ts; the rules live
 * here, without I/O, so they are tested on their own. Every reason is shown to
 * users as is, so none names a setting, a host or an upstream body.
 */

import {
  SWAP_VENUE_CHAIN_ID,
  XCS_CONTRACT_CODE_IDS,
  XCS_CONTRACT_LABEL_PREFIX,
} from "@/config/interchain";
import { isRecord } from "@/lib/swap/types";
import type { SwapVenueWire } from "@/lib/swap/wire";

export interface SwapVenue extends SwapVenueWire {
  /** The verified contract address, or `null` when the contract path is off. */
  readonly address: string | null;
}

/** A venue the contract path cannot use, for `reason`. */
export function venueOff(
  address: string | null,
  reason: string,
  label: string | null = null,
  codeId: string | null = null,
): SwapVenue {
  return {
    chainId: SWAP_VENUE_CHAIN_ID,
    address: null,
    contract: address ? { address, verified: false, label, codeId } : null,
    reason,
  };
}

/**
 * The verdict on one LCD answer for `/cosmwasm/wasm/v1/contract/{address}`:
 * the answer must echo the address, carry contract info, a label starting
 * with `XCS_CONTRACT_LABEL_PREFIX` and a code id in `XCS_CONTRACT_CODE_IDS`.
 * The label alone is not enough: it is set at instantiation and survives a
 * migration, which this deployment's admin (a plain account) can make at any
 * time.
 */
export function venueFromContractInfo(address: string, body: unknown): SwapVenue {
  const info = isRecord(body) && isRecord(body.contract_info) ? body.contract_info : null;
  const label = info && typeof info.label === "string" ? info.label : null;
  const rawCode = info?.code_id;
  const codeId =
    (typeof rawCode === "string" && /^\d{1,20}$/.test(rawCode)) ||
    (typeof rawCode === "number" && Number.isSafeInteger(rawCode) && rawCode >= 0)
      ? String(rawCode)
      : null;
  const echoed = isRecord(body) && typeof body.address === "string" ? body.address : null;
  if (!info || echoed !== address) {
    return venueOff(address, "Osmosis answered for its swap contract with something Zunia could not read, so contract swaps stay off.");
  }
  if (!label || !label.startsWith(XCS_CONTRACT_LABEL_PREFIX)) {
    return venueOff(
      address,
      `The contract at ${address} is labelled "${(label ?? "").slice(0, 60)}", not a CrossChainSwaps contract, so Zunia will not route a swap through it.`,
      label === null ? null : label.slice(0, 60),
      codeId,
    );
  }
  if (!codeId || !XCS_CONTRACT_CODE_IDS.includes(codeId)) {
    return venueOff(
      address,
      `The swap contract at ${address} now runs ${codeId ? `code ${codeId}` : "code Osmosis did not name"}, not the code Zunia was reviewed against, so contract swaps stay off until that code has been checked.`,
      label,
      codeId,
    );
  }
  return {
    chainId: SWAP_VENUE_CHAIN_ID,
    address,
    contract: { address, verified: true, label, codeId },
    reason: null,
  };
}
