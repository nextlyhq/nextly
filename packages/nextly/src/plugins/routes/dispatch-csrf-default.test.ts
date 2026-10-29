/**
 * The cross-site check a plugin route applies, driven through the dispatcher.
 *
 * A plugin page's own write to its route — a `fetch` that sends the session
 * and csrf cookies and the site's own `Origin`, and no token — has to pass
 * the default, so the default is an origin check: a token demanded by default
 * refused every such write with 403, while a forged cross-site write must
 * still be refused, recorded, and answered as `CSRF_FAILED`. The admin's
 * `usePluginRouteMutation` sends the token as well;
 * `usePluginRouteMutation.dispatch.test.tsx` in the admin drives it here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// These tests read a session with no database behind it. Whether the account
// may still use its token is the session check's own question, covered by
// `auth/session/__tests__/session-standing.test.ts` and, on each dialect,
// `session-cutoff.integration.test.ts`; here every account may.
vi.mock("../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../auth/session/session-standing")
  >()),
  sessionTokenIsCurrent: async () => true,
}));

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

const auditWrite = vi.hoisted(() => vi.fn());
vi.mock("../../domains/audit/audit-log-writer", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../domains/audit/audit-log-writer")
  >()),
  buildAuditLogWriter: () => ({ write: auditWrite }),
}));

vi.mock("../../di/service-access", () => ({ getService: () => ({}) }));

import { requireAuthentication } from "../../auth/middleware";
import { signAccessToken } from "../../auth/jwt/sign";
import {
  createPluginAuthApi,
  type CompleteLoginDeps,
} from "../../auth/plugin-auth-api";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext, PluginDefinition } from "../plugin-context";

import { collectPluginRoutes } from "./collect-routes";
import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

let handlerCalls = 0;
function match(extra: Partial<PluginRoute> = {}): RouteMatch {
  return {
    pluginName: "@a/x",
    route: {
      method: "POST",
      path: "/patterns",
      handler: () => {
        handlerCalls++;
        return Response.json({ ok: true });
      },
      ...extra,
    } as PluginRoute,
    baseCtx,
    params: {},
  };
}

/** A write with the given cookies and origin, and no token anywhere. */
function write(cookie: string, origin: string | null): Request {
  return new Request("http://localhost:3000/admin/api/plugins/@a/x/patterns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ name: "hero" }),
  });
}

const ADMIN_COOKIES = "nextly_session=s; nextly_csrf=tok";

beforeEach(() => {
  handlerCalls = 0;
  auditWrite.mockReset();
  vi.mocked(requireAuthentication).mockResolvedValue({
    userId: "u1",
    userEmail: "u1@x.com",
    userName: "U",
    authMethod: "session",
  } as never);
});

describe("a plugin route's default cross-site check", () => {
  it("admits a same-origin write that sends no token", async () => {
    const res = await runPluginRoute(
      write(ADMIN_COOKIES, "http://localhost:3000"),
      match()
    );
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  it("refuses a cross-site write as CSRF_FAILED, and records it", async () => {
    const res = await runPluginRoute(
      write(ADMIN_COOKIES, "https://evil.example"),
      match()
    );

    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(0);
    const body = (await res.json()) as { error: { code: string } };
    // Not FORBIDDEN: the caller may hold every permission, and a client can
    // tell a stale page from a missing grant only by the code.
    expect(body.error.code).toBe("CSRF_FAILED");
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "csrf-failed",
        metadata: { path: "plugins/@a/x/patterns", method: "POST" },
      })
    );
  });

  it("still demands the token from a route that declares csrf: true", async () => {
    const res = await runPluginRoute(
      write(ADMIN_COOKIES, "http://localhost:3000"),
      match({ csrf: true })
    );
    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(0);
  });
});

describe("a public route that declares csrf: true", () => {
  it("does not treat an unrelated cookie as a session", async () => {
    // Any cookie counted, so a browser carrying an analytics or locale cookie
    // and no session was held to a token it could never present.
    const res = await runPluginRoute(
      write("_ga=GA1.2.3; NEXT_LOCALE=en", "http://localhost:3000"),
      match({ public: true, csrf: true })
    );
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  it("demands the token from a caller the session cookie authenticates", async () => {
    // The control: a classifier that never saw a session would pass the case
    // above while leaving the signed-in caller unchecked. Signed with the
    // secret the dispatcher verifies with; a cookie that authenticates nobody
    // is an anonymous caller's, checked for its origin alone
    // (`dispatch-csrf-anonymous.test.ts`).
    const token = await signAccessToken(
      { sub: "u1", email: "u1@x.com" },
      process.env.NEXTLY_SECRET ?? ""
    );
    const res = await runPluginRoute(
      write(
        `nextly_session=${token}; nextly_csrf=tok`,
        "http://localhost:3000"
      ),
      match({ public: true, csrf: true })
    );
    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(0);
  });
});

describe("a route that opts out with csrf: false", () => {
  /** A request with the given method and cookies, from a sibling subdomain. */
  function siblingRequest(method: string, cookie: string): Request {
    return new Request(
      "http://localhost:3000/admin/api/plugins/@a/x/patterns",
      {
        method,
        headers: {
          cookie,
          origin: "https://sibling.example.com",
          ...(method === "GET" ? {} : { "content-type": "text/plain" }),
        },
        ...(method === "GET" ? {} : { body: "{}" }),
      }
    );
  }

  it("refuses a write the session cookie authenticates, and records it", async () => {
    // A sibling subdomain is same-site, so the browser sends the session
    // cookie on a no-preflight `text/plain` POST; the opt-out must not turn
    // that into a write as the signed-in user.
    const res = await runPluginRoute(
      siblingRequest("POST", ADMIN_COOKIES),
      match({ csrf: false })
    );

    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(0);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CSRF_FAILED");
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "csrf-failed",
        metadata: { path: "plugins/@a/x/patterns", method: "POST" },
      })
    );
  });

  it("refuses the app's boot when a public route opts out", () => {
    // On a public route the opt-out would switch a refusal on where the
    // public default checks nothing, so the pair is refused at collection,
    // naming the plugin and the route, rather than guessed at per request.
    let thrown: unknown;
    try {
      collectPluginRoutes([
        {
          name: "@a/x",
          version: "1.0.0",
          nextly: ">=0.0.1",
          contributes: {
            routes: [match({ csrf: false, public: true }).route],
          },
        } as PluginDefinition,
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect((thrown as NextlyError).logMessage).toBe(
      'Plugin "@a/x" route POST /patterns: csrf: false cannot be combined with public: true; declare csrf: true if the handler acts on the signed-in user, or leave csrf unset.'
    );
  });

  it("collects a public route that leaves csrf unset", () => {
    // The control: a refusal of every public route would pass the case above.
    expect(
      collectPluginRoutes([
        {
          name: "@a/x",
          version: "1.0.0",
          nextly: ">=0.0.1",
          contributes: { routes: [match({ public: true }).route] },
        } as PluginDefinition,
      ]).map(entry => entry.fullPath)
    ).toEqual(["/plugins/@a/x/patterns"]);
  });

  it("admits the same write from an API-key caller", async () => {
    // The control: a route refusing every write would pass the case above.
    vi.mocked(requireAuthentication).mockResolvedValue({
      userId: "u1",
      userEmail: "u1@x.com",
      userName: "U",
      authMethod: "api-key",
    } as never);
    const res = await runPluginRoute(
      siblingRequest("POST", ""),
      match({ csrf: false })
    );
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });

  it("admits a read the session cookie authenticates", async () => {
    const res = await runPluginRoute(
      siblingRequest("GET", ADMIN_COOKIES),
      match({ csrf: false, method: "GET" })
    );
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
  });
});

describe("a public route that reads the signed-in user", () => {
  const SECRET = "a-test-secret-of-at-least-thirty-two-characters";
  // Only `secret` is read on the path under test: `currentUser` verifies the
  // session cookie with it and touches nothing else.
  const auth = createPluginAuthApi(
    () => ({ secret: SECRET }) as unknown as CompleteLoginDeps
  );

  /** A route whose handler asks who is signed in, as many times as told. */
  function readsUser(reads = 1, after?: () => never): RouteMatch {
    const base = match({ public: true });
    return {
      ...base,
      baseCtx: { ...baseCtx, auth } as unknown as PluginContext,
      route: {
        ...base.route,
        handler: async (req: Request, ctx: PluginContext) => {
          handlerCalls++;
          let user: unknown = null;
          for (let i = 0; i < reads; i++) {
            user = await ctx.auth.currentUser(req);
          }
          after?.();
          return Response.json({ user });
        },
      } as PluginRoute,
    };
  }

  async function sessionCookies(): Promise<string> {
    const token = await signAccessToken(
      { sub: "u1", email: "u1@x.com" },
      SECRET
    );
    return `nextly_session=${token}; nextly_csrf=tok`;
  }

  const csrfRows = () =>
    auditWrite.mock.calls.filter(
      ([event]) => (event as { kind?: string }).kind === "csrf-failed"
    );

  it("answers no user to a signed-in cross-site write, and records it", async () => {
    const res = await runPluginRoute(
      write(await sessionCookies(), "https://evil.example"),
      readsUser()
    );

    expect(((await res.json()) as { user: unknown }).user).toBeNull();
    expect(csrfRows()).toEqual([
      [
        expect.objectContaining({
          kind: "csrf-failed",
          metadata: { path: "plugins/@a/x/patterns", method: "POST" },
        }),
      ],
    ]);
  });

  it("answers the user to a same-origin write, and records nothing", async () => {
    // The control: a route that refused and recorded every write would pass
    // the case above.
    const res = await runPluginRoute(
      write(await sessionCookies(), "http://localhost:3000"),
      readsUser()
    );

    expect(((await res.json()) as { user: { id: string } }).user.id).toBe("u1");
    expect(csrfRows()).toEqual([]);
  });

  it("records nothing for a cross-site write that carries no session", async () => {
    // A cookie-less post from another site, such as a provider's webhook,
    // forges nobody's request.
    const res = await runPluginRoute(
      write("_ga=GA1.2.3", "https://evil.example"),
      readsUser()
    );

    expect(((await res.json()) as { user: unknown }).user).toBeNull();
    expect(csrfRows()).toEqual([]);
  });

  it("records one row however often the handler asks", async () => {
    await runPluginRoute(
      write(await sessionCookies(), "https://evil.example"),
      readsUser(3)
    );
    expect(csrfRows()).toHaveLength(1);
  });

  it("still records it when the handler then fails", async () => {
    const res = await runPluginRoute(
      write(await sessionCookies(), "https://evil.example"),
      readsUser(1, () => {
        throw NextlyError.forbidden();
      })
    );

    expect(res.status).toBe(403);
    expect(csrfRows()).toHaveLength(1);
  });
});

describe("a route that asks for the raw body and a token", () => {
  it("hands the handler the exact bytes sent, after the token was read from them", async () => {
    // Bytes a parse-and-reserialise would change: spacing, key order, an
    // escaped character, a non-ASCII one and a trailing newline. A signature
    // a webhook route checks is over exactly these.
    const sent = new TextEncoder().encode(
      '{ "z": 1,  "csrfToken": "tok", "a": "caf\\u00e9 é" }\n'
    );
    let received: Uint8Array | undefined;
    const route = match({ csrf: true, rawBody: true });
    route.route.handler = async (req: Request) => {
      handlerCalls++;
      received = new Uint8Array(await req.arrayBuffer());
      return Response.json({ ok: true });
    };

    const res = await runPluginRoute(
      new Request("http://localhost:3000/admin/api/plugins/@a/x/patterns", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ADMIN_COOKIES,
          origin: "http://localhost:3000",
        },
        body: sent,
      }),
      route
    );

    // The check passed on the token in the body, so it read the body first.
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
    expect(received).toEqual(sent);
  });
});
