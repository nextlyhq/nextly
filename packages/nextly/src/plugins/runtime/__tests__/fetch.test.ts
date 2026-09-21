import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { hostMatches, judgeIpv4, judgeIpv6 } from "../address-rules";
import {
  createPluginFetch,
  type PluginFetchDeps,
  type ResolvedAddress,
} from "../fetch";

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
