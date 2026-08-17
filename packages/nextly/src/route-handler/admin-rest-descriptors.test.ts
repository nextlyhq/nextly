/**
 * Tests for the admin REST operation introspection seam.
 *
 * The headline guard is the per-service AGREEMENT test: every listed operation
 * must exist in the live `*_METHODS` map, so a renamed dispatcher method fails
 * here instead of silently producing a stale list. The list is intentionally a
 * SUBSET of the map — service-only methods with no REST route are not listed.
 *
 * @module route-handler/admin-rest-descriptors.test
 * @since alpha
 */
import { describe, expect, it } from "vitest";

import { USER_METHODS } from "../dispatcher/handlers/user-dispatcher";

import {
  dedupeRestOperations,
  listAdminRestOperations,
  restOperationsForService,
  type AdminRestOperation,
} from "./admin-rest-descriptors";

describe("admin rest descriptors — users (reference service)", () => {
  it("every users operation exists in the live USER_METHODS map", () => {
    const liveMethods = new Set(Object.keys(USER_METHODS));
    const listed = restOperationsForService("users");
    // Subset direction: catches a listed operation the dispatcher no longer has.
    // The reverse need not hold — internal methods have no route.
    const orphans = listed.filter(op => !liveMethods.has(op.operation));
    expect(orphans).toEqual([]);
  });

  it("lists the /users CRUD with correct verbs, paths, and permissions", () => {
    const ops = new Map(
      restOperationsForService("users").map(op => [op.operation, op])
    );
    expect(ops.get("listUsers")).toMatchObject({
      method: "GET",
      path: "/users",
      permissionSlug: "read-users",
    });
    expect(ops.get("createLocalUser")).toMatchObject({
      method: "POST",
      path: "/users",
      permissionSlug: "create-users",
    });
    expect(ops.get("getUserById")).toMatchObject({
      method: "GET",
      path: "/users/{userId}",
      permissionSlug: "read-users",
    });
    expect(ops.get("updateUser")).toMatchObject({
      method: "PATCH",
      path: "/users/{userId}",
      permissionSlug: "update-users",
    });
    expect(ops.get("deleteUser")).toMatchObject({
      method: "DELETE",
      path: "/users/{userId}",
      permissionSlug: "delete-users",
    });
  });

  it("scopes /me routes to authenticated (current-user, no specific permission)", () => {
    const me = restOperationsForService("users").filter(op =>
      op.path.startsWith("/me")
    );
    expect(me.every(op => op.auth === "authenticated")).toBe(true);
    expect(me.map(op => op.operation).sort()).toEqual([
      "getCurrentUser",
      "getCurrentUserPermissions",
      "updateCurrentUser",
    ]);
  });

  it("does NOT list internal-only service methods (no REST route)", () => {
    const ops = new Set(
      restOperationsForService("users").map(op => op.operation)
    );
    // These exist in USER_METHODS but have no parser route. If one gains a route
    // later, add it to the table.
    expect(ops.has("findByEmail")).toBe(false);
    expect(ops.has("hasPassword")).toBe(false);
    expect(ops.has("getUserPasswordHashById")).toBe(false);
  });
});

describe("admin rest descriptors — assembly", () => {
  it("dedupes identical operation identities (dual-reachable appears once)", () => {
    const a: AdminRestOperation = {
      service: "users",
      operation: "listUsers",
      method: "GET",
      path: "/users",
      auth: "permission",
      permissionSlug: "read-users",
      tag: "Users",
      envelope: "list",
    };
    const deduped = dedupeRestOperations([a, { ...a }, { ...a, tag: "dup" }]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual(a);
  });

  it("keeps operations that differ in path or verb", () => {
    const base = {
      service: "users",
      operation: "getUserById",
      method: "GET",
      auth: "permission",
      permissionSlug: "read-users",
      tag: "Users",
      envelope: "doc",
    } as const;
    const deduped = dedupeRestOperations([
      { ...base, path: "/users/{userId}" },
      { ...base, path: "/users/{userId}/accounts" },
      { ...base, method: "PATCH", path: "/users/{userId}" },
    ]);
    expect(deduped).toHaveLength(3);
  });

  it("listAdminRestOperations is stable, non-empty, and internally unique", () => {
    const a = listAdminRestOperations();
    const b = listAdminRestOperations();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    const keys = a.map(
      op => `${op.service}::${op.operation}::${op.method}::${op.path}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
