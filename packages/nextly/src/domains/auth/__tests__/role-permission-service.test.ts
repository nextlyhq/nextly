import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import {
  permissionFactory,
  bulkPermissionsFactory,
} from "../../../__tests__/fixtures/permissions";
import { roleFactory } from "../../../__tests__/fixtures/roles";
import { expectArrayLength } from "../../../__tests__/utils/assertions";
import { RolePermissionService } from "../services/role-permission-service";

describe("RolePermissionService", () => {
  let testDb: TestDb;
  let service: RolePermissionService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new RolePermissionService(testDb.db, testDb.schema);
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  describe("addPermissionToRole()", () => {
    describe("with existing permission", () => {
      it("should assign existing permission to role successfully", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "read",
          resource: "users",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: Verify role-permission relationship was created
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 1);
        expect(rolePermissions[0].permissionId).toBe(permission.id);
      });

      it("should handle duplicate assignment gracefully (idempotent)", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "update",
          resource: "content",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act: Add same permission twice
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: Should only have one assignment
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 1);
      });

      it("should allow assigning same permission to multiple roles", async () => {
        // Arrange
        const role1 = roleFactory({ name: "Admin" });
        const role2 = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "delete",
          resource: "posts",
        });

        await testDb.db.insert(testDb.schema.roles).values([role1, role2]);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act: Assign same permission to both roles
        await service.addPermissionToRole(role1.id, {
          action: permission.action,
          resource: permission.resource,
        });
        await service.addPermissionToRole(role2.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: Both roles should have the permission
        const role1Permissions = await testDb.db.query.rolePermissions.findMany(
          {
            where: (rolePermissions, { eq }) =>
              eq(rolePermissions.roleId, role1.id),
          }
        );
        const role2Permissions = await testDb.db.query.rolePermissions.findMany(
          {
            where: (rolePermissions, { eq }) =>
              eq(rolePermissions.roleId, role2.id),
          }
        );

        expectArrayLength(role1Permissions, 1);
        expectArrayLength(role2Permissions, 1);
        expect(role1Permissions[0].permissionId).toBe(permission.id);
        expect(role2Permissions[0].permissionId).toBe(permission.id);
      });
    });

    // Note: Tests for auto-creating permissions (when permission doesn't exist) are skipped
    // because they use withTx() which requires PostgreSQL transaction support.
    // Our test suite uses in-memory SQLite. In production, this service auto-creates permissions.

    describe("multiple permissions", () => {
      it("should allow assigning multiple permissions to one role", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const perms = [
          permissionFactory({ action: "create", resource: "posts" }),
          permissionFactory({ action: "read", resource: "posts" }),
          permissionFactory({ action: "update", resource: "posts" }),
        ];

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(perms);

        // Act: Assign all 3 permissions
        for (const perm of perms) {
          await service.addPermissionToRole(role.id, {
            action: perm.action,
            resource: perm.resource,
          });
        }

        // Assert
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 3);
        const permissionIds = rolePermissions.map(rp => rp.permissionId);
        expect(permissionIds).toContain(perms[0].id);
        expect(permissionIds).toContain(perms[1].id);
        expect(permissionIds).toContain(perms[2].id);
      });

      it("should handle assigning many permissions efficiently", async () => {
        // Arrange: Role with 50 permissions
        const role = roleFactory({ name: "SuperUser" });
        const permissions = bulkPermissionsFactory(50);

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Act
        const startTime = Date.now();
        for (const perm of permissions) {
          await service.addPermissionToRole(role.id, {
            action: perm.action,
            resource: perm.resource,
          });
        }
        const executionTime = Date.now() - startTime;

        // Assert
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 50);
        expect(executionTime).toBeLessThan(10000); // Should complete in < 10 seconds, allowing CI overhead
      });
    });

    describe("edge cases", () => {
      it("should handle role without any prior permissions", async () => {
        // Arrange
        const role = roleFactory({ name: "New Role" });
        const permission = permissionFactory({
          action: "first",
          resource: "permission",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 1);
      });

      it("should handle special characters in action/resource", async () => {
        // Arrange
        const role = roleFactory({ name: "Test Role" });
        const permission = permissionFactory({
          action: "admin:delete",
          resource: "user_profiles",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert
        const permissions = await testDb.db.query.permissions.findMany();
        expectArrayLength(permissions, 1);
        expect(permissions[0].action).toBe("admin:delete");
        expect(permissions[0].resource).toBe("user_profiles");
      });
    });
  });

  describe("removePermissionFromRole()", () => {
    describe("existing assignments", () => {
      it("should remove permission from role successfully", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "delete",
          resource: "comments",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Verify it exists
        let rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });
        expectArrayLength(rolePermissions, 1);

        // Act: Remove permission
        await service.removePermissionFromRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: Permission should be removed
        rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });
        expectArrayLength(rolePermissions, 0);
      });

      it("should only remove specified permission (not affect others)", async () => {
        // Arrange: Role with 3 permissions
        const role = roleFactory({ name: "Editor" });
        const perms = [
          permissionFactory({ action: "create", resource: "posts" }),
          permissionFactory({ action: "read", resource: "posts" }),
          permissionFactory({ action: "update", resource: "posts" }),
        ];

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(perms);

        for (const perm of perms) {
          await service.addPermissionToRole(role.id, {
            action: perm.action,
            resource: perm.resource,
          });
        }

        // Act: Remove only one permission
        await service.removePermissionFromRole(role.id, {
          action: perms[1].action,
          resource: perms[1].resource,
        });

        // Assert: Other 2 permissions should remain
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 2);
        const permissionIds = rolePermissions.map(rp => rp.permissionId);
        expect(permissionIds).toContain(perms[0].id);
        expect(permissionIds).toContain(perms[2].id);
        expect(permissionIds).not.toContain(perms[1].id);
      });

      it("should only remove permission from specified role (not affect other roles)", async () => {
        // Arrange: Two roles with same permission
        const role1 = roleFactory({ name: "Admin" });
        const role2 = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "edit",
          resource: "pages",
        });

        await testDb.db.insert(testDb.schema.roles).values([role1, role2]);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        await service.addPermissionToRole(role1.id, {
          action: permission.action,
          resource: permission.resource,
        });
        await service.addPermissionToRole(role2.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Act: Remove permission from role1 only
        await service.removePermissionFromRole(role1.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: role2 should still have the permission
        const role1Permissions = await testDb.db.query.rolePermissions.findMany(
          {
            where: (rolePermissions, { eq }) =>
              eq(rolePermissions.roleId, role1.id),
          }
        );
        const role2Permissions = await testDb.db.query.rolePermissions.findMany(
          {
            where: (rolePermissions, { eq }) =>
              eq(rolePermissions.roleId, role2.id),
          }
        );

        expectArrayLength(role1Permissions, 0);
        expectArrayLength(role2Permissions, 1);
      });
    });

    describe("edge cases", () => {
      it("should handle non-existent permission gracefully", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act & Assert: Should not throw even though permission doesn't exist
        await expect(
          service.removePermissionFromRole(role.id, {
            action: "non-existent",
            resource: "resource",
          })
        ).resolves.not.toThrow();
      });

      it("should handle role without any permissions", async () => {
        // Arrange
        const role = roleFactory({ name: "Empty Role" });
        const permission = permissionFactory({
          action: "test",
          resource: "test",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Act & Assert: Should not throw
        await expect(
          service.removePermissionFromRole(role.id, {
            action: permission.action,
            resource: permission.resource,
          })
        ).resolves.not.toThrow();
      });

      it("should handle removing permission that was never assigned", async () => {
        // Arrange: Role has permission A, try to remove permission B
        const role = roleFactory({ name: "Editor" });
        const permA = permissionFactory({ action: "read", resource: "posts" });
        const permB = permissionFactory({ action: "write", resource: "posts" });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([permA, permB]);
        await service.addPermissionToRole(role.id, {
          action: permA.action,
          resource: permA.resource,
        });

        // Act: Try to remove permB which was never assigned
        await service.removePermissionFromRole(role.id, {
          action: permB.action,
          resource: permB.resource,
        });

        // Assert: permA should still be there
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 1);
        expect(rolePermissions[0].permissionId).toBe(permA.id);
      });

      it("should be idempotent (removing twice doesn't error)", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const permission = permissionFactory({
          action: "test",
          resource: "test",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Act: Remove twice
        await service.removePermissionFromRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });
        await service.removePermissionFromRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Assert: No error, permissions empty
        const rolePermissions = await testDb.db.query.rolePermissions.findMany({
          where: (rolePermissions, { eq }) =>
            eq(rolePermissions.roleId, role.id),
        });

        expectArrayLength(rolePermissions, 0);
      });
    });
  });

  describe("listRolePermissions()", () => {
    describe("basic listing", () => {
      it("should return all permissions for role", async () => {
        // Arrange
        const role = roleFactory({ name: "Editor" });
        const perms = [
          permissionFactory({ action: "create", resource: "articles" }),
          permissionFactory({ action: "read", resource: "articles" }),
          permissionFactory({ action: "update", resource: "articles" }),
        ];

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(perms);

        for (const perm of perms) {
          await service.addPermissionToRole(role.id, {
            action: perm.action,
            resource: perm.resource,
          });
        }

        // Act
        const result = await service.listRolePermissions(role.id);

        // Assert
        expectArrayLength(result, 3);
        expect(result.every(p => p.id && p.action && p.resource)).toBe(true);

        // Verify all permissions are present
        const actions = result.map(p => p.action);
        expect(actions).toContain("create");
        expect(actions).toContain("read");
        expect(actions).toContain("update");
      });

      it("should return empty array for role with no permissions", async () => {
        // Arrange
        const role = roleFactory({ name: "Empty Role" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act
        const result = await service.listRolePermissions(role.id);

        // Assert
        expectArrayLength(result, 0);
      });

      it("should return permission objects with id, action, and resource", async () => {
        // Arrange
        const role = roleFactory({ name: "Viewer" });
        const permission = permissionFactory({
          action: "view",
          resource: "dashboard",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);
        await service.addPermissionToRole(role.id, {
          action: permission.action,
          resource: permission.resource,
        });

        // Act
        const result = await service.listRolePermissions(role.id);

        // Assert
        expectArrayLength(result, 1);
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("action");
        expect(result[0]).toHaveProperty("resource");
        expect(result[0].id).toBe(permission.id);
        expect(result[0].action).toBe("view");
        expect(result[0].resource).toBe("dashboard");
      });
    });

    describe("edge cases", () => {
      it("should handle non-existent role gracefully", async () => {
        // Act
        const result = await service.listRolePermissions(
          "non-existent-role-id"
        );

        // Assert
        expectArrayLength(result, 0);
      });

      it("should handle large number of permissions efficiently", async () => {
        // Arrange: Role with 100 permissions
        const role = roleFactory({ name: "SuperUser" });
        const permissions = bulkPermissionsFactory(100);

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        for (const perm of permissions) {
          await service.addPermissionToRole(role.id, {
            action: perm.action,
            resource: perm.resource,
          });
        }

        // Act
        const startTime = Date.now();
        const result = await service.listRolePermissions(role.id);
        const executionTime = Date.now() - startTime;

        // Assert
        expectArrayLength(result, 100);
        expect(executionTime).toBeLessThan(1000); // Should complete in < 1 second, allowing CI overhead
      });
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete lifecycle (add, list, remove)", async () => {
      // Arrange
      const role = roleFactory({ name: "Editor" });
      const permission = permissionFactory({
        action: "manage",
        resource: "content",
      });

      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act: Add permission
      await service.addPermissionToRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      // Verify it was added
      let permissions = await service.listRolePermissions(role.id);
      expectArrayLength(permissions, 1);

      // Act: Remove permission
      await service.removePermissionFromRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      // Verify it was removed
      permissions = await service.listRolePermissions(role.id);
      expectArrayLength(permissions, 0);
    });

    it("should handle multiple roles with overlapping permissions", async () => {
      // Arrange
      const admin = roleFactory({ name: "Admin" });
      const editor = roleFactory({ name: "Editor" });
      const viewer = roleFactory({ name: "Viewer" });

      const readPerm = permissionFactory({ action: "read", resource: "posts" });
      const writePerm = permissionFactory({
        action: "write",
        resource: "posts",
      });

      await testDb.db
        .insert(testDb.schema.roles)
        .values([admin, editor, viewer]);
      await testDb.db
        .insert(testDb.schema.permissions)
        .values([readPerm, writePerm]);

      // Act: Admin gets both, Editor gets write, Viewer gets read
      await service.addPermissionToRole(admin.id, {
        action: readPerm.action,
        resource: readPerm.resource,
      });
      await service.addPermissionToRole(admin.id, {
        action: writePerm.action,
        resource: writePerm.resource,
      });
      await service.addPermissionToRole(editor.id, {
        action: writePerm.action,
        resource: writePerm.resource,
      });
      await service.addPermissionToRole(viewer.id, {
        action: readPerm.action,
        resource: readPerm.resource,
      });

      // Assert
      const adminPerms = await service.listRolePermissions(admin.id);
      const editorPerms = await service.listRolePermissions(editor.id);
      const viewerPerms = await service.listRolePermissions(viewer.id);

      expectArrayLength(adminPerms, 2);
      expectArrayLength(editorPerms, 1);
      expectArrayLength(viewerPerms, 1);

      expect(editorPerms[0].action).toBe("write");
      expect(viewerPerms[0].action).toBe("read");
    });

    it("should handle adding/removing/re-adding same permission", async () => {
      // Arrange
      const role = roleFactory();
      const permission = permissionFactory({
        action: "manage",
        resource: "settings",
      });

      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      // Act: Add -> Remove -> Re-add
      await service.addPermissionToRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      let perms = await service.listRolePermissions(role.id);
      expectArrayLength(perms, 1);

      await service.removePermissionFromRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      perms = await service.listRolePermissions(role.id);
      expectArrayLength(perms, 0);

      await service.addPermissionToRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      perms = await service.listRolePermissions(role.id);
      expectArrayLength(perms, 1);

      // Assert: Permission should be the same
      expect(perms[0].id).toBe(permission.id);
      expect(perms[0].action).toBe("manage");
      expect(perms[0].resource).toBe("settings");
    });

    it("should maintain referential integrity when permission is removed", async () => {
      // Arrange: Two roles with same permission
      const role1 = roleFactory({ name: "Role 1", slug: "role-1" });
      const role2 = roleFactory({ name: "Role 2", slug: "role-2" });
      const permission = permissionFactory({
        action: "shared",
        resource: "data",
      });

      await testDb.db.insert(testDb.schema.roles).values([role1, role2]);
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      await service.addPermissionToRole(role1.id, {
        action: permission.action,
        resource: permission.resource,
      });
      await service.addPermissionToRole(role2.id, {
        action: permission.action,
        resource: permission.resource,
      });

      // Act: Remove permission from role1
      await service.removePermissionFromRole(role1.id, {
        action: permission.action,
        resource: permission.resource,
      });

      // Assert: role1 should not have it, role2 should still have it
      const role1Perms = await service.listRolePermissions(role1.id);
      const role2Perms = await service.listRolePermissions(role2.id);

      expectArrayLength(role1Perms, 0);
      expectArrayLength(role2Perms, 1);
      expect(role2Perms[0].id).toBe(permission.id);
    });
  });

  describe("boundary and performance tests", () => {
    it("should handle empty permission list", async () => {
      // Arrange: Role with no permissions
      const emptyRole = roleFactory();
      await testDb.db.insert(testDb.schema.roles).values(emptyRole);

      // Act
      const result = await service.listRolePermissions(emptyRole.id);

      // Assert
      expectArrayLength(result, 0);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle role with many permissions", async () => {
      // Arrange: Create role and 10 permissions
      const role = roleFactory();
      const permissions = Array.from({ length: 10 }, (_, i) =>
        permissionFactory({
          action: `action${i}`,
          resource: `resource${i}`,
        })
      );

      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.permissions).values(permissions);

      // Act: Assign all permissions
      for (const perm of permissions) {
        await service.addPermissionToRole(role.id, {
          action: perm.action,
          resource: perm.resource,
        });
      }

      // Assert
      const result = await service.listRolePermissions(role.id);
      expectArrayLength(result, 10);

      // Verify all actions are present
      const actions = result.map(p => p.action).sort();
      expect(actions).toEqual([
        "action0",
        "action1",
        "action2",
        "action3",
        "action4",
        "action5",
        "action6",
        "action7",
        "action8",
        "action9",
      ]);
    });

    it("should handle removing all permissions from role", async () => {
      // Arrange: Role with 3 permissions
      const role = roleFactory();
      const perms = [
        permissionFactory({ action: "read", resource: "posts" }),
        permissionFactory({ action: "write", resource: "posts" }),
        permissionFactory({ action: "delete", resource: "posts" }),
      ];

      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.permissions).values(perms);

      for (const perm of perms) {
        await service.addPermissionToRole(role.id, {
          action: perm.action,
          resource: perm.resource,
        });
      }

      // Act: Remove all permissions
      for (const perm of perms) {
        await service.removePermissionFromRole(role.id, {
          action: perm.action,
          resource: perm.resource,
        });
      }

      // Assert: Role should have no permissions
      const result = await service.listRolePermissions(role.id);
      expectArrayLength(result, 0);
    });

    it("should correctly return permission IDs in list", async () => {
      // Arrange
      const role = roleFactory();
      const permission = permissionFactory({
        action: "test",
        resource: "data",
      });

      await testDb.db.insert(testDb.schema.roles).values(role);
      await testDb.db.insert(testDb.schema.permissions).values(permission);

      await service.addPermissionToRole(role.id, {
        action: permission.action,
        resource: permission.resource,
      });

      // Act
      const result = await service.listRolePermissions(role.id);

      // Assert: Should return correct permission ID
      expectArrayLength(result, 1);
      expect(result[0].id).toBe(permission.id);
      expect(result[0].action).toBe(permission.action);
      expect(result[0].resource).toBe(permission.resource);

      // Verify ID is a valid UUID
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(result[0].id)).toBe(true);
    });
  });
});
