/** Keplr `ChainInfo` from a catalog row (the shape `experimentalSuggestChain` validates). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSuggestChainInfo, SuggestUnavailableError } from "../suggest";

const SAFRO = {
  chainId: "safrochain-1",
  chainName: "Safrochain",
  bech32Prefix: "addr_safro",
  coinType: 118,
  coinDenom: "SAF",
  coinMinimalDenom: "usaf",
  coinDecimals: 6,
  feeDenom: "SAF",
  feeMinimalDenom: "usaf",
  feeDecimals: 6,
  gasPriceStep: { low: 0.05, average: 0.075, high: 0.1 },
  features: ["cosmwasm", "ibc-v2", "made-up"],
  rpc: "https://rpc.safrochain.network/",
  rest: "https://api.safrochain.network",
  iconUrl: "https://raw.githubusercontent.com/Zunia-Lab/zunia-chain-registry/main/images/safrochain/chain.png",
  currencies: [
    { coinDenom: "SAF", coinMinimalDenom: "usaf", coinDecimals: 6 },
    { coinDenom: "DYMA", coinMinimalDenom: "factory/addr_safro1zlqc8hf3drqz9ntaklfhddetfay3tt9n9c2tar/udyma", coinDecimals: 6 },
  ],
};

test("Safrochain as Keplr needs it", () => {
  const info = buildSuggestChainInfo(SAFRO);
  assert.equal(info.rpc, "https://rpc.safrochain.network");
  assert.equal(info.rest, "https://api.safrochain.network");
  assert.deepEqual(info.bip44, { coinType: 118 });
  assert.deepEqual(info.bech32Config, {
    bech32PrefixAccAddr: "addr_safro",
    bech32PrefixAccPub: "addr_safropub",
    bech32PrefixValAddr: "addr_safrovaloper",
    bech32PrefixValPub: "addr_safrovaloperpub",
    bech32PrefixConsAddr: "addr_safrovalcons",
    bech32PrefixConsPub: "addr_safrovalconspub",
  });
  assert.deepEqual(info.stakeCurrency, { coinDenom: "SAF", coinMinimalDenom: "usaf", coinDecimals: 6 });
  assert.deepEqual(info.feeCurrencies, [
    { coinDenom: "SAF", coinMinimalDenom: "usaf", coinDecimals: 6, gasPriceStep: { low: 0.05, average: 0.075, high: 0.1 } },
  ]);
  // Stake + fee currency once, then the rest of the catalog's list.
  assert.deepEqual(
    info.currencies.map((c) => c.coinDenom),
    ["SAF", "DYMA"],
  );
  // Only features Keplr knows: one unknown flag fails the whole suggestion there.
  assert.deepEqual(info.features, ["cosmwasm"]);
  assert.match(info.chainSymbolImageUrl!, /^https:\/\//);
});

test("no https endpoints, no suggestion", () => {
  assert.throws(() => buildSuggestChainInfo({ ...SAFRO, rpc: undefined }), SuggestUnavailableError);
  assert.throws(() => buildSuggestChainInfo({ ...SAFRO, rest: "http://insecure.example" }), SuggestUnavailableError);
});

test("a separate fee token keeps its own denom and decimals", () => {
  const info = buildSuggestChainInfo({
    ...SAFRO,
    chainId: "atomone-1",
    coinDenom: "ATONE",
    coinMinimalDenom: "uatone",
    coinGeckoId: "atomone",
    feeDenom: "PHOTON",
    feeMinimalDenom: "uphoton",
    currencies: [],
  });
  assert.equal(info.feeCurrencies[0]!.coinMinimalDenom, "uphoton");
  assert.equal(info.feeCurrencies[0]!.coinGeckoId, undefined);
  assert.equal(info.stakeCurrency.coinGeckoId, "atomone");
  assert.deepEqual(
    info.currencies.map((c) => c.coinMinimalDenom),
    ["uatone", "uphoton"],
  );
});
