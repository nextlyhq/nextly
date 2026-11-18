/**
 * The site CSS routes: a person, never an API key, saves CSS only once the
 * checker accepts it and only over the CSS they read; the read and the save
 * ask for the site settings permission; each save writes an audit row naming
 * the CSS by hash, never holding it, and expires the cached pages that drew
 * the CSS it replaced.
 *
 * @module site-code/css-route.test
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  SITE_CSS_DRAWN_ROUTE_PATH,
  SITE_CSS_ROUTE_PATH,
} from "../site-css-contract";
import { sha256Hex } from "../sha256-hex";

import {
  SITE_CSS_SAVED_AUDIT,
  siteCssRoutes,
  type SiteCssRouteContext,
  type SiteCssStore,
} from "./css-route";
import {
  SITE_CSS_CACHE_PART,
  SITE_CSS_STALE,
  SiteCssStaleError,
  type SiteCssSave,
} from "./site-css-store";

const PERMISSION = "manage-page-builder-site";

/** A store holding `css`, which refuses a save made from another hash. */
async function storeHolding(css = "") {
  let held = { css, sha256: await sha256Hex(css), by: null as string | null };
  const saves: SiteCssSave[] = [];
  const store: SiteCssStore = {
    read: async () => ({
      css: held.css,
      sha256: held.sha256,
      changedBy: held.by,
      changedAt: held.by === null ? null : "2026-11-18T06:00:00.000Z",
    }),
    save: async save => {
      if (save.readSha256 !== held.sha256) throw new SiteCssStaleError();
      saves.push(save);
      const before = { sha256: held.sha256, chars: held.css.length };
      held = {
        css: save.css,
        sha256: await sha256Hex(save.css),
        by: save.changedBy,
      };
      return { before, after: { sha256: held.sha256, chars: save.css.length } };
    },
  };
  return { store, saves };
}

/** A route context for a caller signed in as `user-1`, or using a key. */
function contextFor(authMethod: "session" | "api-key") {
  const audit = vi.fn(async (_row: unknown) => undefined);
  const expire = vi.fn(async (..._parts: string[]) => undefined);
  const ctx = {
    user: { id: "user-1" },
    caller: { authMethod },
    audit: { write: audit },
    cache: { expire },
  } as unknown as SiteCssRouteContext;
  return { ctx, audit, expire };
}

/** The route for `method` at `path`. */
function routeOf(
  method: "GET" | "POST",
  store: SiteCssStore,
  path = SITE_CSS_ROUTE_PATH,
  options: {
    mayDraw?: boolean;
    personName?: (id: string) => Promise<string | null>;
  } = {}
): PluginRoute {
  const route = siteCssRoutes({
    permission: PERMISSION,
    mayDraw: async () => options.mayDraw ?? true,
    store: () => store,
    ...(options.personName === undefined
      ? {}
      : { personName: options.personName }),
  }).find(candidate => candidate.method === method && candidate.path === path);
  if (route === undefined) throw new Error(`no ${method} ${path} route`);
  return route;
}

/** A save's POST. */
function post(body: unknown): Request {
  return new Request("https://acme.example/admin/api/plugins/x/site/css", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Call a route as `ctx`. */
function call(
  route: PluginRoute,
  req: Request,
  ctx: SiteCssRouteContext
): Promise<Response> {
  return route.handler(req, ctx as never) as Promise<Response>;
}

describe("the site CSS routes' permission", () => {
  it("reads and saves under the site settings permission", async () => {
    const { store } = await storeHolding();
    expect(routeOf("GET", store).requiredPermission).toBe(PERMISSION);
    expect(routeOf("POST", store).requiredPermission).toBe(PERMISSION);
  });

  it("refuses the canvas's read to a caller who may not read the site style", async () => {
    const { store } = await storeHolding("body { color: red; }");
    const read = vi.spyOn(store, "read");
    const { ctx } = contextFor("session");
    const route = routeOf("GET", store, SITE_CSS_DRAWN_ROUTE_PATH, {
      mayDraw: false,
    });
    await expect(
      call(route, new Request("https://acme.example/"), ctx)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  });

  it("gives the canvas the CSS alone", async () => {
    const { store } = await storeHolding("body { color: red; }");
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("GET", store, SITE_CSS_DRAWN_ROUTE_PATH),
      new Request("https://acme.example/"),
      ctx
    );
    expect(await answer.json()).toEqual({ css: "body { color: red; }" });
  });
});

describe("saving the site CSS", () => {
  it("is refused to an API key, before anything is read or written", async () => {
    const { store, saves } = await storeHolding();
    const read = vi.spyOn(store, "read");
    const { ctx, audit, expire } = contextFor("api-key");
    await expect(
      call(
        routeOf("POST", store),
        post({ css: "a{}", sha256: await sha256Hex("") }),
        ctx
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    expect(saves).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it("refuses CSS the checker refuses, naming each line, saving nothing", async () => {
    const { store, saves } = await storeHolding();
    const { ctx } = contextFor("session");
    const css = 'a { color: red; }\n\n@import "/x.css";\n';
    const refused = await call(
      routeOf("POST", store),
      post({ css, sha256: await sha256Hex("") }),
      ctx
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(JSON.stringify(refused)).toContain("Line 3: @import isn't allowed.");
    expect(saves).toEqual([]);
  });

  it("refuses a save made from CSS someone has changed since", async () => {
    const { store, saves } = await storeHolding("a { color: red; }");
    const { ctx, audit, expire } = contextFor("session");
    await expect(
      call(
        routeOf("POST", store),
        // Made from the empty CSS, which is no longer what is stored.
        post({ css: "a { color: blue; }", sha256: await sha256Hex("") }),
        ctx
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: SITE_CSS_STALE,
    });
    expect(saves).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
  });

  it("saves, writes an audit row of hashes and sizes, and expires the cached pages", async () => {
    const before = "a { color: red; }";
    const after = "a { color: blue; }\nb { margin: 0; }";
    const { store, saves } = await storeHolding(before);
    const { ctx, audit, expire } = contextFor("session");
    const answer = await call(
      routeOf("POST", store),
      post({ css: after, sha256: await sha256Hex(before) }),
      ctx
    );
    const { item } = (await answer.json()) as { item: { sha256: string } };
    expect(item.sha256).toBe(await sha256Hex(after));
    expect(saves).toEqual([
      {
        css: after,
        readSha256: await sha256Hex(before),
        changedBy: "user:user-1",
      },
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
    const row = audit.mock.calls[0]?.[0] as {
      kind: string;
      actorUserId: string;
      metadata: Record<string, unknown>;
    };
    expect(row.kind).toBe(SITE_CSS_SAVED_AUDIT);
    expect(row.actorUserId).toBe("user-1");
    expect(row.metadata).toEqual({
      cssSha256: await sha256Hex(after),
      cssSha256Before: await sha256Hex(before),
      cssChars: after.length,
      cssCharsBefore: before.length,
    });
    // Never the CSS itself.
    expect(JSON.stringify(row.metadata)).not.toContain("color");
    expect(expire).toHaveBeenCalledWith(SITE_CSS_CACHE_PART);
  });
});

describe("reading the site CSS", () => {
  it("answers the CSS, its hash, and who changed it last and when", async () => {
    const { store } = await storeHolding();
    await store.save({
      css: "a{}",
      readSha256: await sha256Hex(""),
      changedBy: "user:user-7",
    });
    const { ctx } = contextFor("session");
    const answer = await call(
      routeOf("GET", store, SITE_CSS_ROUTE_PATH, {
        personName: async id => (id === "user-7" ? "Ada" : null),
      }),
      new Request("https://acme.example/"),
      ctx
    );
    expect(await answer.json()).toEqual({
      css: "a{}",
      sha256: await sha256Hex("a{}"),
      changedAt: "2026-11-18T06:00:00.000Z",
      changedBy: "Ada",
    });
  });
});
