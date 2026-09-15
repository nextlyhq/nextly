/**
 * A scoped API key reaching an entity through `requirePermission` is held to
 * that entity's own code-defined access rule, as every other read gate holds it.
 *
 * `requirePermission` guards every plugin route that declares a
 * `requiredPermission`, and first-party plugins name entity grants there —
 * `read-<forms slug>`, a patterns collection's `read`. Checking only the grant
 * admits a key the entity's `access` rule refuses, while the same key asking
 * `requireCollectionAccess` for the same entity is refused. Two gates, one
 * question, two answers.
 *
 * The middleware runs for real. Only what sits outside it is replaced: the
 * session lookup (no session, so the bearer key is used), the container that
 * supplies the key and RBAC services, the rate limiter and the env module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionAccessControl } from "@nextly/domains/auth/services/access-control-types";

import {
  apiKeyScope,
  callerMayPerform,
  type GrantedPermission,
} from "../authenticated-scope";

const state = vi.hoisted(() => ({
  rules: new Map<string, CollectionAccessControl>(),
  grants: [] as GrantedPermission[],
}));

const services = vi.hoisted(() => ({
  apiKeyService: {
    authenticateApiKey: async () => ({
      id: "key-1",
      userId: "owner-1",
      tokenType: "read-only",
      roleId: null,
    }),
    resolveApiKeyGrants: async () => state.grants,
    resolveApiKeyRoles: async () => [],
  },
  rbac: {
    getRegisteredAccess: (slug: string) => state.rules.get(slug),
  },
}));

// Relative specifiers, as the rest of this package's suites mock these modules:
// they name the same files the middleware's aliased imports resolve to, which
// is what makes the replacement reach it. With the real container in place the
// key service is absent and every request answers 503 instead.
vi.mock("../../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "apiKeyService" || key === "rbacAccessControlService",
    get: (key: string) =>
      key === "apiKeyService" ? services.apiKeyService : services.rbac,
  },
}));

vi.mock("../session", () => ({
  getSession: async () => ({ authenticated: false }),
}));

vi.mock("./rate-limiter", () => ({
  authRateLimiter: () => ({
    check: async () => ({ allowed: true, resetAt: new Date() }),
  }),
}));

vi.mock("../../lib/env", () => ({ env: { NEXTLY_SECRET: "test-secret" } }));

vi.mock("../../services/lib/permissions", () => ({
  hasPermission: async () => false,
  hasAnyPermission: async () => false,
}));

const { requireCollectionAccess, requirePermission } = await import("./index");

/** A request that authenticates only by its bearer API key. */
function keyRequest(): Request {
  return new Request("https://example.com/api/plugins/forms/export", {
    headers: { authorization: "Bearer nx_test_key" },
  });
}

/** The key holds exactly this one grant. */
function holdGrant(action: string, resource: string): void {
  state.grants = [{ slug: `${action}-${resource}`, action, resource }];
}

/** The HTTP status a gate's answer becomes; an auth context is a pass. */
function statusOf(
  answer: Awaited<ReturnType<typeof requirePermission>>
): number {
  return "statusCode" in answer ? answer.statusCode : 200;
}

beforeEach(() => {
  state.rules.clear();
  state.grants = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requirePermission and a scoped API key's entity access rule", () => {
  it("refuses a key holding the grant when the entity's read rule is false", async () => {
    state.rules.set("forms", { read: false });
    holdGrant("read", "forms");

    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(403);
  });

  it("refuses a key holding the grant when the entity's rule function denies", async () => {
    state.rules.set("forms", { read: () => false });
    holdGrant("read", "forms");

    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(403);
  });

  it("refuses when the entity's rule throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rules.set("forms", {
      read: () => {
        throw new Error("rule failed");
      },
    });
    holdGrant("read", "forms");

    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(403);
  });

  it("admits a key holding the grant when the entity declares no read rule", async () => {
    holdGrant("read", "forms");

    // The pass is the key's own auth context, not merely a missing error.
    expect(
      await requirePermission(keyRequest(), "read", "forms")
    ).toMatchObject({ authMethod: "api-key", userId: "owner-1" });
  });

  it("admits a key holding the grant when the entity's rule allows", async () => {
    holdGrant("read", "forms");

    state.rules.set("forms", { read: true });
    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(200);

    state.rules.set("forms", { read: () => true });
    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(200);
  });

  it("still refuses a key without the grant, whatever the rule says", async () => {
    state.rules.set("forms", { read: true });

    expect(
      statusOf(await requirePermission(keyRequest(), "read", "forms"))
    ).toBe(403);
  });

  it("answers exactly as the service gates do, for every rule state", async () => {
    // The property this file exists for: one question, one answer, whichever
    // door asks it. `callerMayPerform` is the decision the service gates use
    // for a scoped key, so both route gates must agree with it as well as
    // with each other.
    //
    // The last state returns a truthy value that is not `true`. A rule is typed
    // to return a boolean, but a JavaScript rule can return anything, and the
    // service decision admits only `true` — so a route gate that admitted any
    // truthy value would answer this row differently.
    const truthyNotTrue = (() =>
      "yes") as unknown as CollectionAccessControl["read"];
    const ruleStates: Array<CollectionAccessControl | undefined> = [
      undefined,
      { read: true },
      { read: false },
      { read: () => true },
      { read: () => false },
      { read: truthyNotTrue },
    ];
    holdGrant("read", "forms");
    const scope = apiKeyScope(state.grants);
    const seen = new Set<number>();

    for (const rule of ruleStates) {
      state.rules.clear();
      if (rule) state.rules.set("forms", rule);

      const viaService = (await callerMayPerform(scope, "read", "forms", {
        id: "owner-1",
      }))
        ? 200
        : 403;
      const viaPermission = statusOf(
        await requirePermission(keyRequest(), "read", "forms")
      );
      const viaCollection = statusOf(
        await requireCollectionAccess(keyRequest(), "read", "forms")
      );
      seen.add(viaService);
      expect({
        rule,
        permission: viaPermission,
        collection: viaCollection,
      }).toEqual({ rule, permission: viaService, collection: viaService });
    }

    // Agreement only means something if the states told the gates apart. Gates
    // failing the same way for an unrelated reason agree on every row.
    expect([...seen].sort()).toEqual([200, 403]);
  });
});
