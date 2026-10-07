/**
 * The signature check before broadcast: valid signatures pass whoever made
 * them, signatures over other bytes do not, and what it cannot check it
 * leaves to the chain.
 *
 * Valid signatures come from three independent places:
 * - the vendored CosmJS vectors (`vectors/cosmos-signing.json`), signed here
 *   with their public test key ("abandon … about");
 * - `fixtures/cosmjs-signatures.json`: CosmJS (elliptic, what Keplr's software
 *   keys sign) over the same documents, so two implementations agree;
 * - `fixtures/chain-verified-amino.json`: real cosmoshub-4 transactions whose
 *   signatures the chain accepted, made by real wallets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import type { StdSignDoc } from "../amino-tx";
import { fromBase64, fromHex, serializeAminoSignDoc, sortKeysDeep, toHex } from "../bytes";
import {
  COSMOS_PUBKEY_TYPE_URL,
  ETHERMINT_PUBKEY_TYPE_URL,
  encodeAuthInfo,
  encodePubKeyAny,
  encodeSignDoc,
  encodeTxBody,
  SIGN_MODE_DIRECT,
} from "../encode";
import { buildSend } from "../messages";
import { COSMOS_EVM_PUBKEY_TYPE_URL, INITIA_PUBKEY_TYPE_URL, INJECTIVE_PUBKEY_TYPE_URL } from "../pubkey";
import { checkAminoSignature, checkDirectSignature, signatureDigest, signerKeyTypeUrl } from "../verify-signature";

type VectorCase = {
  name: string;
  amino: { sign_doc: string; sign_bytes_hex: string };
  direct: { body_bytes_hex: string; auth_info_bytes_hex: string; sign_bytes_hex: string };
};
const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "vectors/cosmos-signing.json"), "utf8")) as {
  key: { privkey_hex: string; pubkey_compressed_hex: string; addresses: { cosmos: string } };
  cases: VectorCase[];
  adr36: { sign_doc: string; sign_bytes_hex: string }[];
};
const cosmjs = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/cosmjs-signatures.json"), "utf8")) as {
  pubKeyHex: string;
  aminoCases: { name: string; expect: "valid" | "invalid"; why?: "line-separator" | "unescaped"; signed: StdSignDoc; signature: string }[];
  directCases: { name: string; chainId: string; accountNumber: string; bodyBytesHex: string; authInfoBytesHex: string; signature: string }[];
};
const chainVerified = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/chain-verified-amino.json"), "utf8")) as {
  cases: { name: string; txHash: string; pubKey: string; signature: string; signBytesHex: string }[];
};

/** The vectors' key: the public "abandon … about" test phrase, m/44'/118'/0'/0/0. */
const PRIVKEY = fromHex(vectors.key.privkey_hex);
const PUBKEY = fromHex(vectors.key.pubkey_compressed_hex);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const sign = (bytes: Uint8Array, digest: (b: Uint8Array) => Uint8Array = sha256): Uint8Array =>
  secp256k1.sign(digest(bytes), PRIVKEY, { prehash: false });
const flipped = (signature: Uint8Array): Uint8Array => {
  const out = signature.slice();
  out[17]! ^= 0x01;
  return out;
};
const utf8 = (text: string) => new TextEncoder().encode(text);
/** The bytes CosmJS `serializeSignDoc` signs: `&`, `<`, `>` escaped, nothing else. */
const cosmjsBytes = (doc: unknown) =>
  utf8(JSON.stringify(sortKeysDeep(doc)).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e"));
const plainBytes = (doc: unknown) => utf8(JSON.stringify(sortKeysDeep(doc)));

const aminoCheck = (signed: StdSignDoc, signature: Uint8Array, pubKey = PUBKEY, pubKeyTypeUrl = COSMOS_PUBKEY_TYPE_URL) =>
  checkAminoSignature({ signed, pubKey, pubKeyTypeUrl, signature });

function directDoc(typeUrl = COSMOS_PUBKEY_TYPE_URL, memo = "") {
  const send = buildSend({ fromAddress: vectors.key.addresses.cosmos, toAddress: vectors.key.addresses.cosmos, amount: [{ denom: "uatom", amount: "1" }] });
  return {
    bodyBytes: encodeTxBody({ messages: [send], memo }),
    authInfoBytes: encodeAuthInfo({
      signers: [{ publicKey: encodePubKeyAny(PUBKEY, typeUrl), mode: SIGN_MODE_DIRECT, sequence: 7 }],
      fee: { amount: [{ denom: "uatom", amount: "5000" }], gasLimit: 200_000 },
    }),
    chainId: "cosmoshub-4",
    accountNumber: "12345",
  };
}

test("the digest follows the key type: SHA-256 for Cosmos keys, keccak256 for the ethsecp256k1 family, nothing else known", () => {
  assert.equal(signatureDigest(COSMOS_PUBKEY_TYPE_URL), "sha256");
  for (const typeUrl of [ETHERMINT_PUBKEY_TYPE_URL, INJECTIVE_PUBKEY_TYPE_URL, COSMOS_EVM_PUBKEY_TYPE_URL, INITIA_PUBKEY_TYPE_URL]) {
    assert.equal(signatureDigest(typeUrl), "keccak256", typeUrl);
  }
  for (const typeUrl of ["/cosmos.crypto.ed25519.PubKey", "/cosmos.crypto.multisig.LegacyAminoPubKey", "/cosmos.crypto.secp256r1.PubKey", "tendermint/PubKeySecp256k1", ""]) {
    assert.equal(signatureDigest(typeUrl), null, typeUrl);
  }
});

for (const c of vectors.cases) {
  test(`${c.name}: the vector's sign bytes, signed with its key, verify in both modes; one flipped bit does not`, () => {
    const doc = JSON.parse(c.amino.sign_doc) as StdSignDoc;
    // A1 and CosmJS write the same bytes for every vector: none holds U+2028 or U+2029.
    assert.equal(toHex(serializeAminoSignDoc(doc)), c.amino.sign_bytes_hex);
    const aminoSignature = sign(fromHex(c.amino.sign_bytes_hex));
    assert.deepEqual(aminoCheck(doc, aminoSignature), { verdict: "valid", detail: null });
    assert.equal(aminoCheck(doc, flipped(aminoSignature)).verdict, "invalid");

    const signDoc = {
      bodyBytes: fromHex(c.direct.body_bytes_hex),
      authInfoBytes: fromHex(c.direct.auth_info_bytes_hex),
      chainId: doc.chain_id,
      accountNumber: doc.account_number,
    };
    assert.equal(toHex(encodeSignDoc(signDoc)), c.direct.sign_bytes_hex);
    const directSignature = sign(fromHex(c.direct.sign_bytes_hex));
    const direct = (signature: Uint8Array, accountNumber = signDoc.accountNumber) =>
      checkDirectSignature({ ...signDoc, accountNumber, pubKey: PUBKEY, pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL, signature });
    assert.deepEqual(direct(directSignature), { verdict: "valid", detail: null });
    assert.equal(direct(flipped(directSignature)).verdict, "invalid");
    // The chain checks its own account number: another one is other bytes.
    assert.equal(direct(directSignature, "12346").verdict, "invalid");
    // The amino signature is not a direct one, and the other way round.
    assert.equal(direct(aminoSignature).verdict, "invalid");
    assert.equal(aminoCheck(doc, directSignature).verdict, "invalid");
  });
}

test("ADR-36 sign-in documents (empty chain id and fee) verify the same way", () => {
  for (const a of vectors.adr36) {
    const doc = JSON.parse(a.sign_doc) as StdSignDoc;
    assert.equal(toHex(serializeAminoSignDoc(doc)), a.sign_bytes_hex);
    assert.equal(aminoCheck(doc, sign(fromHex(a.sign_bytes_hex))).verdict, "valid");
  }
});

test("CosmJS signatures (what Keplr signs) verify, and the two the chain would refuse are named", () => {
  assert.equal(cosmjs.pubKeyHex, vectors.key.pubkey_compressed_hex);
  assert.ok(cosmjs.aminoCases.length >= vectors.cases.length + 3 && cosmjs.directCases.length === vectors.cases.length);
  for (const c of cosmjs.aminoCases) {
    const check = aminoCheck(c.signed, fromBase64(c.signature));
    assert.equal(check.verdict, c.expect, c.name);
    if (c.why === "line-separator") assert.match(check.detail!, /U\+2028 or U\+2029 left unescaped/, c.name);
    if (c.why === "unescaped") assert.match(check.detail!, /without the chain's escaping of &, < and >/, c.name);
  }
  for (const c of cosmjs.directCases) {
    const check = checkDirectSignature({
      bodyBytes: fromHex(c.bodyBytesHex),
      authInfoBytes: fromHex(c.authInfoBytesHex),
      chainId: c.chainId,
      accountNumber: c.accountNumber,
      pubKey: PUBKEY,
      pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL,
      signature: fromBase64(c.signature),
    });
    assert.deepEqual(check, { verdict: "valid", detail: null }, c.name);
  }
  // noble's RFC 6979 signature is CosmJS's, byte for byte: the same bytes signed the same way.
  const send = cosmjs.aminoCases.find((c) => c.name === "msg_send")!;
  assert.equal(toHex(sign(serializeAminoSignDoc(send.signed))), toHex(fromBase64(send.signature)));
});

test("real cosmoshub-4 signatures, made by real wallets and accepted by the chain, verify", () => {
  assert.ok(chainVerified.cases.length >= 5);
  for (const c of chainVerified.cases) {
    // The verified sign bytes are the document as the chain wrote it; parsed, it is what a wallet returns.
    const signed = JSON.parse(new TextDecoder().decode(fromHex(c.signBytesHex))) as StdSignDoc;
    const pubKey = fromBase64(c.pubKey);
    const signature = fromBase64(c.signature);
    assert.deepEqual(aminoCheck(signed, signature, pubKey), { verdict: "valid", detail: null }, c.name);
    assert.equal(aminoCheck({ ...signed, memo: `${signed.memo}x` }, signature, pubKey).verdict, "invalid", c.name);
    assert.equal(aminoCheck(signed, signature, PUBKEY).verdict, "invalid", `${c.name}: another key`);
  }
});

test("A1: U+2028 and U+2029 are written as Go writes them, and only a signature over those bytes verifies", () => {
  const doc = { ...(JSON.parse(vectors.cases[0]!.amino.sign_doc) as StdSignDoc), memo: `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c & <d>` };
  const text = new TextDecoder().decode(serializeAminoSignDoc(doc));
  assert.ok(text.includes('"memo":"a\\u2028b\\u2029c \\u0026 \\u003cd\\u003e"'), text);
  assert.ok(!text.includes(LINE_SEPARATOR) && !text.includes(PARAGRAPH_SEPARATOR));
  assert.equal(aminoCheck(doc, sign(serializeAminoSignDoc(doc))).verdict, "valid");
  // Keplr and Zunia Mobile (CosmJS escaping): refused, and said why.
  const keplr = aminoCheck(doc, sign(cosmjsBytes(doc)));
  assert.equal(keplr.verdict, "invalid");
  assert.match(keplr.detail!, /U\+2028 or U\+2029 left unescaped/);
  // The Zunia extension up to 0.1.4 (nothing escaped).
  const legacy = aminoCheck(doc, sign(plainBytes(doc)));
  assert.equal(legacy.verdict, "invalid");
  assert.match(legacy.detail!, /without the chain's escaping of &, < and >/);
});

test("a document with nothing to escape: every serializer agrees, so every one of them verifies", () => {
  const doc = JSON.parse(vectors.cases[1]!.amino.sign_doc) as StdSignDoc;
  assert.equal(toHex(cosmjsBytes(doc)), toHex(serializeAminoSignDoc(doc)));
  assert.equal(toHex(plainBytes(doc)), toHex(serializeAminoSignDoc(doc)));
  assert.equal(aminoCheck(doc, sign(plainBytes(doc))).verdict, "valid");
});

test("an amino signature over something else entirely is invalid, with no claim about what it was over", () => {
  const doc = JSON.parse(vectors.cases[0]!.amino.sign_doc) as StdSignDoc;
  const check = aminoCheck(doc, sign(utf8("something else")));
  assert.equal(check.verdict, "invalid");
  assert.match(check.detail!, /does not verify over the document the chain rebuilds/);
});

test("Ethereum keys: direct is checked over keccak256; amino is left to the chain (EIP-712)", () => {
  for (const typeUrl of [INJECTIVE_PUBKEY_TYPE_URL, ETHERMINT_PUBKEY_TYPE_URL, COSMOS_EVM_PUBKEY_TYPE_URL]) {
    const doc = directDoc(typeUrl);
    const bytes = encodeSignDoc(doc);
    const check = (signature: Uint8Array) => checkDirectSignature({ ...doc, pubKey: PUBKEY, pubKeyTypeUrl: typeUrl, signature });
    assert.deepEqual(check(sign(bytes, keccak_256)), { verdict: "valid", detail: null }, typeUrl);
    const sha = check(sign(bytes));
    assert.equal(sha.verdict, "invalid", typeUrl);
    assert.equal(sha.detail, "The direct signature is over the transaction's SHA-256 digest; the chain checks keccak256 for this key type.");
  }
  // And the other way round on a Cosmos key.
  const cosmos = directDoc();
  const keccakOnCosmos = checkDirectSignature({ ...cosmos, pubKey: PUBKEY, pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL, signature: sign(encodeSignDoc(cosmos), keccak_256) });
  assert.equal(keccakOnCosmos.verdict, "invalid");
  assert.match(keccakOnCosmos.detail!, /keccak256 digest; the chain checks SHA-256/);

  const amino = JSON.parse(vectors.cases[0]!.amino.sign_doc) as StdSignDoc;
  const eip712 = aminoCheck(amino, sign(utf8("an EIP-712 digest stand-in"), keccak_256), PUBKEY, ETHERMINT_PUBKEY_TYPE_URL);
  assert.equal(eip712.verdict, "unchecked");
  assert.match(eip712.detail!, /EIP-712/);
});

test("the key type the auth info names is the one checked: it is what the chain reads", () => {
  const doc = directDoc(ETHERMINT_PUBKEY_TYPE_URL);
  assert.equal(signerKeyTypeUrl(doc.authInfoBytes), ETHERMINT_PUBKEY_TYPE_URL);
  const planned = (signature: Uint8Array) => checkDirectSignature({ ...doc, pubKey: PUBKEY, pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL, signature });
  assert.equal(planned(sign(encodeSignDoc(doc), keccak_256)).verdict, "valid");
  assert.equal(planned(sign(encodeSignDoc(doc))).verdict, "invalid");
  // Auth info with no signer key to read: the planned type decides.
  const keyless = { ...doc, authInfoBytes: encodeAuthInfo({ signers: [{ publicKey: null, mode: SIGN_MODE_DIRECT, sequence: 7 }], fee: { amount: [], gasLimit: 1 } }) };
  assert.equal(signerKeyTypeUrl(keyless.authInfoBytes), null);
  assert.equal(signerKeyTypeUrl(new Uint8Array([0xff, 0xff])), null);
  assert.equal(
    checkDirectSignature({ ...keyless, pubKey: PUBKEY, pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL, signature: sign(encodeSignDoc(keyless)) }).verdict,
    "valid",
  );
});

test("what it cannot check is left to the chain: unknown key types, keys that are not compressed points, odd signatures", () => {
  const doc = directDoc();
  const bytes = encodeSignDoc(doc);
  const good = sign(bytes);
  const direct = (pubKey: Uint8Array, signature = good, pubKeyTypeUrl = COSMOS_PUBKEY_TYPE_URL) =>
    checkDirectSignature({ ...doc, authInfoBytes: doc.authInfoBytes, pubKey, pubKeyTypeUrl, signature });
  const offCurve = new Uint8Array(33).fill(0xff);
  offCurve[0] = 0x02;
  const badPrefix = PUBKEY.slice();
  badPrefix[0] = 0x05;
  const uncompressed = secp256k1.getPublicKey(PRIVKEY, false);
  for (const [what, pubKey] of [
    ["off-curve", offCurve],
    ["bad prefix", badPrefix],
    ["uncompressed", uncompressed],
    ["32 bytes", PUBKEY.slice(1)],
  ] as const) {
    const check = direct(pubKey);
    assert.equal(check.verdict, "unchecked", what);
    assert.match(check.detail!, /not a 33-byte compressed secp256k1 key/, what);
    assert.equal(aminoCheck(JSON.parse(vectors.cases[0]!.amino.sign_doc) as StdSignDoc, good, pubKey).verdict, "unchecked", what);
  }
  const keyless = { ...doc, authInfoBytes: encodeAuthInfo({ signers: [{ publicKey: null, mode: SIGN_MODE_DIRECT, sequence: 7 }], fee: { amount: [], gasLimit: 1 } }) };
  const ed25519 = checkDirectSignature({ ...keyless, pubKey: PUBKEY, pubKeyTypeUrl: "/cosmos.crypto.ed25519.PubKey", signature: good });
  assert.equal(ed25519.verdict, "unchecked");
  assert.match(ed25519.detail!, /\/cosmos\.crypto\.ed25519\.PubKey is not a key type this check knows/);
  assert.equal(direct(PUBKEY, new Uint8Array(65)).verdict, "unchecked");
});

test("a high S or a random nonce over the right bytes is still the wallet's signature", () => {
  const doc = directDoc();
  const bytes = encodeSignDoc(doc);
  const check = (signature: Uint8Array) => checkDirectSignature({ ...doc, pubKey: PUBKEY, pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL, signature });
  // secp256k1's group order. BigInt() rather than an `n` literal: the
  // project targets below ES2020, where tsc refuses BigInt literals.
  const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const low = sign(bytes);
  const s = BigInt(`0x${toHex(low.slice(32))}`);
  const high = new Uint8Array(64);
  high.set(low.slice(0, 32));
  high.set(fromHex((N - s).toString(16).padStart(64, "0")), 32);
  assert.notEqual(toHex(high), toHex(low));
  assert.equal(check(high).verdict, "valid");
  const hedged = secp256k1.sign(sha256(bytes), PRIVKEY, { prehash: false, extraEntropy: true });
  assert.notEqual(toHex(hedged), toHex(low));
  assert.equal(check(hedged).verdict, "valid");
});
