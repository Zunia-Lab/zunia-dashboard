import assert from "node:assert/strict";
import { test } from "node:test";
import { requestChains } from "../request-chains";

test("asks the wallet once per chain and reports who answered", async () => {
  const asked: string[] = [];
  const result = await requestChains(["injective-1", "evmos_9001-2", "injective-1", "dymension_1100-1"], async (id) => {
    asked.push(id);
    if (id === "evmos_9001-2") throw new Error("declined");
  });
  assert.deepEqual(asked, ["injective-1", "evmos_9001-2", "dymension_1100-1"]);
  assert.deepEqual(result.added, ["injective-1", "dymension_1100-1"]);
  assert.deepEqual(result.failed.map((f) => f.chainId), ["evmos_9001-2"]);
});
