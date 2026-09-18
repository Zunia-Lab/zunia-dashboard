/**
 * The approval screen's description of a memo.
 *
 * The memos here are written out literally, in the shapes INTERCHAIN-SPEC.md
 * quotes from the packet-forward-middleware README and the Osmosis
 * crosschain-swaps README. Building them with our own builder and then parsing
 * them back would only prove the two agree with each other.
 *
 * What is under test is the gate: which memos this build is willing to let
 * someone sign. `risk: "danger"` is what disables the confirm button, so every
 * case that must not be signable asserts on it directly.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { explainMemo, memoMatchesIntent } from "../memo-summary";

const XCS_CONTRACT = "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs";
const RECIPIENT = "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4";
const RECOVERY = "osmo19rl4cm2hmr8afy4kldpxz3fka4jguq0ae5egnx";

function xcsMemo(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    wasm: {
      contract: XCS_CONTRACT,
      msg: {
        osmosis_swap: {
          output_denom: "uatom",
          slippage: { twap: { slippage_percentage: "1", window_seconds: 10 } },
          receiver: RECIPIENT,
          on_failed_delivery: { local_recovery_addr: RECOVERY },
          next_memo: null,
          ...overrides,
        },
      },
    },
  });
}

test("an empty memo is described as inert and is signable", () => {
  const result = explainMemo("");
  assert.equal(result.kind, "empty");
  assert.equal(result.risk, "none");
  assert.match(result.statements[0]!.text, /no memo/i);
});

test("a well-formed crosschain swap names the contract, the payout and the recovery", () => {
  const result = explainMemo(xcsMemo(), {
    receiver: XCS_CONTRACT,
    venueChainId: "osmosis-1",
    chainName: () => "Osmosis",
  });

  assert.equal(result.kind, "xcs");
  assert.equal(result.risk, "none");
  assert.equal(result.requiresIbcHooks, true);

  const text = result.statements.map((s) => s.text).join(" ");
  // The contract, because it is what runs; the payout, because it is where the
  // money goes; and the "no account needed there" line, because that is the
  // question this flow generates.
  assert.match(text, /Osmosis runs contract osmo1uwk8x…qxwvxs/);
  assert.match(text, /You do not need an account or gas there/);
  assert.match(text, /swaps them for uatom/);
  assert.match(text, /only osmo19rl4c…e5egnx can claim it back/);
  assert.match(text, /1% against the 10-second average/);
});

test('"do_nothing" recovery is a danger and cannot be signed', () => {
  const result = explainMemo(xcsMemo({ on_failed_delivery: "do_nothing" }), {
    receiver: XCS_CONTRACT,
  });

  assert.equal(result.risk, "danger");
  const danger = result.statements.find((s) => s.tone === "danger");
  assert.ok(danger, "expected a danger statement");
  assert.match(danger.text, /stranded with no way to reclaim/);
});

test("a memo this build cannot account for is a danger, not a shrug", () => {
  // Middleware we do not model is still middleware: it acts on the packet
  // before the funds reach anyone.
  const result = explainMemo(JSON.stringify({ some_other_middleware: { x: 1 } }));
  assert.equal(result.kind, "unknown");
  assert.equal(result.risk, "danger");
});

test("a receiver that is neither empty nor the contract is reported", () => {
  // ibc-hooks would skip the hook entirely and the funds would land at the
  // receiver instead of being swapped. It succeeds; it just does something else.
  const result = explainMemo(xcsMemo(), { receiver: RECIPIENT });
  assert.ok(
    result.warnings.length > 0,
    "expected validateMemo to flag the receiver mismatch",
  );
});

test("a forward memo lists the hops and the address they end at", () => {
  const memo = JSON.stringify({
    forward: {
      receiver: "pfm",
      port: "transfer",
      channel: "channel-123",
      timeout: "10m",
      retries: 2,
      next: {
        forward: {
          receiver: RECIPIENT,
          port: "transfer",
          channel: "channel-234",
          timeout: "10m",
          retries: 2,
        },
      },
    },
  });
  const result = explainMemo(memo);
  assert.equal(result.kind, "forward");
  assert.equal(result.requiresPfm, true);
  const text = result.statements.map((s) => s.text).join(" ");
  assert.match(text, /channel-123/);
  assert.match(text, /channel-234/);
  assert.match(text, /to cosmos19rl…uqdal4/);
});

test('a forward that ends at the literal "pfm" is a danger', () => {
  // "pfm" is the conventional placeholder for an intermediate hop. As the final
  // receiver it is not an account, and the funds would be unrecoverable.
  const memo = JSON.stringify({
    forward: {
      receiver: "pfm",
      port: "transfer",
      channel: "channel-123",
      timeout: "10m",
      retries: 2,
    },
  });
  const result = explainMemo(memo);
  assert.equal(result.risk, "danger");
});

test("memoMatchesIntent accepts the memo the form asked for", () => {
  assert.deepEqual(
    memoMatchesIntent(xcsMemo(), {
      contractAddress: XCS_CONTRACT,
      outputDenom: "uatom",
      recipient: RECIPIENT,
      recoveryAddress: RECOVERY,
    }),
    { ok: true },
  );
});

test("memoMatchesIntent rejects a swapped-out contract address", () => {
  const result = memoMatchesIntent(xcsMemo(), {
    contractAddress: "osmo1someotheraddressentirely",
    outputDenom: "uatom",
    recipient: RECIPIENT,
    recoveryAddress: RECOVERY,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /targets contract/);
});

test("memoMatchesIntent rejects a redirected payout", () => {
  const result = memoMatchesIntent(
    xcsMemo({ receiver: "cosmos1attackeraddresshere" }),
    {
      contractAddress: XCS_CONTRACT,
      outputDenom: "uatom",
      recipient: RECIPIENT,
      recoveryAddress: RECOVERY,
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /not the recipient entered/);
});

test("memoMatchesIntent rejects a different output denom", () => {
  const result = memoMatchesIntent(xcsMemo({ output_denom: "uosmo" }), {
    contractAddress: XCS_CONTRACT,
    outputDenom: "uatom",
    recipient: RECIPIENT,
    recoveryAddress: RECOVERY,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not the asset selected/);
});

test("memoMatchesIntent rejects a recovery address that is not the user's", () => {
  const result = memoMatchesIntent(
    xcsMemo({ on_failed_delivery: { local_recovery_addr: "osmo1someoneelse" } }),
    {
      contractAddress: XCS_CONTRACT,
      outputDenom: "uatom",
      recipient: RECIPIENT,
      recoveryAddress: RECOVERY,
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /not your own/);
});

test("memoMatchesIntent rejects a memo with no swap at all", () => {
  const result = memoMatchesIntent("", {
    contractAddress: XCS_CONTRACT,
    outputDenom: "uatom",
    recipient: RECIPIENT,
    recoveryAddress: RECOVERY,
  });
  assert.equal(result.ok, false);
});
