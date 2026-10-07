/**
 * Shared test inputs: the recorded transactions in ./fixtures and a small,
 * fixed identity table.
 *
 * Fixtures are real `GET /cosmos/tx/v1beta1/txs/{hash}` bodies, fetched from
 * the public nodes the catalog lists on 2026-10-07 (Safrochain, Keplr's Hub
 * and Osmosis, Keplr's Kava for the SDK 0.47 `logs` shape; `safro-authz-*` are
 * a compounding bot's MsgExec, D880E8E2… and D5039CF5…; `safro-create-validator`
 * is Vinjan's MsgCreateValidator, 463FD64E…). They are not edited:
 * what the decoder reads is exactly what the chain served.
 *
 * Identities are a fixed stand-in for lib/token/identity (which needs the
 * server-only catalog loader): the chains' own coins with 6 decimals, the one
 * voucher the fixtures name on purpose (Injective's USDC, held on Osmosis and
 * Safrochain), and `IBC·XXXX` with unknown decimals for everything else, the
 * same convention the real engine uses for an unproven voucher.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenIdentity } from "@/lib/token/types";
import type { DecodeContext } from "../decode";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

const NATIVE: Readonly<Record<string, string>> = {
  usaf: "SAF",
  uosmo: "OSMO",
  uatom: "ATOM",
  ukava: "KAVA",
};

/** Injective USDC (`erc20:0xa00C…`), as held on two of the fixture chains. */
const USDC_INJ: Readonly<Record<string, string>> = {
  "osmosis-1": "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138",
  "safrochain-1": "ibc/1E180C085A3A2688CDF2A781E5990BE8AA92CE69CB62A8CC6BB9F5EE17DD5C38",
};

export function testIdentity(chainId: string, denom: string): TokenIdentity {
  const native = NATIVE[denom];
  if (native) {
    return { key: `${chainId}:${denom}`, chainId, denom, kind: "native", ticker: native, name: native, decimals: 6, provenance: "native", proven: true };
  }
  if (USDC_INJ[chainId] === denom) {
    return {
      key: "injective-1:erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
      chainId,
      denom,
      kind: "ibc",
      ticker: "USDC.inj",
      name: "Injective USDC",
      decimals: 6,
      provenance: "table",
      proven: true,
    };
  }
  const hash = denom.split("/").pop() ?? denom;
  return {
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    kind: denom.startsWith("ibc/") ? "ibc" : "other",
    ticker: `IBC·${hash.slice(0, 4).toUpperCase()}`,
    name: "Unknown token",
    decimals: null,
    provenance: "unknown",
    proven: false,
  };
}

const PEERS: Readonly<Record<string, Readonly<Record<string, { chainId: string; chainName: string }>>>> = {
  "safrochain-1": {
    "channel-0": { chainId: "noble-1", chainName: "Noble" },
    "channel-1": { chainId: "osmosis-1", chainName: "Osmosis" },
    "channel-2": { chainId: "injective-1", chainName: "Injective" },
  },
  "osmosis-1": { "channel-122": { chainId: "injective-1", chainName: "Injective" } },
};

export function testContext(chainId: string): DecodeContext {
  return {
    chainId,
    identify: (denom) => testIdentity(chainId, denom),
    channelPeer: (channel) => PEERS[chainId]?.[channel] ?? null,
  };
}

/** Accounts the fixtures are about. */
export const ACCOUNTS = {
  /** Vinjan.Inc's validator account on Safrochain. */
  vinjan: "addr_safro1t0aw2zvghsdr7avfksgtsu090w8nvqpcq8z4ps",
  /** Winnode's validator account on Safrochain. */
  winnode: "addr_safro1jz4fmzlc9lskmxum02elvml6jms03wa7gnyzax",
  /** Everstake's validator account on the Hub. */
  everstake: "cosmos1tflk30mq5vgqjdly92kkhhq3raev2hnzldd74z",
  /** The account that signed the recorded Zunia pool swap on Osmosis. */
  swapper: "osmo1zva9t8r8dkugkeytzjjd8fg345sh37ngrwg8mm",
  /** Zunia's Osmosis treasury (config/fees.ts). */
  treasury: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm",
  /** A compounding delegator on Osmosis. */
  compounder: "osmo1h3lnr0a3dgcl0gueu5gsdwxyq6vn60ngx0c47k",
  /** A split-route swapper on Osmosis. */
  splitter: "osmo159dp2sqwyfpv00znzxhxvr682ajnvmf2h9jcvs",
  /** A Kava validator account (SDK 0.47 response shape). */
  kava: "kava1qevj3fw5l3fhh65k6jx4x5x5f8upv58epmsz4w",
  /** A Safrochain validator account that lets a bot compound for it (authz granter). */
  granter: "addr_safro1fvjkhch8wuvhp2altf2zfs65vkza7s3nslt95h",
  /** The compounding bot that signs those MsgExec (authz grantee). */
  grantee: "addr_safro1xx3j7gtv6sd2uldtuhy7kjk2w6v6vqjw7k9kqp",
} as const;
