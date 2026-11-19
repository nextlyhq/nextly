/**
 * The builder's start-up read answers each read as that read's own route
 * would: the same handler, the same caller, the route's own gate, and one
 * read's refusal or failure never failing the reads beside it.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  builderStartupPath,
  type BuilderStartupResponse,
} from "./builder-startup-contract";
import { builderStartupRoute } from "./builder-startup-route";

const BASE = "http://site.test/admin/api/plugins/@nextlyhq/plugin-page-builder";

/** A route context whose caller holds exactly `granted`. */
function contextHolding(granted: readonly string[]): {
  ctx: PluginRouteContext;
  asked: string[];
} {
  const asked: string[] = [];
  const ctx = {
    self: {
      name: "@nextlyhq/plugin-page-builder",
      // Renamed, so a gate read from the declared name would ask the wrong
      // resource and be told apart from one read from the resolved name.
      collections: { layouts: "site_layouts" },
      singles: {},
    },
    caller: {
      can: async (action: string, resource: string) => {
        asked.push(`${action}-${resource}`);
        return granted.includes(`${action}-${resource}`);
      },
    },
    logger: { warn: vi.fn() },
    params: {},
  } as unknown as PluginRouteContext;
  return { ctx, asked };
}

/** A GET route answering its own query back, as JSON. */
function echo(path: string, extra: object = {}) {
  return {
    method: "GET" as const,
    path,
    siteWide: false as const,
    handler: vi.fn(async (req: Request) =>
      Response.json({
        at: new URL(req.url).pathname,
        q: new URL(req.url).search,
      })
    ),
    ...extra,
  };
}

async function ask(
  route: ReturnType<typeof builderStartupRoute>,
  reads: readonly string[],
  ctx: PluginRouteContext
): Promise<BuilderStartupResponse> {
  const response = await route.handler(
    new Request(`${BASE}${builderStartupPath(reads)}`),
    ctx
  );
  expect(response.status).toBe(200);
  return (await response.json()) as BuilderStartupResponse;
}

describe("the builder's start-up read", () => {
  it("answers each read through its own route, with that route's path and query", async () => {
    const loops = echo("/loop-collections");
    const style = echo("/site/style");
    const route = builderStartupRoute([loops, style]);
    const { ctx, asked } = contextHolding([]);
    const answer = await ask(
      route,
      ["/loop-collections?locale=fr", "/site/style"],
      ctx
    );
    expect(answer.reads).toEqual({
      "/loop-collections?locale=fr": {
        status: 200,
        body: {
          at: "/admin/api/plugins/@nextlyhq/plugin-page-builder/loop-collections",
          q: "?locale=fr",
        },
      },
      "/site/style": {
        status: 200,
        body: {
          at: "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/style",
          q: "",
        },
      },
    });
    // The same caller the request came with, for each.
    expect(loops.handler.mock.calls[0]?.[1]).toBe(ctx);
    expect(style.handler).toHaveBeenCalledTimes(1);
    // It decides nothing itself: each handler judges its caller.
    expect(asked).toEqual([]);
  });

  it("says whom it read for, so the editor hands it to no one else", async () => {
    const route = builderStartupRoute([echo("/site/style")]);
    const signedIn = contextHolding([]).ctx;
    (signedIn as { user: unknown }).user = { id: "ada" };
    expect((await ask(route, ["/site/style"], signedIn)).readFor).toBe("ada");
    const nobody = contextHolding([]).ctx;
    (nobody as { user: unknown }).user = null;
    expect((await ask(route, ["/site/style"], nobody)).readFor).toBeNull();
  });

  it("refuses one read without failing the others", async () => {
    const refusing = {
      ...echo("/capability"),
      handler: vi.fn(async () => {
        throw NextlyError.forbidden();
      }),
    };
    const failing = {
      ...echo("/named-queries"),
      handler: vi.fn(async () => {
        throw new Error("the database went away");
      }),
    };
    const answering = echo("/site/style");
    const route = builderStartupRoute([refusing, failing, answering]);
    const { ctx } = contextHolding([]);
    const answer = await ask(
      route,
      ["/capability", "/named-queries", "/site/style", "/not-a-read"],
      ctx
    );
    expect(answer.reads["/capability"]).toEqual({ status: 403 });
    expect(answer.reads["/named-queries"]).toEqual({ status: 500 });
    expect(answer.reads["/site/style"]?.status).toBe(200);
    // Only the routes it was built with are answered for.
    expect(answer.reads["/not-a-read"]).toEqual({ status: 404 });
  });

  it("answers a route's own refusal response as its status alone", async () => {
    const gone = {
      ...echo("/layouts/page-collection"),
      handler: vi.fn(async () => Response.json({ secret: 1 }, { status: 404 })),
    };
    const route = builderStartupRoute([gone]);
    const answer = await ask(
      route,
      ["/layouts/page-collection"],
      contextHolding([]).ctx
    );
    expect(answer.reads["/layouts/page-collection"]).toEqual({ status: 404 });
  });

  it("refuses a request naming no reads, too many, one that is not a path, or one route twice", async () => {
    const route = builderStartupRoute([echo("/site/style")]);
    const { ctx } = contextHolding([]);
    for (const reads of [
      [],
      Array.from({ length: 13 }, (_, n) => `/x${String(n)}`),
      ["https://elsewhere.test/site/style"],
      ["//elsewhere.test/site/style"],
      // One route twice, so one request would run it twice.
      ["/site/style", "/site/style?again=1"],
    ]) {
      await expect(
        route.handler(new Request(`${BASE}${builderStartupPath(reads)}`), ctx)
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("refuses, while the config is read, a route it could not answer as the dispatcher does", () => {
    for (const [extra, why] of [
      [{ method: "POST" }, "not a GET"],
      [{ path: "/items/:id" }, "parameters"],
      [{ public: true, siteWide: undefined }, "public"],
      [{ middleware: [async () => new Response()] }, "middleware"],
      [{ rateLimit: "general" }, "rate limit"],
      [{ formatTimestamps: true }, "timestamps"],
      [{ mount: "root" }, "root"],
      [{ siteWide: undefined }, "declares no access"],
      [
        {
          siteWide: undefined,
          requiredPermission: () => "read-layouts",
        },
        "judges its permission",
      ],
    ] as const) {
      expect(() =>
        builderStartupRoute([
          echo("/x", extra) as unknown as Parameters<
            typeof builderStartupRoute
          >[0][number],
        ])
      ).toThrow(why);
    }
  });

  it("is authenticated, judges each read's caller, and is never stored", () => {
    const route = builderStartupRoute([]);
    expect(route).toMatchObject({
      method: "GET",
      path: "/builder/startup",
      checksAccess: true,
      noStore: true,
    });
    expect(route).not.toHaveProperty("public");
  });
});
