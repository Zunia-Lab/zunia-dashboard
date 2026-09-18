/**
 * What the memo will DO, said in plain language, derived in the browser.
 *
 * This is a security control, not a caption. The route is planned server-side,
 * so the memo the user signs arrives over the network; if the approval screen
 * showed the server's description of that memo, a compromised or stale server
 * could describe one thing and hand over another. So the memo bytes are
 * re-parsed here with the engine's own `validateMemo` and every sentence below
 * is derived from the parse, never from anything else in the response.
 *
 * The rule for the copy: name the contract, name where the funds end up, and
 * name what happens when it fails. A memo the parser cannot fully account for
 * is `danger`, never "probably fine".
 */

import {
  validateMemo,
  type MemoKind,
  type XcsFailedDelivery,
  type XcsSlippage,
} from "@zunialab/interchain";

export type MemoTone = "neutral" | "info" | "warning" | "danger";

/** Highest tone anywhere in the explanation, for gating the confirm button. */
export type MemoRisk = "none" | "notice" | "danger";

export interface MemoStatement {
  readonly text: string;
  readonly tone: MemoTone;
}

export interface MemoExplanation {
  readonly kind: MemoKind;
  /** One line, safe to render as a heading. */
  readonly headline: string;
  /** The sentences that make up "what this will do", in execution order. */
  readonly statements: readonly MemoStatement[];
  /** `validateMemo`'s own warnings, verbatim. */
  readonly warnings: readonly string[];
  readonly risk: MemoRisk;
  readonly byteLength: number;
  /** True when a `forward` object is present. */
  readonly requiresPfm: boolean;
  /** True when a `wasm` object is present. */
  readonly requiresIbcHooks: boolean;
  /** The memo exactly as it will be signed, for the raw disclosure. */
  readonly raw: string;
}

export interface ExplainMemoOptions {
  /**
   * The ICS20 receiver of the transfer that carries this memo.
   *
   * Passed through to `validateMemo`, which cross-checks it: ibc-hooks only
   * runs when the receiver is `""` or the contract address, and a mismatch
   * means the hook is skipped and the funds land at the receiver instead.
   */
  readonly receiver?: string;
  /** Chain id to display name. Falls back to the id. */
  readonly chainName?: (chainId: string) => string;
  /** Denom to a symbol the user recognises. Falls back to the denom. */
  readonly denomLabel?: (denom: string) => string;
  /** Chain the swap venue runs on, for "Osmosis will run …". */
  readonly venueChainId?: string;
}

function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function describeSlippage(slippage: XcsSlippage): string {
  if (slippage.kind === "min_output_amount") {
    return `the swap is rejected below ${slippage.minOutputAmount} base units of output`;
  }
  return `the swap is rejected if the price moves more than ${slippage.slippagePercentage}% against the ${slippage.windowSeconds}-second average`;
}

function describeFailedDelivery(
  onFailedDelivery: XcsFailedDelivery,
): MemoStatement {
  if (onFailedDelivery.kind === "local_recovery_addr") {
    return {
      tone: "info",
      text:
        `If the swap succeeds but the payout transfer fails, the output is held by the contract and only ` +
        `${shorten(onFailedDelivery.address)} can claim it back.`,
    };
  }
  return {
    tone: "danger",
    text:
      "If the swap succeeds but the payout transfer fails, this memo tells the contract to do nothing — " +
      "the funds would be stranded with no way to reclaim them. Do not sign this.",
  };
}

const RISK_ORDER: Record<MemoTone, number> = {
  neutral: 0,
  info: 0,
  warning: 1,
  danger: 2,
};

function riskOf(statements: readonly MemoStatement[], hasWarnings: boolean): MemoRisk {
  let worst = 0;
  for (const statement of statements) {
    worst = Math.max(worst, RISK_ORDER[statement.tone]);
  }
  if (worst >= 2) return "danger";
  if (worst === 1 || hasWarnings) return "notice";
  return "none";
}

/**
 * Explain a memo from its bytes.
 *
 * @param memo - The memo exactly as it will be signed.
 * @returns An explanation whose `risk` is `danger` whenever the memo is one
 *   this build cannot fully account for. An unreadable memo is never described
 *   as harmless: unknown middleware is still middleware, and it still decides
 *   where the money goes.
 */
export function explainMemo(
  memo: string,
  options: ExplainMemoOptions = {},
): MemoExplanation {
  const raw = typeof memo === "string" ? memo : "";
  const inspection = validateMemo(raw, {
    ...(options.receiver === undefined ? {} : { receiver: options.receiver }),
  });
  const chainName = options.chainName ?? ((id: string) => id);
  const denomLabel = options.denomLabel ?? ((denom: string) => denom);
  const statements: MemoStatement[] = [];

  if (inspection.kind === "empty") {
    return {
      kind: inspection.kind,
      headline: "No memo",
      statements: [
        {
          tone: "neutral",
          text: "This transfer carries no memo, so no middleware acts on it. The funds land at the receiver.",
        },
      ],
      warnings: inspection.warnings,
      risk: riskOf([], inspection.warnings.length > 0),
      byteLength: inspection.byteLength,
      requiresPfm: false,
      requiresIbcHooks: false,
      raw,
    };
  }

  if (inspection.kind === "plain-text") {
    return {
      kind: inspection.kind,
      headline: "Plain text memo",
      statements: [
        {
          tone: "neutral",
          text: "The memo is free text. No IBC middleware reads it, so the funds land at the receiver.",
        },
      ],
      warnings: inspection.warnings,
      risk: riskOf([], inspection.warnings.length > 0),
      byteLength: inspection.byteLength,
      requiresPfm: false,
      requiresIbcHooks: false,
      raw,
    };
  }

  if (inspection.forward) {
    const hops = inspection.forward.hops;
    hops.forEach((hop, index) => {
      const last = index === hops.length - 1;
      statements.push({
        tone: "neutral",
        text: last
          ? `On arrival, packet-forward-middleware sends the funds on over ${hop.channelId} to ${shorten(hop.receiver)}.`
          : `On arrival, packet-forward-middleware sends the funds on over ${hop.channelId} (hop ${index + 1} of ${hops.length}).`,
      });
    });
    if (inspection.forward.finalReceiver === "pfm") {
      statements.push({
        tone: "danger",
        text: 'The last hop is addressed to the literal string "pfm", which is not an account. The funds would be unrecoverable.',
      });
    }
  }

  if (inspection.xcs) {
    const xcs = inspection.xcs;
    const venue = options.venueChainId
      ? chainName(options.venueChainId)
      : "the swap venue";
    statements.push({
      tone: "neutral",
      text: `${venue} runs contract ${shorten(xcs.contract)} on the arriving funds. You do not need an account or gas there — the relayer pays for that call inside packet processing.`,
    });
    statements.push({
      tone: "neutral",
      text: `The contract swaps them for ${denomLabel(xcs.outputDenom)} and sends the result to ${shorten(xcs.receiver)}.`,
    });
    statements.push({
      tone: "neutral",
      text: `Tolerance: ${describeSlippage(xcs.slippage)}.`,
    });
    statements.push(describeFailedDelivery(xcs.onFailedDelivery));
    if (xcs.hasNextMemo) {
      statements.push({
        tone: "info",
        text: "After the swap the output is forwarded again, so the payout address above is not the last stop.",
      });
    }
  } else if (inspection.wasm) {
    const wasm = inspection.wasm;
    statements.push({
      tone: "warning",
      text:
        `The memo calls contract ${shorten(wasm.contract)} with "${wasm.msgKeys.join(", ")}". ` +
        "This build cannot say what that call does with the funds.",
    });
  }

  if (inspection.kind === "unknown") {
    statements.push({
      tone: "danger",
      text:
        "Part of this memo could not be read. Middleware acts on it before the funds reach anyone, " +
        "so this build cannot tell you where they end up. Do not sign it.",
    });
  }

  const headline =
    inspection.kind === "xcs"
      ? "Cross-chain swap"
      : inspection.kind === "forward"
        ? "Forwarded transfer"
        : inspection.kind === "wasm"
          ? "Contract call on arrival"
          : "Memo could not be fully read";

  return {
    kind: inspection.kind,
    headline,
    statements,
    warnings: inspection.warnings,
    risk: riskOf(statements, inspection.warnings.length > 0),
    byteLength: inspection.byteLength,
    requiresPfm: inspection.requiresPfm,
    requiresIbcHooks: inspection.requiresIbcHooks,
    raw,
  };
}

/**
 * Re-check that a memo built elsewhere still describes the swap the user
 * configured.
 *
 * Used on the confirm step: the plan came back over the network, so the fields
 * that decide where the money goes are compared against what the form asked
 * for. A mismatch disables signing with the field named, rather than trusting
 * the planner.
 */
export function memoMatchesIntent(
  memo: string,
  intent: {
    readonly contractAddress: string;
    readonly outputDenom: string;
    readonly recipient: string;
    readonly recoveryAddress: string;
  },
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const inspection = validateMemo(memo);
  const xcs = inspection.xcs;
  if (!xcs) {
    return {
      ok: false,
      reason: "The planned memo does not contain a crosschain swap.",
    };
  }
  if (xcs.contract !== intent.contractAddress) {
    return {
      ok: false,
      reason: `The memo targets contract ${shorten(xcs.contract)}, not the one this deployment is configured with.`,
    };
  }
  if (xcs.outputDenom !== intent.outputDenom) {
    return {
      ok: false,
      reason: `The memo asks for ${xcs.outputDenom}, not the asset selected.`,
    };
  }
  // The payout address is the recipient on a single-hop exit, and an
  // intermediate address when `next_memo` carries further forwards. Only the
  // first case can be compared to the recipient directly.
  if (!xcs.hasNextMemo && xcs.receiver !== intent.recipient) {
    return {
      ok: false,
      reason: `The memo pays ${shorten(xcs.receiver)}, not the recipient entered.`,
    };
  }
  if (xcs.onFailedDelivery.kind !== "local_recovery_addr") {
    return {
      ok: false,
      reason:
        "The memo has no recovery address, so funds stranded by a failed payout could not be reclaimed.",
    };
  }
  if (xcs.onFailedDelivery.address !== intent.recoveryAddress) {
    return {
      ok: false,
      reason: `The memo names ${shorten(xcs.onFailedDelivery.address)} as the recovery address, not your own.`,
    };
  }
  return { ok: true };
}
