/**
 * The address tables behind the NFT metadata fetcher's SSRF guard.
 *
 * A token_uri is chosen by whoever minted the token, and this server fetches
 * it. These tests pin the boundary of every refused range (first and last
 * address inside, first address outside) because a prefix length that is off
 * by one bit lets a whole /16 of internal addresses through and still passes a
 * casual check with `127.0.0.1`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockedReason,
  checkRemoteUrl,
  fetchRemoteText,
  isFollowableRedirect,
  parseIpv4,
  parseIpv6,
  readCapped,
  type RemoteFetchDeps,
  type RemoteFetchPolicy,
} from "../remote-guard";

test("IPv4 special ranges are refused at both edges", () => {
  const cases: Array<[string, string | null]> = [
    ["0.0.0.0", "unspecified"],
    ["0.255.255.255", "unspecified"],
    ["1.0.0.0", null],
    ["9.255.255.255", null],
    ["10.0.0.0", "private"],
    ["10.255.255.255", "private"],
    ["11.0.0.0", null],
    ["100.63.255.255", null],
    ["100.64.0.0", "carrier-grade-nat"],
    ["100.127.255.255", "carrier-grade-nat"],
    ["100.128.0.0", null],
    ["126.255.255.255", null],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["128.0.0.0", null],
    ["169.253.255.255", null],
    ["169.254.169.254", "link-local"],
    ["169.255.0.0", null],
    ["172.15.255.255", null],
    ["172.16.0.0", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.0", null],
    ["192.0.0.8", "reserved"],
    ["192.0.2.1", "documentation"],
    ["192.0.3.0", null],
    ["192.88.99.1", "reserved"],
    ["192.167.255.255", null],
    ["192.168.0.1", "private"],
    ["192.168.255.255", "private"],
    ["192.169.0.0", null],
    ["198.17.255.255", null],
    ["198.18.0.0", "benchmarking"],
    ["198.19.255.255", "benchmarking"],
    ["198.20.0.0", null],
    ["198.51.100.7", "documentation"],
    ["203.0.113.9", "documentation"],
    ["223.255.255.255", null],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    // Ordinary public hosts.
    ["8.8.8.8", null],
    ["104.16.132.229", null],
  ];
  for (const [address, expected] of cases) {
    assert.equal(blockedReason(address), expected, address);
  }
});

test("IPv6 loopback, unspecified, ULA, link-local and multicast are refused", () => {
  assert.equal(blockedReason("::"), "unspecified");
  assert.equal(blockedReason("::1"), "loopback");
  assert.equal(blockedReason("0:0:0:0:0:0:0:1"), "loopback");
  assert.equal(blockedReason("fc00::1"), "unique-local");
  assert.equal(blockedReason("fdff:ffff::1"), "unique-local");
  assert.equal(blockedReason("fe80::1"), "link-local");
  assert.equal(blockedReason("fe80::1%eth0"), "link-local");
  assert.equal(blockedReason("febf::1"), "link-local");
  assert.equal(blockedReason("fec0::1"), "reserved");
  assert.equal(blockedReason("ff02::1"), "multicast");
  assert.equal(blockedReason("100::1"), "reserved");
  assert.equal(blockedReason("64:ff9b:1::1"), "translation");
});

test("IPv6 forms that embed an IPv4 address get the IPv4 verdict", () => {
  // Mapped, as the URL parser normalises `[::ffff:127.0.0.1]`.
  assert.equal(blockedReason("::ffff:7f00:1"), "loopback");
  assert.equal(blockedReason("::ffff:127.0.0.1"), "loopback");
  assert.equal(blockedReason("::ffff:169.254.169.254"), "link-local");
  assert.equal(blockedReason("::ffff:10.1.2.3"), "private");
  assert.equal(blockedReason("::ffff:8.8.8.8"), null);
  // Translated (::ffff:0:a.b.c.d) and the deprecated compatible form.
  assert.equal(blockedReason("::ffff:0:192.168.1.1"), "private");
  assert.equal(blockedReason("::127.0.0.1"), "loopback");
  // NAT64 well-known prefix: the gateway forwards to the embedded address.
  assert.equal(blockedReason("64:ff9b::10.0.0.1"), "private");
  assert.equal(blockedReason("64:ff9b::808:808"), null);
});

test("only global unicast IPv6 passes, minus its special carve-outs", () => {
  assert.equal(blockedReason("2606:4700:4700::1111"), null);
  assert.equal(blockedReason("2a00:1450:4001:80b::200e"), null);
  assert.equal(blockedReason("2001:db8::1"), "documentation");
  assert.equal(blockedReason("2001::1"), "reserved"); // Teredo
  assert.equal(blockedReason("2001:1ff::1"), "reserved");
  assert.equal(blockedReason("2001:200::1"), null); // just past 2001::/23
  assert.equal(blockedReason("2002:7f00:1::1"), "translation"); // 6to4
  assert.equal(blockedReason("3fff::1"), "documentation");
  assert.equal(blockedReason("3fff:1000::1"), null); // past 3fff::/20
  assert.equal(blockedReason("4000::1"), "reserved"); // outside 2000::/3
});

test("anything that does not parse is refused, not reinterpreted", () => {
  for (const junk of ["", "localhost", "127.1", "0x7f.0.0.1", "1.2.3", "1.2.3.4.5", "256.1.1.1", "01.2.3.4", "1::2::3", "1:2:3:4:5:6:7:8:9", "gggg::1", "::ffff:1.2.3.999"]) {
    assert.equal(blockedReason(junk), "invalid", junk);
  }
});

test("the parsers read the canonical forms byte for byte", () => {
  assert.deepEqual([...parseIpv4("192.168.1.20")!], [192, 168, 1, 20]);
  assert.equal(parseIpv4("1.2.3"), null);
  assert.deepEqual(
    [...parseIpv6("2001:db8::ff00:42:8329")!],
    [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0xff, 0x00, 0x00, 0x42, 0x83, 0x29],
  );
  assert.deepEqual(
    [...parseIpv6("::ffff:1.2.3.4")!],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 4],
  );
  assert.equal(parseIpv6("1:2:3:4::5:6:7:8"), null); // `::` must stand for at least one group
});

test("only https URLs without credentials pass the URL check", () => {
  const strict = { allowLoopbackHttp: false };
  const ok = checkRemoteUrl("https://meta.example/token/1.json", strict);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.hostname, "meta.example");
    assert.equal(ok.loopbackException, false);
  }

  for (const raw of [
    "http://meta.example/1.json",
    "http://127.0.0.1:8788/v1/devices",
    "ftp://meta.example/1.json",
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_",
    "https://user:secret@meta.example/1.json",
    "not a url",
  ]) {
    assert.equal(checkRemoteUrl(raw, strict).ok, false, raw);
  }
});

test("IPv6 literal hosts lose their brackets so the address check can read them", () => {
  const check = checkRemoteUrl("https://[::ffff:127.0.0.1]/x", { allowLoopbackHttp: false });
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.hostname, "::ffff:7f00:1");
    assert.equal(blockedReason(check.hostname), "loopback");
  }
  // Decimal and hex IPv4 hosts are normalised by the URL parser first.
  const decimal = checkRemoteUrl("https://2130706433/x", { allowLoopbackHttp: false });
  assert.equal(decimal.ok && decimal.hostname, "127.0.0.1");
});

test("the loopback exception is exact and only exists when asked for", () => {
  const dev = { allowLoopbackHttp: true };
  const local = checkRemoteUrl("http://127.0.0.1:8899/ipfs/Qm", dev);
  assert.equal(local.ok && local.loopbackException, true);
  // Not a prefix match: these used to pass a `startsWith("http://127.0.0.1")` test.
  assert.equal(checkRemoteUrl("http://127.0.0.1.attacker.example/x", dev).ok, false);
  assert.equal(checkRemoteUrl("http://localhost:8899/x", dev).ok, false);
  assert.equal(checkRemoteUrl("http://10.0.0.5/x", dev).ok, false);
  // Production never takes it.
  assert.equal(checkRemoteUrl("http://127.0.0.1:8899/ipfs/Qm", { allowLoopbackHttp: false }).ok, false);
});

test("only real redirects are followed", () => {
  for (const status of [301, 302, 303, 307, 308]) assert.equal(isFollowableRedirect(status), true);
  for (const status of [200, 300, 304, 305, 306, 400]) assert.equal(isFollowableRedirect(status), false);
});

/* -------------------------------------------------------------------------- *
 * The redirect loop, driven through a fake network
 * -------------------------------------------------------------------------- */

const POLICY: RemoteFetchPolicy = {
  allowLoopbackHttp: false,
  maxRedirects: 3,
  maxBytes: 1024,
  accept: "application/json",
};

const PUBLIC_IP = "93.184.216.34";

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/**
 * A network made of fixed answers. `requested` is every URL `fetch` was
 * asked for, in order: the assertions that matter are about requests that
 * were *never made*, which a live probe cannot show.
 */
function fakeNetwork(
  routes: Record<string, () => Response>,
  dns: Record<string, readonly string[]>,
) {
  const requested: string[] = [];
  const inits: RequestInit[] = [];
  const resolved: string[] = [];
  const deps: RemoteFetchDeps = {
    fetch: async (url, init) => {
      requested.push(url.href);
      inits.push(init);
      const answer = routes[url.href];
      if (!answer) throw new Error(`unexpected request to ${url.href}`);
      return answer();
    },
    resolve: async (hostname) => {
      resolved.push(hostname);
      // Like dns.lookup: an address literal resolves to itself.
      if (parseIpv4(hostname) || parseIpv6(hostname)) return [{ address: hostname }];
      const answers = dns[hostname];
      if (!answers) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      return answers.map((address) => ({ address }));
    },
  };
  return { deps, requested, inits, resolved };
}

const NO_ABORT = new AbortController().signal;

test("a public https document is read, every request manual-redirect and uncached", async () => {
  const net = fakeNetwork(
    { "https://meta.example/1.json": () => Response.json({ name: "Token 1" }) },
    { "meta.example": [PUBLIC_IP] },
  );
  const text = await fetchRemoteText("https://meta.example/1.json", NO_ABORT, net.deps, POLICY);
  assert.deepEqual(JSON.parse(text), { name: "Token 1" });
  assert.deepEqual(net.resolved, ["meta.example"]);
  assert.equal(net.inits[0]!.redirect, "manual", "fetch must never follow a redirect by itself");
  assert.equal(net.inits[0]!.cache, "no-store");
  assert.equal(net.inits[0]!.signal, NO_ABORT, "the caller's deadline reaches the request");
});

test("a redirect into the host's own network is refused before it is requested", async () => {
  for (const [location, reason] of [
    ["http://127.0.0.1:8788/v1/devices", /Only https/],
    ["https://localhost/admin", /loopback/],
    ["https://169.254.169.254/latest/meta-data/", /link-local/],
    ["https://[::ffff:127.0.0.1]/", /loopback/],
    ["https://internal.example/", /private-network/],
    ["https://user:pw@meta.example/2.json", /credentials/],
  ] as const) {
    const net = fakeNetwork(
      { "https://meta.example/1.json": () => redirect(location) },
      { "meta.example": [PUBLIC_IP], localhost: ["::1", "127.0.0.1"], "internal.example": ["10.1.2.3"] },
    );
    await assert.rejects(
      fetchRemoteText("https://meta.example/1.json", NO_ABORT, net.deps, POLICY),
      reason,
      location,
    );
    assert.deepEqual(net.requested, ["https://meta.example/1.json"], `${location} was requested`);
  }
});

test("a host with any private address is refused, however many public ones it has", async () => {
  const net = fakeNetwork({}, { "split.example": [PUBLIC_IP, "2606:4700::1", "192.168.1.1"] });
  await assert.rejects(
    fetchRemoteText("https://split.example/x", NO_ABORT, net.deps, POLICY),
    /private-network/,
  );
  assert.equal(net.requested.length, 0);
});

test("a name that does not resolve is an error, not a request", async () => {
  const net = fakeNetwork({}, {});
  await assert.rejects(
    fetchRemoteText("https://nowhere.example/x", NO_ABORT, net.deps, POLICY),
    /ENOTFOUND/,
  );
  assert.equal(net.requested.length, 0);
});

test("exactly maxRedirects hops are followed, and the next one is refused unrequested", async () => {
  const hops = ["a", "b", "c", "d", "e"].map((name) => `https://${name}.example/doc`);
  const dns = Object.fromEntries(hops.map((url) => [new URL(url).hostname, [PUBLIC_IP]]));

  // a → b → c → d answers: three redirects, the policy's limit.
  const ok = fakeNetwork(
    {
      [hops[0]!]: () => redirect(hops[1]!, 301),
      [hops[1]!]: () => redirect(hops[2]!, 307),
      [hops[2]!]: () => redirect(hops[3]!, 308),
      [hops[3]!]: () => Response.json({ ok: true }),
    },
    dns,
  );
  assert.deepEqual(JSON.parse(await fetchRemoteText(hops[0]!, NO_ABORT, ok.deps, POLICY)), { ok: true });
  assert.deepEqual(ok.requested, hops.slice(0, 4));

  // a → b → c → d → e: the fourth redirect is refused and e is never asked.
  const loop = fakeNetwork(
    Object.fromEntries(hops.slice(0, 4).map((url, index) => [url, () => redirect(hops[index + 1]!)])),
    dns,
  );
  await assert.rejects(fetchRemoteText(hops[0]!, NO_ABORT, loop.deps, POLICY), /More than 3 redirects/);
  assert.deepEqual(loop.requested, hops.slice(0, 4));
});

test("a relative Location is resolved against the hop that sent it", async () => {
  const net = fakeNetwork(
    {
      "https://meta.example/dir/1": () => redirect("../tokens/1.json", 303),
      "https://meta.example/tokens/1.json": () => Response.json({ id: 1 }),
    },
    { "meta.example": [PUBLIC_IP] },
  );
  assert.equal(await fetchRemoteText("https://meta.example/dir/1", NO_ABORT, net.deps, POLICY), '{"id":1}');
});

test("a redirect without a usable Location is an error", async () => {
  const missing = fakeNetwork(
    { "https://meta.example/1": () => new Response(null, { status: 302 }) },
    { "meta.example": [PUBLIC_IP] },
  );
  await assert.rejects(fetchRemoteText("https://meta.example/1", NO_ABORT, missing.deps, POLICY), /without a Location/);

  const invalid = fakeNetwork(
    { "https://meta.example/1": () => redirect("https://[not-an-address/") },
    { "meta.example": [PUBLIC_IP] },
  );
  await assert.rejects(fetchRemoteText("https://meta.example/1", NO_ABORT, invalid.deps, POLICY), /not a valid URL/);
  assert.equal(invalid.requested.length, 1);
});

test("an error status and an oversized body are refused", async () => {
  const notFound = fakeNetwork(
    { "https://meta.example/1": () => new Response("gone", { status: 404 }) },
    { "meta.example": [PUBLIC_IP] },
  );
  await assert.rejects(fetchRemoteText("https://meta.example/1", NO_ABORT, notFound.deps, POLICY), /HTTP 404/);

  // Declared too big: refused on the header, before the body is read.
  const declared = fakeNetwork(
    {
      "https://meta.example/1": () =>
        new Response("{}", { headers: { "content-length": String(POLICY.maxBytes + 1) } }),
    },
    { "meta.example": [PUBLIC_IP] },
  );
  await assert.rejects(fetchRemoteText("https://meta.example/1", NO_ABORT, declared.deps, POLICY), /exceeded 1024 bytes/);

  // Undeclared and too big: cut off while streaming.
  const streamed = fakeNetwork(
    { "https://meta.example/1": () => new Response(streamOf([new Uint8Array(700), new Uint8Array(700)])) },
    { "meta.example": [PUBLIC_IP] },
  );
  await assert.rejects(fetchRemoteText("https://meta.example/1", NO_ABORT, streamed.deps, POLICY), /exceeded 1024 bytes/);
});

test("the development loopback exception skips DNS and reaches nowhere else", async () => {
  const dev: RemoteFetchPolicy = { ...POLICY, allowLoopbackHttp: true };
  const net = fakeNetwork(
    {
      "http://127.0.0.1:8899/ipfs/Qm1": () => Response.json({ name: "local" }),
      "http://127.0.0.1:8899/ipfs/Qm2": () => redirect("http://10.0.0.7/x"),
    },
    {},
  );
  assert.equal(await fetchRemoteText("http://127.0.0.1:8899/ipfs/Qm1", NO_ABORT, net.deps, dev), '{"name":"local"}');
  assert.deepEqual(net.resolved, []);
  await assert.rejects(fetchRemoteText("http://127.0.0.1:8899/ipfs/Qm2", NO_ABORT, net.deps, dev), /Only https/);
  assert.deepEqual(net.requested, ["http://127.0.0.1:8899/ipfs/Qm1", "http://127.0.0.1:8899/ipfs/Qm2"]);
});

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("readCapped allows exactly the cap and decodes characters split across chunks", async () => {
  const exact = await readCapped(new Response(streamOf([new Uint8Array(512).fill(0x61), new Uint8Array(512).fill(0x62)])), 1024);
  assert.equal(exact.length, 1024);
  await assert.rejects(readCapped(new Response(streamOf([new Uint8Array(1025)])), 1024), /exceeded 1024 bytes/);
  // "é" is 0xC3 0xA9; a chunk boundary between the two bytes must not mangle it.
  assert.equal(await readCapped(new Response(streamOf([Uint8Array.of(0x22, 0xc3), Uint8Array.of(0xa9, 0x22)])), 16), '"é"');
});
