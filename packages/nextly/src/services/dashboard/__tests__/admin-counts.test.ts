/**
 * Which of the summary's admin counts a caller may be given.
 *
 * Each count is given to exactly the callers its resource's own list endpoint
 * admits, so these cases drive the REAL route gate beside the decision and ask
 * that the two agree for a caller holding each permission in turn. The checks
 * both delegate to are replaced by a fake that admits a caller holding the
 * named permission and refuses everyone else: what is under test is which
 * permission each side ASKS for, not how a grant is looked up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => new Set<string>());
const superAdmins = vi.hoisted(() => new Set<string>());

// The API-key list's own question, answered by user id here.
vi.mock("../../lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/permissions")>()),
  isSuperAdmin: vi.fn(async (userId: string) => superAdmins.has(userId)),
}));

vi.mock("../../../auth/middleware", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../auth/middleware")>();
  const admitted = {
    userId: "u1",
    userEmail: "u1@x.com",
    authMethod: "session",
    permissions: [],
    roles: [],
  };
  const refused = { statusCode: 403, error: "Forbidden" };
  const one = async (action: string, resource: string) =>
    granted.has(`${action}-${resource}`) ? admitted : refused;
  const any = async (list: Array<{ action: string; resource: string }>) =>
    list.some(({ action, resource }) => granted.has(`${action}-${resource}`))
      ? admitted
      : refused;
  return {
    ...actual,
    requireAuthentication: vi.fn(async () => admitted),
    requirePermission: vi.fn(
      async (_req: Request, action: string, resource: string) =>
        one(action, resource)
    ),
    authorizeCaller: vi.fn(
      async (_caller: unknown, action: string, resource: string) =>
        one(action, resource)
    ),
    requireAnyPermission: vi.fn(
      async (
        _req: Request,
        list: Array<{ action: string; resource: string }>
      ) => any(list)
    ),
    authorizeCallerForAny: vi.fn(
      async (
        _caller: unknown,
        list: Array<{ action: string; resource: string }>
      ) => any(list)
    ),
  };
});

import type { AuthContext } from "../../../auth/middleware";
import { _resolveAuthorizationForTest as routeGate } from "../../../routeHandler";
import {
  apiKeyCountScope,
  readableAdminCounts,
  type AdminCount,
} from "../admin-counts";

const CALLER = {
  userId: "u1",
  permissions: [],
  roles: [],
  authMethod: "session",
} as AuthContext;

/** Every action on every resource an admin count could plausibly ask for. */
const GRANTS = ["read", "create", "update", "delete", "manage"].flatMap(
  action =>
    ["users", "roles", "permissions", "media", "settings", "api-keys"].map(
      resource => `${action}-${resource}`
    )
);

/** The counts holding exactly `grants` admits. */
async function countsFor(grants: string[]): Promise<Set<AdminCount>> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  return new Set(await readableAdminCounts(CALLER));
}

/** Whether the route gate admits a caller holding exactly `grants` to a list read. */
async function listAdmits(
  grants: string[],
  service: string,
  method: string
): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const result = await routeGate(
    new Request(`http://localhost/api/${service}`, { method: "GET" }),
    service,
    method,
    "list",
    undefined,
    "GET"
  );
  // `null` is a visitor admitted, which a signed-in request never is.
  return result !== null && !("statusCode" in result);
}

beforeEach(() => {
  granted.clear();
  superAdmins.clear();
});

describe("each count asks what its list endpoint asks", () => {
  // The three whose list is served by the catch-all route gate. Field groups,
  // media and API keys are listed by their own handlers, whose gates
  // `list-read-gates-readers.test.ts` holds to the counts'; the dispatcher's
  // field-group read is the builder palette's, open to any signed-in caller.
  const LISTS: Array<[AdminCount, string, string]> = [
    ["users", "users", "listUsers"],
    ["roles", "rbac", "listRoles"],
    ["permissions", "rbac", "listPermissions"],
  ];

  it.each(LISTS)(
    "%s: admitted for exactly the grants its list admits",
    async (count, service, method) => {
      const admittedByList: string[] = [];
      const admittedByCount: string[] = [];
      for (const grant of GRANTS) {
        if (await listAdmits([grant], service, method)) {
          admittedByList.push(grant);
        }
        if ((await countsFor([grant])).has(count)) admittedByCount.push(grant);
      }
      // The control: a list that admitted nobody would agree with a count
      // given to nobody, and prove nothing.
      expect(admittedByList.length).toBeGreaterThan(0);
      expect(admittedByCount).toEqual(admittedByList);
    }
  );

  it("permissions follows the permissions list, which admits read-roles", async () => {
    // Named on its own because it is the surprising one: `read-permissions`
    // alone does not open the permissions list, so it does not open the count.
    expect((await countsFor(["read-roles"])).has("permissions")).toBe(true);
    expect((await countsFor(["read-permissions"])).has("permissions")).toBe(
      false
    );
  });
});

describe("the counts whose lists are served by their own handlers", () => {
  it("field groups: read-settings", async () => {
    // The gate asks the plain read; `manage-settings` counts as it in the
    // real check, which the fake above does not model.
    for (const grant of GRANTS) {
      expect((await countsFor([grant])).has("fieldGroups"), grant).toBe(
        grant === "read-settings"
      );
    }
  });

  it("media: read-media", async () => {
    for (const grant of GRANTS) {
      expect((await countsFor([grant])).has("media"), grant).toBe(
        grant === "read-media"
      );
    }
  });

  it("API keys: the API-key read policy, read or update", async () => {
    for (const grant of GRANTS) {
      expect((await countsFor([grant])).has("apiKeys"), grant).toBe(
        grant === "read-api-keys" || grant === "update-api-keys"
      );
    }
  });
});

describe("whose keys the API-key count covers", () => {
  it("is every key for a super-admin, whose key list is every key", async () => {
    superAdmins.add("u1");
    expect(await apiKeyCountScope(CALLER)).toEqual({ kind: "all" });
  });

  it("is every key for anyone else who may read keys, as its key list is", async () => {
    // Holding read-api-keys opens every key, so the count covers every key.
    granted.add("read-api-keys");
    expect(await apiKeyCountScope(CALLER)).toEqual({ kind: "all" });
  });
});

describe("a caller with no admin grant", () => {
  it("may be given none of them", async () => {
    expect([...(await countsFor(["read-posts"]))]).toEqual([]);
  });
});
