/**
 * The venue check's rules (src/lib/swap/venue.ts): what the Osmosis LCD must
 * answer for the crosschain-swaps address before Zunia puts it in a memo.
 * The answer below is lcd.osmosis.zone's for the shipped candidate on
 * 2026-10-07 (code 37, label "CrossChainSwaps v1.2", admin a plain account).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SKIP_ENTRY_POINT, XCS_CONTRACT_CANDIDATES, XCS_CONTRACT_CODE_IDS } from "@/config/interchain";
import { skipVenueFromContractInfo, venueFromContractInfo, venueOff } from "../venue";

const XCS = "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs";

const LIVE = {
  address: XCS,
  contract_info: {
    code_id: "37",
    creator: "osmo1tfu4j7nzfhtex2wyp946rm02748zxu8w8dlm3v",
    admin: "osmo1tfu4j7nzfhtex2wyp946rm02748zxu8w8dlm3v",
    label: "CrossChainSwaps v1.2",
    created: { block_height: "9123190", tx_index: "791486" },
    ibc_port_id: "",
    extension: null,
  },
};

describe("the swap venue check", () => {
  test("ships the verified candidate and the code it runs", () => {
    assert.deepEqual(XCS_CONTRACT_CANDIDATES, [XCS]);
    assert.deepEqual(XCS_CONTRACT_CODE_IDS, ["37"]);
  });

  test("verifies the live answer: echoed address, CrossChainSwaps label, reviewed code", () => {
    assert.deepEqual(venueFromContractInfo(XCS, LIVE), {
      chainId: "osmosis-1",
      address: XCS,
      contract: { address: XCS, verified: true, label: "CrossChainSwaps v1.2", codeId: "37" },
      reason: null,
    });
    // Some gateways send the code id as a number.
    assert.equal(venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, code_id: 37 } }).address, XCS);
  });

  test("turns the contract path off after a migration to other code, label unchanged", () => {
    const migrated = venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, code_id: "9001" } });
    assert.equal(migrated.address, null);
    assert.deepEqual(migrated.contract, { address: XCS, verified: false, label: "CrossChainSwaps v1.2", codeId: "9001" });
    assert.match(migrated.reason ?? "", /now runs code 9001, not the code Zunia was reviewed against/);
    const unnamed = venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, code_id: undefined } });
    assert.match(unnamed.reason ?? "", /code Osmosis did not name/);
  });

  test("refuses another contract, an answer for another address, and an unreadable answer", () => {
    const router = venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, label: "swaprouter" } });
    assert.equal(router.address, null);
    assert.match(router.reason ?? "", /labelled "swaprouter", not a CrossChainSwaps contract/);
    assert.equal(venueFromContractInfo(XCS, { ...LIVE, address: "osmo1other" }).address, null);
    assert.equal(venueFromContractInfo(XCS, { address: XCS }).address, null);
    assert.equal(venueFromContractInfo(XCS, null).address, null);
    assert.equal(venueFromContractInfo(XCS, "<html>").address, null);
  });

  test("words every refusal for users: no setting, host or upstream text", () => {
    const reasons = [
      venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, code_id: "1" } }).reason,
      venueFromContractInfo(XCS, { ...LIVE, contract_info: { ...LIVE.contract_info, label: "x".repeat(500) } }).reason,
      venueFromContractInfo(XCS, {}).reason,
    ];
    for (const reason of reasons) {
      assert.ok(reason);
      assert.doesNotMatch(reason, /ZUNIA_|process\.env|https?:\/\//);
      assert.ok(reason.length < 260, reason);
    }
    assert.deepEqual(venueOff(null, "off"), { chainId: "osmosis-1", address: null, contract: null, reason: "off" });
  });
});

/** osmosis-rest.publicnode.com's answer for Skip's entry point on 2026-11-06: code 1241, no admin. */
const SKIP_LIVE = {
  address: SKIP_ENTRY_POINT,
  contract_info: {
    code_id: "1241",
    creator: "osmo1zhqrfu9w3sugwykef3rq8t0vlxkz72vwd63q67",
    admin: "",
    label: "Skip Swap Entry Point",
    created: { block_height: "23628927", tx_index: "0" },
    ibc_port_id: "",
    extension: null,
  },
};

describe("Skip's entry point check", () => {
  test("verifies the shipped entry point as Osmosis reports it", () => {
    const venue = skipVenueFromContractInfo(SKIP_ENTRY_POINT, SKIP_LIVE);
    assert.equal(venue.address, SKIP_ENTRY_POINT);
    assert.deepEqual(venue.contract, { address: SKIP_ENTRY_POINT, verified: true, label: "Skip Swap Entry Point", codeId: "1241" });
    assert.equal(venue.reason, null);
  });

  test("refuses an admin, other code, another label, another address, or an answer for another contract", () => {
    const withInfo = (patch: Record<string, unknown>) => ({ ...SKIP_LIVE, contract_info: { ...SKIP_LIVE.contract_info, ...patch } });
    const admin = skipVenueFromContractInfo(SKIP_ENTRY_POINT, withInfo({ admin: "osmo1zhqrfu9w3sugwykef3rq8t0vlxkz72vwd63q67" }));
    assert.equal(admin.address, null);
    assert.match(admin.reason ?? "", /admin who could change its code/);
    const code = skipVenueFromContractInfo(SKIP_ENTRY_POINT, withInfo({ code_id: "1300" }));
    assert.equal(code.address, null);
    assert.match(code.reason ?? "", /runs code 1300/);
    const label = skipVenueFromContractInfo(SKIP_ENTRY_POINT, withInfo({ label: "Skip Swap Swap Adapter osmosis-poolmanager" }));
    assert.equal(label.address, null);
    const other = "osmo1xzphwrc9aahmq7smwaggukwx5w2w8mmtqf5mk0ky0v6hh75paxsszfnlu5";
    assert.equal(skipVenueFromContractInfo(other, { ...SKIP_LIVE, address: other }).address, null);
    assert.equal(skipVenueFromContractInfo(SKIP_ENTRY_POINT, { ...SKIP_LIVE, address: other }).address, null);
    assert.equal(skipVenueFromContractInfo(SKIP_ENTRY_POINT, { address: SKIP_ENTRY_POINT }).address, null);
  });
});
