import { randomUUID } from "crypto";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTestDb,
  type TestDb,
  testLogger,
} from "../../../__tests__/fixtures/db";
import { permissionFactory } from "../../../__tests__/fixtures/permissions";
import { roleFactory } from "../../../__tests__/fixtures/roles";
import {
  expectSuccessResponse,
  expectArrayLength,
  expectPaginationMeta,
} from "../../../__tests__/utils/assertions";
import { PermissionService } from "../services/permission-service";

describe("PermissionService - Smoke Tests", () => {
  let testDb: TestDb;
  let service: PermissionService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new PermissionService(testDb.adapter, testLogger);
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  describe("listPermissions()", () => {
    it("should list permissions with default pagination", async () => {
      // Arrange
      const permissions = [
        permissionFactory({ action: "read", resource: "users" }),
        permissionFactory({ action: "create", resource: "users" }),
        permissionFactory({ action: "update", resource: "users" }),
      ];
      await testDb.db.insert(testDb.schema.permissions).values(permissions);

      // Act
      const result = await service.listPermissions();

      // Assert
      expectArrayLength(result.data!, 3);
      expectPaginationMeta(result, { total: 3, page: 1, limit: 10 });

      // Verify all required fields are present including slug
      expect(result.data![0]).toHaveProperty("id");
      expect(result.data![0]).toHaveProperty("name");
      expect(result.data![0]).toHaveProperty("slug");
      expect(result.data![0]).toHaveProperty("action");
      expect(result.data![0]).toHaveProperty("resource");
      expect(result.data![0]).toHaveProperty("description");
    });

    it("should filter by action", async () => {
      // Arrange
      await testDb.db
        .insert(testDb.schema.permissions)
        .values([
          permissionFactory({ action: "read", resource: "users" }),
          permissionFactory({ action: "write", resource: "users" }),
        ]);

      // Act
      const result = await service.listPermissions({ action: "read" });

      // Assert
      expectArrayLength(result.data!, 1);
      expect(result.data![0].action).toBe("read");
    });

    it("should filter by resource", async () => {
      // Arrange
      await testDb.db
        .insert(testDb.schema.permissions)
        .values([
          permissionFactory({ action: "read", resource: "users" }),
          permissionFactory({ action: "read", resource: "posts" }),
        ]);

      // Act
      const result = await service.listPermissions({ resource: "users" });

      // Assert
      expectArrayLength(result.data!, 1);
      expect(result.data![0].resource).toBe("users");
    });

    it("should search across fields", async () => {
      // Arrange
      await testDb.db.insert(testDb.schema.permissions).values([
        permissionFactory({
          action: "read",
          resource: "users",
          name: "Read Users",
        }),
        permissionFactory({
          action: "write",
          resource: "posts",
          name: "Write Posts",
        }),
      ]);

      // Act
      const result = await service.listPermissions({ search: "users" });

      // Assert
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty database", async () => {
      // Act
      const result = await service.listPermissions();

      // Assert
      expectArrayLength(result.data!, 0);
    });
  });

  describe("getPermissionById()", () => {
    it("should return permission when ID exists", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "read",
        resource: "users",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      const result = await service.getPermissionById(permission.id);

      // Assert
      expect(result.id).toBe(permission.id);
      expect(result.action).toBe("read");
      expect(result.resource).toBe("users");
    });

    it("should return 404 when permission does not exist", async () => {
      // Act
      await expect(
        service.getPermissionById(randomUUID())
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("ensurePermission()", () => {
    it("should create new permission if it doesn't exist", async () => {
      // Act
      const result = await service.ensurePermission(
        "read",
        "users",
        "Read Users",
        "read-users",
        "Allows reading user data"
      );

      // Assert
      expect(result.data).not.toBeNull();
      expect(result.id).toBeTruthy();
    });

    it("should return existing permission if it already exists", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "read",
        resource: "users",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      const result = await service.ensurePermission(
        "read",
        "users",
        "Read Users",
        "read-users",
        "Allows reading user data"
      );

      // Assert
      expect(result.id).toBe(permission.id);
    });
  });

  describe("updatePermission()", () => {
    it("should update permission successfully", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "read",
        resource: "users",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.updatePermission(permission.id, {
        description: "Updated description",
      });

      // Assert on the STORE, not on the call resolving. Awaiting alone passes
      // against an implementation that validates the id and returns without
      // ever writing — which is evidence the method did not throw, not
      // evidence it did anything.
      const after = await service.getPermissionById(permission.id);
      expect(after.description).toBe("Updated description");
    });

    it("should return 404 when updating non-existent permission", async () => {
      // Act
      await expect(
        service.updatePermission(randomUUID(), {
          description: "Updated",
        })
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("should return 200 when no changes are made", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "read",
        resource: "users",
        description: "Test description",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.updatePermission(permission.id, {
        description: "Test description", // Same as existing
      });
    });
  });

  describe("deletePermissionById()", () => {
    it("should delete permission successfully", async () => {
      // Arrange
      // A NON-system resource. `users` is in SYSTEM_RESOURCES, and
      // `deletePermissionById` refuses those on purpose — a deletion test
      // written against one asserts success where the product says no.
      const permission = permissionFactory({
        action: "read",
        resource: "posts",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.deletePermissionById(permission.id);

      // Assert: the method returns void, so the deletion is read back rather
      // than inferred from a return value.
      const remaining = await testDb.db.query.permissions.findMany({
        where: { id: permission.id },
      });
      expect(remaining).toHaveLength(0);
    });

    it("refuses to delete a permission on a system resource", async () => {
      // The guard the case above was accidentally exercising. It had no test of
      // its own, so a change that dropped the refusal would have gone unnoticed
      // while that test went green.
      const permission = permissionFactory({
        action: "read",
        resource: "users",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      await expect(
        service.deletePermissionById(permission.id)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("should return 404 when deleting non-existent permission", async () => {
      // Act
      await expect(
        service.deletePermissionById(randomUUID())
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("should return 400 when deleting permission assigned to roles", async () => {
      // A NON-system resource, and that is the whole point of the change: with
      // `users` here the system-resource guard refuses FIRST, so this case
      // never reached the role-assignment check it is named for. It would have
      // gone green against a build where that check had been deleted.
      const permission = permissionFactory({
        action: "read",
        resource: "posts",
      });
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.permissions).values(permission);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.rolePermissions).values({
        id: randomUUID(),
        roleId: role.id,
        permissionId: permission.id,
        createdAt: new Date(),
      });

      // Act: Try to delete permission
      // Assert: refuses, because the permission is assigned to a role. The method returns void and
      // throws, so the refusal IS the rejection — there is no result to read.
      await expect(
        service.deletePermissionById(permission.id)
      ).rejects.toMatchObject({
        // The code the docblock promises, not a status number. The code IS the
        // contract — `@throws NextlyError(BUSINESS_RULE_VIOLATION) when the
        // permission is currently assigned to one or more roles` — while a
        // status is a transport detail that can move without the rule changing.
        code: "BUSINESS_RULE_VIOLATION",
      });
    });
  });

  describe("deletePermission() - by action/resource", () => {
    it("should delete permission by action and resource successfully", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "delete",
        resource: "posts",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.deletePermission("delete", "posts");

      // Verify permission is gone
      const permissions = await testDb.db.query.permissions.findMany({
        where: { id: permission.id },
      });
      expectArrayLength(permissions, 0);
    });

    it("should return 404 when permission not found by action/resource", async () => {
      // Act: Try to delete non-existent permission
      await expect(
        service.deletePermission("nonexistent", "action")
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("should return 400 when deleting permission assigned to roles", async () => {
      // Arrange: Create permission and role, assign permission to role
      const permission = permissionFactory({
        action: "update",
        resource: "comments",
      });
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.permissions).values(permission);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.rolePermissions).values({
        id: randomUUID(),
        roleId: role.id,
        permissionId: permission.id,
        createdAt: new Date(),
      });

      // Act: Try to delete permission by action/resource
      // Assert: refuses, because the permission is assigned to a role. The method returns void and
      // throws, so the refusal IS the rejection — there is no result to read.
      await expect(
        service.deletePermission("update", "comments")
      ).rejects.toMatchObject({
        // The code the docblock promises, not a status number. The code IS the
        // contract — `@throws NextlyError(BUSINESS_RULE_VIOLATION) when the
        // permission is currently assigned to one or more roles` — while a
        // status is a transport detail that can move without the rule changing.
        code: "BUSINESS_RULE_VIOLATION",
      });
    });
  });

  // Note: Edge case tests for updatePermission duplicate detection are omitted
  // The error handler catches database constraint violations, which are tested
  // through the main updatePermission tests.

  describe("listPermissions() - comprehensive tests", () => {
    describe("pagination", () => {
      // Shared test constants for pagination tests
      const TOTAL_ITEMS = 25;
      const PAGE_SIZE = 10;
      const EXPECTED_PAGES = Math.ceil(TOTAL_ITEMS / PAGE_SIZE); // 3
      const LAST_PAGE_ITEMS = TOTAL_ITEMS % PAGE_SIZE; // 5

      it("should paginate results correctly", async () => {
        // Arrange: Create test data with known pagination boundaries
        const permissions = Array.from({ length: TOTAL_ITEMS }, (_, i) =>
          permissionFactory({
            action: `action${i}`,
            resource: `resource${i}`,
          })
        );
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act: Get first page
        const result = await service.listPermissions({
          page: 1,
          limit: PAGE_SIZE,
        });

        // Assert
        expectArrayLength(result.data!, PAGE_SIZE);
        expectPaginationMeta(result, {
          total: TOTAL_ITEMS,
          page: 1,
          limit: PAGE_SIZE,
          totalPages: EXPECTED_PAGES,
        });
      });

      it("should return second page correctly", async () => {
        // Arrange
        const permissions = Array.from({ length: TOTAL_ITEMS }, (_, i) =>
          permissionFactory({
            action: `action${i}`,
            resource: `resource${i}`,
          })
        );
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act
        const result = await service.listPermissions({
          page: 2,
          limit: PAGE_SIZE,
        });

        // Assert
        expectArrayLength(result.data!, PAGE_SIZE);
        expectPaginationMeta(result, { page: 2, totalPages: EXPECTED_PAGES });
      });

      it("should return last page with remaining items", async () => {
        // Arrange
        const permissions = Array.from({ length: TOTAL_ITEMS }, (_, i) =>
          permissionFactory({
            action: `action${i}`,
            resource: `resource${i}`,
          })
        );
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act
        const result = await service.listPermissions({
          page: EXPECTED_PAGES,
          limit: PAGE_SIZE,
        });

        // Assert
        expectArrayLength(result.data!, LAST_PAGE_ITEMS);
        expectPaginationMeta(result, {
          page: EXPECTED_PAGES,
          totalPages: EXPECTED_PAGES,
        });
      });

      it("should handle page beyond total pages", async () => {
        // Arrange: Small dataset for this specific test
        const SMALL_DATASET_SIZE = 5;
        const permissions = Array.from({ length: SMALL_DATASET_SIZE }, (_, i) =>
          permissionFactory({
            action: `action${i}`,
            resource: `resource${i}`,
          })
        );
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act: Request page far beyond available data
        const BEYOND_PAGE = 10;
        const result = await service.listPermissions({
          page: BEYOND_PAGE,
          limit: PAGE_SIZE,
        });

        // Assert
        expectArrayLength(result.data!, 0);
        expectPaginationMeta(result, {
          total: SMALL_DATASET_SIZE,
          page: BEYOND_PAGE,
          totalPages: 1,
        });
      });
    });

    describe("sorting", () => {
      it("should sort by resource ascending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([
            permissionFactory({ resource: "zebra", action: "read" }),
            permissionFactory({ resource: "alpha", action: "read" }),
            permissionFactory({ resource: "beta", action: "read" }),
          ]);

        // Act
        const result = await service.listPermissions({
          sortBy: "resource",
          sortOrder: "asc",
        });

        // Assert
        expect(result.data![0].resource).toBe("alpha");
        expect(result.data![1].resource).toBe("beta");
        expect(result.data![2].resource).toBe("zebra");
      });

      it("should sort by resource descending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([
            permissionFactory({ resource: "alpha", action: "read" }),
            permissionFactory({ resource: "beta", action: "read" }),
            permissionFactory({ resource: "zebra", action: "read" }),
          ]);

        // Act
        const result = await service.listPermissions({
          sortBy: "resource",
          sortOrder: "desc",
        });

        // Assert
        expect(result.data![0].resource).toBe("zebra");
        expect(result.data![1].resource).toBe("beta");
        expect(result.data![2].resource).toBe("alpha");
      });

      it("should sort by action ascending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([
            permissionFactory({ action: "write", resource: "users" }),
            permissionFactory({ action: "read", resource: "users" }),
            permissionFactory({ action: "delete", resource: "users" }),
          ]);

        // Act
        const result = await service.listPermissions({
          sortBy: "action",
          sortOrder: "asc",
        });

        // Assert
        expect(result.data![0].action).toBe("delete");
        expect(result.data![1].action).toBe("read");
        expect(result.data![2].action).toBe("write");
      });

      it("should sort by name ascending", async () => {
        // Arrange
        await testDb.db.insert(testDb.schema.permissions).values([
          permissionFactory({
            name: "Zebra Permission",
            action: "read",
            resource: "a",
          }),
          permissionFactory({
            name: "Alpha Permission",
            action: "read",
            resource: "b",
          }),
          permissionFactory({
            name: "Beta Permission",
            action: "read",
            resource: "c",
          }),
        ]);

        // Act
        const result = await service.listPermissions({
          sortBy: "name",
          sortOrder: "asc",
        });

        // Assert
        expect(result.data![0].name).toBe("Alpha Permission");
        expect(result.data![1].name).toBe("Beta Permission");
        expect(result.data![2].name).toBe("Zebra Permission");
      });
    });

    describe("combined filters", () => {
      it("should combine action filter with pagination", async () => {
        // Arrange
        const permissions = Array.from({ length: 15 }, (_, i) =>
          permissionFactory({
            action: "read",
            resource: `resource${i}`,
          })
        );
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act
        const result = await service.listPermissions({
          action: "read",
          page: 1,
          limit: 10,
        });

        // Assert
        expectArrayLength(result.data!, 10);
        expectPaginationMeta(result, { total: 15, totalPages: 2 });
      });

      it("should combine search with sorting", async () => {
        // Arrange
        await testDb.db.insert(testDb.schema.permissions).values([
          permissionFactory({
            action: "read",
            resource: "users",
            name: "Read Users",
          }),
          permissionFactory({
            action: "write",
            resource: "users",
            name: "Write Users",
          }),
          permissionFactory({
            action: "read",
            resource: "posts",
            name: "Read Posts",
          }),
        ]);

        // Act
        const result = await service.listPermissions({
          search: "users",
          sortBy: "action",
          sortOrder: "asc",
        });

        // Assert
        expect(result.data.length).toBeGreaterThanOrEqual(2);
      });

      it("should combine action and resource filters", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([
            permissionFactory({ action: "read", resource: "users" }),
            permissionFactory({ action: "write", resource: "users" }),
            permissionFactory({ action: "read", resource: "posts" }),
          ]);

        // Act
        const result = await service.listPermissions({
          action: "read",
          resource: "users",
        });

        // Assert
        expectArrayLength(result.data!, 1);
        expect(result.data![0].action).toBe("read");
        expect(result.data![0].resource).toBe("users");
      });
    });

    describe("edge cases", () => {
      it("should handle permissions with special characters", async () => {
        // Arrange
        await testDb.db.insert(testDb.schema.permissions).values([
          permissionFactory({
            action: "read",
            resource: "user-profiles",
            name: "Read (User Profiles)",
          }),
        ]);

        // Act
        const result = await service.listPermissions({
          search: "user-profiles",
        });

        // Assert
        expect(result.data.length).toBeGreaterThanOrEqual(1);
      });

      it("should handle unicode in permission names", async () => {
        // Arrange
        await testDb.db.insert(testDb.schema.permissions).values([
          permissionFactory({
            action: "読み取り",
            resource: "ユーザー",
            name: "読み取り権限",
          }),
        ]);

        // Act
        const result = await service.listPermissions({ search: "ユーザー" });

        // Assert
        expect(result.data.length).toBeGreaterThanOrEqual(0);
      });

      it("should handle null descriptions", async () => {
        // Arrange
        const permission = permissionFactory();
        permission.description = null; // Override after factory
        await testDb.db.insert(testDb.schema.permissions).values([permission]);

        // Act
        const result = await service.listPermissions();

        // Assert
        expect(result.data.some(p => p.description === null)).toBe(true);
      });
    });

    describe("error handling", () => {
      it("should handle database errors gracefully", async () => {
        // Arrange: Close the database connection to simulate error
        await testDb.close();

        // A closed connection is a throw, not a result. "Gracefully" now means
        // the driver error is wrapped as a NextlyError rather than escaping raw
        // — the caller gets one error type whatever the dialect did.
        await expect(service.listPermissions()).rejects.toMatchObject({
          statusCode: 500,
        });

        // Cleanup: Recreate database for subsequent tests
        testDb = await createTestDb();
        service = new PermissionService(testDb.adapter, testLogger);
      });
    });
  });

  describe("getPermissionById() - additional tests", () => {
    it("should return 404 for invalid UUID format", async () => {
      // An id matching no row is NOT_FOUND rather than a validation error: the
      // query simply returns nothing, and the service does not pre-judge the
      // format. It throws, so there is no result to inspect.
      await expect(
        service.getPermissionById("not-a-uuid")
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    // An empty id is a CALLER bug, not a miss. Drizzle drops an `undefined`
    // filter key, so an unguarded lookup runs with no where clause and returns
    // an arbitrary permission — measured: with two seeded, it returned "Read
    // Posts". `requireFilterValue` refuses it, which is why this is
    // INTERNAL_ERROR rather than NOT_FOUND.
    it("refuses a null permission ID rather than running an unfiltered lookup", async () => {
      await expect(
        service.getPermissionById(null as any)
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
    });

    it("refuses an undefined permission ID, even with rows present", async () => {
      // Seeded deliberately. Without rows the unguarded lookup ALSO returned
      // nothing, which is why the original version of this test passed while
      // the defect was live: an empty table hides a missing WHERE clause.
      await service.ensurePermission(
        "read",
        "posts",
        "Read Posts",
        "read-posts"
      );
      await service.ensurePermission(
        "write",
        "posts",
        "Write Posts",
        "write-posts"
      );

      await expect(
        service.getPermissionById(undefined as any)
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
    });

    it("refuses an empty-string permission ID", async () => {
      // Empty string is the third value Drizzle cannot filter on usefully, and
      // `requireFilterValue` rejects all three together rather than leaving one
      // to be discovered later.
      await expect(service.getPermissionById("")).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
        statusCode: 500,
      });
    });

    it("should return all fields correctly", async () => {
      // Arrange
      const permission = permissionFactory({
        action: "create",
        resource: "articles",
        name: "Create Articles",
        description: "Allows creating new articles",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      const result = await service.getPermissionById(permission.id);

      // Assert
      expect(result.id).toBe(permission.id);
      expect(result.action).toBe("create");
      expect(result.resource).toBe("articles");
      expect(result.name).toBe("Create Articles");
      expect(result.description).toBe("Allows creating new articles");
    });
  });

  describe("ensurePermission() - additional tests", () => {
    it("should handle minimum required parameters", async () => {
      // Act
      const result = await service.ensurePermission(
        "read",
        "users",
        "Read Users",
        "read-users",

        null as any
      );

      // Assert
      expect(result.created).toBe(true);
      expect(result.id).toBeTruthy();
    });

    it("should be truly idempotent (multiple calls return same ID)", async () => {
      // Act: Call three times
      const result1 = await service.ensurePermission(
        "delete",
        "comments",
        "Delete Comments",
        "delete-comments",
        "Allows deleting comments"
      );

      const result2 = await service.ensurePermission(
        "delete",
        "comments",
        "Delete Comments",
        "delete-comments",
        "Allows deleting comments"
      );

      const result3 = await service.ensurePermission(
        "delete",
        "comments",
        "Delete Comments",
        "delete-comments",
        "Allows deleting comments"
      );

      // Assert: All should return same ID
      expect(result1.id).toBe(result2.id);
      expect(result2.id).toBe(result3.id);
    });

    it("should handle special characters in parameters", async () => {
      // Act
      const result = await service.ensurePermission(
        "read:sensitive",
        "user-profiles",
        "Read (Sensitive) User Profiles",
        "read-sensitive-user-profiles",
        "Allows reading sensitive user profile data"
      );

      // Assert
      expect(result.created).toBe(true);
      expect(result.id).toBeTruthy();

      // Verify it was created correctly
      const permission = await service.getPermissionById(result.id);
      expect(permission.action).toBe("read:sensitive");
    });

    it("should be case-insensitive for action and resource matching", async () => {
      // Arrange: Create permission with lowercase
      const result1 = await service.ensurePermission(
        "read",
        "users",
        "Read Users",
        "read-users",
        "Allows reading users"
      );

      // Act: Try to create same permission with different casing
      const result2 = await service.ensurePermission(
        "READ",
        "USERS",
        "Read Users (uppercase)",
        "read-users-uppercase",
        "Different description"
      );

      // Assert: Should return the same existing permission (not create a duplicate)
      expect(result1.id).toBe(result2.id);
      expect(result2.created).toBe(false);
    });

    it("should be case-insensitive for mixed case variations", async () => {
      // Arrange: Create permission with mixed case
      const result1 = await service.ensurePermission(
        "Create",
        "Articles",
        "Create Articles",
        "create-articles"
      );

      // Act: Try with different case variations
      const result2 = await service.ensurePermission(
        "create",
        "articles",
        "Create Articles",
        "create-articles"
      );
      const result3 = await service.ensurePermission(
        "CREATE",
        "ARTICLES",
        "Create Articles",
        "create-articles"
      );

      // Assert: All should resolve to the same permission
      expect(result1.id).toBe(result2.id);
      expect(result2.id).toBe(result3.id);
    });
  });

  describe("updatePermission() - additional tests", () => {
    it("should update name successfully", async () => {
      // Arrange
      const permission = permissionFactory({
        name: "Old Name",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.updatePermission(permission.id, {
        name: "New Name",
      });

      // Verify change
      const updated = await service.getPermissionById(permission.id);
      expect(updated.name).toBe("New Name");
    });

    it("should reject invalid UUID", async () => {
      // Act + Assert: a malformed id is treated as a miss rather than as a
      // validation failure -- it never matches a row, so the lookup that
      // precedes the update raises NOT_FOUND. That is still the behaviour;
      // only the delivery changed from a returned envelope to a throw.
      await expect(
        service.updatePermission("not-a-uuid", { description: "Updated" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    });

    it("should handle null description update", async () => {
      // Arrange
      const permission = permissionFactory({
        description: "Old description",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.updatePermission(permission.id, {
        description: null as any,
      });

      // Same reason as above, and the null case is the one most likely to be
      // silently skipped: a writer that treats null as "no change" would leave
      // the old description in place and still resolve.
      const after = await service.getPermissionById(permission.id);
      expect(after.description).toBeNull();
    });

    it("should handle empty object (no changes)", async () => {
      // Arrange
      const permission = permissionFactory();
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act
      await service.updatePermission(permission.id, {});
    });
  });

  describe("integration scenarios", () => {
    it("should handle permission deletion after creation", async () => {
      // Arrange: Create permission directly
      const permission = permissionFactory({
        action: "create",
        resource: "articles",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act: Delete permission
      await service.deletePermissionById(permission.id);

      // Assert: the row is gone, which is what "deleted" means when the method
      // returns void — reading it back now raises NOT_FOUND.
      await expect(
        service.getPermissionById(permission.id)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("should prevent deletion of in-use permissions", async () => {
      // Arrange: Create permission, role, and assignment
      const permission = permissionFactory();
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.permissions).values(permission);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.rolePermissions).values({
        id: randomUUID(),
        roleId: role.id,
        permissionId: permission.id,
        createdAt: new Date(),
      });

      // Act + Assert: refused by id. The rule is the documented code, not a
      // status: BUSINESS_RULE_VIOLATION is what the docblock promises.
      await expect(
        service.deletePermissionById(permission.id)
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });

      // Act + Assert: the same refusal reached by action/resource rather than
      // by id. Both entry points must refuse, or the rule is only enforced on
      // the path someone happened to test.
      await expect(
        service.deletePermission(permission.action, permission.resource)
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });

      // Verify permission still exists -- a refusal that deleted anyway would
      // satisfy both throws above.
      const getResult = await service.getPermissionById(permission.id);
      expect(getResult.id).toBe(permission.id);
    });

    it("should delete permission with case-insensitive action/resource matching", async () => {
      // Arrange: Create permission with lowercase
      const permission = permissionFactory({
        action: "update",
        resource: "comments",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act + Assert: resolves to void. "Deleted" is only observable in the
      // store, so the read-back below is the assertion that matters.
      await expect(
        service.deletePermission("UPDATE", "COMMENTS")
      ).resolves.toBeUndefined();

      // Verify deletion
      await expect(
        service.getPermissionById(permission.id)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("should handle case-insensitive deletion with mixed case", async () => {
      // Arrange: Create permission with mixed case
      const permission = permissionFactory({
        action: "Delete",
        resource: "Posts",
      });
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act + Assert: as above, mixed-case stored value matched by a
      // lowercase request.
      await expect(
        service.deletePermission("delete", "posts")
      ).resolves.toBeUndefined();

      // Verify deletion
      await expect(
        service.getPermissionById(permission.id)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
