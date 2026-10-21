/**
 * The chain scan, against a fake node that answers the real REST paths.
 *
 * What these guard, in order of how badly each would hurt:
 *
 * - a verdict is only ever cached from an answer. The cache is permanent and
 *   shared by every visitor, so an outage read as "not a CW721" would hide a
 *   code's collections from everyone, for good;
 * - one walk per chain, however many visitors arrive while it runs;
 * - the result stays incomplete, and the scan is named as the source, so the
 *   page never presents a look at the newest codes as the whole chain;
 * - a scanned contract that is not a collection is not reported as a failure.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bech32 } from "bech32";
import {
  discoverNfts,
  InterchainError,
  type ChainInfoLike,
  type LcdClient,
  type LcdRequestOptions,
  type NftChainContext,
  type NftDiscoveryResult,
} from "@zunialab/interchain";
import {
  attributeScan,
  classifyCode,
  createChainScanCache,
  isNotCw721,
  parseScanFile,
  scanLimitation,
  scanWindow,
  serializeScanFile,
  walkCodes,
  SCAN_FILE_VERSION,
  SCAN_MAX_CONTRACTS,
  SCAN_PARTIAL_TTL_MS,
  SCAN_TTL_MS,
  type ChainScanFile,
} from "../chain-scan";

const CHAIN: ChainInfoLike = {
  chainId: "juno-1",
  chainName: "Juno",
  bech32Prefix: "juno",
  coinType: 118,
  network: "mainnet",
  coinDenom: "JUNO",
  coinMinimalDenom: "ujuno",
  coinDecimals: 6,
  feeDenom: "JUNO",
  feeMinimalDenom: "ujuno",
  feeDecimals: 6,
  features: ["cosmwasm"],
};

/** A valid 32-byte contract address on the test chain; `n` keeps them apart. */
function contract(n: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = Math.floor(n / 256);
  bytes[1] = n % 256;
  return bech32.encode("juno", bech32.toWords(bytes));
}

const OWNER = bech32.encode("juno", bech32.toWords(new Uint8Array(20).fill(7)));

/** How one contract answers a `tokens` query. */
type Answer = "cw721" | "refuse" | "malformed" | "outage" | "rate-limited" | "hang";

interface FakeChain {
  /** Code ids, newest first, as the node returns them with `pagination.reverse`. */
  codes: string[];
  instances: Record<string, string[]>;
  answers: Record<string, Answer>;
  /** Token ids each contract holds for `OWNER`. */
  holdings?: Record<string, string[]>;
  rejectReverse?: boolean;
  codeListDown?: boolean;
  /** Code ids whose instance listing fails like a struggling node. */
  listingDown?: string[];
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new InterchainError("aborted", "aborted"));
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

function fakeNode(chain: FakeChain) {
  const calls: string[] = [];
  /** The owner each smart query asked about, by contract. */
  const asked: Array<{ contract: string; owner: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;

  async function answer(path: string, options: LcdRequestOptions): Promise<unknown> {
    if (options.signal?.aborted) throw new InterchainError("aborted", "aborted");
    // Let concurrent callers overlap, so the in-flight count means something.
    await new Promise((resolve) => setTimeout(resolve, 1));

    if (path === "/cosmwasm/wasm/v1/code") {
      if (chain.codeListDown) throw new InterchainError("lcd-unreachable", "down", { chainId: CHAIN.chainId });
      if (options.query?.["pagination.reverse"] && chain.rejectReverse) {
        throw new InterchainError("lcd-unreachable", "HTTP 400", { chainId: CHAIN.chainId, httpStatus: 400 });
      }
      const ids = options.query?.["pagination.reverse"] ? chain.codes : [...chain.codes].reverse();
      return { code_infos: ids.map((id) => ({ code_id: id })), pagination: { next_key: null } };
    }

    const listing = /^\/cosmwasm\/wasm\/v1\/code\/(\d+)\/contracts$/.exec(path);
    if (listing) {
      const codeId = listing[1]!;
      if (chain.listingDown?.includes(codeId)) {
        throw new InterchainError("lcd-unreachable", "HTTP 503", { chainId: CHAIN.chainId, httpStatus: 503 });
      }
      return { contracts: chain.instances[codeId] ?? [] };
    }

    const smart = /^\/cosmwasm\/wasm\/v1\/contract\/([^/]+)\/smart\/(.+)$/.exec(path);
    if (smart) {
      const address = decodeURIComponent(smart[1]!);
      const query = JSON.parse(Buffer.from(smart[2]!, "base64url").toString("utf8")) as {
        tokens?: { owner: string };
      };
      asked.push({ contract: address, owner: query.tokens?.owner ?? "" });
      switch (chain.answers[address] ?? "refuse") {
        case "cw721":
          return { data: { tokens: query.tokens?.owner === OWNER ? (chain.holdings?.[address] ?? []) : [] } };
        case "malformed":
          return { data: { not_tokens: true } };
        case "refuse":
          throw new InterchainError("lcd-unreachable", "HTTP 400", { chainId: CHAIN.chainId, httpStatus: 400 });
        case "rate-limited":
          throw new InterchainError("lcd-unreachable", "HTTP 429", { chainId: CHAIN.chainId, httpStatus: 429 });
        case "outage":
          throw new InterchainError("lcd-unreachable", "timed out", { chainId: CHAIN.chainId });
        case "hang":
          return waitForAbort(options.signal);
      }
    }
    throw new InterchainError("lcd-unreachable", `HTTP 404 for ${path}`, { chainId: CHAIN.chainId, httpStatus: 404 });
  }

  const lcd: LcdClient = {
    chainId: CHAIN.chainId,
    async getJson(path, options = {}) {
      const query = options.query
        ? `?${new URLSearchParams(Object.entries(options.query).map(([key, value]) => [key, String(value)])).toString()}`
        : "";
      calls.push(`${path}${query}`);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await answer(path, options);
      } finally {
        inFlight -= 1;
      }
    },
  };
  const ctx: NftChainContext = { chain: CHAIN, lcd };
  return {
    ctx,
    calls,
    asked,
    get maxInFlight() {
      return maxInFlight;
    },
    listings: () => calls.filter((call) => /\/code\/\d+\/contracts/.test(call)),
    probes: () => calls.filter((call) => call.includes("/smart/")),
    codeLists: () => calls.filter((call) => call.startsWith("/cosmwasm/wasm/v1/code?")),
  };
}

const NO_DEADLINE = () => new AbortController().signal;

/** Three codes: a collection, a contract that is not one, a code with no instance. */
function smallChain(): FakeChain {
  return {
    codes: ["3", "2", "1"],
    instances: { "3": [contract(31), contract(30)], "2": [contract(20)], "1": [] },
    answers: { [contract(31)]: "cw721", [contract(30)]: "cw721", [contract(20)]: "refuse" },
  };
}

/* -------------------------------------------------------------------------- *
 * Verdicts
 * -------------------------------------------------------------------------- */

test("a query the gateway could not decode is not a verdict", () => {
  const gateway = new InterchainError(
    "lcd-unreachable",
    "https://lcd HTTP 400: type mismatch, parameter: query_data, error: illegal base64 data at input byte 136",
    { httpStatus: 400 },
  );
  assert.equal(isNotCw721(gateway), false);
  // As smartQuery hands it over: reclassified, with the node's sentence in the cause.
  assert.equal(
    isNotCw721(new InterchainError("contract-error", 'rejected "tokens" (HTTP 400)', { httpStatus: 400, cause: gateway })),
    false,
  );
});

test("a refusal is a verdict; an outage, a 429 and a cancelled read are not", () => {
  assert.equal(isNotCw721(new InterchainError("contract-error", "rejected")), true);
  assert.equal(isNotCw721(new InterchainError("malformed-response", "no tokens array")), true);
  assert.equal(isNotCw721(new InterchainError("lcd-unreachable", "HTTP 400", { httpStatus: 400 })), true);

  assert.equal(isNotCw721(new InterchainError("lcd-unreachable", "timed out")), false);
  assert.equal(isNotCw721(new InterchainError("lcd-unreachable", "HTTP 429", { httpStatus: 429 })), false);
  assert.equal(isNotCw721(new InterchainError("lcd-unreachable", "HTTP 503", { httpStatus: 503 })), false);
  assert.equal(isNotCw721(new InterchainError("aborted", "aborted", { httpStatus: 400 })), false);
  assert.equal(isNotCw721(new Error("a bug, not an answer")), false);
});

test("a code is judged on its own instance's address, never on a visitor's", async () => {
  const node = fakeNode(smallChain());
  const verdict = await classifyCode(node.ctx, [contract(31)], {}, NO_DEADLINE());
  assert.equal(verdict, "cw721");
  // The verdict is shared and permanent; an owner a visitor typed must not decide it.
  assert.deepEqual(node.asked, [{ contract: contract(31), owner: contract(31) }]);
});

test("one dead instance does not condemn its code: the second one is asked", async () => {
  const node = fakeNode({
    codes: ["9"],
    instances: { "9": [contract(91), contract(90)] },
    answers: { [contract(91)]: "outage", [contract(90)]: "cw721" },
  });
  assert.equal(await classifyCode(node.ctx, [contract(91), contract(90)], {}, NO_DEADLINE()), "cw721");
});

test("no answer from either instance leaves the code unjudged", async () => {
  const node = fakeNode({
    codes: ["9"],
    instances: {},
    answers: { [contract(91)]: "rate-limited", [contract(90)]: "outage", [contract(89)]: "cw721" },
  });
  // Two attempts, not three: a third instance is not asked.
  assert.equal(await classifyCode(node.ctx, [contract(91), contract(90), contract(89)], {}, NO_DEADLINE()), null);
  assert.equal(node.asked.length, 2);
});

test("an envelope with no tokens array is a contract that is not a CW721", async () => {
  const node = fakeNode({ codes: ["9"], instances: {}, answers: { [contract(91)]: "malformed" } });
  assert.equal(await classifyCode(node.ctx, [contract(91)], {}, NO_DEADLINE()), "other");
});

/* -------------------------------------------------------------------------- *
 * One walk
 * -------------------------------------------------------------------------- */

test("the walk keeps the CW721 code's instances and judges each code once", async () => {
  const node = fakeNode(smallChain());
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: {}, concurrency: 4, signal: NO_DEADLINE() });

  assert.equal(walk.listed, true);
  assert.equal(walk.newestFirst, true);
  assert.deepEqual(walk.contracts, [contract(31), contract(30)]);
  assert.deepEqual(walk.verdicts, { "3": "cw721", "2": "other" });
  // Code 1 has no instance: looked at, nothing to judge, nothing cached.
  assert.equal(walk.codesChecked, 3);
  assert.equal(walk.codesUnread, 0);
  assert.deepEqual(node.codeLists(), ["/cosmwasm/wasm/v1/code?pagination.limit=40&pagination.reverse=true"]);
  assert.ok(node.listings().every((call) => call.endsWith("?pagination.limit=25&pagination.reverse=true")));
  // One probe per code: code 3's second instance was never needed.
  assert.equal(node.probes().length, 2);
});

test("a code judged other is never listed again; a CW721 code is listed but not re-probed", async () => {
  const node = fakeNode(smallChain());
  const walk = await walkCodes({
    ctx: node.ctx,
    gate: {},
    verdicts: { "3": "cw721", "2": "other" },
    concurrency: 4,
    signal: NO_DEADLINE(),
  });
  assert.deepEqual(walk.contracts, [contract(31), contract(30)]);
  assert.equal(node.listings().some((call) => call.includes("/code/2/")), false);
  assert.equal(node.probes().length, 0);
});

test("an outage leaves no verdict and counts as a hole", async () => {
  const chain = smallChain();
  chain.answers[contract(31)] = "outage";
  chain.answers[contract(30)] = "outage";
  chain.listingDown = ["1"];
  const node = fakeNode(chain);
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: {}, concurrency: 4, signal: NO_DEADLINE() });
  assert.deepEqual(walk.contracts, []);
  assert.deepEqual(walk.verdicts, { "2": "other" });
  assert.equal(walk.codesChecked, 1);
  assert.equal(walk.codesUnread, 2);
});

test("a node that refuses `reverse` is asked again without it, and the walk stops saying newest", async () => {
  const chain = smallChain();
  chain.rejectReverse = true;
  const node = fakeNode(chain);
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: {}, concurrency: 4, signal: NO_DEADLINE() });
  assert.equal(walk.listed, true);
  assert.equal(walk.newestFirst, false);
  assert.deepEqual(node.codeLists(), [
    "/cosmwasm/wasm/v1/code?pagination.limit=40&pagination.reverse=true",
    "/cosmwasm/wasm/v1/code?pagination.limit=40",
  ]);
  assert.deepEqual(walk.contracts, [contract(31), contract(30)]);
});

test("a code list that does not answer is a walk that did not happen", async () => {
  const node = fakeNode({ ...smallChain(), codeListDown: true });
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: { "7": "cw721" }, concurrency: 4, signal: NO_DEADLINE() });
  assert.equal(walk.listed, false);
  assert.deepEqual(walk.contracts, []);
  // What was known before is not forgotten.
  assert.deepEqual(walk.verdicts, { "7": "cw721" });
});

test("the budget stops the walk at fifty contracts, newest code first, never above the concurrency", async () => {
  const codes = ["5", "4", "3", "2", "1"];
  const instances: Record<string, string[]> = {};
  const answers: Record<string, Answer> = {};
  for (const code of codes) {
    instances[code] = Array.from({ length: 25 }, (_, i) => contract(Number(code) * 100 + i));
    for (const address of instances[code]!) answers[address] = "cw721";
  }
  const node = fakeNode({ codes, instances, answers });
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: {}, concurrency: 2, signal: NO_DEADLINE() });

  assert.equal(walk.contracts.length, SCAN_MAX_CONTRACTS);
  assert.deepEqual(walk.contracts, [...instances["5"]!, ...instances["4"]!]);
  // The first batch (codes 5 and 4) filled the budget; codes 3 to 1 were never listed.
  assert.equal(node.listings().length, 2);
  assert.ok(node.maxInFlight <= 2, `at most two requests at once, saw ${node.maxInFlight}`);
});

test("an instance that is not an address of this chain is not a candidate", async () => {
  const stranger = bech32.encode("osmo", bech32.toWords(new Uint8Array(32).fill(1)));
  const node = fakeNode({
    codes: ["3"],
    instances: { "3": [stranger, "not-an-address", contract(31)] },
    answers: { [contract(31)]: "cw721" },
  });
  const walk = await walkCodes({ ctx: node.ctx, gate: {}, verdicts: {}, concurrency: 4, signal: NO_DEADLINE() });
  assert.deepEqual(walk.contracts, [contract(31)]);
});

test("the deadline stops the walk where it is and keeps what it learned", async () => {
  const chain = smallChain();
  chain.codes = ["4", "3", "2", "1"];
  chain.instances["4"] = [contract(40)];
  chain.answers[contract(40)] = "hang";
  const node = fakeNode(chain);
  const walk = await walkCodes({
    ctx: node.ctx,
    gate: {},
    verdicts: {},
    concurrency: 2,
    signal: AbortSignal.timeout(50),
  });
  // Batch one (4, 3): 3 answered, 4 hung until the deadline. Batch two never ran.
  assert.deepEqual(walk.verdicts, { "3": "cw721" });
  assert.deepEqual(walk.contracts, [contract(31), contract(30)]);
  assert.equal(walk.codesChecked, 1);
  assert.equal(walk.codesUnread, 3);
});

/* -------------------------------------------------------------------------- *
 * The shared cache
 * -------------------------------------------------------------------------- */

function memoryFile(initial: unknown = null): ChainScanFile & { saved: string | null } {
  return {
    saved: null,
    async read() {
      return initial;
    },
    schedule(snapshot) {
      this.saved = snapshot();
    },
  };
}

test("visitors who arrive while a walk runs share it: one code list, one set of probes", async () => {
  const node = fakeNode(smallChain());
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000 });
  const [a, b, c] = await Promise.all([
    cache.scan(node.ctx, {}),
    cache.scan(node.ctx, {}),
    cache.scan(node.ctx, {}),
  ]);
  assert.equal(node.codeLists().length, 1);
  assert.equal(node.probes().length, 2);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a.status, "ran");
  assert.deepEqual(a.contracts, [contract(31), contract(30)]);
});

test("a clean list is reused for six hours; after that no code is probed twice", async () => {
  let clock = 1_000_000;
  const node = fakeNode(smallChain());
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000, now: () => clock });

  const first = await cache.scan(node.ctx, {});
  assert.equal(first.checkedAt, 1_000_000);
  const requests = node.calls.length;

  clock += SCAN_TTL_MS - 1;
  await cache.scan(node.ctx, {});
  assert.equal(node.calls.length, requests, "nothing is asked while the list is fresh");

  clock += 2;
  const second = await cache.scan(node.ctx, {});
  const after = node.calls.slice(requests);
  // The code list, then instances for code 3 (CW721) and code 1 (no verdict:
  // it had nothing to judge). Code 2 is known not to be a collection.
  assert.deepEqual(after.filter((call) => call.includes("/code/2/")), []);
  assert.equal(after.filter((call) => call.includes("/smart/")).length, 0);
  assert.deepEqual(second.contracts, first.contracts);
});

test("a list with holes is rebuilt within minutes, not hours", async () => {
  let clock = 0;
  const chain = smallChain();
  chain.listingDown = ["1"];
  const node = fakeNode(chain);
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000, now: () => clock });
  const first = await cache.scan(node.ctx, {});
  assert.equal(first.codesUnread, 1);

  chain.listingDown = [];
  clock += SCAN_PARTIAL_TTL_MS + 1;
  const second = await cache.scan(node.ctx, {});
  assert.equal(second.codesUnread, 0);
  assert.equal(node.codeLists().length, 2);
});

test("a walk with holes keeps the collections the last one found", async () => {
  let clock = 0;
  const chain = smallChain();
  const node = fakeNode(chain);
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000, now: () => clock });
  await cache.scan(node.ctx, {});

  chain.listingDown = ["3"];
  clock += SCAN_TTL_MS + 1;
  const rescan = await cache.scan(node.ctx, {});
  assert.equal(rescan.codesUnread, 1);
  assert.deepEqual(rescan.contracts, [contract(31), contract(30)]);
});

test("a code list that does not answer serves the last list, or says it failed", async () => {
  let clock = 0;
  const chain = smallChain();
  const node = fakeNode(chain);
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000, now: () => clock });

  const fresh = fakeNode({ ...smallChain(), codeListDown: true });
  const never = await createChainScanCache({ concurrency: 4, deadlineMs: 5_000 }).scan(fresh.ctx, {});
  assert.equal(never.status, "failed");
  assert.deepEqual(never.contracts, []);
  assert.equal(never.checkedAt, null);

  const good = await cache.scan(node.ctx, {});
  chain.codeListDown = true;
  clock += SCAN_TTL_MS + 1;
  const stale = await cache.scan(node.ctx, {});
  assert.equal(stale.status, "ran");
  assert.deepEqual(stale.contracts, good.contracts);
  assert.equal(stale.checkedAt, good.checkedAt, "the list says how old it is");
});

test("verdicts and the list survive a restart through the file", async () => {
  const node = fakeNode(smallChain());
  const file = memoryFile();
  const cache = createChainScanCache({ concurrency: 4, deadlineMs: 5_000, file, now: () => 5 });
  await cache.scan(node.ctx, {});
  assert.ok(file.saved);

  const restarted = createChainScanCache({
    concurrency: 4,
    deadlineMs: 5_000,
    file: memoryFile(JSON.parse(file.saved!)),
    now: () => 6,
  });
  const requests = node.calls.length;
  const again = await restarted.scan(node.ctx, {});
  assert.equal(node.calls.length, requests, "a fresh list on disk costs no request");
  assert.deepEqual(again.contracts, [contract(31), contract(30)]);
});

test("a file from another version, or one that does not parse, is dropped rather than repaired", () => {
  assert.equal(parseScanFile(null).size, 0);
  assert.equal(parseScanFile({ version: SCAN_FILE_VERSION + 1, chains: { "juno-1": {} } }).size, 0);

  const parsed = parseScanFile({
    version: SCAN_FILE_VERSION,
    chains: {
      "juno-1": {
        verdicts: { "3": "cw721", "2": "maybe", "../etc": "other" },
        scan: { status: "ran", contracts: [contract(31), 7], codesChecked: 3, newestFirst: true, checkedAt: 9 },
        freshUntil: 10,
      },
      "osmosis-1": { scan: { status: "excellent" } },
    },
  });
  assert.deepEqual([...parsed.keys()], ["juno-1"]);
  const record = parsed.get("juno-1")!;
  assert.deepEqual(record.verdicts, { "3": "cw721" });
  assert.deepEqual(record.scan.contracts, [contract(31)]);
  assert.equal(record.scan.codesUnread, 0);
  assert.equal(record.freshUntil, 10);

  // And the round trip is exact.
  assert.deepEqual(parseScanFile(JSON.parse(serializeScanFile(parsed))), parsed);
});

/* -------------------------------------------------------------------------- *
 * Discovery, with the scan named
 * -------------------------------------------------------------------------- */

test("scanned candidates go to the engine as known contracts and come back as the scan", async () => {
  const chain = smallChain();
  chain.holdings = { [contract(30)]: ["dr-1"] };
  const node = fakeNode(chain);
  const scan = await createChainScanCache({ concurrency: 4, deadlineMs: 5_000 }).scan(node.ctx, {});
  const result = await discoverNfts(node.ctx, OWNER, {
    knownContracts: scan.contracts,
    maxContracts: Math.max(25, scan.contracts.length),
  });
  const attributed = attributeScan(result, scan.contracts, []);

  assert.equal(attributed.holdings.length, 1);
  assert.equal(attributed.holdings[0]!.contractAddress, contract(30));
  assert.equal(attributed.holdings[0]!.source, "scan");
  assert.deepEqual(attributed.holdings[0]!.tokenIds, ["dr-1"]);
  assert.deepEqual(attributed.sources, ["scan"]);
  // A scan is never an index: the list cannot be complete.
  assert.equal(attributed.complete, false);
  assert.notEqual(attributed.limitation, null);
});

test("a scanned contract that is not a collection is dropped; a pasted one, and an outage, are not", () => {
  const scanned = contract(1);
  const pasted = contract(2);
  const slow = contract(3);
  const listed = contract(4);
  const result: NftDiscoveryResult = {
    chainId: CHAIN.chainId,
    owner: OWNER,
    holdings: [
      { contractAddress: listed, source: "known", tokenIds: ["1"], truncated: false },
      { contractAddress: pasted, source: "user", tokenIds: ["2"], truncated: false },
    ],
    sources: ["known", "user"],
    complete: false,
    limitation: "engine sentence",
    issues: [
      { contractAddress: scanned, message: 'contract-error: juno-1: juno1… rejected "tokens" (HTTP 400)' },
      { contractAddress: pasted, message: 'contract-error: juno-1: juno1… rejected "tokens" (HTTP 400)' },
      { contractAddress: slow, message: "lcd-unreachable: timed out" },
      { contractAddress: null, message: "the index: lcd-unreachable: down" },
    ],
  };
  const attributed = attributeScan(result, [scanned, slow, pasted], [pasted]);

  assert.deepEqual(
    attributed.issues.map((issue) => issue.contractAddress),
    [pasted, slow, null],
  );
  // The deployment's own address keeps its label; the user's wins over the scan.
  assert.deepEqual(
    attributed.holdings.map((holding) => holding.source),
    ["known", "user"],
  );
  assert.deepEqual(attributed.sources, ["known", "user"]);
});

test("the index stays a source when it answered, even with nothing found", () => {
  const attributed = attributeScan(
    {
      chainId: CHAIN.chainId,
      owner: OWNER,
      holdings: [],
      sources: ["indexer"],
      complete: true,
      limitation: null,
      issues: [],
    },
    [],
    [],
  );
  assert.deepEqual(attributed.sources, ["indexer"]);
  assert.equal(attributed.complete, true);
});

/* -------------------------------------------------------------------------- *
 * Words
 * -------------------------------------------------------------------------- */

/** Same rule as support.test.ts: setting names and paths are operator documentation. */
const OPERATOR_WORDS = /ZUNIA_|[A-Z]{2,}_[A-Z]{2,}|\.mjs|scripts\/|zunia-extension|=1\b/;

test("the scan's sentences name the window, and nothing an operator would", () => {
  assert.equal(scanWindow({ codesChecked: 16, newestFirst: true }), "the newest 16 contract codes");
  assert.equal(scanWindow({ codesChecked: 1, newestFirst: true }), "the newest contract code");
  assert.equal(scanWindow({ codesChecked: 16, newestFirst: false }), "16 contract codes");

  const sentence = scanLimitation("Safrochain", {
    status: "ran",
    codesChecked: 16,
    codesUnread: 0,
    newestFirst: true,
    checkedAt: 1,
  });
  assert.match(sentence, /newest 16 contract codes on Safrochain/);
  assert.match(sentence, /no chain-wide index/);
  assert.doesNotMatch(sentence, OPERATOR_WORDS);
});
