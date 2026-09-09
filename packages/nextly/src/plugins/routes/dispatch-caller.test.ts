/**
 * What a plugin route is told about the caller, and what that changes.
 *
 * The property under test is NOT "a permission check runs" — one ran before
 * this change too, against the key OWNER's database grants, and every assertion
 * about a route being gated stayed green while a read-only key could write.
 * The separating property is that a key whose scope is NARROWER than its
 * owner's is judged on the narrower set: so every scoped-key case here is
 * paired with an owner who WOULD be allowed, and the fake RBAC service says
 * yes to everything. If the key's own scope is ever dropped again, the owner's
 * "yes" is what comes back, and these tests go red rather than passing on a
 * check that consulted the wrong subject.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  requirePermission: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));

// Partial: only the role resolution is replaced. `readCaller` resolves a
// SESSION caller's role slugs from the database, which a unit test has none of;
// everything else in the module is left real so nothing else in the import
// graph quietly changes shape.
vi.mock("../../services/lib/permissions", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../services/lib/permissions")>();
  return {
    ...actual,
    listRoleSlugsForUser: vi.fn(async () => ["editor"]),
  };
});

import { container } from "../../di/container";
import {
  requireAuthentication,
  requirePermission,
} from "../../auth/middleware";
import type { PluginContext } from "../plugin-context";
import { wrapCollectionsForPlugin } from "../service-opts";

import { runPluginRoute } from "./dispatch";
import type { RouteMatch } from "./route-registry";
import type { PluginRoute, PluginRouteContext } from "./route-types";

const reqAuth = vi.mocked(requireAuthentication);
const reqPerm = vi.mocked(requirePermission);

/**
 * The owner is allowed EVERYTHING, deliberately.
 *
 * This is the control that makes a scoped-key refusal meaningful. `checkAccess`
 * is the session path's whole decision — super-admin bypass included — so an
 * implementation that resolves the key's owner instead of the key gets `true`
 * here and the refusal assertions fail.
 */
const checkAccess = vi.fn(async () => true);
const getRegisteredAccess = vi.fn(() => undefined);

/** Every access method the plugin collection wrapper gates, and its call log. */
let createCalls: unknown[][] = [];
let listCalls: unknown[][] = [];

/**
 * Every method the wrapper gates, and the argument position its `ServiceOpts`
 * occupies — `updateEntry` takes an extra id, so its options are one further
 * along. Named here so the sweep below drives each method the way a plugin
 * would rather than assuming they share a shape.
 */
const GATED = [
  ["createEntry", "create", 2],
  ["createMany", "create", 2],
  ["updateEntry", "update", 3],
  ["deleteEntry", "delete", 2],
  ["listEntries", "read", 2],
  ["findEntryById", "read", 2],
  ["count", "read", 2],
] as const;

function collectionService() {
  const svc: Record<string, unknown> = {
    createEntry: vi.fn(async (...args: unknown[]) => {
      createCalls.push(args);
      return { id: "e1" };
    }),
    listEntries: vi.fn(async (...args: unknown[]) => {
      listCalls.push(args);
      return { items: [], meta: {} };
    }),
  };
  for (const [name] of GATED) {
    svc[name] ??= vi.fn(async () => ({ id: "e1" }));
  }
  return svc;
}

/**
 * A context whose `services` carries the REAL plugin collection wrapper, so the
 * `ServiceOpts` translation under test is the product's own rather than a stub
 * that agrees with it.
 */
function baseCtx(): PluginContext {
  const svc = collectionService();
  return {
    self: { name: "@a/x", collections: {}, singles: {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    services: {
      collections: wrapCollectionsForPlugin(svc as never),
    },
  } as unknown as PluginContext;
}

let seen: PluginRouteContext | null = null;

function route(extra: Partial<PluginRoute>): PluginRoute {
  return {
    method: "GET",
    path: "/r",
    handler: (_req, ctx) => {
      seen = ctx;
      return Response.json({ ok: true });
    },
    ...extra,
  } as PluginRoute;
}

function match(r: PluginRoute, ctx: PluginContext): RouteMatch {
  return { pluginName: "@a/x", route: r, baseCtx: ctx, params: {} };
}

const req = () => new Request("http://x/api/plugins/@a/x/r");

/** A session caller: `permissions` is empty by design; RBAC decides by id. */
const sessionAuth = {
  userId: "u1",
  userEmail: "u1@x.com",
  userName: "U",
  permissions: [],
  roles: ["role-id-1"],
  authMethod: "session" as const,
  claims: { tenant: "acme" },
};

/** A key scoped to reads only, owned by a user allowed everything. */
const readOnlyKeyAuth = {
  userId: "u1",
  permissions: ["read-posts"],
  roles: ["editor"],
  authMethod: "api-key" as const,
  apiKeyId: "key-1",
};

beforeEach(() => {
  seen = null;
  createCalls = [];
  listCalls = [];
  reqAuth.mockReset();
  reqPerm.mockReset();
  checkAccess.mockClear();
  checkAccess.mockResolvedValue(true);
  getRegisteredAccess.mockReset();
  getRegisteredAccess.mockReturnValue(undefined);
  container.register(
    "rbacAccessControlService",
    () => ({ checkAccess, getRegisteredAccess }) as never
  );
});

describe("a plugin route is told what the caller may do", () => {
  it("refuses a scoped key the write its scope excludes, though its owner may", async () => {
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    const ctx = baseCtx();
    await runPluginRoute(req(), match(route({}), ctx));

    await expect(
      seen!.services.collections.createEntry(
        "posts",
        { title: "t" },
        { as: "user", user: seen!.user! }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The refusal is a PRECONDITION: nothing reached the service.
    expect(createCalls).toHaveLength(0);
    // And the owner's grants were never what decided it.
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it("allows the same key the read its scope includes", async () => {
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    const ctx = baseCtx();
    await runPluginRoute(req(), match(route({}), ctx));

    await seen!.services.collections.listEntries(
      "posts",
      {},
      { as: "user", user: seen!.user! }
    );
    expect(listCalls).toHaveLength(1);
  });

  it("answers can() from the key's own scope, in both directions", async () => {
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));

    await expect(seen!.caller!.can("read", "posts")).resolves.toBe(true);
    await expect(seen!.caller!.can("create", "posts")).resolves.toBe(false);
    // A super-admin OWNER does not lift a key's scope: the bypass lives on the
    // session path, and `checkAccess` (which holds it) is never consulted.
    expect(checkAccess).not.toHaveBeenCalled();
  });

  it("leaves a session caller's services object identical", async () => {
    reqAuth.mockResolvedValue(sessionAuth as never);
    const ctx = baseCtx();
    await runPluginRoute(req(), match(route({}), ctx));

    expect(seen!.services).toBe(ctx.services);
    await seen!.services.collections.createEntry(
      "posts",
      { title: "t" },
      { as: "user", user: seen!.user! }
    );
    expect(createCalls).toHaveLength(1);
  });

  it("answers can() for a session through the RBAC service, super-admin included", async () => {
    reqAuth.mockResolvedValue(sessionAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));

    await expect(seen!.caller!.can("create", "posts")).resolves.toBe(true);
    expect(checkAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        operation: "create",
        resource: "posts",
      })
    );

    checkAccess.mockResolvedValue(false);
    await expect(seen!.caller!.can("delete", "posts")).resolves.toBe(false);
  });

  it("carries authMethod, apiKeyId and claims to the handler", async () => {
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));
    expect(seen!.caller).toMatchObject({
      authMethod: "api-key",
      apiKeyId: "key-1",
    });
    expect(seen!.caller!.claims).toBeUndefined();

    reqAuth.mockResolvedValue(sessionAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));
    // The field's own docblock promises the rule sees over HTTP what it sees
    // through the Direct API; a route that never receives them cannot.
    expect(seen!.caller).toMatchObject({
      authMethod: "session",
      claims: { tenant: "acme" },
    });
    expect(seen!.caller!.apiKeyId).toBeUndefined();
  });

  it("leaves a public route with no caller at all", async () => {
    await runPluginRoute(req(), match(route({ public: true }), baseCtx()));
    expect(seen!.user).toBeNull();
    expect(seen!.caller).toBeNull();
    expect(reqAuth).not.toHaveBeenCalled();
  });

  it("still enforces requiredPermission, and still authenticates without one", async () => {
    reqPerm.mockResolvedValue({ statusCode: 403 } as never);
    const denied = await runPluginRoute(
      req(),
      match(route({ requiredPermission: "export-submissions" }), baseCtx())
    );
    expect(denied.status).toBe(403);
    expect(seen).toBeNull();

    reqPerm.mockResolvedValue(readOnlyKeyAuth as never);
    const granted = await runPluginRoute(
      req(),
      match(route({ requiredPermission: "export-submissions" }), baseCtx())
    );
    expect(granted.status).toBe(200);
    expect(seen!.caller!.authMethod).toBe("api-key");

    reqAuth.mockResolvedValue({ statusCode: 401 } as never);
    seen = null;
    const unauth = await runPluginRoute(req(), match(route({}), baseCtx()));
    expect(unauth.status).toBe(401);
    expect(seen).toBeNull();
  });

  it("maps every gated method to the operation its scope is judged on", async () => {
    // A read-only key, driven through all seven access methods. The separating
    // property is the MAPPING: `deleteEntry` mistyped as a read would pass a
    // permission check that consults `read-posts` and delete the row anyway, and
    // no assertion about "a check ran" would notice.
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));
    const collections = seen!.services.collections as unknown as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >;

    for (const [name, operation, optsIndex] of GATED) {
      const args: unknown[] = ["posts", {}, {}, {}].slice(0, optsIndex + 1);
      args[optsIndex] = { as: "user", user: seen!.user! };
      const call = collections[name](...args);
      if (operation === "read") {
        await expect(call, `${name} is a read`).resolves.toBeDefined();
      } else {
        await expect(call, `${name} is a ${operation}`).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    }
  });

  it("judges a scoped key against the code-defined rule, not only the grant", async () => {
    // The key HOLDS `read-posts`, so a permission-only check admits it. The
    // rule refuses, and it must be evaluated against the KEY's roles.
    const read = vi.fn(async () => false);
    getRegisteredAccess.mockReturnValue({ read } as never);
    reqAuth.mockResolvedValue(readOnlyKeyAuth as never);
    await runPluginRoute(req(), match(route({}), baseCtx()));

    await expect(seen!.caller!.can("read", "posts")).resolves.toBe(false);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ["editor"],
        permissions: ["read-posts"],
      })
    );
  });
});
