/**
 * What an NFT transfer will DO, derived from the bytes that will be signed.
 *
 * A CW721 transfer reaches the chain as a `MsgExecuteContract`: a sender, a
 * contract address, and an opaque base64 blob. A naive approval screen shows
 * "Execute contract" and a hash, which is not informed consent — the user
 * cannot tell a transfer of one token from a transfer of a different one, or
 * from an `approve` handing a stranger standing permission over the whole
 * collection.
 *
 * So this module does the same thing `memo-summary.ts` does for an ICS20 memo:
 * it takes the message that is actually going to be signed, decodes the payload
 * back out of it, and writes the sentences from the decode. The form's
 * intentions are used for exactly one thing — cross-checking the decode — and
 * never as the source of the description. If the two disagree, or if anything
 * in the payload is unaccounted for, the result is `danger` and the caller
 * disables the button.
 *
 * The message itself comes from `@zunialab/interchain`'s builders, which own
 * the CW721 and ICS721 wire shapes and the bech32-prefix checks. This file
 * builds nothing; it reads.
 */

import {
  buildNftTransferMsg,
  decodeBase64Utf8,
  isInterchainError,
  type BuiltMsg,
  type ChainInfoLike,
  type NftTransferRequest,
} from "@zunialab/interchain";

export type NftStatementTone = "neutral" | "info" | "warning" | "danger";

/** Highest tone anywhere in the description, for gating the confirm button. */
export type NftRisk = "none" | "notice" | "danger";

export interface NftStatement {
  readonly text: string;
  readonly tone: NftStatementTone;
}

/** What the decoded execute body turned out to be. */
export type NftActionKind =
  /** `{"transfer_nft": …}` — a same-chain move. */
  | "transfer_nft"
  /** `{"send_nft": …}` whose target is the configured cw-ics721 bridge. */
  | "ics721"
  /** `{"send_nft": …}` to some other contract. Not something this screen builds. */
  | "send_nft"
  /** Anything else, including a body this build cannot fully account for. */
  | "unknown";

export interface NftAction {
  readonly kind: NftActionKind;
  /** The contract the message executes: the CW721 collection. */
  readonly contract: string;
  readonly sender: string;
  /**
   * The decoded execute body.
   *
   * Handed to the amino builder, so the bytes that are signed are the bytes
   * these sentences were written from. Round-tripping through the decode is the
   * check: a payload that cannot be read back is never signed.
   */
  readonly executeMsg: Record<string, unknown>;
  readonly tokenId: string | null;
  /** Final recipient of the token, or of the voucher for an ICS721 transfer. */
  readonly recipient: string | null;
  readonly bridgeContract: string | null;
  readonly channelId: string | null;
  /** Nanosecond packet timeout, as the decoded `IbcOutgoingMsg` carries it. */
  readonly timeoutNanos: string | null;
  readonly statements: readonly NftStatement[];
  readonly warnings: readonly string[];
  readonly risk: NftRisk;
  /** The execute body, pretty-printed, for the raw disclosure. */
  readonly rawJson: string;
  /** The decoded `IbcOutgoingMsg`, pretty-printed, or null when there is none. */
  readonly innerJson: string | null;
}

export type NftActionResult =
  | { readonly ok: true; readonly action: NftAction }
  | { readonly ok: false; readonly message: string };

export interface DescribeOptions {
  /** Destination chain, so an ICS721 receiver is checked against the right prefix. */
  readonly destChain?: ChainInfoLike;
  /** The bridge this deployment configured, to confirm the `send_nft` target. */
  readonly bridgeContract?: string | null;
  /** Chain id to display name. Falls back to the id. */
  readonly chainName?: (chainId: string) => string;
  /** Collection display name, when one was read. */
  readonly collectionName?: string | null;
  /**
   * Let the engine's CosmWasm gate accept a chain with no `features` list.
   *
   * Set from exactly one thing: `/api/nft/config` answering with
   * `basis: "chain-probe"`, which means the server asked the chain and it
   * answered a wasm query. Without it the builder would refuse every chain in
   * today's catalog, because the catalog generator drops `features[]` — and
   * setting it on anything weaker than that live answer would turn the gate off
   * rather than satisfy it.
   */
  readonly allowUnknownFeatures?: boolean;
  /** Injected for tests; the ICS721 timeout is otherwise `Date.now`-relative. */
  readonly now?: () => number;
}

function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function riskOf(statements: readonly NftStatement[]): NftRisk {
  if (statements.some((line) => line.tone === "danger")) return "danger";
  if (statements.some((line) => line.tone === "warning")) return "notice";
  return "none";
}

function failed(
  contract: string,
  sender: string,
  executeMsg: Record<string, unknown>,
  statements: readonly NftStatement[],
): NftAction {
  return {
    kind: "unknown",
    contract,
    sender,
    executeMsg,
    tokenId: null,
    recipient: null,
    bridgeContract: null,
    channelId: null,
    timeoutNanos: null,
    statements,
    warnings: [],
    risk: "danger",
    rawJson: safeJson(executeMsg),
    innerJson: null,
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

/** Keys `IbcOutgoingMsg` is allowed to carry, per the engine's builder. */
const OUTGOING_KEYS = new Set(["receiver", "channel_id", "timeout", "memo"]);

/**
 * Build the transfer and describe what it does.
 *
 * The order matters and is the point: build → decode → describe. Describing the
 * request instead of the decode would mean the screen and the signature could
 * differ, which is exactly the property an approval dialog exists to rule out.
 */
export function describeNftTransfer(
  chain: ChainInfoLike,
  request: NftTransferRequest,
  options: DescribeOptions = {},
): NftActionResult {
  let built: BuiltMsg;
  try {
    built = buildNftTransferMsg(chain, request, {
      ...(options.destChain ? { destChain: options.destChain } : {}),
      ...(options.now ? { now: options.now } : {}),
      // The engine's own CosmWasm gate, left on unless the server has already
      // confirmed the chain answers wasm queries. See `allowUnknownFeatures`.
      ...(options.allowUnknownFeatures ? { allowUnknownFeatures: true } : {}),
    });
  } catch (error) {
    if (isInterchainError(error)) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The transfer message could not be built.",
    };
  }

  return { ok: true, action: describeBuiltNftMsg(built, chain, request, options) };
}

/**
 * Describe an already-built `MsgExecuteContract`.
 *
 * Split from {@link describeNftTransfer} so the refusal branches below can be
 * tested against payloads the engine would never produce. That matters: they
 * are the defence against the engine changing under us, or against a build
 * where something else assembles the message, and a branch that cannot be
 * reached by a test is a branch nobody knows works.
 *
 * `request` is used only for the intent cross-check.
 */
export function describeBuiltNftMsg(
  built: BuiltMsg,
  chain: ChainInfoLike,
  request: NftTransferRequest,
  options: DescribeOptions = {},
): NftAction {
  const value = built.value as Record<string, unknown>;
  const contract = asString(value.contract) ?? "";
  const sender = asString(value.sender) ?? "";
  const encoded = asString(value.msg);

  if (!contract || !sender || !encoded) {
    return failed(contract, sender, {}, [
      {
        text: "The built message is missing its sender, its contract or its payload. Nothing is signed from a message this build cannot read back.",
        tone: "danger",
      },
    ]);
  }

  let executeMsg: Record<string, unknown>;
  try {
    const decoded: unknown = JSON.parse(decodeBase64Utf8(encoded));
    if (!isRecord(decoded)) throw new Error("not an object");
    executeMsg = decoded;
  } catch {
    return failed(contract, sender, {}, [
      {
        text: "The contract payload could not be decoded back out of the message, so what it would do cannot be stated. It is not signed.",
        tone: "danger",
      },
    ]);
  }

  const keys = Object.keys(executeMsg);
  if (keys.length !== 1) {
    return failed(contract, sender, executeMsg, [
      {
        text: `A CW721 execute body carries exactly one action; this one carries ${keys.length} (${keys.join(", ") || "none"}). It is not signed.`,
        tone: "danger",
      },
    ]);
  }

  const action = keys[0]!;
  const chainLabel = options.chainName?.(chain.chainId) ?? chain.chainName;
  const collectionLabel = options.collectionName?.trim()
    ? `${options.collectionName.trim()} (${shorten(contract)})`
    : shorten(contract);

  if (action === "transfer_nft") {
    return describeTransferNft({
      body: executeMsg[action],
      contract,
      sender,
      executeMsg,
      chainLabel,
      collectionLabel,
      request,
    });
  }

  if (action === "send_nft") {
    return describeSendNft({
      body: executeMsg[action],
      contract,
      sender,
      executeMsg,
      chainLabel,
      collectionLabel,
      request,
      options,
    });
  }

  return failed(contract, sender, executeMsg, [
    {
      text: `This message would run "${action}" on ${collectionLabel}, which is not a transfer. Zunia only signs transfers from this screen.`,
      tone: "danger",
    },
  ]);
}

function describeTransferNft(params: {
  readonly body: unknown;
  readonly contract: string;
  readonly sender: string;
  readonly executeMsg: Record<string, unknown>;
  readonly chainLabel: string;
  readonly collectionLabel: string;
  readonly request: NftTransferRequest;
}): NftAction {
  const body = isRecord(params.body) ? params.body : null;
  const recipient = body ? asString(body.recipient) : null;
  const tokenId = body ? asString(body.token_id) : null;
  const extra = body
    ? Object.keys(body).filter((key) => key !== "recipient" && key !== "token_id")
    : [];

  if (!body || !recipient || !tokenId) {
    return failed(params.contract, params.sender, params.executeMsg, [
      {
        text: "This transfer_nft is missing its recipient or its token id, so which token would leave and where it would go cannot be stated. It is not signed.",
        tone: "danger",
      },
    ]);
  }

  if (extra.length > 0) {
    return failed(params.contract, params.sender, params.executeMsg, [
      {
        text: `This transfer_nft carries fields this build does not recognise (${extra.join(", ")}), so it cannot be fully accounted for. It is not signed.`,
        tone: "danger",
      },
    ]);
  }

  const statements: NftStatement[] = [
    {
      text: `Token ${tokenId} leaves collection ${params.collectionLabel} and becomes the property of ${recipient}.`,
      tone: "neutral",
    },
    {
      text: `This is a CW721 transfer_nft executed on ${params.chainLabel}. The token stays on ${params.chainLabel}; nothing crosses a chain.`,
      tone: "neutral",
    },
    {
      text: "Once it lands, only the new owner can move it back. There is no cancel and no recall.",
      tone: "warning",
    },
  ];

  // The form said one thing; the bytes say another. That is the case this whole
  // module exists to catch, so it outranks everything above it.
  const mismatch = intentMismatch(params.request, { recipient, tokenId });
  if (mismatch) {
    statements.unshift({ text: mismatch, tone: "danger" });
  }

  return {
    kind: "transfer_nft",
    contract: params.contract,
    sender: params.sender,
    executeMsg: params.executeMsg,
    tokenId,
    recipient,
    bridgeContract: null,
    channelId: null,
    timeoutNanos: null,
    statements,
    warnings: [],
    risk: riskOf(statements),
    rawJson: safeJson(params.executeMsg),
    innerJson: null,
  };
}

function describeSendNft(params: {
  readonly body: unknown;
  readonly contract: string;
  readonly sender: string;
  readonly executeMsg: Record<string, unknown>;
  readonly chainLabel: string;
  readonly collectionLabel: string;
  readonly request: NftTransferRequest;
  readonly options: DescribeOptions;
}): NftAction {
  const body = isRecord(params.body) ? params.body : null;
  const target = body ? asString(body.contract) : null;
  const tokenId = body ? asString(body.token_id) : null;
  const inner = body ? asString(body.msg) : null;

  if (!body || !target || !tokenId || !inner) {
    return failed(params.contract, params.sender, params.executeMsg, [
      {
        text: "This send_nft is missing its target contract, its token id or its payload, so where the token would go cannot be stated. It is not signed.",
        tone: "danger",
      },
    ]);
  }

  let outgoing: Record<string, unknown>;
  try {
    const decoded: unknown = JSON.parse(decodeBase64Utf8(inner));
    if (!isRecord(decoded)) throw new Error("not an object");
    outgoing = decoded;
  } catch {
    return failed(params.contract, params.sender, params.executeMsg, [
      {
        text: `Token ${tokenId} would be handed to ${shorten(target)} with a payload this build cannot decode. What that contract would do with it cannot be stated, so it is not signed.`,
        tone: "danger",
      },
    ]);
  }

  const innerJson = safeJson(outgoing);
  const receiver = asString(outgoing.receiver);
  const channelId = asString(outgoing.channel_id);
  const timeout = isRecord(outgoing.timeout)
    ? asString(outgoing.timeout.timestamp)
    : null;
  const unexpected = Object.keys(outgoing).filter((key) => !OUTGOING_KEYS.has(key));

  const configured = params.options.bridgeContract?.trim() || null;

  if (!receiver || !channelId || unexpected.length > 0) {
    return {
      ...failed(params.contract, params.sender, params.executeMsg, [
        {
          text:
            unexpected.length > 0
              ? `The cross-chain payload carries fields this build does not recognise (${unexpected.join(", ")}), so it cannot be fully accounted for. It is not signed.`
              : "The cross-chain payload does not name both a receiver and a channel, so where the token would arrive cannot be stated. It is not signed.",
          tone: "danger",
        },
      ]),
      innerJson,
    };
  }

  // A `send_nft` to a contract other than the one the operator configured is
  // the shape of a phishing payload: the token is handed over and the receiving
  // contract decides what happens next.
  if (configured !== null && target !== configured) {
    return {
      ...failed(params.contract, params.sender, params.executeMsg, [
        {
          text: `This would hand token ${tokenId} to ${target}, which is not the cw-ics721 bridge this deployment configured (${configured}). It is not signed.`,
          tone: "danger",
        },
      ]),
      innerJson,
    };
  }

  const destName = params.request.destChainId
    ? (params.options.chainName?.(params.request.destChainId) ??
      params.request.destChainId)
    : "the destination chain";

  const statements: NftStatement[] = [
    {
      text: `Token ${tokenId} leaves collection ${params.collectionLabel} and is handed to the cw-ics721 bridge at ${target} on ${params.chainLabel}.`,
      tone: "neutral",
    },
    {
      text: `The bridge locks it on ${params.chainLabel} and sends a packet over ${channelId}. The original token does not move to ${destName} — it stays escrowed in that bridge contract.`,
      tone: "info",
    },
    {
      text: `${destName} mints a voucher NFT to ${receiver}. The voucher is backed by the original, but it is a different token in a different contract; a marketplace on ${destName} may not recognise it, and the only way to get the original back is to send the voucher home, which burns it.`,
      tone: "warning",
    },
  ];

  if (timeout) {
    const minutes = timeoutMinutes(timeout, params.options.now);
    statements.push({
      text:
        minutes === null
          ? "If the packet is not relayed before its timeout, the bridge returns the token to you."
          : `If the packet is not relayed within about ${minutes} minute${minutes === 1 ? "" : "s"}, the bridge returns the token to you.`,
      tone: "neutral",
    });
  } else {
    statements.push({
      text: "This payload carries no packet timeout, so a packet that is never relayed has no stated deadline for returning the token.",
      tone: "warning",
    });
  }

  const warnings: string[] = [];
  if (params.request.destChainId === undefined) {
    warnings.push(
      "The destination chain was not named, so the receiver address was not checked against it.",
    );
  }
  if (configured === null) {
    warnings.push(
      "This build could not confirm the bridge address against deployment configuration.",
    );
  }

  const mismatch = intentMismatch(params.request, { recipient: receiver, tokenId });
  if (mismatch) statements.unshift({ text: mismatch, tone: "danger" });

  return {
    kind: "ics721",
    contract: params.contract,
    sender: params.sender,
    executeMsg: params.executeMsg,
    tokenId,
    recipient: receiver,
    bridgeContract: target,
    channelId,
    timeoutNanos: timeout,
    statements,
    warnings,
    risk: riskOf(statements),
    rawJson: safeJson(params.executeMsg),
    innerJson,
  };
}

/**
 * The decode against the form.
 *
 * Only two fields can differ in a way that loses the token — which token, and
 * to whom — so those are the two that are cross-checked. A difference is
 * `danger`, not a note: it means the screen above and the bytes below are
 * describing different transactions.
 */
function intentMismatch(
  request: NftTransferRequest,
  decoded: { readonly recipient: string; readonly tokenId: string },
): string | null {
  if (decoded.tokenId !== request.tokenId) {
    return `The message would move token ${decoded.tokenId}, but this screen is showing token ${request.tokenId}. It is not signed.`;
  }
  if (decoded.recipient !== request.recipient) {
    return `The message would send it to ${decoded.recipient}, but this screen is showing ${request.recipient}. It is not signed.`;
  }
  return null;
}

/** Nanoseconds-since-epoch to whole minutes from now, or null if unreadable. */
function timeoutMinutes(nanos: string, now?: () => number): number | null {
  if (!/^\d+$/.test(nanos)) return null;
  const millis = BigInt(nanos) / BigInt(1_000_000);
  const current = BigInt(Math.floor((now ?? Date.now)()));
  if (millis <= current) return 0;
  return Number((millis - current) / BigInt(60_000));
}
