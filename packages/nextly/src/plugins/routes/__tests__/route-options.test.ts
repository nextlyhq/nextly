import { describe, expect, it } from "vitest";

import {
  checkRouteCsrf,
  publicCallerCredential,
  rateLimitClient,
  rateLimitKey,
  rateLimitProxyWarning,
  routeCsrfMode,
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

describe("publicCallerCredential", () => {
  it("reads the SESSION cookie as the automatic credential", () => {
    expect(
      publicCallerCredential(request("POST", { cookie: "nextly_session=x" }))
    ).toBe("cookie");
  });

  it("does not read an unrelated cookie as a session", () => {
    // Any cookie at all counted, so an analytics or locale cookie held a
    // browser to a check it had no session to pass — and a root-mounted
    // route never receives the `/admin`-scoped csrf cookie either.
    expect(
      publicCallerCredential(
        request("POST", { cookie: "_ga=GA1.2.3; NEXT_LOCALE=en" })
      )
    ).toBe("none");
  });

  it("reads an Authorization header as a deliberate credential", () => {
    expect(
      publicCallerCredential(request("POST", { authorization: "Bearer k" }))
    ).toBe("bearer");
  });

  it("prefers the session cookie over an Authorization header", () => {
    // The header may be ambient HTTP authentication the browser attached on
    // its own; the session cookie is what a handler would act on.
    expect(
      publicCallerCredential(
        request("POST", {
          authorization: "Basic dXNlcjpwYXNz",
          cookie: "nextly_session=x",
        })
      )
    ).toBe("cookie");
  });
});

describe("routeCsrfMode", () => {
  it("checks the ORIGIN by default for a cookie-authenticated write", () => {
    // The default the admin's own writes must pass: they send no token.
    expect(routeCsrfMode(route(), request("POST"), "cookie")).toBe("origin");
  });

  it("requires a token when the route declares csrf: true", () => {
    expect(
      routeCsrfMode(route({ csrf: true }), request("POST"), "cookie")
    ).toBe("token");
  });

  it.each([["GET"], ["HEAD"]])("checks nothing on %s", method => {
    expect(
      routeCsrfMode(
        route({ csrf: true, method: method as never }),
        request(method),
        "cookie"
      )
    ).toBe("none");
  });

  it("checks nothing for an API-key caller", () => {
    // A browser cannot attach a Bearer token cross-site, so there is no
    // cross-site request to forge.
    expect(
      routeCsrfMode(route({ csrf: true }), request("POST"), "bearer")
    ).toBe("none");
  });

  it("checks nothing on a route that opted out", () => {
    expect(
      routeCsrfMode(route({ csrf: false }), request("POST"), "cookie")
    ).toBe("none");
  });

  it("checks nothing on a public route by default", () => {
    // A public route authenticated no one, so a session cookie on the
    // request says nothing about what admitted it.
    expect(
      routeCsrfMode(route({ public: true }), request("POST"), "cookie")
    ).toBe("none");
  });

  it("honors an explicit csrf on a public route", () => {
    // A public handler that resolves the session user and acts on them
    // declares the check; only session-cookie callers are asked for a token,
    // so webhook callers stay free.
    expect(
      routeCsrfMode(
        route({ public: true, csrf: true }),
        request("POST"),
        "cookie"
      )
    ).toBe("token");
  });
});

describe("checkRouteCsrf: the default origin check", () => {
  /** The admin's own write: session and csrf cookies, same origin, no token. */
  function adminWrite(origin: string | null): Request {
    return new Request("http://localhost:3000/admin/api/plugins/x/thing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "nextly_session=s; nextly_csrf=tok",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ name: "pattern" }),
    });
  }

  it("admits the admin's own write, which sends no token", () => {
    // The separating case: token-by-default refused exactly this request,
    // so every admin page writing through `usePluginRouteMutation` got 403.
    expect(
      checkRouteCsrf(
        route(),
        adminWrite("http://localhost:3000"),
        {},
        [],
        "cookie"
      ).valid
    ).toBe(true);
  });

  it("refuses the same write from another site", () => {
    // The control: an origin check that admitted everything would pass the
    // case above too.
    expect(
      checkRouteCsrf(
        route(),
        adminWrite("https://evil.example"),
        {},
        [],
        "cookie"
      )
    ).toEqual({ valid: false, error: "Invalid request origin" });
  });

  it("refuses a write that names no origin at all", () => {
    expect(
      checkRouteCsrf(route(), adminWrite(null), {}, [], "cookie").valid
    ).toBe(false);
  });

  it("admits a configured allowed origin", () => {
    expect(
      checkRouteCsrf(
        route(),
        adminWrite("https://admin.example"),
        {},
        ["https://admin.example"],
        "cookie"
      ).valid
    ).toBe(true);
  });

  it("still demands the token when the route declares csrf: true", () => {
    expect(
      checkRouteCsrf(
        route({ csrf: true }),
        adminWrite("http://localhost:3000"),
        {},
        [],
        "cookie"
      )
    ).toEqual({ valid: false, error: "Missing CSRF token" });
  });
});

describe("validateRouteOptions", () => {
  it("accepts csrf on a public route", () => {
    // Honored at runtime for cookie-carrying callers; the declaration is
    // how a public handler that resolves the session user protects itself.
    expect(
      validateRouteOptions(route({ csrf: true, public: true }))
    ).toBeNull();
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
    ).toBe("plugin-auth-ip:acme-auth:/thing:1.2.3.4");
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
    // means. The fixture's default method is POST, so the bucket is the write
    // half of the read/write pair.
    expect(
      rateLimitKey(route({ rateLimit: "general" }), "acme-auth", "1.2.3.4")
    ).toBe("plugin-general-ip:acme-auth:/thing:1.2.3.4:write");
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

describe("validateRouteOptions: the rate-limit mode", () => {
  it("refuses a mode outside the declared union", () => {
    // The union is a TypeScript guarantee; an unchecked JavaScript plugin
    // has none. A typo made `rateLimitKey` answer null and the route ran
    // with no limiter — silently losing the budget the author declared.
    const problem = validateRouteOptions(
      route({ rateLimit: "authn" as never })
    );
    expect(problem).toContain("rateLimit");
    expect(problem).toContain("authn");
  });

  it.each(["auth", "general"] as const)("accepts %s", mode => {
    // The control: both declared modes stay declarable.
    expect(validateRouteOptions(route({ rateLimit: mode }))).toBeNull();
  });

  it("accepts a route that declares no mode", () => {
    expect(validateRouteOptions(route())).toBeNull();
  });
});

describe("rateLimitKey: reads and writes spend separate counters", () => {
  it("suffixes a general bucket by the read/write class", () => {
    // Reads and writes have separate configured limits, so one shared
    // counter let enough GETs raise the count past `writeLimit` and refuse
    // the next POST without a single write having been spent.
    const read = rateLimitKey(
      route({ method: "GET", rateLimit: "general" }),
      "a",
      "1.2.3.4"
    );
    const write = rateLimitKey(
      route({ method: "POST", rateLimit: "general" }),
      "a",
      "1.2.3.4"
    );
    expect(read).not.toBe(write);
    expect(read).toContain(":read");
    expect(write).toContain(":write");
  });

  it("keeps ONE auth bucket regardless of method", () => {
    // The auth allowance is a single guess-per-IP budget; splitting it by
    // method would multiply the attempts an attacker gets.
    const get = rateLimitKey(
      route({ method: "GET", rateLimit: "auth" }),
      "a",
      "1.2.3.4"
    );
    const post = rateLimitKey(
      route({ method: "POST", rateLimit: "auth" }),
      "a",
      "1.2.3.4"
    );
    expect(get).toBe(post);
  });
});

describe("routeCsrfMode with the resolved credential", () => {
  it("applies when the SESSION admitted the request, header notwithstanding", () => {
    // A browser can attach an Authorization header on its own (ambient HTTP
    // authentication); classifying by header presence then skipped CSRF for
    // a request whose session cookie was the credential that let it in.
    const req = request("POST", {
      authorization: "Basic dXNlcjpwYXNz",
      cookie: "nextly_session=x",
    });
    expect(routeCsrfMode(route({ csrf: true }), req, "cookie")).toBe("token");
  });

  it("still skips when the header actually authenticated", () => {
    expect(
      routeCsrfMode(
        route({ csrf: true }),
        request("POST", { authorization: "Bearer k" }),
        "bearer"
      )
    ).toBe("none");
  });
});

describe("checkRouteCsrf with the resolved credential", () => {
  it("VALIDATES the token when the session admitted the request", () => {
    // The preliminary check demanded CSRF using the resolved credential;
    // the validator recomputing it from headers returned valid without
    // looking — the bypass the outer fix existed to close, reopened inside.
    const req = request("POST", {
      authorization: "Basic dXNlcjpwYXNz",
      cookie: "nextly_csrf=tok",
      origin: "http://localhost:3000",
      "x-csrf-token": "tok",
    });
    const verdict = checkRouteCsrf(
      route({ csrf: true }),
      req,
      {},
      ["http://localhost:3000"],
      "cookie"
    );
    expect(verdict.valid).toBe(true);
  });

  it("REFUSES when the session-admitted request carries no token", () => {
    const req = request("POST", {
      authorization: "Basic dXNlcjpwYXNz",
      cookie: "nextly_csrf=tok",
      origin: "http://localhost:3000",
    });
    const verdict = checkRouteCsrf(
      route({ csrf: true }),
      req,
      {},
      ["http://localhost:3000"],
      "cookie"
    );
    expect(verdict.valid).toBe(false);
  });
});

describe("rateLimitKey: one bucket per route", () => {
  it("gives two routes of one plugin different buckets", () => {
    // An SSO sign-in spends `authorize` and `callback`; sharing one bucket
    // made it cost two of the same budget.
    const authorize = rateLimitKey(
      route({ method: "GET", path: "/authorize", rateLimit: "auth" }),
      "acme-auth",
      "1.2.3.4"
    );
    const callback = rateLimitKey(
      route({ method: "GET", path: "/callback", rateLimit: "auth" }),
      "acme-auth",
      "1.2.3.4"
    );
    expect(authorize).not.toBe(callback);
  });

  it("gives one route the same bucket on every call", () => {
    // The control: a key that varied per call would never limit anything.
    const r = route({ path: "/callback", rateLimit: "auth" });
    expect(rateLimitKey(r, "acme-auth", "1.2.3.4")).toBe(
      rateLimitKey(r, "acme-auth", "1.2.3.4")
    );
  });

  it("puts a route's own allowance in a namespace of its own", () => {
    expect(
      rateLimitKey(
        route({ rateLimit: { max: 5, windowMs: 60_000 } }),
        "acme-auth",
        "1.2.3.4"
      )
    ).toBe("plugin-route-ip:acme-auth:/thing:1.2.3.4:POST");
  });
});

describe("rateLimitKey: a route's own allowance", () => {
  it("counts two methods on one path apart", () => {
    // Different limits on GET and POST must not share one counter, or the
    // looser method's traffic spends the stricter one's budget.
    const get = rateLimitKey(
      route({
        method: "GET",
        path: "/hook",
        rateLimit: { max: 1000, windowMs: 1 },
      }),
      "p",
      "1.2.3.4"
    );
    const post = rateLimitKey(
      route({
        method: "POST",
        path: "/hook",
        rateLimit: { max: 10, windowMs: 1 },
      }),
      "p",
      "1.2.3.4"
    );
    expect(get).not.toBe(post);
  });
});

describe("rateLimitClient", () => {
  it("counts two IPv6 addresses in one /64 as one client", () => {
    expect(rateLimitClient("2001:db8:1:2::a")).toBe(
      rateLimitClient("2001:db8:1:2:ffff:ffff:ffff:ffff")
    );
  });

  it("counts addresses in different /64s apart", () => {
    expect(rateLimitClient("2001:db8:1:2::a")).not.toBe(
      rateLimitClient("2001:db8:1:3::a")
    );
  });

  it("counts an IPv4 address by itself, mapped or not", () => {
    expect(rateLimitClient("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitClient("::ffff:203.0.113.7")).toBe("203.0.113.7");
    // Two mapped IPv4 clients are not one /64.
    expect(rateLimitClient("::ffff:203.0.113.7")).not.toBe(
      rateLimitClient("::ffff:203.0.113.8")
    );
  });
});

describe("validateRouteOptions: a route's own allowance", () => {
  it("accepts positive integers", () => {
    expect(
      validateRouteOptions(route({ rateLimit: { max: 10, windowMs: 60_000 } }))
    ).toBeNull();
  });

  it.each([
    [{ max: 0, windowMs: 60_000 }],
    [{ max: 10, windowMs: -1 }],
    [{ max: 1.5, windowMs: 60_000 }],
    [{ max: 10 }],
    [{ max: 10, windowMs: 60_000, key: "ip" }],
  ])("refuses %j", allowance => {
    expect(
      validateRouteOptions(route({ rateLimit: allowance as never }))
    ).toContain("rateLimit");
  });
});

describe("rateLimitProxyWarning", () => {
  const limited = {
    fullPath: "/plugins/acme-auth/callback",
    route: route({ method: "GET", rateLimit: "auth" }),
  };
  const open = { fullPath: "/plugins/acme-auth/info", route: route() };

  it("names each rate-limited route when the proxy is not trusted", () => {
    expect(rateLimitProxyWarning([limited, open], false)).toContain(
      "GET /plugins/acme-auth/callback"
    );
    expect(rateLimitProxyWarning([limited, open], false)).not.toContain(
      "/info"
    );
  });

  it("says nothing when the proxy is trusted", () => {
    expect(rateLimitProxyWarning([limited], true)).toBeNull();
  });

  it("says nothing when no route is rate limited", () => {
    expect(rateLimitProxyWarning([open], false)).toBeNull();
  });
});
