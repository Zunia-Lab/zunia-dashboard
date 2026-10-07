/**
 * Checking an account address against the chain it is read on. Pure, so the
 * rules are tested; `accounts.ts` turns a refusal into the route's 400.
 *
 * The prefix part allows `_` and `@` because the catalog has `addr_safro`
 * (Safrochain, the home chain) and `lava@` (Lava). `validate.ts`'s
 * `parseAddress` refuses both today, which is why the portfolio routes check
 * addresses here, with the same rules otherwise: bech32 checksum, the chain's
 * own prefix, 20 or 32 bytes.
 */

import { bech32 } from "bech32";

const ADDRESS_SHAPE = /^[a-z0-9_@]{1,40}1[a-z0-9]{6,120}$/;

export type AddressCheck =
  | { ok: true; address: string }
  | { ok: false; code: "address_required" | "address_invalid" | "address_prefix"; message: string };

export function checkChainAddress(raw: string, chain: { chainId: string; bech32Prefix: string }): AddressCheck {
  const value = raw.trim();
  if (!value) return { ok: false, code: "address_required", message: "address is required" };
  if (!ADDRESS_SHAPE.test(value)) {
    return { ok: false, code: "address_invalid", message: "address is not a bech32 address" };
  }
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(value, 200);
  } catch {
    return { ok: false, code: "address_invalid", message: "address is not a bech32 address" };
  }
  const bytes = bech32.fromWords(decoded.words).length;
  if (bytes !== 20 && bytes !== 32) {
    return { ok: false, code: "address_invalid", message: "address has an unexpected length" };
  }
  if (decoded.prefix !== chain.bech32Prefix) {
    return {
      ok: false,
      code: "address_prefix",
      message: `address for ${chain.chainId} must start with ${chain.bech32Prefix}1`,
    };
  }
  return { ok: true, address: value };
}
