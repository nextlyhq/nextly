import { describe, expect, it } from "vitest";

import {
  callerCredential,
  csrfApplies,
  rateLimitKey,
  shouldNotStore,
  validateRouteOptions,
} from "../route-options";
import type { PluginRoute } from "../route-types";

function route(over: Partial<PluginRoute> = {}): PluginRoute {
  return {
    method: "POST",
    path: "/thing",
    handler: () => new Response("ok"),
    ...over,
  } as PluginRoute;
}

function request(
  method: string,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/admin/api/plugins/x/thing", {
    method,
    headers,
  });
}

describe("callerCredential", () => {
  it("reads an Authorization header as a deliberate credential", () => {
    expect(
      callerCredential(request("POST", { authorization: "Bearer k" }))
    ).toBe("bearer");
  });

  it("reads a cookie as an automatic credential", () => {
    expect(
      callerCredential(request("POST", { cookie: "nextly_session=x" }))
    ).toBe("cookie");
  });

  it("prefers the header when both are present", () => {
    // A request carrying a key was made by whoever holds it, whatever else
    // the browser attached on its own.
    expect(
      callerCredential(
        request("POST", { authorization: "Bearer k", cookie: "a=b" })
      )
    ).toBe("bearer");
  });
});

describe("csrfApplies", () => {
  it("applies to an unsafe method from a cookie caller", () => {
    expect(
      csrfApplies(route({ csrf: true }), request("POST", { cookie: "a=b" }))
    ).toBe(true);
  });

  it.each([["GET"], ["HEAD"]])("does not apply to %s", method => {
    expect(
      csrfApplies(
        route({ csrf: true, method: method as never }),
        request(method, { cookie: "a=b" })
      )
    ).toBe(false);
  });

  it("does not apply to an API-key caller", () => {
    // A browser cannot attach a Bearer token cross-site, so there is no
    // cross-site request to forge.
    expect(
      csrfApplies(
        route({ csrf: true }),
        request("POST", { authorization: "Bearer k" })
      )
    ).toBe(false);
  });

  it("does not apply when the route did not ask for it", () => {
    expect(csrfApplies(route(), request("POST", { cookie: "a=b" }))).toBe(
      false
    );
  });
});

describe("validateRouteOptions", () => {
  it("refuses csrf on a public route", () => {
    // A public route has no cookie identity to protect, so accepting this
    // would advertise a protection that is not there.
    expect(validateRouteOptions(route({ csrf: true, public: true }))).toMatch(
      /public route/
    );
  });

  it("refuses rawBody on a method with no body", () => {
    expect(
      validateRouteOptions(route({ rawBody: true, method: "GET" }))
    ).toMatch(/rawBody/);
  });

  it("accepts the combinations that make sense", () => {
    expect(validateRouteOptions(route({ csrf: true }))).toBeNull();
    expect(validateRouteOptions(route({ rawBody: true }))).toBeNull();
    expect(validateRouteOptions(route({ rateLimit: "auth" }))).toBeNull();
    expect(validateRouteOptions(route({ public: true }))).toBeNull();
  });
});

describe("shouldNotStore", () => {
  it("is set when the route asks", () => {
    expect(shouldNotStore(route({ noStore: true }))).toBe(true);
  });

  it("is set for an auth-limited route whether or not it asked", () => {
    // Its responses describe an authentication attempt, which is never
    // cacheable — and a plugin should not have to remember that.
    expect(shouldNotStore(route({ rateLimit: "auth" }))).toBe(true);
  });

  it("is not set for an ordinary route", () => {
    expect(shouldNotStore(route())).toBe(false);
  });
});

describe("rateLimitKey", () => {
  it("namespaces the bucket by plugin", () => {
    expect(
      rateLimitKey(route({ rateLimit: "auth" }), "acme-auth", "1.2.3.4")
    ).toBe("plugin-auth-ip:acme-auth:1.2.3.4");
  });

  it("gives two plugins different buckets for the same caller", () => {
    // Sharing one would let either exhaust the other's budget.
    const a = rateLimitKey(route({ rateLimit: "auth" }), "a", "1.2.3.4");
    const b = rateLimitKey(route({ rateLimit: "auth" }), "b", "1.2.3.4");
    expect(a).not.toBe(b);
  });

  it("is distinct from the core auth bucket for the same IP", () => {
    expect(
      rateLimitKey(route({ rateLimit: "auth" }), "acme-auth", "1.2.3.4")
    ).not.toBe("auth-ip:1.2.3.4");
  });

  it("gives a general-limited route a bucket too", () => {
    // `general` is a public option on `PluginRoute.rateLimit`, and this
    // returned null for it — so a route declaring a valid documented value ran
    // with no limit whatsoever, which is the opposite of what declaring one
    // means.
    expect(
      rateLimitKey(route({ rateLimit: "general" }), "acme-auth", "1.2.3.4")
    ).toBe("plugin-general-ip:acme-auth:1.2.3.4");
  });

  it("keeps the general and auth buckets apart", () => {
    // Ordinary traffic must not be able to spend the allowance that exists to
    // make password guessing expensive.
    const auth = rateLimitKey(route({ rateLimit: "auth" }), "p", "1.2.3.4");
    const general = rateLimitKey(
      route({ rateLimit: "general" }),
      "p",
      "1.2.3.4"
    );
    expect(auth).not.toBe(general);
  });

  it("is null for a route that asked for no limit", () => {
    // The control: a key generated for every route would satisfy both tests
    // above while limiting routes that never opted in.
    expect(rateLimitKey(route(), "acme-auth", "1.2.3.4")).toBeNull();
  });
});
