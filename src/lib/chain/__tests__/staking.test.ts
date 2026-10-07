/**
 * Account staking readers, the security review readers and the `accounts=`
 * parameter. The weighted APR must count an inactive validator at 0 % and
 * refuse to average over unknowns; a security review must keep every field
 * that says what a grant allows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAccounts, splitAccounts } from "../accounts";
import { parseAuthzGrants, parseFeeGrants } from "../security";
import {
  nextRelease,
  otherDenoms,
  parseDelegations,
  parseRedelegations,
  parseRewards,
  parseUnbonding,
  parseWithdrawAddress,
  sumDenom,
  weightedApr,
} from "../staking";

test("delegations and rewards (live Safrochain shapes)", () => {
  assert.deepEqual(
    parseDelegations({
      delegation_responses: [
        {
          delegation: {
            delegator_address: "addr_safro1q4c4p0n66crlkgagr76mjtnmt4d8pdlq3gcr9j",
            validator_address: "addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z",
            shares: "30000000.000000000000000000",
          },
          balance: { denom: "usaf", amount: "30000000" },
        },
        { delegation: {}, balance: { denom: "usaf", amount: "1" } },
      ],
    }),
    [{ validator: "addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z", denom: "usaf", amount: "30000000" }],
  );
  const rewards = parseRewards({
    rewards: [
      {
        validator_address: "val-a",
        reward: [
          { denom: "usaf", amount: "503521.100598716310000000" },
          { denom: "ibc/ABC", amount: "0.5" },
        ],
      },
    ],
    total: [],
  });
  // The 0.5 dust truncates to 0 and is dropped.
  assert.deepEqual(rewards.get("val-a"), [{ denom: "usaf", amount: "503521" }]);
});

test("unbonding and redelegation entries, soonest first", () => {
  const unbonding = parseUnbonding({
    unbonding_responses: [
      {
        validator_address: "val-a",
        entries: [
          { creation_height: "200", completion_time: "2026-10-23T15:05:26Z", initial_balance: "50", balance: "45" },
          { creation_height: "100", completion_time: "2026-10-20T15:05:26Z", initial_balance: "10", balance: "10" },
        ],
      },
    ],
  });
  assert.equal(unbonding.length, 1);
  assert.deepEqual(unbonding[0]!.entries.map((e) => [e.completionTime, e.balance, e.initialBalance, e.creationHeight]), [
    ["2026-10-20T15:05:26Z", "10", "10", 100],
    ["2026-10-23T15:05:26Z", "45", "50", 200],
  ]);
  assert.deepEqual(nextRelease(unbonding), { completionTime: "2026-10-20T15:05:26Z", balance: "10" });
  assert.equal(nextRelease([]), null);

  const redelegations = parseRedelegations({
    redelegation_responses: [
      {
        redelegation: { validator_src_address: "val-a", validator_dst_address: "val-b", entries: [] },
        entries: [
          {
            redelegation_entry: { creation_height: "7", completion_time: "2026-10-30T00:00:00Z", initial_balance: "99", shares_dst: "99.0" },
            balance: "99",
          },
        ],
      },
    ],
  });
  assert.deepEqual(redelegations, [
    {
      src: "val-a",
      dst: "val-b",
      entries: [{ balance: "99", initialBalance: "99", completionTime: "2026-10-30T00:00:00Z", creationHeight: 7 }],
    },
  ]);
  assert.equal(parseWithdrawAddress({ withdraw_address: "cosmos1abc" }), "cosmos1abc");
});

test("totals by denom", () => {
  const lists = [
    [{ denom: "uatom", amount: "5" }, { denom: "ibc/X", amount: "2" }],
    [{ denom: "uatom", amount: "7" }, { denom: "ibc/X", amount: "3" }, { denom: "ibc/Y", amount: "9" }],
  ];
  assert.equal(sumDenom(lists, "uatom"), "12");
  assert.deepEqual(otherDenoms(lists, "uatom"), [
    { denom: "ibc/Y", amount: "9" },
    { denom: "ibc/X", amount: "5" },
  ]);
});

test("weighted APR: inactive at 0 %, unknown poisons the average", () => {
  assert.equal(weightedApr([{ amount: "300", apr: 0.2 }, { amount: "100", apr: 0 }]), 0.15);
  assert.equal(weightedApr([{ amount: "300", apr: 0.2 }, { amount: "100", apr: null }]), null);
  assert.equal(weightedApr([]), null);
  // A zero position does not count either way.
  assert.equal(weightedApr([{ amount: "0", apr: null }, { amount: "10", apr: 0.1 }]), 0.1);
});

test("authz grants: generic, stake (allow list) and send (spend limit)", () => {
  const rows = parseAuthzGrants(
    {
      grants: [
        {
          granter: "cosmos1me",
          grantee: "cosmos1bot",
          authorization: {
            "@type": "/cosmos.staking.v1beta1.StakeAuthorization",
            max_tokens: { denom: "uatom", amount: "1000" },
            allow_list: { address: ["cosmosvaloper1x"] },
            authorization_type: "AUTHORIZATION_TYPE_DELEGATE",
          },
          expiration: "2027-01-09T07:00:00Z",
        },
        {
          granter: "cosmos1me",
          grantee: "cosmos1app",
          authorization: { "@type": "/cosmos.authz.v1beta1.GenericAuthorization", msg: "/cosmos.gov.v1beta1.MsgVote" },
          expiration: null,
        },
        {
          granter: "cosmos1me",
          grantee: "cosmos1shop",
          authorization: { "@type": "/cosmos.bank.v1beta1.SendAuthorization", spend_limit: [{ denom: "uatom", amount: "5" }] },
          expiration: "2026-12-01T00:00:00Z",
        },
        { granter: "cosmos1me", authorization: {} },
      ],
    },
    "cosmoshub-4",
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    chainId: "cosmoshub-4",
    granter: "cosmos1me",
    grantee: "cosmos1bot",
    authorization: "StakeAuthorization",
    authorizationTypeUrl: "/cosmos.staking.v1beta1.StakeAuthorization",
    expiration: "2027-01-09T07:00:00Z",
    stakeAction: "delegate",
    validators: ["cosmosvaloper1x"],
    spendLimit: [{ denom: "uatom", amount: "1000" }],
  });
  assert.equal(rows[1]!.msgTypeUrl, "/cosmos.gov.v1beta1.MsgVote");
  assert.equal(rows[1]!.expiration, null, "a grant without expiry never expires");
  assert.deepEqual(rows[2]!.spendLimit, [{ denom: "uatom", amount: "5" }]);
});

test("fee grants: basic, periodic and message-limited allowances", () => {
  const rows = parseFeeGrants(
    {
      allowances: [
        {
          granter: "osmo1me",
          grantee: "osmo1a",
          allowance: { "@type": "/cosmos.feegrant.v1beta1.BasicAllowance", spend_limit: [{ denom: "uosmo", amount: "100" }], expiration: "2027-01-01T00:00:00Z" },
        },
        {
          granter: "osmo1me",
          grantee: "osmo1b",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            allowance: {
              "@type": "/cosmos.feegrant.v1beta1.PeriodicAllowance",
              basic: { spend_limit: [], expiration: null },
              period: "86400s",
            },
            allowed_messages: ["/cosmos.bank.v1beta1.MsgSend"],
          },
        },
      ],
    },
    "osmosis-1",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.allowance, "BasicAllowance");
  assert.deepEqual(rows[0]!.spendLimit, [{ denom: "uosmo", amount: "100" }]);
  assert.equal(rows[0]!.expiration, "2027-01-01T00:00:00Z");
  assert.equal(rows[1]!.allowance, "AllowedMsgAllowance");
  assert.deepEqual(rows[1]!.allowedMessages, ["/cosmos.bank.v1beta1.MsgSend"]);
  assert.equal(rows[1]!.expiration, null);
  assert.equal(rows[1]!.spendLimit, undefined);
});

test("accounts parameter: one address per chain, bounded, malformed refused", () => {
  assert.equal(
    formatAccounts([
      { chainId: "cosmoshub-4", address: "cosmos1a" },
      { chainId: "osmosis-1", address: "osmo1a" },
      { chainId: "cosmoshub-4", address: "cosmos1b" },
    ]),
    "cosmoshub-4:cosmos1a,osmosis-1:osmo1a",
  );
  assert.deepEqual(splitAccounts("cosmoshub-4:cosmos1a, osmosis-1:osmo1a,,cosmoshub-4:cosmos1b", 10), {
    ok: true,
    accounts: [
      { chainId: "cosmoshub-4", address: "cosmos1a" },
      { chainId: "osmosis-1", address: "osmo1a" },
    ],
  });
  assert.equal(splitAccounts("cosmos1a", 10).ok, false);
  assert.equal(splitAccounts(":cosmos1a", 10).ok, false);
  const tooMany = splitAccounts("a:x,b:x,c:x", 2);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.ok === false && tooMany.code, "accounts_too_many");
  assert.deepEqual(splitAccounts(null, 5), { ok: true, accounts: [] });
});
