/**
 * One owner builds the error body, so every boundary answers with the same one.
 *
 * Two places used to build it. They agreed on the status and the content type
 * and diverged on everything either had gained since, which is why a plugin
 * route was the only surface with no development diagnostics and why a rejected
 * request and a failing handler on that same route came back in two different
 * envelopes.
 *
 * These compare the boundaries against each other rather than against a fixed
 * expected body: a shared owner that both call is the property under test, and
 * a literal would keep passing if one of them stopped calling it and happened
 * to reproduce today's shape.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { runPluginRoute } from "../../plugins/routes/dispatch";
import type { PluginContext } from "../../plugins/plugin-context";
import type { RouteMatch } from "../../plugins/routes/route-registry";
import type { PluginRoute } from "../../plugins/routes/route-types";
import { withErrorHandler } from "../with-error-handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

const baseCtx = {
  self: { name: "@a/x", collections: {}, singles: {} },
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

/** The same failure, thrown from a plugin route. */
function pluginRouteThrowing(thrown: unknown): RouteMatch {
  const route: PluginRoute = {
    method: "GET",
    path: "/r",
    public: true,
    handler: () => {
      throw thrown;
    },
  } as PluginRoute;
  return { pluginName: "@a/x", route, baseCtx, params: {} };
}

function request(): Request {
  return new Request("http://x/api/plugins/@a/x/r");
}

/** The same failure, thrown from an ordinary route handler. */
function ordinaryRouteThrowing(thrown: unknown): Promise<Response> {
  return withErrorHandler(async (_req: Request) => {
    throw thrown;
  })(request());
}

function failure(): NextlyError {
  return NextlyError.internal({
    cause: new Error("driver: connection terminated"),
    logContext: { table: "submissions" },
  });
}

describe("both boundaries answer with the same error body", () => {
  it("agrees on the envelope and the content type", async () => {
    const [plugin, ordinary] = await Promise.all([
      runPluginRoute(request(), pluginRouteThrowing(failure())),
      ordinaryRouteThrowing(failure()),
    ]);

    expect(plugin.status).toBe(ordinary.status);
    expect(plugin.headers.get("content-type")).toBe(
      ordinary.headers.get("content-type")
    );

    const [pluginBody, ordinaryBody] = (await Promise.all([
      plugin.json(),
      ordinary.json(),
    ])) as Array<{ error: Record<string, unknown> }>;

    // The request id differs per request by design, so the comparison is over
    // the keys and the values that must not.
    expect(Object.keys(pluginBody.error).sort()).toEqual(
      Object.keys(ordinaryBody.error).sort()
    );
    expect(pluginBody.error.code).toBe(ordinaryBody.error.code);
    expect(pluginBody.error.message).toBe(ordinaryBody.error.message);
  });

  it("agrees on the development diagnostics, which one of them never had", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_DEV_DIAGNOSTICS", "1");

    const [plugin, ordinary] = await Promise.all([
      runPluginRoute(request(), pluginRouteThrowing(failure())),
      ordinaryRouteThrowing(failure()),
    ]);
    const [pluginBody, ordinaryBody] = (await Promise.all([
      plugin.json(),
      ordinary.json(),
    ])) as Array<{ error: Record<string, unknown> }>;

    expect(pluginBody.error._devDiagnostics).toEqual(
      ordinaryBody.error._devDiagnostics
    );
    expect(pluginBody.error._devDiagnostics).toMatchObject({
      logContext: { table: "submissions" },
      cause: "driver: connection terminated",
    });
  });

  it("withholds them from both under production", async () => {
    // The gate belongs to the owner now, so a boundary cannot opt out of it by
    // building its own body — and cannot opt INTO it either.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTLY_DEV_DIAGNOSTICS", "1");

    const [plugin, ordinary] = await Promise.all([
      runPluginRoute(request(), pluginRouteThrowing(failure())),
      ordinaryRouteThrowing(failure()),
    ]);

    for (const response of [plugin, ordinary]) {
      const serialized = JSON.stringify(await response.json());
      expect(serialized).not.toContain("connection terminated");
      expect(serialized).not.toContain("submissions");
    }
  });

  it("sets the request id header on both", async () => {
    // The plugin boundary has no later wrapper to add it, so the owner does.
    const [plugin, ordinary] = await Promise.all([
      runPluginRoute(request(), pluginRouteThrowing(failure())),
      ordinaryRouteThrowing(failure()),
    ]);

    expect(plugin.headers.get("x-request-id")).toBeTruthy();
    expect(ordinary.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("a plugin route keeps the failure it could not type", () => {
  it("chains a thrown non-NextlyError rather than discarding it", async () => {
    // The generic 500 exists so a handler failure cannot take the server down.
    // Discarding the thrown value along with it left the one failure carrying
    // no typed detail as the one failure carrying no detail at all.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_DEV_DIAGNOSTICS", "1");

    const response = await runPluginRoute(
      request(),
      pluginRouteThrowing(new Error("plugin exploded"))
    );
    const body = (await response.json()) as {
      error: { _devDiagnostics?: { cause?: string } };
    };

    expect(response.status).toBe(500);
    expect(body.error._devDiagnostics?.cause).toBe("plugin exploded");
  });

  it("still answers when a non-Error is thrown", async () => {
    // A handler can throw a string or an object. The chain has nothing to take
    // from those, and the response must not depend on it having something.
    const response = await runPluginRoute(
      request(),
      pluginRouteThrowing("just a string")
    );

    expect(response.status).toBe(500);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
