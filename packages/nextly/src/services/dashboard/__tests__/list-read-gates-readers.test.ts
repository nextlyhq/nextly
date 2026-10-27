/**
 * Each list route and each dashboard count reads its list's gate from
 * `auth/list-read-gates`, the same object on both sides: a dispatcher route
 * through `requireListRead`, a standalone one through `requireRouteListRead`. A route or a count
 * that went back to a gate of its own fails here, whatever that gate asks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  route: [] as unknown[],
  caller: [] as unknown[],
}));

vi.mock("../../../auth/list-read-gates", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../../auth/list-read-gates")>();
  const { createErrorResponse } = await import(
    "../../../auth/middleware/error-response"
  );
  const { toNextlyAuthError } = await import(
    "../../../auth/middleware/to-nextly-error"
  );
  // Every gate refuses, so a route stops right after asking it.
  const refused = createErrorResponse(403, "Forbidden");
  return {
    ...actual,
    requireListRead: vi.fn(async (_req: Request, gate: unknown) => {
      seen.route.push(gate);
      return refused;
    }),
    requireRouteListRead: vi.fn(async (_req: Request, gate: unknown) => {
      seen.route.push(gate);
      throw toNextlyAuthError(refused);
    }),
    authorizeListRead: vi.fn(async (_auth: unknown, gate: unknown) => {
      seen.caller.push(gate);
      return refused;
    }),
  };
});

vi.mock("../../../init", () => ({
  getNextly: vi.fn(async () => ({})),
  getCachedNextly: vi.fn(async () => ({})),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({})),
  container: { get: vi.fn(() => ({})) },
}));

import { listApiKeys } from "../../../api/api-keys";
import { GET as listFieldGroups } from "../../../api/field-groups";
import { createMediaHandlers } from "../../../api/media-handlers";
import { LIST_READ_GATES } from "../../../auth/list-read-gates";
import type { AuthContext } from "../../../auth/middleware";
import { _resolveAuthorizationForTest as routeGate } from "../../../routeHandler";
import { readableAdminCounts } from "../admin-counts";

beforeEach(() => {
  seen.route.length = 0;
  seen.caller.length = 0;
});

describe("each list route reads its gate", () => {
  it.each([
    ["users", "users", "listUsers"],
    ["roles", "rbac", "listRoles"],
    ["permissions", "rbac", "listPermissions"],
    // The dispatcher's field-group list is the builder palette's metadata read,
    // open to any signed-in caller; the field-group LIST is the standalone route.
  ] as const)("%s, through the dispatcher", async (list, service, method) => {
    await routeGate(
      new Request(`http://localhost/api/${service}`),
      service,
      method,
      "list",
      undefined,
      "GET"
    );
    expect(seen.route).toHaveLength(1);
    expect(seen.route[0]).toBe(LIST_READ_GATES[list]);
  });

  it("field groups, through its own route", async () => {
    const res = await listFieldGroups(
      new Request("http://localhost/api/field-groups")
    );
    expect(res.status).toBe(403);
    expect(seen.route).toHaveLength(1);
    expect(seen.route[0]).toBe(LIST_READ_GATES.fieldGroups);
  });

  it("media", async () => {
    const res = await createMediaHandlers({ requireAuth: true }).GET(
      new Request("http://localhost/api/media"),
      { params: Promise.resolve({ path: [] }) }
    );
    expect(res.status).toBe(403);
    expect(seen.route).toHaveLength(1);
    expect(seen.route[0]).toBe(LIST_READ_GATES.media);
  });

  it("API keys", async () => {
    const res = await listApiKeys(new Request("http://localhost/api/api-keys"));
    expect(res.status).toBe(403);
    expect(seen.route).toHaveLength(1);
    expect(seen.route[0]).toBe(LIST_READ_GATES.apiKeys);
  });
});

describe("each count reads its list's gate", () => {
  it("asks every list's gate, once each, and no other", async () => {
    const auth: AuthContext = {
      userId: "u1",
      permissions: [],
      roles: [],
      authMethod: "session",
    };
    expect(await readableAdminCounts(auth)).toEqual(new Set());
    const gates = Object.values(LIST_READ_GATES);
    expect(seen.caller).toHaveLength(gates.length);
    for (const gate of gates) {
      expect(seen.caller.filter(asked => asked === gate)).toHaveLength(1);
    }
  });
});
