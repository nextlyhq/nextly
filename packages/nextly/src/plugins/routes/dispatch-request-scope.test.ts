/**
 * A plugin route pins the request its handler is serving.
 *
 * A contributed route reaches the collections through the managed facade, and
 * that facade takes an explicit request only if the route names one. Routes
 * written before the field existed do not, and a hook underneath them then
 * reads a browser's write as background work: a rate limit stands down, an
 * audit records nothing, a honeypot never runs. Pinning here is what makes the
 * facts reach the hook without every contributed route remembering.
 *
 * Sibling of `dispatch-caller.test.ts`, which pins the other scope this opens
 * for the same reason.
 *
 * @module plugins/routes/dispatch-request-scope
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(async () => ({
    userId: "u1",
    userEmail: "u1@x.com",
    userName: "U",
    permissions: [],
    roles: [],
    authMethod: "session" as const,
  })),
  requirePermission: vi.fn(async () => undefined),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

import { currentRequest } from "../../hooks/request-scope";
import type { PluginContext } from "../plugin-context";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute } from "./route-types";

const baseCtx = () =>
  ({
    self: { name: "@a/x", collections: {}, singles: {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    services: {},
  }) as unknown as PluginContext;

function match(handler: PluginRoute["handler"]): RouteMatch {
  return {
    pluginName: "@a/x",
    route: { method: "GET", path: "/r", handler } as PluginRoute,
    baseCtx: baseCtx(),
    params: {},
  };
}

describe("a plugin route pins the request", () => {
  it("hands it to code that was told nothing", async () => {
    let seen: Request | undefined;
    const req = new Request("http://x/api/plugins/@a/x/r");
    await runPluginRoute(
      req,
      match(() => {
        // What a service several layers below the handler can reach. The
        // handler's own argument is not the question: the facade underneath it
        // is what reads this.
        seen = currentRequest();
        return Response.json({ ok: true });
      })
    );
    expect(seen).toBe(req);
  });

  it("pins nothing outside a route", () => {
    // The control. A scope that leaked would answer here too, and every job
    // and seed write would be attributed to whichever route ran last.
    expect(currentRequest()).toBeUndefined();
  });

  it("closes when the handler returns", async () => {
    await runPluginRoute(
      new Request("http://x/api/plugins/@a/x/r"),
      match(() => Response.json({ ok: true }))
    );
    expect(currentRequest()).toBeUndefined();
  });
});
