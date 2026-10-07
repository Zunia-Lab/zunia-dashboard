/**
 * Deep links into Send, Bridge and Receive, read on the server from the
 * page's search params and handed to the client body as plain props.
 *
 * Shapes accepted (every part optional):
 *
 * - `/bridge?from=cosmoshub-4&to=osmosis-1&amount=12.5&asset=uatom`
 * - `/bridge?from=osmosis-1:ibc/27394…&to=osmosis-1` — the swap page's row
 *   keys (`chainId:denom`); the chain is the part before the first ":".
 * - `/send?asset=cosmoshub-4:uatom&to=osmo1…&amount=1`
 * - `/receive?chain=osmosis-1`
 *
 * Everything is shape-checked here and checked again against the catalog and
 * the wallet's balances on the client: a link is a suggestion, never an
 * instruction to sign.
 */

export interface TransferPrefill {
  /** Source chain id. */
  from?: string;
  /** Destination chain id (Bridge). */
  to?: string;
  /** Denom on the source chain. */
  denom?: string;
  /** Display units, digits and one ".". */
  amount?: string;
  /** A recipient address (Send). */
  recipient?: string;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const CHAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DENOM = /^[A-Za-z0-9][A-Za-z0-9/:._-]{0,255}$/;
const AMOUNT = /^\d{1,30}(\.\d{1,30})?$/;
const ADDRESS = /^[a-z0-9_@.-]{1,40}1[02-9ac-hj-np-z]{6,100}$/;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** `chainId` or `chainId:denom`. */
function splitKey(value: string | undefined): { chainId?: string; denom?: string } {
  if (!value) return {};
  const at = value.indexOf(":");
  const chainId = at === -1 ? value : value.slice(0, at);
  const denom = at === -1 ? undefined : value.slice(at + 1);
  return {
    ...(CHAIN_ID.test(chainId) ? { chainId } : {}),
    ...(denom && DENOM.test(denom) ? { denom } : {}),
  };
}

function amountOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normal = value.replace(",", ".");
  return AMOUNT.test(normal) ? normal : undefined;
}

/** Bridge: `from`, `to`, `amount`, `asset` (or `denom`). */
export function readBridgePrefill(params: SearchParams): TransferPrefill {
  const from = splitKey(first(params.from));
  const to = splitKey(first(params.to));
  const asset = first(params.asset) ?? first(params.denom);
  const assetKey = asset?.includes(":") ? splitKey(asset) : { denom: asset && DENOM.test(asset) ? asset : undefined };
  const denom = assetKey.denom ?? from.denom;
  const amount = amountOf(first(params.amount));
  return {
    ...(from.chainId ? { from: from.chainId } : assetKey.chainId ? { from: assetKey.chainId } : {}),
    ...(to.chainId ? { to: to.chainId } : {}),
    ...(denom ? { denom } : {}),
    ...(amount ? { amount } : {}),
  };
}

/** Send: `asset` (`chainId:denom`), `chain`, `to` (an address), `amount`. */
export function readSendPrefill(params: SearchParams): TransferPrefill {
  const asset = splitKey(first(params.asset));
  const chain = splitKey(first(params.chain) ?? first(params.from));
  const recipient = first(params.to) ?? first(params.recipient);
  const amount = amountOf(first(params.amount));
  const fromChain = asset.chainId ?? chain.chainId;
  return {
    ...(fromChain ? { from: fromChain } : {}),
    ...(asset.denom ? { denom: asset.denom } : {}),
    ...(recipient && ADDRESS.test(recipient.toLowerCase()) ? { recipient: recipient.toLowerCase() } : {}),
    ...(amount ? { amount } : {}),
  };
}

/** Receive: `chain`. */
export function readReceiveChain(params: SearchParams): string | undefined {
  const chain = splitKey(first(params.chain)).chainId;
  return chain;
}
