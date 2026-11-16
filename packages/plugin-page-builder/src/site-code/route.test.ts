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

import { cspHash } from "./csp";
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
    // A Single read with `createIfMissing` is created empty, at a version.
    findSingle: async args => {
      if (doc === null && args.createIfMissing) doc = { _rev: "rev-0" };
      return doc;
    },
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
  csp?: string,
  reportOnly = false,
  personName?: (id: string) => Promise<string | null>
): PluginRoute {
  const route = siteCodeRoutes({
    nextly: async () => nextly,
    options: csp === undefined ? undefined : { csp, reportOnly },
    permission: "manage-page-builder-site",
    ...(personName === undefined ? {} : { personName }),
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

  it("says exactly what to add to a policy that blocks the code", async () => {
    const { nextly } = store();
    const { ctx } = contextFor("session");
    const route = routeOf("POST", nextly, "script-src 'self'");
    const checked = (await (
      await call(
        route,
        post({ head: "<script>a()</script>", body: "", dryRun: true }),
        ctx
      )
    ).json()) as {
      item: {
        csp: { additions: { directive: string; sources: string[] }[] }[];
      };
    };
    // A directive the policy doesn't name comes whole: its fallback's
    // sources, the inline script's hash and the loader's.
    const [addition] = checked.item.csp[0]?.additions ?? [];
    expect(addition?.directive).toBe("script-src-elem");
    expect(addition?.sources).toContain("'self'");
    expect(addition?.sources).toContain(`'${await cspHash("a()")}'`);
  });

  it("adds nothing to a policy that blocks nothing", async () => {
    const { nextly } = store();
    const { ctx } = contextFor("session");
    const checked = (await (
      await call(
        routeOf("POST", nextly, "script-src 'self' 'unsafe-inline'"),
        post({ head: "<script>a()</script>", body: "", dryRun: true }),
        ctx
      )
    ).json()) as { item: { csp: { additions: unknown[] }[] } };
    expect(checked.item.csp[0]?.additions).toEqual([]);
  });

  it("shows a Report-Only policy's findings but asks no acknowledgement for them", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    const route = routeOf("POST", nextly, "script-src 'self'", true);
    const code = { head: "<script>a()</script>", body: "" };
    const checked = (await (
      await call(route, post({ ...code, dryRun: true }), ctx)
    ).json()) as {
      item: {
        cspKey: string | null;
        csp: { check: { findings: unknown[] } }[];
      };
    };
    expect(checked.item.csp[0]?.check.findings.length).toBeGreaterThan(0);
    expect(checked.item.cspKey).toBeNull();
    await call(route, post(code), ctx);
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

describe("the version a save is made from", () => {
  it("makes the first save of a site with none stored against the empty Single's version", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    await call(
      routeOf("POST", nextly),
      post({ head: "<script>a()</script>", body: "" }),
      ctx
    );
    // Never an overwrite: a second first save at once is refused as stale.
    expect(updates[0]?.data).toMatchObject({ _rev: "rev-0" });
    expect(updates[0]?.data).not.toHaveProperty("_overwrite");
  });

  it("refuses a second save naming no version once the first has stored code", async () => {
    const { nextly, updates } = store();
    const { ctx } = contextFor("session");
    const route = routeOf("POST", nextly);
    await call(
      route,
      post({ head: "<script>first()</script>", body: "" }),
      ctx
    );
    await expect(
      call(route, post({ head: "<script>second()</script>", body: "" }), ctx)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updates).toHaveLength(1);
  });

  it("refuses a save naming no version once code is stored, writing nothing", async () => {
    const { nextly, updates } = store({
      headSource: "<script>stored()</script>",
      _rev: "rev-7",
    });
    const { ctx } = contextFor("session");
    await expect(
      call(
        routeOf("POST", nextly),
        post({ head: "<script>a()</script>", body: "" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updates).toEqual([]);
  });

  it("answers the version its own write made, not a later read's", async () => {
    const { nextly } = store({ headSource: "", _rev: "rev-7" });
    // Someone else's save lands right after this one: a read now would see it.
    const write = nextly.updateSingle.bind(nextly);
    nextly.updateSingle = async args => {
      const mine = await write(args);
      await write({ ...args, data: { headSource: "theirs", _rev: "x" } });
      return mine;
    };
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("POST", nextly),
      post({ head: "<script>a()</script>", body: "", version: "rev-7" }),
      ctx
    );
    const { item } = (await answer.json()) as { item: { version: string } };
    expect(item.version).toBe("rev-1");
  });
});

describe("reading site code", () => {
  it("answers what was written, its version, whether a policy is declared, and who changed it when", async () => {
    const { nextly } = store({
      headSource: "<script>a()</script>",
      bodySource: "",
      head: [{ tag: "script", attrs: {}, text: "a()" }],
      body: [],
      changedBy: "user:user-1",
      updatedAt: "2026-11-06T09:30:00.000Z",
      _rev: "rev-7",
    });
    const { ctx } = contextFor("session");
    const names = vi.fn(async (id: string) =>
      id === "user-1" ? "Ada Lovelace" : null
    );
    const answer = await call(
      routeOf("GET", nextly, "script-src 'self'", false, names),
      new Request(`${SITE}/x`),
      ctx
    );
    expect(await answer.json()).toEqual({
      head: "<script>a()</script>",
      body: "",
      version: "rev-7",
      policyDeclared: true,
      described: { head: ["An inline script"], body: [] },
      changedAt: "2026-11-06T09:30:00.000Z",
      changedBy: "Ada Lovelace",
    });
  });

  it("answers no name where it can't be read, and never fails the read", async () => {
    const { nextly } = store({ changedBy: "user:gone", _rev: "rev-1" });
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("GET", nextly, undefined, false, async () => {
        throw new Error("no such user");
      }),
      new Request(`${SITE}/x`),
      ctx
    );
    expect(await answer.json()).toMatchObject({
      changedBy: null,
      changedAt: null,
      described: { head: [], body: [] },
    });
  });
});
