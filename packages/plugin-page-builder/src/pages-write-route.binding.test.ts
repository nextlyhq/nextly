/**
 * What the Pages panel's writes BIND to, and that installing the plugin serves
 * them authenticated.
 *
 * `pages-write-route.test.ts` exercises the decisions over injected writes, so
 * its assertions pass whatever the declarations hand the Direct API — and the
 * Direct API is the trusted server handle, which defaults every call to
 * `overrideAccess: true`. Under that default any signed-in author could delete
 * any page. So this file reads the arguments of every call the routes make.
 *
 * @module pages-write-route.binding.test
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the routes reach, every call recorded. */
const nextly = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  duplicate: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

// The handle is replaced and nothing else is: the identity the routes hand it
// is the caller's own answer (`caller.identity()`), modelled below.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import {
  PAGE_DUPLICATE_ROUTE_PATH,
  PAGE_ROUTE_PATH,
  PAGES_ROUTE_PATH,
} from "./pages-write-contract";
import { pagesWriteRoutes } from "./pages-write-route";
import { pageBuilder } from "./plugin";

const identity = { user: { id: "u1", roles: ["editor"] } };

/** A route context: the caller, its path params, and a registry with one page collection. */
function contextWith(params: Record<string, string> = {}): PluginRouteContext {
  return {
    self: { collections: {} },
    user: { id: "account-only" },
    params,
    caller: {
      authMethod: "session",
      can: async () => true,
      identity: async () => identity,
    },
    services: {
      collections: {
        listCollections: async () => ({
          data: [
            {
              slug: "pages",
              label: "Page",
              status: true,
              fields: [
                { name: "title", type: "text" },
                { name: "slug", type: "text", unique: true },
                { name: "content", type: "blocks" },
              ],
            },
          ],
          pagination: { hasMore: false, total: 1 },
        }),
      },
    },
  } as unknown as PluginRouteContext;
}

/** The declared route for `method` and `path`. */
function route(method: string, path: string) {
  const found = pagesWriteRoutes().find(
    candidate => candidate.method === method && candidate.path === path
  );
  if (found === undefined) throw new Error(`no ${method} ${path}`);
  return found;
}

const body = (value: unknown) =>
  new Request("http://nextly.test/x", {
    method: "POST",
    body: JSON.stringify(value),
  });

/** Every Direct API call the routes made, as `[method, args]`. */
const calls = () =>
  Object.entries(nextly).flatMap(([method, fn]) =>
    fn.mock.calls.map(
      call => [method, call[0] as Record<string, unknown>] as const
    )
  );

describe("the page writes run AS THE CALLER", () => {
  beforeEach(() => {
    for (const fn of Object.values(nextly)) fn.mockReset();
    const empty = {
      items: [],
      meta: {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
    nextly.find.mockImplementation(async (args: { where?: object }) =>
      JSON.stringify(args.where ?? {}).includes('"equals"')
        ? { ...empty, items: [{ id: "p1", title: "About" }] }
        : empty
    );
    const row = { item: { id: "p2", title: "About", status: "draft" } };
    nextly.create.mockResolvedValue(row);
    nextly.duplicate.mockResolvedValue(row);
    nextly.update.mockResolvedValue(row);
    nextly.delete.mockResolvedValue({ message: "", item: { id: "p1" } });
  });

  it("says overrideAccess: false, with the identity the caller resolved, on every read and write", async () => {
    await route("POST", PAGES_ROUTE_PATH).handler(
      body({ collection: "pages", title: "About" }),
      contextWith()
    );
    await route("POST", PAGE_DUPLICATE_ROUTE_PATH).handler(
      body({}),
      contextWith({ collection: "pages", id: "p1" })
    );
    await route("PATCH", PAGE_ROUTE_PATH).handler(
      body({ title: "New" }),
      contextWith({ collection: "pages", id: "p1" })
    );
    await route("DELETE", PAGE_ROUTE_PATH).handler(
      new Request("http://nextly.test/x", { method: "DELETE" }),
      contextWith({ collection: "pages", id: "p1" })
    );

    const made = calls();
    // Each write once, and the reads they needed (two slug checks, one
    // duplicate source).
    expect(made.map(([method]) => method).sort()).toEqual(
      ["create", "delete", "duplicate", "find", "find", "find", "update"].sort()
    );
    for (const [, args] of made) {
      expect(args).toMatchObject({
        collection: "pages",
        overrideAccess: false,
      });
      expect(args.user).toBe(identity.user);
    }
    expect(nextly.delete.mock.calls[0]?.[0]).toMatchObject({ id: "p1" });
    expect(nextly.update.mock.calls[0]?.[0]).toMatchObject({
      id: "p1",
      data: { title: "New" },
    });
  });

  it("answers the canonical mutation envelope", async () => {
    const response = await route("DELETE", PAGE_ROUTE_PATH).handler(
      new Request("http://nextly.test/x", { method: "DELETE" }),
      contextWith({ collection: "pages", id: "p1" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "The page was deleted.",
      item: { collection: "pages", id: "p1" },
    });
  });
});

describe("installing the plugin", () => {
  it("serves the four writes, authenticated, with no permission of their own", () => {
    const routes = (pageBuilder().contributes?.routes ?? []).filter(candidate =>
      [PAGES_ROUTE_PATH, PAGE_ROUTE_PATH, PAGE_DUPLICATE_ROUTE_PATH].includes(
        candidate.path
      )
    );
    expect(
      routes.map(candidate => `${candidate.method} ${candidate.path}`).sort()
    ).toEqual(
      [
        `POST ${PAGES_ROUTE_PATH}`,
        `POST ${PAGE_DUPLICATE_ROUTE_PATH}`,
        `PATCH ${PAGE_ROUTE_PATH}`,
        `DELETE ${PAGE_ROUTE_PATH}`,
      ].sort()
    );
    for (const candidate of routes) {
      // Absent `public`, the dispatcher refuses a caller who is not signed in.
      expect(candidate).not.toHaveProperty("public");
      expect(candidate).not.toHaveProperty("requiredPermission");
    }
  });
});
