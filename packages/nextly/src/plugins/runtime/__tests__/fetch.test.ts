import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { hostMatches, judgeIpv4, judgeIpv6 } from "../address-rules";
import {
  createPluginFetch,
  type PluginFetchDeps,
  type ResolvedAddress,
} from "../fetch";
import type { SendArgs } from "../transport";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

function deps(over: Partial<PluginFetchDeps> = {}): PluginFetchDeps {
  return {
    allowlist: ["api.example.com", "*.provider.example"],
    resolve: vi.fn(async (): Promise<ResolvedAddress[]> => [PUBLIC]),
    send: vi.fn(async () => new Response("ok", { status: 200 })),
    allowLoopback: false,
    ...over,
  };
}

/** The refusal rule that fired, which is what each vector asserts. */
async function refusalOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (NextlyError.is(err)) {
      const ctx = err.logContext as { reason?: string; rule?: string };
      return ctx.rule ?? ctx.reason ?? "no-reason";
    }
    throw err;
  }
  return "not-refused";
}

describe("address rules — IPv4", () => {
  it.each([
    ["0.0.0.0", "unspecified"],
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    // The cloud metadata service: this one hands out the instance's own
    // credentials to anything that asks.
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "carrier-nat"],
    ["192.0.0.1", "reserved"],
    ["198.18.0.1", "benchmark"],
    ["192.0.2.1", "documentation"],
    ["198.51.100.1", "documentation"],
    ["203.0.113.1", "documentation"],
    ["192.88.99.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
  ])("refuses %s as %s", (address, rule) => {
    const verdict = judgeIpv4(address);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe(rule);
  });

  it.each([
    ["93.184.216.34"],
    ["8.8.8.8"],
    ["172.32.0.1"],
    ["172.15.0.1"],
    // The neighbours of the documentation and relay ranges, so a rule written
    // one octet too wide shows up here.
    ["192.0.3.1"],
    ["198.51.101.1"],
    ["203.0.114.1"],
    ["192.88.98.1"],
  ])("allows the public address %s", address => {
    // The positive control: without it, a rule that refused everything
    // would pass every test above.
    expect(judgeIpv4(address).allowed).toBe(true);
  });
});

describe("address rules — IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "unique-local"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["3fff:fff::1", "documentation"],
    ["100::1", "reserved"],
    ["100:0:0:1::1", "reserved"],
    ["2001:2::1", "benchmark"],
    ["2001::1", "reserved"],
    ["2001:1ff::1", "reserved"],
    ["5f00::1", "reserved"],
  ])("refuses %s as %s", (address, rule) => {
    const verdict = judgeIpv6(address);
    expect(verdict.allowed === false && verdict.reason).toBe(rule);
  });

  it.each([
    ["::ffff:127.0.0.1", "IPv4-mapped"],
    ["::127.0.0.1", "IPv4-compatible"],
    ["64:ff9b::7f00:1", "NAT64"],
    ["2002:7f00:1::", "6to4"],
  ])("refuses %s (%s), judging the IPv4 it carries", address => {
    // Each of these reaches 127.0.0.1. Treating them as ordinary v6 addresses
    // that match no refused prefix is exactly how loopback gets through.
    const verdict = judgeIpv6(address);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe("loopback");
  });

  it.each([
    // The RFC 6052 /48 layout, carrying loopback, metadata and private space.
    ["64:ff9b:1:7f00:0:100::"],
    ["64:ff9b:1:a9fe:a9:fe00::"],
    ["64:ff9b:1:a08:5:400::"],
    // The same prefix operated as a /96: 169.254.169.254 and 10.0.0.1 at the
    // end. A decoder assuming the /48 layout read these as public addresses.
    ["64:ff9b:1:ab01::a9fe:a9fe"],
    ["64:ff9b:1:ab01::a00:1"],
    // And a public IPv4 inside it: the prefix is not globally reachable, so
    // what it carries does not matter.
    ["64:ff9b:1:5db8:d8:2200::"],
  ])(
    "refuses %s under the local-use NAT64 prefix, whatever it carries",
    address => {
      const verdict = judgeIpv6(address);
      expect(verdict).toEqual({ allowed: false, reason: "nat64-local-use" });
    }
  );

  it.each([
    // The well-known /96 still decodes, and a public IPv4 in it is allowed.
    ["64:ff9b::5db8:d822"],
    // The /48's neighbours are ordinary addresses.
    ["64:ff9b:2::1"],
    ["64:ff9b:0:1::1"],
  ])("still allows %s, next to the refused prefix", address => {
    // The control: a rule one field too wide would refuse these too.
    expect(judgeIpv6(address).allowed).toBe(true);
  });

  it.each([
    ["2606:2800:220:1:248:1893:25c8:1946"],
    // The neighbours of the documentation, protocol-assignment and SRv6
    // prefixes.
    ["2001:db9::1"],
    ["3fff:1000::1"],
    ["2001:200::1"],
    ["5f01::1"],
  ])("allows the public IPv6 address %s", address => {
    expect(judgeIpv6(address).allowed).toBe(true);
  });

  it("refuses a mapped address carrying a private IPv4", () => {
    const verdict = judgeIpv6("::ffff:169.254.169.254");
    expect(verdict.allowed === false && verdict.reason).toBe("link-local");
  });
});

describe("host matching", () => {
  it("matches an exact host", () => {
    expect(hostMatches("api.example.com", "api.example.com")).toBe(true);
  });

  it("matches a subdomain under a wildcard but not the bare domain", () => {
    expect(hostMatches("a.example.com", "*.example.com")).toBe(true);
    expect(hostMatches("example.com", "*.example.com")).toBe(false);
  });

  it("does not let a suffix look like a match", () => {
    // `example.com.evil.com` ends with the pattern as TEXT and is a different
    // host entirely; matching on whole labels is what separates them.
    expect(hostMatches("example.com.evil.com", "*.example.com")).toBe(false);
    expect(hostMatches("notexample.com", "example.com")).toBe(false);
  });
});

describe("ctx.fetch", () => {
  it("sends an allowed request to the address it vetted", async () => {
    const d = deps();
    const res = await createPluginFetch(d)("https://api.example.com/token");

    expect(res.status).toBe(200);
    const sent = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      address: ResolvedAddress;
      url: URL;
    };
    // The address, not the name: the transport must not resolve it again.
    expect(sent.address).toEqual(PUBLIC);
    expect(sent.url.hostname).toBe("api.example.com");
  });

  it("refuses a host the plugin did not declare", async () => {
    expect(
      await refusalOf(() => createPluginFetch(deps())("https://evil.example/x"))
    ).toBe("outbound-host-not-declared");
  });

  it.each([
    ["http://api.example.com/x"],
    ["file:///etc/passwd"],
    ["gopher://api.example.com"],
    ["data:text/html,x"],
  ])("refuses the scheme in %s", async input => {
    expect(await refusalOf(() => createPluginFetch(deps())(input))).toBe(
      "outbound-scheme"
    );
  });

  it("refuses when a public name answers with any internal address", async () => {
    // One good answer and one bad one is a rebinding attempt whichever the
    // transport would have picked.
    const d = deps({
      resolve: async () => [PUBLIC, { address: "10.0.0.5", family: 4 }],
    });
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("private");
  });

  it("re-checks a redirect against the same rules", async () => {
    const d = deps({
      send: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/pwn" },
          })
      ),
    });
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("outbound-host-not-declared");
  });

  it("refuses a redirect to a declared host that resolves internally", async () => {
    const resolve = vi.fn(async (host: string) =>
      host === "api.example.com"
        ? [PUBLIC]
        : [{ address: "169.254.169.254", family: 4 as const }]
    );
    const d = deps({
      resolve,
      send: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://a.provider.example/meta" },
          })
      ),
    });
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("link-local");
  });

  it("gives up after three redirects rather than looping", async () => {
    const d = deps({
      send: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://api.example.com/again" },
          })
      ),
    });
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("outbound-too-many-redirects");
  });

  it("refuses a name that resolves to nothing", async () => {
    const d = deps({ resolve: async () => [] });
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("outbound-unresolved");
  });

  it("allows http to localhost only when the install permits it", async () => {
    const d = deps({
      allowlist: ["localhost"],
      allowLoopback: true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const res = await createPluginFetch(d)("http://localhost:8080/token");
    expect(res.status).toBe(200);

    const strict = deps({
      allowlist: ["localhost"],
      allowLoopback: false,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    expect(
      await refusalOf(() =>
        createPluginFetch(strict)("http://localhost:8080/x")
      )
    ).toBe("outbound-scheme");
  });

  it("passes the caller's init through, with redirects taken over", async () => {
    const d = deps();
    await createPluginFetch(d)("https://api.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const sent = (d.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      init: RequestInit;
    };
    expect(sent.init.method).toBe("POST");
    expect(sent.init.redirect).toBe("manual");
  });
});

/**
 * What a redirect hop carries forward.
 *
 * A redirect names a NEW destination, so replaying the original method and
 * body hands the second host whatever the first was trusted with — an OAuth
 * form, a bearer assertion, a signed payload. The status is what decides:
 * 307 and 308 promise the request is unchanged, and every other 3xx becomes
 * a bodyless GET.
 */
describe("a redirect hop", () => {
  /**
   * Redirect once, answer on the second, keeping every init handed over.
   * Same-origin unless `location` says otherwise: what a hop does to the body
   * across an origin is its own rule, tested below.
   */
  function hopping(status: number, location = "https://api.example.com/next") {
    const seen: RequestInit[] = [];
    const send = async (request: SendArgs): Promise<Response> => {
      seen.push(request.init);
      if (seen.length === 1) {
        return new Response(null, {
          status,
          headers: { location },
        });
      }
      return new Response("ok", { status: 200 });
    };
    return { seen, d: deps({ send }) };
  }

  it("drops the body and becomes a GET on a 302", async () => {
    const { seen, d } = hopping(302);
    await createPluginFetch(d)("https://api.example.com/token", {
      method: "POST",
      body: new URLSearchParams({ client_secret: "shhh" }),
    });

    // The population first: two hops were made, so the second init exists to
    // be judged. Asserting only the second would pass on a run that never
    // redirected at all.
    expect(seen).toHaveLength(2);
    expect(seen[0].method).toBe("POST");
    expect(seen[1].method).toBe("GET");
    expect(seen[1].body).toBeUndefined();
  });

  it("keeps the method and body on a 307", async () => {
    // The control. Dropping the body unconditionally would satisfy the test
    // above while breaking the one redirect that promises replay.
    const body = new URLSearchParams({ client_secret: "shhh" });
    const { seen, d } = hopping(307);
    await createPluginFetch(d)("https://api.example.com/token", {
      method: "POST",
      body,
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].method).toBe("POST");
    expect(seen[1].body).toBe(body);
  });

  it("refuses to replay a 307 body it cannot send twice", async () => {
    // A stream is consumed by the first hop, so the second would arrive
    // empty — which reads as the far end rejecting a valid request.
    const { d } = hopping(307);
    expect(
      await refusalOf(() =>
        createPluginFetch(d)("https://api.example.com/token", {
          method: "POST",
          body: new ReadableStream(),
        })
      )
    ).toBe("outbound-unreplayable-redirect-body");
  });

  /**
   * A body is never carried to another origin.
   *
   * The credential headers are already dropped there, and a body can carry a
   * credential as surely as a header: an OAuth token exchange posts its
   * `client_secret` in the form. Replaying it to the redirect's origin handed
   * the secret to a host it was never sent to.
   */
  it.each([307, 308])(
    "refuses a %i that would carry the body to another origin",
    async status => {
      const { seen, d } = hopping(status, "https://a.provider.example/next");
      expect(
        await refusalOf(() =>
          createPluginFetch(d)("https://api.example.com/token", {
            method: "POST",
            body: new URLSearchParams({ client_secret: "shhh" }),
          })
        )
      ).toBe("outbound-cross-origin-redirect-body");
      // Refused before the second hop: the secret was sent once, to the
      // origin it was meant for.
      expect(seen).toHaveLength(1);
    }
  );

  it("refuses a PUT whose body a cross-origin 301 would keep", async () => {
    const { seen, d } = hopping(301, "https://a.provider.example/next");
    expect(
      await refusalOf(() =>
        createPluginFetch(d)("https://api.example.com/x", {
          method: "PUT",
          body: new URLSearchParams({ a: "1" }),
        })
      )
    ).toBe("outbound-cross-origin-redirect-body");
    expect(seen).toHaveLength(1);
  });

  it("still follows a cross-origin redirect that sends no body", async () => {
    // The control. Refusing every cross-origin redirect would satisfy the
    // tests above while breaking the ordinary 302 after a POST, which becomes
    // a bodyless GET and so replays nothing.
    const { seen, d } = hopping(302, "https://a.provider.example/next");
    await createPluginFetch(d)("https://api.example.com/token", {
      method: "POST",
      body: new URLSearchParams({ client_secret: "shhh" }),
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].method).toBe("GET");
    expect(seen[1].body).toBeUndefined();
  });
});

/**
 * Credentials do not follow a hop to another origin.
 *
 * The allowlist declares which hosts a plugin may reach; it says nothing about
 * which of them may see a token issued for one of the others. A compromised —
 * or merely misconfigured — allowed host could therefore redirect a bearer
 * token or session cookie to any OTHER allowed host, and both ends being
 * declared is exactly why the allowlist cannot catch it.
 */
describe("credentials across a redirect", () => {
  /** Redirect once to `to`, keeping the headers each hop was handed. */
  function hoppingTo(to: string) {
    const seen: RequestInit[] = [];
    const send = async (request: SendArgs): Promise<Response> => {
      seen.push(request.init);
      if (seen.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: to },
        });
      }
      return new Response("ok", { status: 200 });
    };
    return { seen, d: deps({ send }) };
  }

  /** Case-insensitive lookup, since a hop may respell what it forwards. */
  function headerOf(init: RequestInit, name: string): string | null {
    return new Headers(init.headers ?? {}).get(name);
  }

  it("drops Authorization and Cookie when the origin changes", async () => {
    const { seen, d } = hoppingTo("https://a.provider.example/next");
    await createPluginFetch(d)("https://api.example.com/token", {
      headers: {
        authorization: "Bearer secret-token",
        cookie: "session=abc",
        accept: "application/json",
      },
    });

    expect(seen).toHaveLength(2);
    // The first hop legitimately carries them — it is the origin they belong
    // to — so their absence on the second is a change this code made.
    expect(headerOf(seen[0], "authorization")).toBe("Bearer secret-token");
    expect(headerOf(seen[1], "authorization")).toBeNull();
    expect(headerOf(seen[1], "cookie")).toBeNull();
    // Ordinary headers are not credentials and still travel.
    expect(headerOf(seen[1], "accept")).toBe("application/json");
  });

  it("keeps them on a SAME-origin redirect", async () => {
    // The control. Stripping unconditionally would satisfy the test above
    // while breaking every ordinary authenticated redirect within one host.
    const { seen, d } = hoppingTo("https://api.example.com/next");
    await createPluginFetch(d)("https://api.example.com/token", {
      headers: { authorization: "Bearer secret-token" },
    });

    expect(seen).toHaveLength(2);
    expect(headerOf(seen[1], "authorization")).toBe("Bearer secret-token");
  });
});

/**
 * Which methods a redirect rewrites, and which it leaves alone.
 *
 * Rewriting everything below 307 into a GET turned a caller's PUT, PATCH or
 * DELETE into a different operation and dropped its body — a provider that
 * redirects an update then received a read. The status decides: 303 means
 * "fetch the result by GET", 301 and 302 rewrite only POST.
 */
describe("redirect method rules", () => {
  function hopping(status: number) {
    const seen: RequestInit[] = [];
    const send = async (request: SendArgs): Promise<Response> => {
      seen.push(request.init);
      if (seen.length === 1) {
        return new Response(null, {
          status,
          headers: { location: "https://api.example.com/next" },
        });
      }
      return new Response("ok", { status: 200 });
    };
    return { seen, d: deps({ send }) };
  }

  it.each([301, 302])("preserves a PUT across %i", async status => {
    const body = new URLSearchParams({ a: "1" });
    const { seen, d } = hopping(status);
    await createPluginFetch(d)("https://api.example.com/x", {
      method: "PUT",
      body,
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].method).toBe("PUT");
    expect(seen[1].body).toBe(body);
  });

  it.each([301, 302])("still rewrites a POST on %i", async status => {
    // The control. Preserving every method would satisfy the test above while
    // reinstating the replay this rule exists to stop.
    const { seen, d } = hopping(status);
    await createPluginFetch(d)("https://api.example.com/x", {
      method: "POST",
      body: new URLSearchParams({ a: "1" }),
    });

    expect(seen[1].method).toBe("GET");
    expect(seen[1].body).toBeUndefined();
  });

  it("rewrites even a PUT on 303, which means fetch by GET", async () => {
    const { seen, d } = hopping(303);
    await createPluginFetch(d)("https://api.example.com/x", {
      method: "PUT",
      body: new URLSearchParams({ a: "1" }),
    });

    expect(seen[1].method).toBe("GET");
    expect(seen[1].body).toBeUndefined();
  });

  it("drops the headers that describe a body it no longer sends", async () => {
    // A `Content-Length` left on a bodyless GET disagrees with the request it
    // is attached to, which a strict intermediary may reject.
    const { seen, d } = hopping(303);
    await createPluginFetch(d)("https://api.example.com/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "17",
        accept: "application/json",
      },
      body: JSON.stringify({ a: 1 }),
    });

    const sent = new Headers(seen[1].headers ?? {});
    expect(sent.get("content-length")).toBeNull();
    expect(sent.get("content-type")).toBeNull();
    // A header that is not about the body still travels.
    expect(sent.get("accept")).toBe("application/json");
  });
});

describe("only real redirect statuses are followed", () => {
  it("returns a 304 with a Location header as-is", async () => {
    // The whole 3xx range is not a redirect. A `304 Not Modified` carrying a
    // stale `Location` was followed, so the plugin received the redirected
    // resource instead of the not-modified answer it asked for — and a POST
    // was rewritten to GET on the way there.
    const seen: string[] = [];
    const fetchFn = createPluginFetch({
      allowlist: ["api.example.com"],
      allowLoopback: false,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      send: async ({ url }) => {
        seen.push(url.toString());
        return new Response(null, {
          status: 304,
          headers: { location: "https://api.example.com/other" },
        });
      },
    });

    const response = await fetchFn("https://api.example.com/thing");

    expect(response.status).toBe(304);
    // ONE request: the Location was not followed.
    expect(seen).toEqual(["https://api.example.com/thing"]);
  });

  it("still follows a 302", async () => {
    // The control: refusing to follow anything would satisfy the assertion
    // above while breaking every redirect the runtime exists to handle.
    const seen: string[] = [];
    const fetchFn = createPluginFetch({
      allowlist: ["api.example.com"],
      allowLoopback: false,
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      send: async ({ url }) => {
        seen.push(url.toString());
        return seen.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "https://api.example.com/other" },
            })
          : new Response("done", { status: 200 });
      },
    });

    const response = await fetchFn("https://api.example.com/thing");

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
  });
});

describe("the IPv4-translated prefix", () => {
  it.each([
    ["::ffff:0:7f00:1", "loopback"],
    ["::ffff:0:a9fe:a9fe", "link-local"],
  ])("refuses %s (%s), judging the IPv4 it carries", address => {
    // RFC 6145's translated form moves the ffff to bytes 8-9 and a zero to
    // 10-11; recognizing only the mapped spelling let a translator on this
    // prefix hand the embedded address to whoever connected.
    const verdict = judgeIpv6(address);
    expect(verdict.allowed).toBe(false);
  });

  it("allows the translated form carrying a public IPv4", () => {
    expect(judgeIpv6("::ffff:0:5db8:d822").allowed).toBe(true);
  });
});

describe("caller cancellation during DNS resolution", () => {
  it("releases the caller without waiting for a stalled resolver", async () => {
    // The lookup itself cannot be interrupted; the CALLER can. Without the
    // race, an aborted request kept waiting on the resolver until the fixed
    // deadline answered for it.
    const controller = new AbortController();
    const never = new Promise<never>(() => undefined);
    const d = deps({ resolve: () => never });

    const started = Date.now();
    const pending = createPluginFetch(d)("https://api.example.com/", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("the deprecated site-local range", () => {
  it("refuses fec0:: addresses as internal", () => {
    // Deprecated since 2004 but still routed on networks that predate the
    // deprecation; falling through as public let a declared host reach
    // internal v6 services through the vetted address.
    expect(judgeIpv6("fec0::1").allowed).toBe(false);
  });
});

describe("cross-origin redirects", () => {
  it("drops a custom credential header the caller sent", async () => {
    // X-API-Key and every provider-invented spelling ride a denylist gap;
    // the hop keeps only body/transport headers now.
    const d = deps();
    (d.send as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.provider.example/x" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await createPluginFetch(d)("https://api.example.com/token", {
      headers: { "x-api-key": "sk-live", "content-type": "application/json" },
    });
    expect(res.status).toBe(200);

    const second = (d.send as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
      init: RequestInit;
    };
    const sent = new Headers(second.init.headers);
    expect(sent.get("x-api-key")).toBeNull();
    expect(sent.get("content-type")).toBe("application/json");
  });
});

describe("DNS failover", () => {
  it("tries the next vetted answer when the first refuses the connection", async () => {
    const DEAD = { address: "93.184.216.34", family: 4 } as never;
    const LIVE = { address: "93.184.216.35", family: 4 } as never;
    const d = deps({
      resolve: vi.fn(async (): Promise<ResolvedAddress[]> => [DEAD, LIVE]),
    });
    (d.send as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await createPluginFetch(d)("https://api.example.com/token");
    expect(res.status).toBe(200);
    const calls = (d.send as ReturnType<typeof vi.fn>).mock.calls;
    expect((calls[0][0] as { address: unknown }).address).toBe(DEAD);
    expect((calls[1][0] as { address: unknown }).address).toBe(LIVE);
  });

  it("rethrows the transport failure when every answer refuses", async () => {
    const d = deps({
      resolve: vi.fn(
        async (): Promise<ResolvedAddress[]> => [
          { address: "93.184.216.34", family: 4 },
          { address: "93.184.216.35", family: 4 },
        ]
      ),
    });
    (d.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })
    );

    await expect(
      createPluginFetch(d)("https://api.example.com/token")
    ).rejects.toThrow("ECONNREFUSED");
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe("failover safety", () => {
  it("does NOT retry a POST after a transmission failure", async () => {
    // A POST that was sent and then reset reads here exactly like one that
    // never connected; replaying it duplicates whatever it did. Only
    // idempotent methods fail over.
    const d = deps({
      resolve: vi.fn(
        async (): Promise<ResolvedAddress[]> => [
          { address: "93.184.216.35", family: 4 },
        ]
      ),
    });
    (d.send as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNRESET")
    );

    await expect(
      createPluginFetch(d)("https://api.example.com/t", {
        method: "POST",
        body: "x",
      })
    ).rejects.toThrow("ECONNRESET");
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("does not turn a caller cancellation into another send", async () => {
    const controller = new AbortController();
    const d = deps({
      resolve: vi.fn(
        async (): Promise<ResolvedAddress[]> => [
          { address: "93.184.216.34", family: 4 },
          { address: "93.184.216.35", family: 4 },
        ]
      ),
    });
    (d.send as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.abort();
          reject(new DOMException("aborted", "AbortError"));
        })
    );

    await expect(
      createPluginFetch(d)("https://api.example.com/t", {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("ctx.fetch behaves as fetch does", () => {
  /** A send answering a redirect to `location` first, then 200. */
  function redirecting(location: string) {
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 302, headers: { location } })
        : new Response("final", { status: 200 });
    });
  }

  it('hands back the redirect itself for redirect: "manual"', async () => {
    // Followed regardless, a plugin could never read the `Location` an OAuth
    // provider puts its code in.
    const d = deps({ send: redirecting("https://api.example.com/next") });
    const res = await createPluginFetch(d)("https://api.example.com/start", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://api.example.com/next");
    expect((d.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('refuses a redirect for redirect: "error"', async () => {
    const d = deps({ send: redirecting("https://api.example.com/next") });
    expect(
      await refusalOf(() =>
        createPluginFetch(d)("https://api.example.com/start", {
          redirect: "error",
        })
      )
    ).toBe("outbound-redirect-refused");
  });

  it("reports the final url and that it was redirected", async () => {
    const d = deps({ send: redirecting("https://api.example.com/next") });
    const res = await createPluginFetch(d)("https://api.example.com/start");
    expect(res.url).toBe("https://api.example.com/next");
    expect(res.redirected).toBe(true);
  });

  it("reports the url of an unredirected response too", async () => {
    // The control: a response that was never redirected says so.
    const res = await createPluginFetch(deps())("https://api.example.com/x");
    expect(res.url).toBe("https://api.example.com/x");
    expect(res.redirected).toBe(false);
  });

  it("accepts a Request, carrying its method, headers and body", async () => {
    // Refused as a malformed URL, a prepared request could not be sent.
    const d = deps();
    await createPluginFetch(d)(
      new Request("https://api.example.com/token", {
        method: "POST",
        headers: { "x-api-key": "k" },
        body: "grant_type=code",
      })
    );
    const sent = (d.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SendArgs;
    expect(sent.url.href).toBe("https://api.example.com/token");
    expect(sent.init.method).toBe("POST");
    expect(new Headers(sent.init.headers).get("x-api-key")).toBe("k");
    expect(sent.init.body).toBeInstanceOf(ReadableStream);
  });

  it("sends a default User-Agent naming the plugin, unless the caller set one", async () => {
    // GitHub's REST API refuses a request without one.
    const d = deps({ userAgent: "nextly-plugin/@acme/github" });
    await createPluginFetch(d)("https://api.example.com/x");
    await createPluginFetch(d)("https://api.example.com/x", {
      headers: { "User-Agent": "acme/2.0" },
    });
    const agents = (d.send as ReturnType<typeof vi.fn>).mock.calls.map(
      ([args]) => new Headers((args as SendArgs).init.headers).get("user-agent")
    );
    expect(agents).toEqual(["nextly-plugin/@acme/github", "acme/2.0"]);
  });

  it("rejects with the signal's own reason when the caller aborts", async () => {
    // A generic AbortError lost the caller's TimeoutError, which libraries
    // such as jose map to their own timeout error.
    const reason = new DOMException("The operation timed out.", "TimeoutError");
    const controller = new AbortController();
    const d = deps({
      resolve: vi.fn(
        () =>
          new Promise<ResolvedAddress[]>(() => {
            // Never answers: the abort is what settles the call.
          })
      ),
    });
    const pending = createPluginFetch(d)("https://api.example.com/x", {
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe("ctx.fetch and ports", () => {
  it("refuses a port the manifest did not name", async () => {
    // An entry naming only the host granted every service on it.
    expect(
      await refusalOf(() =>
        createPluginFetch(deps())("https://api.example.com:22/")
      )
    ).toBe("outbound-host-not-declared");
  });

  it("allows the scheme's default port for an entry naming only the host", async () => {
    const res = await createPluginFetch(deps())(
      "https://api.example.com:443/x"
    );
    expect(res.status).toBe(200);
  });

  it("allows a port the manifest names", async () => {
    const d = deps({ allowlist: ["api.example.com:8443"] });
    expect(
      (await createPluginFetch(d)("https://api.example.com:8443/x")).status
    ).toBe(200);
    expect(
      await refusalOf(() => createPluginFetch(d)("https://api.example.com/x"))
    ).toBe("outbound-host-not-declared");
  });
});
