/**
 * The cross-site check a plugin route applies, driven through the dispatcher.
 *
 * The admin's own writes to plugin routes (`usePluginRouteMutation`) send the
 * session and csrf cookies, the site's own `Origin`, and no token. The default
 * therefore has to be an origin check: a token demanded by default refused
 * every such write with 403, while a forged cross-site write must still be
 * refused, recorded, and answered as `CSRF_FAILED`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../di/register", () => ({ getService: () => ({}) }));

import { requireAuthentication } from "../../auth/middleware";
import type { PluginContext } from "../plugin-context";

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
  it("admits the admin's own write, which sends no token", async () => {
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

  it("demands the token from a caller carrying the session cookie", async () => {
    // The control: a classifier that never saw a session would pass the case
    // above while leaving the session-carrying caller unchecked.
    const res = await runPluginRoute(
      write(ADMIN_COOKIES, "http://localhost:3000"),
      match({ public: true, csrf: true })
    );
    expect(res.status).toBe(403);
    expect(handlerCalls).toBe(0);
  });
});
