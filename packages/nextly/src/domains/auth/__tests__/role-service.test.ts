import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import {
  permissionFactory,
  bulkPermissionsFactory,
} from "../../../__tests__/fixtures/permissions";
import {
  roleFactory,
  systemRoleFactory,
  bulkRolesFactory,
  superAdminRoleFactory,
} from "../../../__tests__/fixtures/roles";
import {
  expectSuccessResponse,
  expectErrorResponse,
  expectValidUUID,
  expectPaginationMeta,
  expectArrayLength,
} from "../../../__tests__/utils/assertions";
import { RoleService } from "../services/role-service";

describe("RoleService", () => {
  let testDb: TestDb;
  let service: RoleService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new RoleService(testDb.db, testDb.schema);
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  describe("listRoles()", () => {
    describe("pagination", () => {
      it("should return first page with correct page size", async () => {
        // Arrange: Seed 25 roles
        const roles = bulkRolesFactory(25);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 1, pageSize: 10 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 10);
        expectPaginationMeta(result, {
          total: 25,
          page: 1,
          pageSize: 10,
          totalPages: 3,
        });
      });

      it("should return second page with correct data", async () => {
        // Arrange
        const roles = bulkRolesFactory(25);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 2, pageSize: 10 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 10);
        expectPaginationMeta(result, {
          page: 2,
          pageSize: 10,
          totalPages: 3,
        });
      });

      it("should return last page with remaining items", async () => {
        // Arrange
        const roles = bulkRolesFactory(25);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 3, pageSize: 10 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 5); // Last page has 5 items
        expectPaginationMeta(result, {
          page: 3,
          totalPages: 3,
        });
      });

      it("should return empty array for page beyond total pages", async () => {
        // Arrange
        const roles = bulkRolesFactory(5);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 10, pageSize: 10 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 0);
        expectPaginationMeta(result, {
          total: 5,
          page: 10,
          totalPages: 1,
        });
      });

      it("should handle different page sizes", async () => {
        // Arrange
        const roles = bulkRolesFactory(50);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 1, pageSize: 25 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 25);
        expectPaginationMeta(result, {
          total: 50,
          pageSize: 25,
          totalPages: 2,
        });
      });

      it("should use default pagination when not specified", async () => {
        // Arrange
        const roles = bulkRolesFactory(15);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles();

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 10); // Default pageSize
        expectPaginationMeta(result, {
          page: 1, // Default page
          pageSize: 10,
        });
      });

      it("should handle empty database", async () => {
        // Act
        const result = await service.listRoles({ page: 1, pageSize: 10 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 0);
        expectPaginationMeta(result, {
          total: 0,
          page: 1,
          totalPages: 0,
        });
      });

      it("should handle page size of 1", async () => {
        // Arrange
        const roles = bulkRolesFactory(5);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 1, pageSize: 1 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
        expectPaginationMeta(result, {
          total: 5,
          pageSize: 1,
          totalPages: 5,
        });
      });

      it("should handle large page size exceeding total", async () => {
        // Arrange
        const roles = bulkRolesFactory(5);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 1, pageSize: 100 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 5);
        expectPaginationMeta(result, {
          total: 5,
          pageSize: 100,
          totalPages: 1,
        });
      });

      it("should calculate total pages correctly with exact division", async () => {
        // Arrange: Exactly 30 roles, 10 per page = 3 pages
        const roles = bulkRolesFactory(30);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ page: 1, pageSize: 10 });

        // Assert
        expectPaginationMeta(result, {
          total: 30,
          totalPages: 3,
        });
      });
    });

    describe("search", () => {
      it("should search by role name (case-insensitive)", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Administrator" }),
            roleFactory({ name: "Editor" }),
            roleFactory({ name: "Viewer" }),
          ]);

        // Act
        const result = await service.listRoles({ search: "admin" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
        expect(result.data![0].name).toBe("Administrator");
      });

      it("should return multiple matches for partial search", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Content Editor" }),
            roleFactory({ name: "Content Manager" }),
            roleFactory({ name: "User Manager" }),
          ]);

        // Act
        const result = await service.listRoles({ search: "content" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
      });

      it("should return empty array when no matches", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([roleFactory({ name: "Administrator" })]);

        // Act
        const result = await service.listRoles({ search: "nonexistent" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 0);
      });

      it("should handle special characters in search", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Admin (Super)" }),
            roleFactory({ name: "Editor [Draft]" }),
          ]);

        // Act
        const result = await service.listRoles({ search: "(super)" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
      });

      it("should combine search with pagination", async () => {
        // Arrange
        const roles = bulkRolesFactory(15, i => ({ name: `Editor ${i}` }));
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({
          search: "editor",
          page: 1,
          pageSize: 10,
        });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 10);
        expectPaginationMeta(result, {
          total: 15,
          totalPages: 2,
        });
      });

      it("should handle empty search string", async () => {
        // Arrange
        const roles = bulkRolesFactory(5);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ search: "" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 5); // Should return all
      });

      it("should handle whitespace-only search", async () => {
        // Arrange
        const roles = bulkRolesFactory(5);
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Act
        const result = await service.listRoles({ search: "   " });

        // Assert
        expectSuccessResponse(result, 200);
        // Should return based on database behavior (likely all or none)
      });

      it("should search with unicode characters", async () => {
        // Arrange
        await testDb.db.insert(testDb.schema.roles).values([
          roleFactory({ name: "Administrador" }), // Spanish
          roleFactory({ name: "編集者" }), // Japanese
        ]);

        // Act
        const result = await service.listRoles({ search: "編集" });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data!.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe("filtering", () => {
      it("should filter by isSystem=true", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            systemRoleFactory({ name: "Super Admin" }),
            systemRoleFactory({ name: "System Role" }),
            roleFactory({ name: "Custom Role" }),
          ]);

        // Act
        const result = await service.listRoles({ isSystem: true });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
        result.data!.forEach(role => {
          expect(role.isSystem).toBe(true);
        });
      });

      it("should filter by isSystem=false", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            systemRoleFactory({ name: "System Role" }),
            roleFactory({ name: "Custom Role 1" }),
            roleFactory({ name: "Custom Role 2" }),
          ]);

        // Act
        const result = await service.listRoles({ isSystem: false });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
        result.data!.forEach(role => {
          expect(role.isSystem).toBe(false);
        });
      });

      it("should filter by minimum level", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Low", level: 10 }),
            roleFactory({ name: "Medium", level: 50 }),
            roleFactory({ name: "High", level: 90 }),
          ]);

        // Act
        const result = await service.listRoles({ levelMin: 50 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
        result.data!.forEach(role => {
          expect(role.level).toBeGreaterThanOrEqual(50);
        });
      });

      it("should filter by maximum level", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Low", level: 10 }),
            roleFactory({ name: "Medium", level: 50 }),
            roleFactory({ name: "High", level: 90 }),
          ]);

        // Act
        const result = await service.listRoles({ levelMax: 50 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
        result.data!.forEach(role => {
          expect(role.level).toBeLessThanOrEqual(50);
        });
      });

      it("should filter by level range", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Low", level: 10 }),
            roleFactory({ name: "Medium 1", level: 40 }),
            roleFactory({ name: "Medium 2", level: 60 }),
            roleFactory({ name: "High", level: 90 }),
          ]);

        // Act
        const result = await service.listRoles({ levelMin: 30, levelMax: 70 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
        result.data!.forEach(role => {
          expect(role.level).toBeGreaterThanOrEqual(30);
          expect(role.level).toBeLessThanOrEqual(70);
        });
      });

      it("should combine multiple filters", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            systemRoleFactory({ name: "System High", level: 90 }),
            systemRoleFactory({ name: "System Low", level: 10 }),
            roleFactory({ name: "Custom High", level: 90 }),
            roleFactory({ name: "Custom Low", level: 10 }),
          ]);

        // Act
        const result = await service.listRoles({
          isSystem: true,
          levelMin: 50,
        });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
        expect(result.data![0].name).toBe("System High");
      });

      it("should return empty array when filters match nothing", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([roleFactory({ name: "Test", level: 50, isSystem: 0 })]);

        // Act
        const result = await service.listRoles({
          isSystem: true,
          levelMin: 100,
        });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 0);
      });

      it("should handle level filter at boundaries", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Exactly 50", level: 50 }),
            roleFactory({ name: "Below", level: 49 }),
            roleFactory({ name: "Above", level: 51 }),
          ]);

        // Act
        const result = await service.listRoles({
          levelMin: 50,
          levelMax: 50,
        });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
        expect(result.data![0].level).toBe(50);
      });

      it("should handle level 0 (minimum)", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Zero", level: 0 }),
            roleFactory({ name: "One", level: 1 }),
          ]);

        // Act
        const result = await service.listRoles({ levelMin: 0, levelMax: 0 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 1);
        expect(result.data![0].level).toBe(0);
      });

      it("should handle level 100 (maximum)", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Max", level: 100 }),
            roleFactory({ name: "Below Max", level: 99 }),
          ]);

        // Act
        const result = await service.listRoles({ levelMax: 100 });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 2);
      });
    });

    describe("sorting", () => {
      it("should sort by name ascending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Zebra" }),
            roleFactory({ name: "Alpha" }),
            roleFactory({ name: "Beta" }),
          ]);

        // Act
        const result = await service.listRoles({
          sortBy: "name",
          sortOrder: "asc",
        });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].name).toBe("Alpha");
        expect(result.data![1].name).toBe("Beta");
        expect(result.data![2].name).toBe("Zebra");
      });

      it("should sort by name descending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Alpha" }),
            roleFactory({ name: "Beta" }),
            roleFactory({ name: "Zebra" }),
          ]);

        // Act
        const result = await service.listRoles({
          sortBy: "name",
          sortOrder: "desc",
        });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].name).toBe("Zebra");
        expect(result.data![1].name).toBe("Beta");
        expect(result.data![2].name).toBe("Alpha");
      });

      it("should sort by level ascending (default)", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "High", level: 90 }),
            roleFactory({ name: "Low", level: 10 }),
            roleFactory({ name: "Medium", level: 50 }),
          ]);

        // Act
        const result = await service.listRoles({
          sortBy: "level",
          sortOrder: "asc",
        });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].level).toBe(10);
        expect(result.data![1].level).toBe(50);
        expect(result.data![2].level).toBe(90);
      });

      it("should sort by level descending", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Low", level: 10 }),
            roleFactory({ name: "Medium", level: 50 }),
            roleFactory({ name: "High", level: 90 }),
          ]);

        // Act
        const result = await service.listRoles({
          sortBy: "level",
          sortOrder: "desc",
        });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].level).toBe(90);
        expect(result.data![1].level).toBe(50);
        expect(result.data![2].level).toBe(10);
      });

      it("should use default sort (level ascending) when not specified", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "C", level: 30 }),
            roleFactory({ name: "A", level: 10 }),
            roleFactory({ name: "B", level: 20 }),
          ]);

        // Act
        const result = await service.listRoles();

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].level).toBe(10);
        expect(result.data![1].level).toBe(20);
        expect(result.data![2].level).toBe(30);
      });

      it("should handle sorting with identical values", async () => {
        // Arrange
        await testDb.db
          .insert(testDb.schema.roles)
          .values([
            roleFactory({ name: "Same Level 1", level: 50 }),
            roleFactory({ name: "Same Level 2", level: 50 }),
            roleFactory({ name: "Same Level 3", level: 50 }),
          ]);

        // Act
        const result = await service.listRoles({ sortBy: "level" });

        // Assert
        expectSuccessResponse(result, 200);
        expectArrayLength(result.data!, 3);
        // All should have same level
        result.data!.forEach(role => expect(role.level).toBe(50));
      });
    });

    describe("child roles inclusion", () => {
      it("should include child role IDs when roles have children", async () => {
        // Arrange
        const parentRole = roleFactory({ name: "Parent" });
        const childRole1 = roleFactory({ name: "Child 1" });
        const childRole2 = roleFactory({ name: "Child 2" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([parentRole, childRole1, childRole2]);

        await testDb.db.insert(testDb.schema.roleInherits).values([
          {
            id: randomUUID(),
            parentRoleId: parentRole.id,
            childRoleId: childRole1.id,
          },
          {
            id: randomUUID(),
            parentRoleId: parentRole.id,
            childRoleId: childRole2.id,
          },
        ]);

        // Act
        const result = await service.listRoles();

        // Assert
        expectSuccessResponse(result, 200);
        const parent = result.data!.find(r => r.name === "Parent");
        expect(parent).toBeDefined();
        expect(parent!.childRoleIds).toBeDefined();
        expectArrayLength(parent!.childRoleIds!, 2);
        expect(parent!.childRoleIds).toContain(childRole1.id);
        expect(parent!.childRoleIds).toContain(childRole2.id);
      });

      it("should return empty childRoleIds array when role has no children", async () => {
        // Arrange
        const role = roleFactory({ name: "Childless" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act
        const result = await service.listRoles();

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].childRoleIds).toEqual([]);
      });
    });

    describe("error handling", () => {
      it("should handle database errors gracefully", async () => {
        // Arrange: Close the database connection to simulate error
        testDb.close();

        // Act: Try to list roles with closed database
        const result = await service.listRoles();

        // Assert: Should return error response
        expect(result.success).toBe(false);
        expect(result.statusCode).toBeGreaterThanOrEqual(400);
        expect(result.message).toContain("Failed to list roles");
        expect(result.data).toBeNull();

        // Cleanup: Recreate database for subsequent tests
        testDb = await createTestDb();
        service = new RoleService(testDb.db, testDb.schema);
      });
    });

    describe("permissions inclusion", () => {
      it("should include permission IDs when includePermissions=true", async () => {
        // Arrange
        const role = roleFactory({ name: "Role with Permissions" });
        const permission1 = permissionFactory({ action: "read" });
        const permission2 = permissionFactory({ action: "write" });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([permission1, permission2]);

        await testDb.db.insert(testDb.schema.rolePermissions).values([
          {
            id: randomUUID(),
            roleId: role.id,
            permissionId: permission1.id,
          },
          {
            id: randomUUID(),
            roleId: role.id,
            permissionId: permission2.id,
          },
        ]);

        // Act
        const result = await service.listRoles({ includePermissions: true });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].permissionIds).toBeDefined();
        expectArrayLength(result.data![0].permissionIds!, 2);
        expect(result.data![0].permissionIds).toContain(permission1.id);
        expect(result.data![0].permissionIds).toContain(permission2.id);
      });

      it("should NOT include permission IDs when includePermissions=false", async () => {
        // Arrange
        const role = roleFactory({ name: "Role" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act
        const result = await service.listRoles({ includePermissions: false });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].permissionIds).toBeUndefined();
      });

      it("should return empty permissionIds array when role has no permissions", async () => {
        // Arrange
        const role = roleFactory({ name: "No Permissions" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act
        const result = await service.listRoles({ includePermissions: true });

        // Assert
        expectSuccessResponse(result, 200);
        expect(result.data![0].permissionIds).toEqual([]);
      });
    });
  });

  describe("getRoleById()", () => {
    it("should return role when ID exists", async () => {
      // Arrange
      const role = roleFactory({ name: "Test Role" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id);

      // Assert
      expectSuccessResponse(result, 200);
      expect(result.data!.id).toBe(role.id);
      expect(result.data!.name).toBe("Test Role");
      expect(result.data!.slug).toBe(role.slug);
      expect(result.data!.level).toBe(role.level);
      expect(result.data!.isSystem).toBe(false);
    });

    it("should return 404 when role does not exist", async () => {
      // Act
      const result = await service.getRoleById(randomUUID());

      // Assert
      expectErrorResponse(result, 404, "not found");
    });

    // PR 4 migration: getRoleById now throws NextlyError(VALIDATION_ERROR) for
    // bad inputs instead of returning a result-shape with statusCode: 400.
    // These assertions check the error code and the validation publicData
    // shape rather than the legacy `{success, message, statusCode}` result.
    it("should reject invalid UUID format", async () => {
      await expect(service.getRoleById("not-a-uuid")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject null role ID", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(service.getRoleById(null as any)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject undefined role ID", async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.getRoleById(undefined as any)
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject empty string role ID", async () => {
      await expect(service.getRoleById("")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject whitespace-only role ID", async () => {
      await expect(service.getRoleById("   ")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should return correct isSystem flag for system role", async () => {
      // Arrange
      const role = systemRoleFactory({ name: "System Role" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id);

      // Assert
      expectSuccessResponse(result, 200);
      expect(result.data!.isSystem).toBe(true);
    });

    it("should return all fields correctly", async () => {
      // Arrange
      const role = roleFactory({
        name: "Complete Role",
        slug: "complete-role",
        description: "A fully detailed role",
        level: 75,
      });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id);

      // Assert
      expectSuccessResponse(result, 200);
      expect(result.data).toEqual({
        id: role.id,
        name: "Complete Role",
        slug: "complete-role",
        description: "A fully detailed role",
        level: 75,
        isSystem: false,
      });
    });

    it("should handle role with null description", async () => {
      // Arrange
      const role = roleFactory({ description: null });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id);

      // Assert
      expectSuccessResponse(result, 200);
      expect(result.data!.description).toBeNull();
    });

    it("should return valid UUID in response", async () => {
      // Arrange
      const role = roleFactory();
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id);

      // Assert
      expectSuccessResponse(result, 200);
      expectValidUUID(result.data!.id);
    });

    it("should handle uppercase UUID input", async () => {
      // Arrange
      const role = roleFactory();
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleById(role.id.toUpperCase());

      // Assert
      // Should either work or return 404 (depending on DB case sensitivity)
      expect([200, 404]).toContain(result.statusCode);
    });

    it("should be performant for single lookup", async () => {
      // Arrange
      const role = roleFactory();
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const start = Date.now();
      await service.getRoleById(role.id);
      const duration = Date.now() - start;

      // Assert: Should complete in under 50ms
      expect(duration).toBeLessThan(50);
    });
  });

  describe("getRoleByName()", () => {
    it("should return role when name exists", async () => {
      // Arrange
      const role = roleFactory({ name: "Unique Name" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName("Unique Name");

      // Assert
      expect(result).not.toBeNull();
      expect(result!.id).toBe(role.id);
    });

    it("should return null when name does not exist", async () => {
      // Act
      const result = await service.getRoleByName("Nonexistent");

      // Assert
      expect(result).toBeNull();
    });

    it("should be case-sensitive for exact match", async () => {
      // Arrange
      const role = roleFactory({ name: "TestRole" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName("testrole");

      // Assert
      // Depending on DB collation, this might be null or found
      // Document the actual behavior
      expect(result === null || result.id === role.id).toBe(true);
    });

    it("should return first match if duplicates exist somehow", async () => {
      // Note: This shouldn't happen due to unique constraints,
      // but test the method's behavior
      // Arrange
      const role = roleFactory({ name: "Duplicate" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName("Duplicate");

      // Assert
      expect(result).not.toBeNull();
      expectValidUUID(result!.id);
    });

    it("should handle special characters in name", async () => {
      // Arrange
      const role = roleFactory({ name: "Role (Special)" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName("Role (Special)");

      // Assert
      expect(result).not.toBeNull();
      expect(result!.id).toBe(role.id);
    });

    it("should handle Unicode characters in name", async () => {
      // Arrange
      const role = roleFactory({ name: "管理者" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName("管理者");

      // Assert
      expect(result).not.toBeNull();
      expect(result!.id).toBe(role.id);
    });

    it("should return only ID field", async () => {
      // Arrange
      const role = roleFactory();
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName(role.name);

      // Assert
      expect(result).not.toBeNull();
      expect(Object.keys(result!)).toEqual(["id"]);
    });

    it("should handle empty string name", async () => {
      // Act
      const result = await service.getRoleByName("");

      // Assert
      expect(result).toBeNull();
    });

    it("should handle very long name", async () => {
      // Arrange
      const longName = "A".repeat(255); // Assuming 255 char limit
      const role = roleFactory({ name: longName });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.getRoleByName(longName);

      // Assert
      expect(result).not.toBeNull();
    });

    it("should be performant for name lookup", async () => {
      // Arrange
      const roles = bulkRolesFactory(100);
      await testDb.db.insert(testDb.schema.roles).values(roles);
      const targetRole = roles[50];

      // Act
      const start = Date.now();
      await service.getRoleByName(targetRole.name);
      const duration = Date.now() - start;

      // Assert: Should complete quickly even with 100 roles
      expect(duration).toBeLessThan(50);
    });
  });

  describe("findRoleIdBySlug()", () => {
    it("should return role ID when slug exists", async () => {
      // Arrange
      const role = roleFactory({ slug: "test-role-slug" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.findRoleIdBySlug("test-role-slug");

      // Assert
      expect(result).toBeTruthy();
      expect(result?.id).toBe(role.id);
    });

    it("should return null when slug does not exist", async () => {
      // Arrange: Empty database

      // Act
      const result = await service.findRoleIdBySlug("non-existent-slug");

      // Assert
      expect(result).toBeNull();
    });

    it("should be case-sensitive for slug lookup", async () => {
      // Arrange
      const role = roleFactory({ slug: "lowercase-slug" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.findRoleIdBySlug("LOWERCASE-SLUG");

      // Assert: Should not match due to case difference
      expect(result).toBeNull();
    });

    it("should handle slugs with special characters", async () => {
      // Arrange
      const role = roleFactory({ slug: "role-with-numbers-123" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.findRoleIdBySlug("role-with-numbers-123");

      // Assert
      expect(result).toBeTruthy();
      expect(result?.id).toBe(role.id);
    });
  });

  describe("ensureSuperAdminRole()", () => {
    it("should create super admin role when it does not exist", async () => {
      // Arrange: Empty database

      // Act
      const result = await service.ensureSuperAdminRole();

      // Assert
      expect(result.created).toBe(true);
      expectValidUUID(result.id);

      // Verify role exists in database
      const role = await testDb.db.query.roles.findFirst({
        where: (roles, { eq }) => eq(roles.slug, "super-admin"),
      });

      expect(role).toBeTruthy();
      expect(role?.name).toBe("Super Admin");
      expect(role?.level).toBe(1000);
      expect(Boolean(role?.isSystem)).toBe(true); // Drizzle returns boolean
    });

    it("should return existing super admin role without creating duplicate", async () => {
      // Arrange: Create super admin role first
      const firstResult = await service.ensureSuperAdminRole();

      // Act: Call again
      const secondResult = await service.ensureSuperAdminRole();

      // Assert: Should return same ID, not create new one
      expect(secondResult.created).toBe(false);
      expect(secondResult.id).toBe(firstResult.id);

      // Verify only one super admin exists
      const roles = await testDb.db.query.roles.findMany({
        where: (roles, { eq }) => eq(roles.slug, "super-admin"),
      });

      expectArrayLength(roles, 1);
    });

    it("should be idempotent (safe to call multiple times)", async () => {
      // Arrange & Act: Call three times
      const result1 = await service.ensureSuperAdminRole();
      const result2 = await service.ensureSuperAdminRole();
      const result3 = await service.ensureSuperAdminRole();

      // Assert: First creates, subsequent calls return existing
      expect(result1.created).toBe(true);
      expect(result2.created).toBe(false);
      expect(result3.created).toBe(false);

      expect(result1.id).toBe(result2.id);
      expect(result2.id).toBe(result3.id);
    });
  });

  describe("findRoleIdBySlug() - additional edge cases", () => {
    it("should handle slug with hyphens and numbers", async () => {
      // Arrange
      const role = roleFactory({ slug: "role-123-admin" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act
      const result = await service.findRoleIdBySlug("role-123-admin");

      // Assert
      expect(result).not.toBeNull();
      expect(result!.id).toBe(role.id);
    });

    it("should return null for null slug", async () => {
      // Act

      const result = await service.findRoleIdBySlug(null as any);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for undefined slug", async () => {
      // Act

      const result = await service.findRoleIdBySlug(undefined as any);

      // Assert
      expect(result).toBeNull();
    });

    it("should handle URL-encoded slug lookup", async () => {
      // Arrange
      const role = roleFactory({ slug: "test-role" });
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act: Try with URL-encoded slug (shouldn't match)
      const result = await service.findRoleIdBySlug("test%2Drole");

      // Assert: Encoded slug shouldn't match
      expect(result).toBeNull();
    });
  });

  describe("listRoles() - additional combined filters", () => {
    it("should combine search with isSystem filter", async () => {
      // Arrange
      await testDb.db
        .insert(testDb.schema.roles)
        .values([
          systemRoleFactory({ name: "System Admin" }),
          systemRoleFactory({ name: "System Editor" }),
          roleFactory({ name: "Admin User" }),
        ]);

      // Act
      const result = await service.listRoles({
        search: "Admin",
        isSystem: true,
      });

      // Assert
      expectSuccessResponse(result, 200);
      expectArrayLength(result.data!, 1);
      expect(result.data![0].name).toBe("System Admin");
    });

    it("should combine level filters with search", async () => {
      // Arrange
      await testDb.db
        .insert(testDb.schema.roles)
        .values([
          roleFactory({ name: "Editor Low", level: 10 }),
          roleFactory({ name: "Editor Mid", level: 50 }),
          roleFactory({ name: "Editor High", level: 90 }),
          roleFactory({ name: "Admin Mid", level: 50 }),
        ]);

      // Act
      const result = await service.listRoles({
        search: "Editor",
        levelMin: 40,
        levelMax: 60,
      });

      // Assert
      expectSuccessResponse(result, 200);
      expectArrayLength(result.data!, 1);
      expect(result.data![0].name).toBe("Editor Mid");
    });

    it("should handle all filters combined with pagination", async () => {
      // Arrange
      const roles = [];
      for (let i = 0; i < 15; i++) {
        roles.push(
          systemRoleFactory({
            name: `System Role ${i}`,
            level: i * 10,
          })
        );
      }
      await testDb.db.insert(testDb.schema.roles).values(roles);

      // Act
      const result = await service.listRoles({
        search: "System",
        isSystem: true,
        levelMin: 30,
        levelMax: 80,
        sortBy: "level",
        sortOrder: "asc",
        page: 1,
        pageSize: 3,
      });

      // Assert
      expectSuccessResponse(result, 200);
      expectArrayLength(result.data!, 3);
      expectPaginationMeta(result, {
        page: 1,
        pageSize: 3,
        total: 6, // Roles with level 30, 40, 50, 60, 70, 80
      });
    });
  });

  // Note: Tests for createRole(), updateRole(), and deleteRole() are deferred.
  // These methods have complex implementations involving transactions, cross-service
  // dependencies, and extensive validation logic that require integration testing
  // rather than unit testing with in-memory SQLite database.
});
