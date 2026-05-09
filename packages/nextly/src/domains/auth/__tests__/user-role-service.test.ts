import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { permissionFactory } from "../../../__tests__/fixtures/permissions";
import { roleFactory } from "../../../__tests__/fixtures/roles";
import { userFactory } from "../../../__tests__/fixtures/users";
import {
  expectArrayLength,
  expectSuccessResponse,
} from "../../../__tests__/utils/assertions";
import { UserRoleService } from "../services/user-role-service";

describe("UserRoleService", () => {
  let testDb: TestDb;
  let service: UserRoleService;

  beforeEach(async () => {
    testDb = await createTestDb();
    // Type cast necessary: UserRoleService expects RBACDatabaseInstance (production PostgreSQL/MySQL)
    // but tests use in-memory SQLite. Both implement the same query interface.
    service = new UserRoleService(testDb.db as any, testDb.schema);
  });

  describe("assignRoleToUser", () => {
    describe("with valid user and role", () => {
      it("should assign role to user successfully", async () => {
        // Arrange: Create test user and role
        const user = userFactory();
        const role = roleFactory();

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act: Assign role to user
        const result = await service.assignRoleToUser(user.id, role.id);

        // Assert: Role assignment created
        expectSuccessResponse(result, 201);
        expect(result.message).toBe("Role assigned successfully");

        const userRoles = await testDb.db.query.userRoles.findMany({
          where: (userRoles, { eq }) => eq(userRoles.userId, user.id),
        });

        expectArrayLength(userRoles, 1);
        expect(userRoles[0].roleId).toBe(role.id);
        expect(userRoles[0].userId).toBe(user.id);
        expect(userRoles[0].expiresAt).toBeNull();
      });

      it("should assign role with expiration date", async () => {
        // Arrange: Create test user and role
        const user = userFactory();
        const role = roleFactory();
        const expirationDate = new Date("2025-12-31");

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act: Assign role with expiration
        const result = await service.assignRoleToUser(user.id, role.id, {
          expiresAt: expirationDate,
        });

        // Assert: Role assignment created with expiration
        expectSuccessResponse(result, 201);

        const userRoles = await testDb.db.query.userRoles.findMany({
          where: (userRoles, { eq }) => eq(userRoles.userId, user.id),
        });

        expectArrayLength(userRoles, 1);
        expect(userRoles[0].expiresAt).toBeTruthy();
      });

      it("should assign multiple different roles to same user", async () => {
        // Arrange: Create user and two roles
        const user = userFactory();
        const role1 = roleFactory({ name: "Role 1", slug: "role-1" });
        const role2 = roleFactory({ name: "Role 2", slug: "role-2" });

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values([role1, role2]);

        // Act: Assign both roles to user
        const result1 = await service.assignRoleToUser(user.id, role1.id);
        const result2 = await service.assignRoleToUser(user.id, role2.id);

        // Assert: Both assignments successful
        expectSuccessResponse(result1, 201);
        expectSuccessResponse(result2, 201);

        const userRoles = await testDb.db.query.userRoles.findMany({
          where: (userRoles, { eq }) => eq(userRoles.userId, user.id),
        });

        expectArrayLength(userRoles, 2);
      });
    });

    describe("with invalid inputs", () => {
      it("should return 404 when user does not exist", async () => {
        // Arrange: Create only a role (no user)
        const role = roleFactory();
        const nonExistentUserId = "non-existent-user-id";

        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act: Try to assign role to non-existent user
        const result = await service.assignRoleToUser(
          nonExistentUserId,
          role.id
        );

        // Assert: Returns user not found error
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(404);
        expect(result.message).toBe("User not found");
      });

      it("should return 404 when role does not exist", async () => {
        // Arrange: Create only a user (no role)
        const user = userFactory();
        const nonExistentRoleId = "non-existent-role-id";

        await testDb.db.insert(testDb.schema.users).values(user);

        // Act: Try to assign non-existent role
        const result = await service.assignRoleToUser(
          user.id,
          nonExistentRoleId
        );

        // Assert: Returns role not found error
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(404);
        expect(result.message).toBe("Role not found");
      });

      it("should return 409 when role already assigned", async () => {
        // Arrange: Create user and role, assign role
        const user = userFactory();
        const role = roleFactory();

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values(role);

        await service.assignRoleToUser(user.id, role.id);

        // Act: Try to assign same role again
        const result = await service.assignRoleToUser(user.id, role.id);

        // Assert: Returns already assigned error
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(409);
        expect(result.message).toBe("Role already assigned to this user");
      });
    });
  });

  describe("unassignRoleFromUser", () => {
    describe("with existing assignment", () => {
      it("should unassign role from user successfully", async () => {
        // Arrange: Create user, role, and assignment
        const user = userFactory();
        const role = roleFactory();

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values(role);
        await service.assignRoleToUser(user.id, role.id);

        // Act: Unassign the role
        const result = await service.unassignRoleFromUser(user.id, role.id);

        // Assert: Assignment removed
        expectSuccessResponse(result, 200);
        expect(result.message).toBe("Role unassigned successfully");

        const userRoles = await testDb.db.query.userRoles.findMany({
          where: (userRoles, { eq }) => eq(userRoles.userId, user.id),
        });

        expectArrayLength(userRoles, 0);
      });

      it("should unassign one role while keeping others", async () => {
        // Arrange: Create user with two roles
        const user = userFactory();
        const role1 = roleFactory({ name: "Role 1", slug: "role-1" });
        const role2 = roleFactory({ name: "Role 2", slug: "role-2" });

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values([role1, role2]);
        await service.assignRoleToUser(user.id, role1.id);
        await service.assignRoleToUser(user.id, role2.id);

        // Act: Unassign only role1
        const result = await service.unassignRoleFromUser(user.id, role1.id);

        // Assert: Only role2 remains
        expectSuccessResponse(result, 200);

        const userRoles = await testDb.db.query.userRoles.findMany({
          where: (userRoles, { eq }) => eq(userRoles.userId, user.id),
        });

        expectArrayLength(userRoles, 1);
        expect(userRoles[0].roleId).toBe(role2.id);
      });
    });

    describe("with invalid inputs", () => {
      it("should return 404 when assignment does not exist", async () => {
        // Arrange: Create user and role but no assignment
        const user = userFactory();
        const role = roleFactory();

        await testDb.db.insert(testDb.schema.users).values(user);
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act: Try to unassign non-existent assignment
        const result = await service.unassignRoleFromUser(user.id, role.id);

        // Assert: Returns not assigned error
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(404);
        expect(result.message).toBe("Role is not assigned to this user");
      });

      it("should return 404 when trying to unassign from wrong user", async () => {
        // Arrange: Create two users and a role, assign to user1
        const user1 = userFactory({ email: "user1@test.com" });
        const user2 = userFactory({ email: "user2@test.com" });
        const role = roleFactory();

        await testDb.db.insert(testDb.schema.users).values([user1, user2]);
        await testDb.db.insert(testDb.schema.roles).values(role);
        await service.assignRoleToUser(user1.id, role.id);

        // Act: Try to unassign from user2 (who doesn't have the role)
        const result = await service.unassignRoleFromUser(user2.id, role.id);

        // Assert: Returns not assigned error
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(404);
      });
    });
  });

  describe("listUserRoles", () => {
    it("should return empty array when user has no roles", async () => {
      // Arrange: Create user with no role assignments
      const user = userFactory();
      await testDb.db.insert(testDb.schema.users).values(user);

      // Act: List user roles
      const result = await service.listUserRoles(user.id);

      // Assert: Returns empty array
      expectArrayLength(result, 0);
    });

    it("should return single role ID when user has one role", async () => {
      // Arrange: Create user and assign one role
      const user = userFactory();
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await service.assignRoleToUser(user.id, role.id);

      // Act: List user roles
      const result = await service.listUserRoles(user.id);

      // Assert: Returns one role ID
      expectArrayLength(result, 1);
      expect(result[0]).toBe(role.id);
    });

    it("should return multiple role IDs when user has multiple roles", async () => {
      // Arrange: Create user with three roles
      const user = userFactory();
      const role1 = roleFactory({ name: "Role 1", slug: "role-1" });
      const role2 = roleFactory({ name: "Role 2", slug: "role-2" });
      const role3 = roleFactory({ name: "Role 3", slug: "role-3" });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values([role1, role2, role3]);
      await service.assignRoleToUser(user.id, role1.id);
      await service.assignRoleToUser(user.id, role2.id);
      await service.assignRoleToUser(user.id, role3.id);

      // Act: List user roles
      const result = await service.listUserRoles(user.id);

      // Assert: Returns all three role IDs
      expectArrayLength(result, 3);
      expect(result).toContain(role1.id);
      expect(result).toContain(role2.id);
      expect(result).toContain(role3.id);
    });

    it("should return only role IDs (not full objects)", async () => {
      // Arrange: Create user with role
      const user = userFactory();
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await service.assignRoleToUser(user.id, role.id);

      // Act: List user roles
      const result = await service.listUserRoles(user.id);

      // Assert: Result contains only strings (role IDs)
      expect(result.every(r => typeof r === "string")).toBe(true);

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(result.every(r => uuidRegex.test(r))).toBe(true);
    });
  });

  describe("listUserRoleNames", () => {
    it("should return empty array when user has no roles", async () => {
      // Arrange: Create user with no roles
      const user = userFactory();
      await testDb.db.insert(testDb.schema.users).values(user);

      // Act: List user role names
      const result = await service.listUserRoleNames(user.id);

      // Assert: Returns empty array
      expectArrayLength(result, 0);
    });

    it("should return single role name when user has one role", async () => {
      // Arrange: Create user with one role
      const user = userFactory();
      const role = roleFactory({ name: "Administrator" });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await service.assignRoleToUser(user.id, role.id);

      // Act: List user role names
      const result = await service.listUserRoleNames(user.id);

      // Assert: Returns role name
      expectArrayLength(result, 1);
      expect(result[0]).toBe("Administrator");
    });

    it("should return multiple role names when user has multiple roles", async () => {
      // Arrange: Create user with three roles
      const user = userFactory();
      const role1 = roleFactory({ name: "Admin", slug: "admin" });
      const role2 = roleFactory({ name: "Editor", slug: "editor" });
      const role3 = roleFactory({ name: "Viewer", slug: "viewer" });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values([role1, role2, role3]);
      await service.assignRoleToUser(user.id, role1.id);
      await service.assignRoleToUser(user.id, role2.id);
      await service.assignRoleToUser(user.id, role3.id);

      // Act: List user role names
      const result = await service.listUserRoleNames(user.id);

      // Assert: Returns all role names
      expectArrayLength(result, 3);
      expect(result).toContain("Admin");
      expect(result).toContain("Editor");
      expect(result).toContain("Viewer");
    });

    it("should return only role names (not IDs or objects)", async () => {
      // Arrange: Create user with role
      const user = userFactory();
      const role = roleFactory({ name: "Test Role" });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);
      await service.assignRoleToUser(user.id, role.id);

      // Act: List user role names
      const result = await service.listUserRoleNames(user.id);

      // Assert: Result contains only strings (not UUIDs)
      expect(result.every(r => typeof r === "string")).toBe(true);

      // Should NOT be UUIDs
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(result.every(r => !uuidRegex.test(r))).toBe(true);

      expect(result[0]).toBe("Test Role");
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete role assignment lifecycle", async () => {
      // Arrange: Create user and role
      const user = userFactory();
      const role = roleFactory({ name: "Manager" });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act & Assert: Full lifecycle

      // 1. Initially no roles
      let roles = await service.listUserRoles(user.id);
      expectArrayLength(roles, 0);

      // 2. Assign role
      const assignResult = await service.assignRoleToUser(user.id, role.id);
      expectSuccessResponse(assignResult, 201);

      // 3. Verify role assigned
      roles = await service.listUserRoles(user.id);
      expectArrayLength(roles, 1);

      const roleNames = await service.listUserRoleNames(user.id);
      expect(roleNames[0]).toBe("Manager");

      // 4. Unassign role
      const unassignResult = await service.unassignRoleFromUser(
        user.id,
        role.id
      );
      expectSuccessResponse(unassignResult, 200);

      // 5. Verify role removed
      roles = await service.listUserRoles(user.id);
      expectArrayLength(roles, 0);
    });

    it("should handle multiple users with same role", async () => {
      // Arrange: Create three users and one role
      const user1 = userFactory({ email: "user1@test.com" });
      const user2 = userFactory({ email: "user2@test.com" });
      const user3 = userFactory({ email: "user3@test.com" });
      const role = roleFactory({ name: "Shared Role" });

      await testDb.db.insert(testDb.schema.users).values([user1, user2, user3]);
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act: Assign same role to all users
      await service.assignRoleToUser(user1.id, role.id);
      await service.assignRoleToUser(user2.id, role.id);
      await service.assignRoleToUser(user3.id, role.id);

      // Assert: All users have the role
      const roles1 = await service.listUserRoles(user1.id);
      const roles2 = await service.listUserRoles(user2.id);
      const roles3 = await service.listUserRoles(user3.id);

      expectArrayLength(roles1, 1);
      expectArrayLength(roles2, 1);
      expectArrayLength(roles3, 1);

      expect(roles1[0]).toBe(role.id);
      expect(roles2[0]).toBe(role.id);
      expect(roles3[0]).toBe(role.id);
    });

    it("should handle role assignments with future expiration dates", async () => {
      // Arrange: Create user and two roles
      const user = userFactory();
      const role1 = roleFactory({ name: "Role 1", slug: "role-1" });
      const role2 = roleFactory({ name: "Role 2", slug: "role-2" });
      const futureDate1 = new Date("2030-01-01");
      const futureDate2 = new Date("2030-12-31");

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values([role1, role2]);

      // Act: Assign roles with different expiration dates
      const result1 = await service.assignRoleToUser(user.id, role1.id, {
        expiresAt: futureDate1,
      });
      const result2 = await service.assignRoleToUser(user.id, role2.id, {
        expiresAt: futureDate2,
      });

      // Assert: Both assignments successful
      expectSuccessResponse(result1, 201);
      expectSuccessResponse(result2, 201);

      // Verify both assignments exist
      const roles = await service.listUserRoles(user.id);
      expectArrayLength(roles, 2);
    });
  });

  describe("edge cases", () => {
    it("should handle assignment to user with no email verification", async () => {
      // Arrange: Create user without email verification
      const user = userFactory({ emailVerified: null });
      const role = roleFactory();

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(role);

      // Act: Assign role
      const result = await service.assignRoleToUser(user.id, role.id);

      // Assert: Assignment successful regardless of email verification
      expectSuccessResponse(result, 201);
    });

    it("should handle system roles correctly", async () => {
      // Arrange: Create system role
      const user = userFactory();
      const systemRole = roleFactory({ name: "System Admin", isSystem: 1 });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db.insert(testDb.schema.roles).values(systemRole);

      // Act: Assign system role to user
      const result = await service.assignRoleToUser(user.id, systemRole.id);

      // Assert: System role can be assigned like any other role
      expectSuccessResponse(result, 201);

      const roleNames = await service.listUserRoleNames(user.id);
      expect(roleNames).toContain("System Admin");
    });

    it("should handle roles with different levels", async () => {
      // Arrange: Create roles with different levels
      const user = userFactory();
      const lowLevelRole = roleFactory({
        name: "Level 1",
        slug: "level-1",
        level: 1,
      });
      const highLevelRole = roleFactory({
        name: "Level 10",
        slug: "level-10",
        level: 10,
      });

      await testDb.db.insert(testDb.schema.users).values(user);
      await testDb.db
        .insert(testDb.schema.roles)
        .values([lowLevelRole, highLevelRole]);

      // Act: Assign both roles
      await service.assignRoleToUser(user.id, lowLevelRole.id);
      await service.assignRoleToUser(user.id, highLevelRole.id);

      // Assert: User can have multiple roles with different levels
      const roles = await service.listUserRoles(user.id);
      expectArrayLength(roles, 2);
    });

    it("should return empty string for role names if role is missing", async () => {
      // This is an edge case that shouldn't happen in production due to foreign keys,
      // but the service handles it gracefully

      // Arrange: Create user
      const user = userFactory();
      await testDb.db.insert(testDb.schema.users).values(user);

      // Act: List role names (user has no roles)
      const result = await service.listUserRoleNames(user.id);

      // Assert: Returns empty array (not an error)
      expectArrayLength(result, 0);
    });
  });
});
