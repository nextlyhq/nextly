/**
 * A browser NAVIGATING to a secure plugin route without a usable session: an
 * OAuth provider sending the person back to a callback, a link opened in a
 * new tab.
 *
 * A navigation cannot run the admin's refresh, which happens in its fetch
 * code, and the refresh cookie is only sent to the auth endpoints, so the
 * route cannot refresh the session itself. Answered with JSON, the person was
 * shown the raw error body. The admin's sign-in page can: it refreshes an
 * expired session silently or asks the person to sign in, and then returns to
 * the address it was given. So a navigation is sent there instead, and every
 * other request keeps the JSON refusal its client reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The auth middleware is mocked to drive the refusals without a real session;
// `isErrorResponse` keeps its real shape, and the conversion to the canonical
// error is real, as in `dispatch-auth.test.ts`.
vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

import {
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import type { PluginContext } from "../plugin-context";

import { pluginRouteAuthRequired, runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const reqAuth = vi.mocked(requireAuthentication);
const reqPerm = vi.mocked(requirePermission);

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

let handlerCalls = 0;
function route(extra: Partial<PluginRoute> = {}): PluginRoute {
  return {
    siteWide: false,
    method: "GET",
    path: "/callback",
    handler: () => {
      handlerCalls++;
      return new Response(null, { status: 303, headers: { location: "/" } });
    },
    ...extra,
  } as PluginRoute;
}
function match(r: PluginRoute): RouteMatch {
  return { pluginName: "@a/x", route: r, baseCtx, params: {} };
}

const CALLBACK =
  "/admin/api/plugins/@a/x/callback?code=4%2F0Ab&state=s-1&scope=a+b";

/** What a browser sends when it opens `path` in a tab. */
const NAVIGATION = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-site": "cross-site",
  accept: "text/html,application/xhtml+xml",
};

function request(
  path: string,
  headers: Record<string, string>,
  method = "GET"
): Request {
  return new Request(`https://example.com${path}`, { method, headers });
}

/** The address a sign-in redirect returns to, read back from its Location. */
function returnAddressOf(res: Response): string | null {
  const location = res.headers.get("location");
  if (location === null) return null;
  const url = new URL(location, "https://example.com");
  expect(url.origin).toBe("https://example.com");
  expect(url.pathname).toBe("/admin/login");
  return url.searchParams.get("next");
}

const expired = {
  statusCode: 401,
  code: "TOKEN_EXPIRED",
  error: "Session expired",
  message: "Authentication required.",
};
const absent = {
  statusCode: 401,
  code: "AUTH_REQUIRED",
  error: "Authentication required",
  message: "Authentication required.",
};

beforeEach(() => {
  handlerCalls = 0;
  reqAuth.mockReset();
  reqPerm.mockReset();
});

describe("a navigation refused for want of a session", () => {
  it.each([
    ["an expired session", expired],
    ["no session", absent],
  ])(
    "with %s is sent to sign in and back to the same address",
    async (_, refusal) => {
      reqAuth.mockResolvedValue(refusal as never);

      const res = await runPluginRoute(
        request(CALLBACK, NAVIGATION),
        match(route())
      );

      expect(res.status).toBe(303);
      // The whole address, query included: a callback's code and state are
      // what it needs when the browser comes back.
      expect(returnAddressOf(res)).toBe(CALLBACK);
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(handlerCalls).toBe(0);
    }
  );

  it("is sent the same way by a route that asks a permission", async () => {
    reqPerm.mockResolvedValue(expired as never);

    const res = await runPluginRoute(
      request(CALLBACK, NAVIGATION),
      match(route({ requiredPermission: "manage-seo" } as Partial<PluginRoute>))
    );

    expect(res.status).toBe(303);
    expect(returnAddressOf(res)).toBe(CALLBACK);
  });

  it("is sent the same way before the app has booted", () => {
    const res = pluginRouteAuthRequired(request(CALLBACK, NAVIGATION), route());

    expect(res.status).toBe(303);
    expect(returnAddressOf(res)).toBe(CALLBACK);
  });
});

describe("every other refusal keeps its JSON answer", () => {
  it.each([
    // The admin's own fetch: its client reads the code and refreshes.
    ["a fetch", { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }, "GET"],
    // A frame cannot be moved to the admin's sign-in page usefully.
    [
      "a navigation inside a frame",
      { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
      "GET",
    ],
    // No Fetch Metadata: not known to be a browser opening a page.
    ["a request without fetch metadata", {}, "GET"],
    // A form post would lose its body on the way back.
    ["a form post", NAVIGATION, "POST"],
  ])("for %s", async (_, headers, method) => {
    reqAuth.mockResolvedValue(expired as never);

    const res = await runPluginRoute(
      request(CALLBACK, headers, method),
      match(route({ method } as Partial<PluginRoute>))
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({
      error: expect.objectContaining({ code: "TOKEN_EXPIRED" }),
    });
  });

  it("for a signed-in person the route refuses", async () => {
    // Signing in again changes nothing for a missing permission.
    reqPerm.mockResolvedValue({
      statusCode: 403,
      code: "FORBIDDEN",
      error: "Forbidden",
      message: "Forbidden",
    } as never);

    const res = await runPluginRoute(
      request(CALLBACK, NAVIGATION),
      match(route({ requiredPermission: "manage-seo" } as Partial<PluginRoute>))
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });

  it("for a route outside the admin, where the session cookie never goes", async () => {
    reqAuth.mockResolvedValue(absent as never);

    const res = await runPluginRoute(
      request("/api/plugins/@a/x/callback?code=1", NAVIGATION),
      match(route())
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
