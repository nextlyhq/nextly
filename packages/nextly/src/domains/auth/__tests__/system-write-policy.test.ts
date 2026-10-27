/**
 * The REST route gates ask exactly what the system write and read policies
 * say.
 *
 * The Direct API reads `SYSTEM_WRITE_POLICY` for its checked role, permission,
 * field-group and media writes, and a plugin's media service reads it too;
 * it reads `SYSTEM_READ_POLICY` for its checked user, role, permission and
 * media reads.
 * REST picks its own grants today, in the route gate (`resolveAuthorization`),
 * in the field-group route files and in the media routes' gate, so this holds
 * each of those, route by route, to the policy: a grant changed on one side
 * and not the other fails here rather than leaving two doors that answer one
 * caller differently.
 *
 * Each gate's checks are replaced by recorders that refuse, so what is
 * observed is the question the gate asks, by the gate's own code, and nothing
 * past it runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
  type RouteGrant,
} from "../system-write-policy";

/** What a gate asked, in the policy's own shape. */
const asked = vi.hoisted(() => ({ grants: [] as unknown[] }));

vi.mock("../../../auth/middleware", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../auth/middleware")>();
  const refused = { statusCode: 403, error: "Forbidden" };
  return {
    ...actual,
    requirePermission: vi.fn(
      async (_req: Request, action: string, resource: string) => {
        asked.grants.push({ action, resource });
        return refused;
      }
    ),
    requireAnyPermission: vi.fn(
      async (
        _req: Request,
        list: Array<{ action: string; resource: string }>
      ) => {
        asked.grants.push({ anyOf: list });
        return refused;
      }
    ),
  };
});

/** Stops a route file at its permission check, once it has been asked. */
class Stopped extends Error {}

vi.mock("../../../api/route-auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../api/route-auth")>()),
  requireRouteAnyPermission: vi.fn(
    async (
      _request: Request,
      list: Array<{ action: string; resource: string }>
    ) => {
      asked.grants.push({ anyOf: list });
      throw new Stopped();
    }
  ),
}));

// What the route files do before their check: the builder switch and the
// service boot, neither of which decides who may write.
vi.mock("../../../shared/builder-access", () => ({
  requireBuilderEnabled: vi.fn(),
}));
vi.mock("../../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../di", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../di")>()),
  getService: vi.fn(() => ({})),
}));

import * as fieldGroupsDetailRoute from "../../../api/field-groups-detail";
import * as fieldGroupsRoute from "../../../api/field-groups";
import { createMediaHandlers } from "../../../api/media-handlers";
import { requiresAuthOnly } from "../../../route-handler/route-parser";
import { _resolveAuthorizationForTest } from "../../../routeHandler";

/** The policy entry as a gate asks it: the single form, or the any-of list. */
function expected(grant: RouteGrant): unknown {
  return "anyOf" in grant
    ? { anyOf: [...grant.anyOf] }
    : { action: grant.action, resource: grant.resource };
}

async function gateAsks(
  service: string,
  method: string,
  httpMethod: string
): Promise<unknown[]> {
  asked.grants.length = 0;
  await _resolveAuthorizationForTest(
    new Request("http://localhost/api/x", { method: httpMethod }),
    service,
    method,
    httpMethod.toLowerCase(),
    { id: "x" },
    httpMethod
  );
  return [...asked.grants];
}

beforeEach(() => {
  asked.grants.length = 0;
});

describe("the REST route gate asks what the system write policy says", () => {
  it.each([
    ["rbac", "createRole", "POST", SYSTEM_WRITE_POLICY.roles.create],
    ["rbac", "updateRole", "PATCH", SYSTEM_WRITE_POLICY.roles.update],
    ["rbac", "deleteRole", "DELETE", SYSTEM_WRITE_POLICY.roles.delete],
    [
      "rbac",
      "setRolePermissions",
      "PATCH",
      SYSTEM_WRITE_POLICY.roles.setPermissions,
    ],
    [
      "rbac",
      "ensurePermission",
      "POST",
      SYSTEM_WRITE_POLICY.permissions.create,
    ],
    [
      "rbac",
      "deletePermissionById",
      "DELETE",
      SYSTEM_WRITE_POLICY.permissions.delete,
    ],
    ["users", "createLocalUser", "POST", SYSTEM_WRITE_POLICY.users.create],
    ["users", "updateUser", "PATCH", SYSTEM_WRITE_POLICY.users.update],
    ["users", "deleteUser", "DELETE", SYSTEM_WRITE_POLICY.users.delete],
    [
      "field-groups",
      "createComponent",
      "POST",
      SYSTEM_WRITE_POLICY.fieldGroups.create,
    ],
    [
      "field-groups",
      "updateComponent",
      "PATCH",
      SYSTEM_WRITE_POLICY.fieldGroups.update,
    ],
    [
      "field-groups",
      "deleteComponent",
      "DELETE",
      SYSTEM_WRITE_POLICY.fieldGroups.delete,
    ],
  ] as const)("%s %s (%s)", async (service, method, httpMethod, grant) => {
    expect(await gateAsks(service, method, httpMethod)).toEqual([
      expected(grant),
    ]);
  });
});

describe("the field-group route files ask what the system write policy says", () => {
  const context = { params: Promise.resolve({ slug: "x" }) };

  it.each([
    [
      "POST /field-groups",
      () =>
        fieldGroupsRoute.POST(
          new Request("http://localhost/api/field-groups", { method: "POST" })
        ),
      SYSTEM_WRITE_POLICY.fieldGroups.create,
    ],
    [
      "PATCH /field-groups/:slug",
      () =>
        fieldGroupsDetailRoute.PATCH(
          new Request("http://localhost/api/field-groups/x", {
            method: "PATCH",
          }),
          context
        ),
      SYSTEM_WRITE_POLICY.fieldGroups.update,
    ],
    [
      "DELETE /field-groups/:slug",
      () =>
        fieldGroupsDetailRoute.DELETE(
          new Request("http://localhost/api/field-groups/x", {
            method: "DELETE",
          }),
          context
        ),
      SYSTEM_WRITE_POLICY.fieldGroups.delete,
    ],
  ] as const)("%s", async (_route, call, grant) => {
    await call();
    expect(asked.grants).toEqual([expected(grant)]);
  });
});

describe("the media routes ask what the system write policy says", () => {
  // The admin mount, where every media write is gated; the public mount
  // serves no write at all.
  const media = createMediaHandlers({ requireAuth: true });
  const at = (...path: string[]) => ({ params: Promise.resolve({ path }) });
  const request = (method: string) =>
    new Request("http://localhost/api/media", { method });

  it.each([
    [
      "POST /media",
      () => media.POST(request("POST"), at()),
      SYSTEM_WRITE_POLICY.media.upload,
    ],
    [
      "POST /media/folders",
      () => media.POST(request("POST"), at("folders")),
      SYSTEM_WRITE_POLICY.media.createFolder,
    ],
    [
      "PATCH /media/:id",
      () => media.PATCH(request("PATCH"), at("m1")),
      SYSTEM_WRITE_POLICY.media.update,
    ],
    [
      "PATCH /media/:id/move",
      () => media.PATCH(request("PATCH"), at("m1", "move")),
      SYSTEM_WRITE_POLICY.media.moveToFolder,
    ],
    [
      "PATCH /media/folders/:id",
      () => media.PATCH(request("PATCH"), at("folders", "f1")),
      SYSTEM_WRITE_POLICY.media.updateFolder,
    ],
    [
      "DELETE /media/:id",
      () => media.DELETE(request("DELETE"), at("m1")),
      SYSTEM_WRITE_POLICY.media.delete,
    ],
    [
      "DELETE /media/bulk",
      () => media.DELETE(request("DELETE"), at("bulk")),
      SYSTEM_WRITE_POLICY.media.bulkDelete,
    ],
    [
      "DELETE /media/folders/:id",
      () => media.DELETE(request("DELETE"), at("folders", "f1")),
      SYSTEM_WRITE_POLICY.media.deleteFolder,
    ],
  ] as const)("%s", async (_route, call, grant) => {
    await call();
    expect(asked.grants).toEqual([expected(grant)]);
  });
});

describe("the REST route gate asks what the system read policy says", () => {
  it.each([
    ["users", "listUsers", SYSTEM_READ_POLICY.users.read],
    ["users", "getUserById", SYSTEM_READ_POLICY.users.read],
    ["rbac", "listRoles", SYSTEM_READ_POLICY.roles.read],
    ["rbac", "getRoleById", SYSTEM_READ_POLICY.roles.read],
    ["rbac", "listRolePermissions", SYSTEM_READ_POLICY.roles.readPermissions],
    ["rbac", "listPermissions", SYSTEM_READ_POLICY.permissions.list],
    ["rbac", "getPermissionById", SYSTEM_READ_POLICY.permissions.read],
  ] as const)("%s %s (GET)", async (service, method, grant) => {
    expect(await gateAsks(service, method, "GET")).toEqual([expected(grant)]);
  });

  it("serves field groups to any signed-in caller, with no grant", () => {
    // Which is why a checked Direct API read of them asks only for a user.
    expect(requiresAuthOnly("field-groups", "listComponents")).toBe(true);
    expect(requiresAuthOnly("field-groups", "getComponent")).toBe(true);
  });
});

describe("the media routes ask what the system read policy says", () => {
  // The admin mount, which a checked read is judged as.
  const media = createMediaHandlers({ requireAuth: true });
  const at = (...path: string[]) => ({ params: Promise.resolve({ path }) });
  const get = () => new Request("http://localhost/api/media");

  it.each([
    ["GET /media", () => media.GET(get(), at())],
    ["GET /media/:id", () => media.GET(get(), at("m1"))],
    ["GET /media/folders", () => media.GET(get(), at("folders"))],
  ] as const)("%s", async (_route, call) => {
    await call();
    expect(asked.grants).toEqual([expected(SYSTEM_READ_POLICY.media.read)]);
  });
});
