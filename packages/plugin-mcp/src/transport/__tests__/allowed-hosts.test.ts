import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAllowedHosts } from "../allowed-hosts";

/**
 * The list both checks are answered against.
 *
 * Everything here is about a widening that would not be noticed. An entry that
 * silently fails to parse, a fallback that quietly adds a name the operator did
 * not write, a port left on an entry so it matches nothing: each leaves an
 * endpoint that looks configured and is not.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the hostnames the endpoint answers on", () => {
  it("takes the hostname out of whatever form an address arrives in", () => {
    // All four are the same install. The checks compare hostnames and ignore
    // ports, so an entry that kept its port would match nothing at all — and
    // would look like a configured allowlist while refusing every request.
    expect(
      resolveAllowedHosts([
        "https://cms.example.com",
        "cms.example.com:3000",
        "http://cms.example.com/admin/api/mcp",
        "cms.example.com",
      ])
    ).toEqual(["cms.example.com"]);
  });

  it("reads a bare host:port, which parses as a scheme if left alone", () => {
    // `new URL("cms.example.com:3000")` succeeds: it reads `cms.example.com:`
    // as the SCHEME and leaves the hostname empty. Parsing first and checking
    // afterwards therefore drops the entry rather than failing on it.
    expect(resolveAllowedHosts(["cms.example.com:3000"])).toEqual([
      "cms.example.com",
    ]);
  });

  it("keeps the brackets an IPv6 literal needs", () => {
    expect(resolveAllowedHosts(["[::1]:3000"])).toEqual(["[::1]"]);
  });

  it("refuses everything when the list an operator wrote resolves to nothing", () => {
    // Falling back here would turn a typo into a wider endpoint, and silently:
    // the install would answer on localhost while its configuration said
    // something else entirely. An empty list refuses on the first call instead.
    expect(resolveAllowedHosts(["not a host"])).toEqual([]);
    expect(resolveAllowedHosts([])).toEqual([]);
  });

  it("does not add localhost to a list an operator wrote", () => {
    // The control on the fallback below. Naming your own hostnames is a
    // statement about which names are legitimate, and a default that survived
    // it would not be the list you wrote.
    expect(resolveAllowedHosts(["cms.example.com"])).toEqual([
      "cms.example.com",
    ]);
  });

  it("falls back to the address the install states about itself", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://cms.example.com");

    expect(resolveAllowedHosts()).toEqual(["cms.example.com"]);
  });

  it("answers on localhost when the install has stated no address", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    // A development install works, and a deployed one that has said nothing
    // about its own address refuses rather than guessing.
    expect(resolveAllowedHosts()).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });

  it("falls back rather than trusting an unparseable published address", () => {
    // The control on the case above. A malformed value must not resolve to an
    // empty hostname that then matches nothing, nor to the raw string.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");

    expect(resolveAllowedHosts()).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });
});
