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
    resolve: vi.fn(async () => [PUBLIC]),
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
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
  ])("refuses %s as %s", (address, rule) => {
    const verdict = judgeIpv4(address);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toBe(rule);
  });

  it.each([["93.184.216.34"], ["8.8.8.8"], ["172.32.0.1"], ["172.15.0.1"]])(
    "allows the public address %s",
    address => {
      // The positive control: without it, a rule that refused everything
      // would pass every test above.
      expect(judgeIpv4(address).allowed).toBe(true);
    }
  );
});

describe("address rules — IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "unique-local"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
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
    ["64:ff9b:1:7f:0:100:0:0", "127.0.0.1"],
    ["64:ff9b:1:a9:fea9:fe00:0:0", "169.254.169.254"],
    ["64:ff9b:1:a:0:100:0:0", "10.0.0.1"],
  ])("refuses the local-use NAT64 prefix carrying %s", address => {
    // The RFC 8215 prefix lays the IPv4 at bytes 7-10 (48-bit prefix, u
    // octet, address — RFC 6052), not at the end like the well-known /96;
    // judging only the well-known form let these fall through as ordinary
    // global addresses, and what they carry is loopback, link-local
    // metadata, and private space — the exact refusals this judge is for.
    const verdict = judgeIpv6(address);
    expect(verdict.allowed).toBe(false);
  });

  it("allows the local-use NAT64 prefix carrying a public IPv4", () => {
    // The control: the prefix itself is not refused, only what it carries —
    // a deployment NAT-ing to a public address is ordinary outbound traffic.
    expect(judgeIpv6("64:ff9b:1:5d:b8d8:2200:0:0").allowed).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(judgeIpv6("2606:2800:220:1:248:1893:25c8:1946").allowed).toBe(true);
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
  /** Redirect once, answer on the second, keeping every init handed over. */
  function hopping(status: number) {
    const seen: RequestInit[] = [];
    const send = async (request: SendArgs): Promise<Response> => {
      seen.push(request.init);
      if (seen.length === 1) {
        return new Response(null, {
          status,
          headers: { location: "https://a.provider.example/next" },
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
