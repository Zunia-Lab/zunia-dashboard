/**
 * Chain errors in plain words. The raw logs are real ones: the first three
 * were returned by cosmoshub-4 and safrochain-1 to this app's own routes on
 * 2026-10-07, the rest are the SDK's and Osmosis's own messages.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanChainLog,
  explainError,
  explainTxError,
  isSimulationRefusal,
  refusedMessageTypes,
  signatureMismatch,
  TxError,
  walletRefusal,
} from "../errors";

test("insufficient funds (simulation on cosmoshub-4)", () => {
  const e = explainTxError(
    "failed to execute message; message index: 0: spendable balance 24840473uatom is smaller than 999999999999999999uatom: insufficient funds [cosmos/cosmos-sdk@v0.53.6/x/bank/keeper/send.go:298] with gas used: '72794'",
  );
  assert.equal(e.kind, "insufficient-funds");
  assert.match(e.message, /not enough balance/);
  assert.match(e.detail!, /spendable balance/);
  assert.equal(e.retryable, false);
});

test("sequence mismatch keeps the sequence the chain expects (simulation on safrochain-1)", () => {
  const e = explainTxError(
    "account sequence mismatch, expected 5, got 10: incorrect account sequence [cosmos/cosmos-sdk@v0.50.14/x/auth/ante/sigverify.go:290] with gas used: '17493'",
  );
  assert.equal(e.kind, "sequence-mismatch");
  assert.equal(e.expectedSequence, "5");
  assert.equal(e.retryable, true);
});

test("signature refused (broadcast with a bad signature, code 4)", () => {
  const e = explainTxError(
    "signature verification failed; please verify account number (49692) and chain-id (safrochain-1): unauthorized",
    { code: 4, codespace: "sdk" },
  );
  assert.equal(e.kind, "unauthorized");
  assert.match(e.message, /could not verify the signature/);
});

test("out of gas, insufficient fee, slippage, expiry", () => {
  assert.equal(explainTxError("out of gas in location: WritePerByte; gasWanted: 100, gasUsed: 2000: out of gas").kind, "out-of-gas");
  assert.match(explainTxError("out of gas in location: x").message, /fee was still charged/);
  assert.equal(explainTxError("insufficient fees; got: 10uosmo required: 400uosmo: insufficient fee").kind, "insufficient-fee");
  assert.equal(
    explainTxError("failed to execute message; message index: 0: token amount calculated (352436) is lesser than min amount (704872)").kind,
    "slippage",
  );
  assert.equal(explainTxError("tx timeout height 100 is lower than current height 120").kind, "expired");
  assert.equal(explainTxError("context deadline exceeded").kind, "network-timeout");
  assert.equal(explainTxError("tx already in mempool").kind, "already-in-mempool");
});

test("an account the chain has never seen (code 9, seen live on cosmoshub-4)", () => {
  const e = explainTxError("account cosmos1r06s88t3s8jrg26rqqtu58crrncj7xzy5hp9un does not exist: unknown address", { code: 9, codespace: "sdk" });
  assert.equal(e.kind, "no-account");
  assert.match(e.message, /never received funds/);
  assert.equal(explainTxError("account cosmos1x does not exist: unknown address").kind, "no-account");
});

test("the SDK code decides in the core codespace; the log decides elsewhere", () => {
  assert.equal(explainTxError("whatever", { code: 13, codespace: "sdk" }).kind, "insufficient-fee");
  assert.equal(explainTxError("whatever", { code: 5 }).kind, "insufficient-funds");
  // Code 5 in another module's codespace is not "insufficient funds".
  assert.equal(explainTxError("execute wasm contract failed: Generic error", { code: 5, codespace: "wasm" }).kind, "unknown");
});

test("an unknown error keeps the chain's words; an empty one still says something", () => {
  const e = explainTxError("execute wasm contract failed: Generic error: nope");
  assert.equal(e.kind, "unknown");
  assert.equal(e.message, "execute wasm contract failed: Generic error: nope");
  assert.equal(e.detail, null);
  assert.equal(explainTxError("   ").message, "The chain refused this transaction.");
});

test("long logs are bounded", () => {
  const e = explainTxError(`insufficient funds ${"x".repeat(5_000)}`);
  assert.ok(e.detail!.length <= 601);
});

test("wallet errors go through the same classifier", () => {
  assert.equal(explainError(new Error("Request rejected")).kind, "user-rejected");
  assert.equal(explainError(Object.assign(new Error("nope"), { code: "USER_REJECTED" })).kind, "user-rejected");
  const wrapped = new TxError(explainTxError("out of gas"), "ABC");
  assert.equal(explainError(wrapped).kind, "out-of-gas");
  assert.equal(wrapped.txHash, "ABC");
});

/*
 * Simulation answers seen live on 2026-10-07 (cosmoshub-4 SDK v0.53.6,
 * safrochain-1 wasmd v0.54.1): a transaction the chain ran and refused comes
 * back as HTTP 500 {"code":2,…}, the status a crashed node gives too.
 */
const INACTIVE_PROPOSAL =
  "failed to execute message; message index: 0: 1: inactive proposal [cosmos/cosmos-sdk@v0.53.6/x/gov/keeper/vote.go:24] with gas used: '71619'";
const NO_CONTRACT =
  "failed to execute message; message index: 0: address addr_safro1q4c4p0n66crlkgagr76mjtnmt4d8pdlq3gcr9j: no such contract [!cosm!wasm/wasmd@v0.54.1/x/wasm/types/errors.go:156] with gas used: '35711'";
const STALE_SEQUENCE =
  "account sequence mismatch, expected 366, got 300: incorrect account sequence [cosmos/cosmos-sdk@v0.53.6/x/auth/ante/sigverify.go:364] with gas used: '13160'";

test("a simulation the chain ran and refused is a refusal, whatever the HTTP status", () => {
  assert.equal(isSimulationRefusal(500, INACTIVE_PROPOSAL, 2), true);
  assert.equal(isSimulationRefusal(500, NO_CONTRACT, 2), true);
  assert.equal(isSimulationRefusal(500, STALE_SEQUENCE, 2), true);
  // Older SDKs: "With gas wanted: … and gas used: …".
  assert.equal(isSimulationRefusal(500, "insufficient funds With gas wanted: '0' and gas used: '41234' ", 2), true);
  assert.equal(isSimulationRefusal(400, "", null), true);
});

test("a node failing is not a refusal (the flow falls back to a fixed gas limit)", () => {
  assert.equal(isSimulationRefusal(500, "", null), false);
  assert.equal(isSimulationRefusal(502, "", null), false);
  assert.equal(isSimulationRefusal(500, "rpc error: code = Unavailable desc = connection refused", 14), false);
  assert.equal(isSimulationRefusal(429, "", null), false);
  // A recognised cause without a gRPC-coded body is an HTML/proxy page, not the chain.
  assert.equal(isSimulationRefusal(503, "insufficient funds", null), false);
});

test("an unknown refusal shows the chain's words without source paths or the gas trailer", () => {
  assert.equal(cleanChainLog(INACTIVE_PROPOSAL), "1: inactive proposal");
  assert.equal(
    cleanChainLog(NO_CONTRACT),
    "address addr_safro1q4c4p0n66crlkgagr76mjtnmt4d8pdlq3gcr9j: no such contract",
  );
  const e = explainTxError(INACTIVE_PROPOSAL);
  assert.equal(e.kind, "unknown");
  assert.equal(e.message, "1: inactive proposal");
  assert.match(e.detail!, /vote\.go:24/, "the raw text stays available for a details fold");
  // Known kinds keep their own copy; the chain's text is the detail.
  const stale = explainTxError(STALE_SEQUENCE);
  assert.equal(stale.kind, "sequence-mismatch");
  assert.equal(stale.expectedSequence, "366");
});

test("TxError says whether the transaction reached a block", () => {
  assert.equal(new TxError(explainTxError("out of gas"), "ABC", true).onChain, true);
  assert.equal(new TxError(explainTxError("insufficient fee"), "ABC").onChain, false);
});

test("wallet error codes (phone SDK, Zunia extension) get plain words", () => {
  const code = (c: string, m: string) => Object.assign(new Error(m), { code: c });
  const timeout = explainError(code("TIMEOUT", "The wallet did not answer in time"));
  assert.equal(timeout.kind, "wallet-timeout");
  assert.match(timeout.message, /open the app on your phone/);
  assert.equal(timeout.retryable, true);
  for (const c of ["NOT_CONNECTED", "SESSION_EXPIRED", "DISCONNECTED"]) {
    assert.equal(explainError(code(c, "Pair a wallet first")).kind, "wallet-disconnected", c);
  }
  assert.match(explainError(code("UNKNOWN_CHAIN", "x")).message, /connect again and include it/);
  assert.equal(explainError(Object.assign(new Error("User rejected the request."), { code: 4001 })).kind, "user-rejected");
});

/*
 * The Zunia extension's refusals, in its own words (zunia-extension
 * lib/provider-handler.ts, lib/approvals.ts, entrypoints/background.ts @
 * 1453e7a). Each gets a next step, and a kind the flows already know.
 */
test("Zunia refusals: a next step in words, the extension's text kept as the detail", () => {
  const zunia = (code: string, message: string) => Object.assign(new Error(message), { name: "ZuniaProviderError", code });

  const blind = explainError(zunia("UNSUPPORTED", "Blind signing disabled for unknown messages"));
  assert.equal(blind.kind, "wallet-unsupported");
  assert.equal(blind.message, "Your Zunia extension can't sign this transaction yet. Update Zunia to the latest version, or use Keplr or Zunia Mobile.");
  assert.equal(blind.retryable, false);
  assert.equal(blind.detail, "Blind signing disabled for unknown messages");
  // UNSUPPORTED for another reason is not a blind-signing refusal.
  assert.notEqual(explainError(zunia("UNSUPPORTED", "Method not implemented: foo")).kind, "wallet-unsupported");

  for (const text of [
    "Zunia stayed locked, so the request was cancelled",
    "The Zunia window was closed before unlocking",
    "Wallet locked",
    "Wallet is locked",
  ]) {
    const locked = explainError(zunia("LOCKED", text));
    assert.equal(locked.kind, "wallet-timeout", text);
    assert.equal(locked.title, "Wallet locked");
    assert.equal(locked.message, "Zunia stayed locked. Unlock it and try again.");
    assert.equal(locked.retryable, true);
  }

  // An unanswered prompt carries USER_REJECTED, but nobody declined.
  const expired = explainError(zunia("USER_REJECTED", "Request expired before it was answered"));
  assert.equal(expired.kind, "wallet-timeout");
  assert.equal(expired.message, "The Zunia prompt expired. Try again.");
  assert.equal(expired.retryable, true);
  // A real "no" is still a decline.
  assert.equal(explainError(zunia("USER_REJECTED", "Request rejected")).kind, "user-rejected");

  const orphaned = explainError(zunia("INTERNAL", "Extension context invalidated."), { wallet: "zunia" });
  assert.equal(orphaned.kind, "wallet-disconnected");
  assert.equal(orphaned.message, "Zunia was updated or reloaded. Reload this page.");
  assert.equal(orphaned.retryable, false);
  const handshake = explainError(zunia("INTERNAL", "Zunia provider handshake timed out"));
  assert.equal(handshake.kind, "wallet-disconnected");
  assert.equal(handshake.message, "Zunia was updated or reloaded. Reload this page.", "its own words name Zunia");
});

test("an orphaned extension is named by the wallet that raised it: Chrome's words fit any extension", () => {
  const orphaned = new Error("Extension context invalidated.");
  assert.equal(explainError(orphaned, { wallet: "keplr" }).message, "Keplr was updated or reloaded. Reload this page.");
  assert.equal(explainError(orphaned, { wallet: "leap" }).message, "Leap was updated or reloaded. Reload this page.");
  assert.equal(explainError(orphaned, { wallet: "cosmostation" }).message, "Cosmostation was updated or reloaded. Reload this page.");
  // The phone is not an extension: Chrome's words are generic there.
  assert.equal(explainError(orphaned, { wallet: "zunia-mobile" }).message, "Your wallet extension was updated or reloaded. Reload this page.");
  // Leap and Cosmostation say no in their own words; it reads as a decline, not a failure.
  assert.equal(explainError(new Error("User rejected the request."), { wallet: "cosmostation" }).kind, "user-rejected");
  assert.equal(explainError(new Error("Request rejected"), { wallet: "leap" }).kind, "user-rejected");
  assert.equal(explainError(orphaned, { wallet: "zunia" }).title, "Page out of date");
  assert.equal(explainError(orphaned).message, "Your wallet extension was updated or reloaded. Reload this page.");
});

test("Zunia refusals are recognised by their words when a wrapper dropped the code", () => {
  // `enableChains` and `ensureKey` rethrow a plain Error with the wallet's text.
  assert.equal(explainError(new Error("Zunia stayed locked, so the request was cancelled")).title, "Wallet locked");
  assert.equal(explainError(new Error("The Zunia window was closed before unlocking")).title, "Wallet locked");
  assert.equal(explainError(new Error("Extension context invalidated.")).kind, "wallet-disconnected");
  assert.equal(explainError(new Error("Request expired before it was answered")).kind, "wallet-timeout");
  // Without its code, "Blind signing…" is not claimed: the words alone do not say which wallet.
  assert.equal(walletRefusal(new Error("Blind signing disabled for unknown messages")), null);
  assert.equal(walletRefusal(new Error("insufficient funds")), null);
  assert.equal(walletRefusal("Extension context invalidated.")?.kind, "wallet-disconnected");
});

/*
 * Zunia 0.1.5 names what it cannot read: "Blind signing disabled for unknown
 * messages: <type>, …" (at most five, each cut at 128 characters), keeping the
 * sentence sites already match on.
 */
test("a refusal that names its types says which ones, in the same words", () => {
  const zunia = (message: string) => Object.assign(new Error(message), { name: "ZuniaProviderError", code: "UNSUPPORTED" });
  const one = explainError(zunia("Blind signing disabled for unknown messages: /cosmos.authz.v1beta1.MsgGrant"));
  assert.equal(one.kind, "wallet-unsupported");
  assert.equal(one.title, "Unsupported in Zunia");
  assert.equal(
    one.message,
    "Your Zunia extension can't sign this transaction yet (it cannot read /cosmos.authz.v1beta1.MsgGrant). Update Zunia to the latest version, or use Keplr or Zunia Mobile.",
  );
  assert.equal(one.detail, "Blind signing disabled for unknown messages: /cosmos.authz.v1beta1.MsgGrant");
  assert.match(
    explainError(zunia("Blind signing disabled for unknown messages: /cosmos.authz.v1beta1.MsgGrant, cosmos-sdk/MsgGrant")).message,
    /\(it cannot read \/cosmos\.authz\.v1beta1\.MsgGrant and cosmos-sdk\/MsgGrant\)/,
  );
  assert.match(
    explainError(zunia("Blind signing disabled for unknown messages: /a.v1.MsgA, /b.v1.MsgB, osmosis/poolmanager/swap-exact-amount-out")).message,
    /\(it cannot read \/a\.v1\.MsgA, \/b\.v1\.MsgB and osmosis\/poolmanager\/swap-exact-amount-out\)/,
  );
});

test("the types are read strictly: deduplicated, at most five, nothing that is not a type", () => {
  const sentence = "Blind signing disabled for unknown messages";
  assert.deepEqual(refusedMessageTypes(sentence), []);
  assert.deepEqual(refusedMessageTypes(`${sentence}:`), []);
  assert.deepEqual(refusedMessageTypes(`${sentence}: /x.MsgA, /x.MsgA, /x.MsgB`), ["/x.MsgA", "/x.MsgB"]);
  assert.deepEqual(refusedMessageTypes(`${sentence}: /a.M1, /a.M2, /a.M3, /a.M4, /a.M5, /a.M6`), ["/a.M1", "/a.M2", "/a.M3", "/a.M4", "/a.M5"]);
  // A type the extension cut at 128 characters keeps its ellipsis; markup and spaces are not types.
  const long = `/${"a".repeat(126)}…`;
  assert.deepEqual(refusedMessageTypes(`${sentence}: ${long}, <img src=x>, two words, /ok.Msg`), [long, "/ok.Msg"]);
  assert.deepEqual(refusedMessageTypes(`${sentence}: /${"a".repeat(200)}`), []);
  // Nothing readable: the plain sentence.
  const none = explainError(Object.assign(new Error(`${sentence}: <b>`), { code: "UNSUPPORTED" }));
  assert.equal(none.message, "Your Zunia extension can't sign this transaction yet. Update Zunia to the latest version, or use Keplr or Zunia Mobile.");
});

test("a signature found not to match before broadcast: its own words, what it was over as the detail", () => {
  const mismatch = signatureMismatch("The amino signature is over the document without the chain's escaping of &, < and >.");
  assert.equal(mismatch.kind, "signature-mismatch");
  assert.equal(mismatch.title, "Signature mismatch");
  assert.equal(mismatch.message, "Your wallet signed something other than this transaction, so nothing was sent.");
  assert.match(mismatch.detail!, /without the chain's escaping/);
  assert.equal(mismatch.retryable, false);
  assert.equal(signatureMismatch(null).detail, null);
  // It reaches the flows as it is.
  assert.equal(explainError(new TxError(mismatch)).kind, "signature-mismatch");
});
