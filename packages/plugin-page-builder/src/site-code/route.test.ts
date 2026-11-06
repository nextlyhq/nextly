/**
 * The site code route: a person, never an API key, saves code only once it
 * is judged on the server and any policy finding has been seen; the write is
 * marked for the Single's guard, and the audit row names the code by hash,
 * never holding it.
 *
 * @module site-code/route.test
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  SITE_CODE_SAVED_AUDIT,
  siteCodeRoutes,
  type SiteCodeDirectApi,
  type SiteCodeRouteContext,
} from "./route";
import { SITE_CODE_WRITE_CONTEXT } from "./storage";

const SITE = "https://acme.example";

/** The Direct API the route reads and writes through, with what it stored. */
function store(initial: Record<string, unknown> | null = null) {
  let doc = initial;
  const updates: Parameters<SiteCodeDirectApi["updateSingle"]>[0][] = [];
  const nextly: SiteCodeDirectApi = {
    findSingle: async () => doc,
    updateSingle: async args => {
      updates.push(args);
      doc = { ...doc, ...args.data, _rev: `rev-${updates.length}` };
      return doc;
    },
  };
  return { nextly, updates };
}

/** A route context for a caller signed in as `user-1`, or using a key. */
function contextFor(authMethod: "session" | "api-key") {
  const audit = vi.fn(async (_row: unknown) => undefined);
  const ctx = {
    user: { id: "user-1" },
    caller: { authMethod },
    audit: { write: audit },
    self: { singles: {} },
  } as unknown as SiteCodeRouteContext;
  return { ctx, audit };
}

/** The route for `method`, built with `deps`. */
function routeOf(
  method: "GET" | "POST",
  nextly: SiteCodeDirectApi,
  csp?: string
): PluginRoute {
  const route = siteCodeRoutes({
    nextly: async () => nextly,
    options: csp === undefined ? undefined : { csp },
    permission: "manage-page-builder-site",
  }).find(candidate => candidate.method === method);
  if (route === undefined) throw new Error(`no ${method} route`);
  return route;
}

/** A POST of `body` from the site's own origin. */
function post(body: Record<string, unknown>): Request {
  return new Request(`${SITE}/admin/api/plugins/page-builder/site/code`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE },
    body: JSON.stringify(body),
  });
}

/** Call a route as `ctx`. */
async function call(
  route: PluginRoute,
  req: Request,
  ctx: SiteCodeRouteContext
): Promise<Response> {
  return route.handler(req, ctx as never);
}

describe("saving site code", () => {
  it("is refused to an API key, before anything is read or written", async () => {
    const { nextly, updates } = store();
    const find = vi.spyOn(nextly, "findSingle");
    const { ctx, audit } = contextFor("api-key");
    await expect(
      call(routeOf("POST", nextly), post({ head: "", body: "" }), ctx)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(find).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("checks without saving on a dry run", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("POST", nextly),
      post({
        head: "<script>a()</script><base href=/>",
        body: "",
        dryRun: true,
      }),
      ctx
    );
    const { item } = (await answer.json()) as {
      item: { head: { refusals: string[]; elements: number } };
    };
    expect(item.head.refusals).toEqual(["<base>: <base> isn't allowed."]);
    expect(updates).toEqual([]);
  });

  it("refuses code the sanitiser refuses, saving nothing", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    await expect(
      call(
        routeOf("POST", nextly),
        post({ head: '<img src=x onerror="a()">', body: "" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updates).toEqual([]);
  });

  it("saves code a policy blocks only with the key naming those findings", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    const route = routeOf("POST", nextly, "script-src 'self'");
    const code = { head: "<script>a()</script>", body: "" };
    await expect(call(route, post(code), ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      call(route, post({ ...code, acknowledgeCsp: "sha256-other" }), ctx)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updates).toEqual([]);
    const checked = (await (
      await call(route, post({ ...code, dryRun: true }), ctx)
    ).json()) as { item: { cspKey: string } };
    await call(
      route,
      post({ ...code, acknowledgeCsp: checked.item.cspKey }),
      ctx
    );
    expect(updates).toHaveLength(1);
  });

  it("writes what was written and what it was judged into, marked, as the person", async () => {
    const { nextly, updates } = store();
    const { ctx, audit } = contextFor("session");
    await call(
      routeOf("POST", nextly),
      post({
        head: '<script async src="https://cdn.example/a.js"></script>',
        body: "<script>secret()</script>",
        version: "rev-0",
      }),
      ctx
    );
    expect(updates).toEqual([
      {
        slug: "page-builder-site-code",
        data: {
          headSource: '<script async src="https://cdn.example/a.js"></script>',
          bodySource: "<script>secret()</script>",
          head: [
            {
              tag: "script",
              attrs: { async: "", src: "https://cdn.example/a.js" },
            },
          ],
          body: [{ tag: "script", attrs: {}, text: "secret()" }],
          changedBy: "user:user-1",
          _rev: "rev-0",
        },
        overrideAccess: true,
        context: { ...SITE_CODE_WRITE_CONTEXT },
        user: { id: "user-1" },
      },
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
    const row = audit.mock.calls[0]?.[0] as {
      kind: string;
      metadata: Record<string, unknown>;
    };
    expect(row.kind).toBe(SITE_CODE_SAVED_AUDIT);
    expect(row.metadata).toMatchObject({
      elements: 2,
      inlineScripts: 1,
      externalScripts: 1,
      scriptOrigins: "https://cdn.example",
      cspFindings: 0,
      cspOverridden: false,
    });
    expect(row.metadata.headSha256).toMatch(/^[0-9a-f]{64}$/);
    // The code itself is never in the row.
    expect(JSON.stringify(row)).not.toContain("secret()");
  });
});

describe("reading site code", () => {
  it("answers what was written, its version, and whether a policy is declared", async () => {
    const { nextly } = store({
      headSource: "<script>a()</script>",
      bodySource: "",
      _rev: "rev-7",
    });
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("GET", nextly, "script-src 'self'"),
      new Request(`${SITE}/x`),
      ctx
    );
    expect(await answer.json()).toEqual({
      head: "<script>a()</script>",
      body: "",
      version: "rev-7",
      policyDeclared: true,
    });
  });
});
