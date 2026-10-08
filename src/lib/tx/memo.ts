/**
 * The transaction-body memo the dashboard writes when the user leaves the
 * field empty: what the transaction does, then the brand (`Send USDC.n - by
 * Zunia-dashboard`, `Swap OSMO to ATOM - by Zunia-dashboard`).
 *
 * The rules are the Zunia extension's (zunia-extension lib/tx-memo.ts):
 *
 * - A memo the user wrote is kept exactly, trimmed, and never suffixed.
 * - A transaction is named by its first message. A swap is signed first and
 *   Zunia's fee (a bank send of the token sold) after it, so a swap reads
 *   `Swap OSMO to ATOM`, never as the fee beside it; several reward claims
 *   read `Claim rewards`, as one does.
 * - The memo is on chain for good, so a token is named only when its identity
 *   is proven on the chain that holds it: by the identity the page shows for
 *   that exact chain and denom (`TxMemoContext.tokens`), or, for a chain's own
 *   staking coin on that chain, by the chain catalog. Anything else gets the
 *   generic phrase (`Send`, `IBC transfer`, `Swap`), never a name someone
 *   could have chosen.
 * - Only `tx.body.memo` is written. An ICS20 packet memo (packet-forward,
 *   ibc-hooks) lives on the message and is protocol JSON: it is read to name
 *   the transaction and never touched.
 *
 * Unlike the extension's, the whole default is printable ASCII (0x20-0x7E)
 * without `&`, `<` or `>`, and at most 256 characters (`...` when cut): a
 * Ledger's Cosmos app refuses anything else in an amino document, and the
 * chain escapes `&<>` in one (`aminoNeedsEscaping`), so a default never moves
 * the sign-mode policy or the signature check. A name that is not ASCII-safe
 * after its spaces are tidied leaves the generic phrase instead.
 *
 * Message data is read from the amino form only when it re-encodes to the
 * message's protobuf bytes exactly, so the memo names what is signed in
 * either mode. Pure; `planTx` (./flow.ts) applies it before simulating and
 * signing, and the review steps show the same string (`describeTxMemo`).
 */

import { bech32 } from "@scure/base";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { findChain } from "@/lib/chains";
import { msgProtoBytes } from "./amino-tx";
import { bytesEqual } from "./bytes";
import { encodePoolSwap, POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL, POOLMANAGER_AMINO_TYPES } from "./osmosis";
import type { SignRequest, TxMemoContext, TxMessage } from "./types";

/** The brand every default memo ends with. */
export const ZUNIA_DASHBOARD_TAG = "by Zunia-dashboard";

/** Cosmos SDK's default `MaxMemoCharacters`; a default is ASCII, so this is its byte length too. */
export const MAX_TX_MEMO_CHARS = 256;

const SUFFIX = ` - ${ZUNIA_DASHBOARD_TAG}`;
const ELLIPSIS = "...";
/** The phrase for a transaction nothing names. */
const SIGNED = "Signed";

/** Longest name of each kind a phrase takes; a longer one is not written. */
const MAX_TICKER = 32;
const MAX_CHAIN_NAME = 48;
const MAX_NFT_ID = 64;
const MAX_TYPE_NAME = 64;

const TYPE = {
  send: "/cosmos.bank.v1beta1.MsgSend",
  transfer: "/ibc.applications.transfer.v1.MsgTransfer",
  delegate: "/cosmos.staking.v1beta1.MsgDelegate",
  undelegate: "/cosmos.staking.v1beta1.MsgUndelegate",
  redelegate: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  claim: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  vote: "/cosmos.gov.v1beta1.MsgVote",
  voteV1: "/cosmos.gov.v1.MsgVote",
  execute: "/cosmwasm.wasm.v1.MsgExecuteContract",
} as const;

/** `cosmos.gov.v1beta1.VoteOption` (the same numbers in gov v1), as the vote reads. */
const VOTE_WORDS: Readonly<Record<number, string>> = { 1: "Yes", 2: "Abstain", 3: "No", 4: "No with veto" };
const VOTE_NAMES: Readonly<Record<string, number>> = {
  VOTE_OPTION_YES: 1,
  VOTE_OPTION_ABSTAIN: 2,
  VOTE_OPTION_NO: 3,
  VOTE_OPTION_NO_WITH_VETO: 4,
};

/** How deep a packet-forward memo's `next` is followed: past any route the dashboard plans. */
const MAX_FORWARD_DEPTH = 10;

type MemoMessage = Pick<TxMessage, "typeUrl" | "value" | "amino">;
type MemoSource = Pick<SignRequest, "chainId" | "memoContext"> & { readonly messages: readonly MemoMessage[] };
type MemoRequest = MemoSource & Pick<SignRequest, "memo">;

/** The memo a request signs, and where it comes from: what a review step shows. */
export interface TxMemoView {
  /** Exactly what is simulated, signed and broadcast. */
  readonly memo: string;
  /** The user left the memo empty: Zunia wrote this one. */
  readonly automatic: boolean;
}

/** {@link resolveTxMemo}, saying whether the memo is the user's or Zunia's. */
export function describeTxMemo(req: MemoRequest): TxMemoView {
  const own = (req.memo ?? "").trim();
  if (own) return { memo: own, automatic: false };
  return { memo: defaultTxMemo(req), automatic: true };
}

/**
 * The memo a request signs: the user's, trimmed, or Zunia's default for its
 * messages when that is empty. Never throws.
 */
export function resolveTxMemo(req: MemoRequest): string {
  return describeTxMemo(req).memo;
}

/** Zunia's default memo for these messages, signed on `chainId`, ending with {@link ZUNIA_DASHBOARD_TAG}. */
export function defaultTxMemo(req: MemoSource): string {
  let phrase: string;
  try {
    phrase = phraseFor(req);
  } catch {
    phrase = SIGNED;
  }
  const memo = withTag(phrase);
  return isSafeMemoText(memo) ? memo : `${SIGNED}${SUFFIX}`;
}

/** Printable ASCII without `&`, `<` or `>`: what every default memo is made of. */
export function isSafeMemoText(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text) && !/[&<>]/.test(text);
}

/** The phrase and the tag, cut with `...` so the whole stays within {@link MAX_TX_MEMO_CHARS}. */
export function withTag(phrase: string): string {
  const room = MAX_TX_MEMO_CHARS - SUFFIX.length;
  const text = phrase.length <= room ? phrase : `${phrase.slice(0, room - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
  return `${text}${SUFFIX}`;
}

/* -------------------------------------------------------------- phrases */

/**
 * What the transaction does, named by its first message: the fee send after
 * a swap and the claims after a first claim add nothing to it.
 */
function phraseFor(req: MemoSource): string {
  const first = req.messages[0];
  if (!first) return SIGNED;
  const value = readValue(first);
  const names = { chainId: req.chainId, context: req.memoContext };
  switch (first.typeUrl) {
    case TYPE.send:
      return labeled("Send", value ? onlyCoinName(value.amount, names) : null);
    case TYPE.transfer:
      return value ? transferPhrase(value, names) : "IBC transfer";
    case TYPE.delegate:
      return labeled("Stake", value ? coinName(value.amount, names) : null);
    case TYPE.undelegate:
      return labeled("Unstake", value ? coinName(value.amount, names) : null);
    case TYPE.redelegate:
      return "Move stake";
    case TYPE.claim:
      return "Claim rewards";
    case TYPE.vote:
    case TYPE.voteV1:
      return value ? votePhrase(value) : "Vote";
    case TYPE.execute:
      return value ? contractPhrase(value, names) : "Contract call";
    case POOL_SWAP_TYPE_URL:
    case POOL_SPLIT_SWAP_TYPE_URL:
      return value ? poolSwapPhrase(first.typeUrl, value, names) : "Swap";
    default:
      return shortTypeName(first.typeUrl) ?? SIGNED;
  }
}

function labeled(action: string, name: string | null): string {
  return name ? `${action} ${name}` : action;
}

/**
 * Both tokens or neither: `Swap OSMO to ATOM`, else `Swap`. Half a pair would
 * read as a claim about the other half.
 */
function swapPhrase(sold: string | null, bought: string | null): string {
  return sold && bought ? `Swap ${sold} to ${bought}` : "Swap";
}

/**
 * An ICS20 transfer: `IBC transfer of ATOM to Osmosis`. A packet memo that
 * runs the crosschain-swaps contract (`{"wasm":{…"osmosis_swap"…}}`) makes it
 * the contract path of a swap from another chain: the token it carries is
 * sold, the call's `output_denom` (an Osmosis denom) is bought.
 */
function transferPhrase(value: Record<string, unknown>, names: Names): string {
  const token = isCoin(value.token) ? value.token : null;
  const sold = token ? tokenName(names.chainId, token.denom, names.context) : null;
  const memo = jsonObject(value.memo);
  if (memo && "wasm" in memo) {
    const outputDenom = xcsOutputDenom(memo.wasm);
    if (outputDenom !== null) return swapPhrase(sold, tokenName(SWAP_VENUE_CHAIN_ID, outputDenom, names.context));
  }
  const destination = destinationName(names.context, finalReceiver(value));
  if (sold && destination) return `IBC transfer of ${sold} to ${destination}`;
  if (sold) return `IBC transfer of ${sold}`;
  if (destination) return `IBC transfer to ${destination}`;
  return "IBC transfer";
}

/** The `output_denom` of an ibc-hooks call to `osmosis_swap`, or null for any other hook. */
function xcsOutputDenom(wasm: unknown): string | null {
  if (!isRecord(wasm) || !isRecord(wasm.msg)) return null;
  const keys = Object.keys(wasm.msg);
  if (keys.length !== 1 || keys[0] !== "osmosis_swap") return null;
  const swap = wasm.msg.osmosis_swap;
  return isRecord(swap) && typeof swap.output_denom === "string" && swap.output_denom ? swap.output_denom : null;
}

/**
 * A swap in Osmosis's own pools, one route or split: the token in, and the
 * last pool's token out (every split must end in the same one).
 */
function poolSwapPhrase(typeUrl: string, value: Record<string, unknown>, names: Names): string {
  const routes = Array.isArray(value.routes) ? value.routes : [];
  const lastOut = (pools: unknown): unknown => {
    const list = Array.isArray(pools) ? pools : [];
    const last: unknown = list[list.length - 1];
    return isRecord(last) ? last.token_out_denom : undefined;
  };
  let soldDenom: unknown;
  let outs: unknown[];
  if (typeUrl === POOL_SWAP_TYPE_URL) {
    soldDenom = isCoin(value.token_in) ? value.token_in.denom : undefined;
    outs = [lastOut(routes)];
  } else {
    soldDenom = value.token_in_denom;
    outs = routes.map((route) => (isRecord(route) ? lastOut(route.pools) : undefined));
  }
  const bought = outs[0];
  if (typeof bought !== "string" || !bought || outs.some((out) => out !== bought)) return "Swap";
  return swapPhrase(tokenName(names.chainId, soldDenom, names.context), tokenName(names.chainId, bought, names.context));
}

/**
 * A CosmWasm call, by the one action its execute message names: the swap
 * contract's `osmosis_swap` (one coin sold, its `output_denom` bought, both on
 * the signing chain) and `recover`, a CW721 move (`transfer_nft`, or
 * `send_nft` to an ICS721 bridge), or `Contract call`.
 */
function contractPhrase(value: Record<string, unknown>, names: Names): string {
  const msg = isRecord(value.msg) ? value.msg : null;
  const keys = msg ? Object.keys(msg) : [];
  if (!msg || keys.length !== 1) return "Contract call";
  const action = keys[0]!;
  const body = isRecord(msg[action]) ? (msg[action] as Record<string, unknown>) : null;
  switch (action) {
    case "osmosis_swap": {
      const funds = Array.isArray(value.funds) ? value.funds : [];
      const coin: unknown = funds[0];
      if (funds.length !== 1 || !isCoin(coin) || !body || typeof body.output_denom !== "string" || !body.output_denom) return "Contract call";
      return swapPhrase(tokenName(names.chainId, coin.denom, names.context), tokenName(names.chainId, body.output_denom, names.context));
    }
    case "recover":
      return "Recover swap";
    case "transfer_nft":
    case "send_nft":
      return labeled("Send NFT", body ? safeText(body.token_id, MAX_NFT_ID) : null);
    default:
      return "Contract call";
  }
}

/** `Vote Yes on proposal 42`, from the vote's option number and proposal id. */
function votePhrase(value: Record<string, unknown>): string {
  const rawId = typeof value.proposal_id === "number" ? String(value.proposal_id) : value.proposal_id;
  const id = typeof rawId === "string" && /^\d{1,20}$/.test(rawId) ? rawId : null;
  const option = voteWord(value.option);
  if (option && id) return `Vote ${option} on proposal ${id}`;
  if (option) return `Vote ${option}`;
  if (id) return `Vote on proposal ${id}`;
  return "Vote";
}

function voteWord(raw: unknown): string | null {
  let number: number | undefined;
  if (typeof raw === "number") number = raw;
  else if (typeof raw === "string" && Object.hasOwn(VOTE_NAMES, raw)) number = VOTE_NAMES[raw];
  else if (typeof raw === "string" && /^[1-4]$/.test(raw)) number = Number(raw);
  return number !== undefined && Object.hasOwn(VOTE_WORDS, number) ? (VOTE_WORDS[number] ?? null) : null;
}

/**
 * Any other message: its type's short name in words (`MsgRevokeAllowance` →
 * `Revoke allowance`), or null when the name is not plain letters and digits.
 */
function shortTypeName(typeUrl: string): string | null {
  const name = (typeUrl.split(".").pop() ?? "").replace(/^Msg(?=[A-Z])/, "");
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((word, index) => (index > 0 && /^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word));
  return safeText(words.join(" "), MAX_TYPE_NAME);
}

/* -------------------------------------------------------------- names */

interface Names {
  /** The chain that signs: the coins of its messages are its bank denoms. */
  readonly chainId: string;
  readonly context: TxMemoContext | undefined;
}

/** The name of a message's coin (`{denom}`), or of a coin list's only coin. */
function coinName(raw: unknown, names: Names): string | null {
  return isCoin(raw) ? tokenName(names.chainId, raw.denom, names.context) : null;
}

/** A send names its coin only when it moves one: naming the first of several would leave the others out. */
function onlyCoinName(raw: unknown, names: Names): string | null {
  return Array.isArray(raw) && raw.length === 1 ? coinName(raw[0], names) : null;
}

/**
 * The ticker a coin is named by, or null for the generic phrase.
 *
 * First the identities the page passed for this exact chain and denom, all of
 * them proven and agreeing on the ticker; then, for a chain's own staking coin
 * on that chain, the catalog's symbol for it (the name the staking pages show,
 * and the coin a staking message can only move). A voucher, an unlisted token
 * or a denom nobody passed is not named.
 */
function tokenName(chainId: string, denom: unknown, context: TxMemoContext | undefined): string | null {
  if (typeof denom !== "string" || !denom) return null;
  const rows = (context?.tokens ?? []).filter((row) => row.chainId === chainId && row.denom === denom);
  const ticker = rows[0]?.ticker;
  if (ticker !== undefined && rows.every((row) => row.proven === true && row.listed !== false && row.ticker === ticker)) {
    const name = safeText(ticker, MAX_TICKER);
    if (name) return name;
  }
  const chain = findChain(chainId);
  if (!chain || chain.coinMinimalDenom !== denom || denom.includes("/")) return null;
  return safeText(chain.coinDenom, MAX_TICKER);
}

/**
 * The chain the user sends to, by its catalog name, when the transfer's last
 * receiver is an address of that chain; null otherwise.
 */
function destinationName(context: TxMemoContext | undefined, receiver: string | null): string | null {
  const chain = context?.destinationChainId ? findChain(context.destinationChainId) : undefined;
  if (!chain || !receiver) return null;
  const decoded = bech32.decodeUnsafe(receiver, 128);
  if (!decoded || decoded.prefix !== chain.bech32Prefix) return null;
  return safeText(chain.chainName, MAX_CHAIN_NAME);
}

/**
 * Who a transfer finally pays: its receiver, or with a packet-forward memo
 * the last hop's. Null when middleware other than packet-forward acts on it
 * (a contract call): the funds' last stop is then not an account.
 */
function finalReceiver(value: Record<string, unknown>): string | null {
  const receiver = typeof value.receiver === "string" ? value.receiver : null;
  let node = jsonObject(value.memo);
  // Free text (or nothing) on the packet: no middleware reads it.
  if (!node) return receiver;
  if (Object.keys(node).length === 0) return receiver;
  let last: string | null = null;
  for (let depth = 0; depth < MAX_FORWARD_DEPTH; depth++) {
    if (Object.keys(node).length !== 1 || !isRecord(node.forward)) return null;
    const forward: Record<string, unknown> = node.forward;
    if (typeof forward.receiver !== "string") return null;
    last = forward.receiver;
    const next = typeof forward.next === "string" ? jsonObject(forward.next) : forward.next;
    if (next === undefined || next === null) return last;
    if (!isRecord(next)) return null;
    node = next;
  }
  return null;
}

/* -------------------------------------------------------------- reading */

/**
 * A message's fields, from its amino form, when that form re-encodes to the
 * message's protobuf bytes exactly; null otherwise (no amino form, a type this
 * build does not encode, or two forms that disagree). Whatever is named is
 * then what a direct signature covers too.
 */
function readValue(message: MemoMessage): Record<string, unknown> | null {
  const amino = message.amino;
  if (!amino || !isRecord(amino.value) || !(message.value instanceof Uint8Array)) return null;
  try {
    let bytes: Uint8Array;
    if (Object.hasOwn(POOLMANAGER_AMINO_TYPES, message.typeUrl)) {
      if (POOLMANAGER_AMINO_TYPES[message.typeUrl] !== amino.type) return null;
      bytes = encodePoolSwap(message.typeUrl, amino.value);
    } else {
      const encoded = msgProtoBytes(amino);
      if (encoded.typeUrl !== message.typeUrl) return null;
      bytes = encoded.value;
    }
    return bytesEqual(bytes, message.value) ? amino.value : null;
  } catch {
    return null;
  }
}

/**
 * A name as the memo may carry it: spaces tidied, then printable ASCII
 * without `&<>`, within `max` characters; null otherwise. Never transliterated:
 * a name that is not ASCII is not this name without its other characters.
 */
function safeText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text && text.length <= max && isSafeMemoText(text) ? text : null;
}

function jsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoin(value: unknown): value is { denom: string; amount?: unknown } {
  return isRecord(value) && typeof value.denom === "string" && value.denom !== "";
}
