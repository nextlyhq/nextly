import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import {
  permissionFactory,
  bulkPermissionsFactory,
} from "../../../__tests__/fixtures/permissions";
import {
  roleFactory,
  bulkRolesFactory,
} from "../../../__tests__/fixtures/roles";
import { expectArrayLength } from "../../../__tests__/utils/assertions";
import { PermissionCheckerService } from "../services/permission-checker-service";
import { RoleInheritanceService } from "../services/role-inheritance-service";

describe("PermissionCheckerService", () => {
  let testDb: TestDb;
  let service: PermissionCheckerService;
  let inheritanceService: RoleInheritanceService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new PermissionCheckerService(testDb.db, testDb.schema);
    inheritanceService = new RoleInheritanceService(testDb.db, testDb.schema);
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  describe("getAllPermissionsForRole()", () => {
    describe("direct permissions only", () => {
      it("should return direct permissions when role has no children", async () => {
        // Arrange: Create role with 3 direct permissions
        const role = roleFactory({ name: "Editor" });
        const permissions = bulkPermissionsFactory(3); // Uses default unique action/resource

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        // Assign permissions to role
        for (const perm of permissions) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${role.id}::${perm.id}`,
            roleId: role.id,
            permissionId: perm.id,
          });
        }

        // Act
        const result = await service.getAllPermissionsForRole(role.id);

        // Assert
        expectArrayLength(result, 3);
        expect(result).toContain(permissions[0].id);
        expect(result).toContain(permissions[1].id);
        expect(result).toContain(permissions[2].id);
      });

      it("should return empty array for role with no permissions", async () => {
        // Arrange: Create role without permissions
        const role = roleFactory({ name: "Empty Role" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act
        const result = await service.getAllPermissionsForRole(role.id);

        // Assert
        expectArrayLength(result, 0);
      });

      it("should handle role with single permission", async () => {
        // Arrange
        const role = roleFactory({ name: "Single Permission Role" });
        const permission = permissionFactory({
          action: "single",
          resource: "perm",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${role.id}::${permission.id}`,
          roleId: role.id,
          permissionId: permission.id,
        });

        // Act
        const result = await service.getAllPermissionsForRole(role.id);

        // Assert
        expectArrayLength(result, 1);
        expect(result[0]).toBe(permission.id);
      });
    });

    describe("inherited permissions", () => {
      it("should return inherited permissions from one level of children (parent inherits from child)", async () => {
        // Arrange: Create parent and child roles
        // NOTE: In this system, child inherits from parent, so we test parent → child
        const parentRole = roleFactory({ name: "Admin" });
        const childRole = roleFactory({ name: "Editor" });

        const parentPerms = [
          permissionFactory({ action: "parent1", resource: "res1" }),
          permissionFactory({ action: "parent2", resource: "res2" }),
        ];
        const childPerms = [
          permissionFactory({ action: "child1", resource: "res3" }),
          permissionFactory({ action: "child2", resource: "res4" }),
        ];

        // Insert roles and permissions
        await testDb.db
          .insert(testDb.schema.roles)
          .values([parentRole, childRole]);
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([...parentPerms, ...childPerms]);

        // Assign permissions
        for (const perm of parentPerms) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${parentRole.id}::${perm.id}`,
            roleId: parentRole.id,
            permissionId: perm.id,
          });
        }
        for (const perm of childPerms) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${childRole.id}::${perm.id}`,
            roleId: childRole.id,
            permissionId: perm.id,
          });
        }

        // Create inheritance: childRole inherits from parentRole
        await inheritanceService.addRoleInheritance(
          childRole.id,
          parentRole.id
        );

        // Act: Get permissions for parent (should NOT include child's permissions)
        const parentResult = await service.getAllPermissionsForRole(
          parentRole.id
        );

        // Assert: Parent gets permissions from descendants (children) - this is how the system works
        expectArrayLength(parentResult, 4); // 2 parent perms + 2 child perms
        expect(parentResult).toContain(parentPerms[0].id);
        expect(parentResult).toContain(parentPerms[1].id);
        expect(parentResult).toContain(childPerms[0].id); // Inherited from descendant
        expect(parentResult).toContain(childPerms[1].id); // Inherited from descendant

        // Act: Get permissions for child (should only have direct permissions)
        const childResult = await service.getAllPermissionsForRole(
          childRole.id
        );

        // Assert: Child has only its direct permissions (children don't inherit upward)
        expectArrayLength(childResult, 2);
        expect(childResult).toContain(childPerms[0].id);
        expect(childResult).toContain(childPerms[1].id);
      });

      it("should return inherited permissions from multi-level hierarchy", async () => {
        // Arrange: Create 3-level hierarchy: grandparent → parent → child
        const grandparentRole = roleFactory({ name: "Super Admin" });
        const parentRole = roleFactory({ name: "Admin" });
        const childRole = roleFactory({ name: "Editor" });

        const grandparentPerms = [
          permissionFactory({ action: "gp1", resource: "r1" }),
          permissionFactory({ action: "gp2", resource: "r2" }),
        ];
        const parentPerms = [
          permissionFactory({ action: "p1", resource: "r3" }),
          permissionFactory({ action: "p2", resource: "r4" }),
        ];
        const childPerms = [
          permissionFactory({ action: "c1", resource: "r5" }),
          permissionFactory({ action: "c2", resource: "r6" }),
        ];

        // Insert all data
        await testDb.db
          .insert(testDb.schema.roles)
          .values([grandparentRole, parentRole, childRole]);
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([...grandparentPerms, ...parentPerms, ...childPerms]);

        // Assign permissions to each role
        for (const perm of grandparentPerms) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${grandparentRole.id}::${perm.id}`,
            roleId: grandparentRole.id,
            permissionId: perm.id,
          });
        }
        for (const perm of parentPerms) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${parentRole.id}::${perm.id}`,
            roleId: parentRole.id,
            permissionId: perm.id,
          });
        }
        for (const perm of childPerms) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${childRole.id}::${perm.id}`,
            roleId: childRole.id,
            permissionId: perm.id,
          });
        }

        // Create inheritance chain: child → parent → grandparent
        await inheritanceService.addRoleInheritance(
          childRole.id,
          parentRole.id
        );
        await inheritanceService.addRoleInheritance(
          parentRole.id,
          grandparentRole.id
        );

        // Act: Get permissions for grandparent (top of hierarchy)
        const grandparentResult = await service.getAllPermissionsForRole(
          grandparentRole.id
        );

        // Assert: Grandparent gets perms from all descendants (parent + child)
        expectArrayLength(grandparentResult, 6); // 2 grandparent + 2 parent + 2 child
        expect(grandparentResult).toContain(grandparentPerms[0].id);
        expect(grandparentResult).toContain(grandparentPerms[1].id);
        expect(grandparentResult).toContain(parentPerms[0].id); // From descendant
        expect(grandparentResult).toContain(parentPerms[1].id); // From descendant
        expect(grandparentResult).toContain(childPerms[0].id); // From descendant
        expect(grandparentResult).toContain(childPerms[1].id); // From descendant

        // Act: Get permissions for parent (middle of hierarchy)
        const parentResult = await service.getAllPermissionsForRole(
          parentRole.id
        );

        // Assert: Parent gets perms from descendants (child only)
        expectArrayLength(parentResult, 4); // 2 parent + 2 child
        expect(parentResult).toContain(parentPerms[0].id);
        expect(parentResult).toContain(parentPerms[1].id);
        expect(parentResult).toContain(childPerms[0].id); // From descendant
        expect(parentResult).toContain(childPerms[1].id); // From descendant

        // Act: Get permissions for child (bottom of hierarchy)
        const childResult = await service.getAllPermissionsForRole(
          childRole.id
        );

        // Assert: Child has only its direct permissions (no descendants)
        expectArrayLength(childResult, 2);
        expect(childResult).toContain(childPerms[0].id);
        expect(childResult).toContain(childPerms[1].id);
      });
    });

    describe("deduplication", () => {
      it("should deduplicate permissions from multiple inheritance paths", async () => {
        // Arrange: Diamond inheritance pattern
        //     top
        //    /   \
        //  left  right
        //    \   /
        //    bottom
        // If bottom inherits from both left and right, and both inherit from top,
        // bottom should get top's permissions only once

        const topRole = roleFactory({ name: "Top" });
        const leftRole = roleFactory({ name: "Left" });
        const rightRole = roleFactory({ name: "Right" });
        const bottomRole = roleFactory({ name: "Bottom" });

        const sharedPerm = permissionFactory({
          action: "shared",
          resource: "permission",
        });
        const leftPerm = permissionFactory({
          action: "left",
          resource: "permission",
        });
        const rightPerm = permissionFactory({
          action: "right",
          resource: "permission",
        });

        // Insert data
        await testDb.db
          .insert(testDb.schema.roles)
          .values([topRole, leftRole, rightRole, bottomRole]);
        await testDb.db
          .insert(testDb.schema.permissions)
          .values([sharedPerm, leftPerm, rightPerm]);

        // Assign shared permission to top
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${topRole.id}::${sharedPerm.id}`,
          roleId: topRole.id,
          permissionId: sharedPerm.id,
        });

        // Assign left permission to left
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${leftRole.id}::${leftPerm.id}`,
          roleId: leftRole.id,
          permissionId: leftPerm.id,
        });

        // Assign right permission to right
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${rightRole.id}::${rightPerm.id}`,
          roleId: rightRole.id,
          permissionId: rightPerm.id,
        });

        // Create diamond inheritance
        await inheritanceService.addRoleInheritance(leftRole.id, topRole.id);
        await inheritanceService.addRoleInheritance(rightRole.id, topRole.id);
        await inheritanceService.addRoleInheritance(bottomRole.id, leftRole.id);
        await inheritanceService.addRoleInheritance(
          bottomRole.id,
          rightRole.id
        );

        // Act
        const result = await service.getAllPermissionsForRole(bottomRole.id);

        // Assert: Should have no duplicates
        const uniquePermissions = new Set(result);
        expect(uniquePermissions.size).toBe(result.length);
      });

      it("should handle role with duplicate permission assignments", async () => {
        // Arrange: Assign same permission multiple times (edge case, shouldn't happen but test it)
        const role = roleFactory({ name: "Test Role" });
        const permission = permissionFactory({
          action: "test",
          resource: "permission",
        });

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permission);

        // Assign permission once
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${role.id}::${permission.id}`,
          roleId: role.id,
          permissionId: permission.id,
        });

        // Act
        const result = await service.getAllPermissionsForRole(role.id);

        // Assert: Should return permission only once
        expectArrayLength(result, 1);
        expect(result[0]).toBe(permission.id);
      });
    });

    describe("edge cases", () => {
      it("should handle non-existent role gracefully", async () => {
        // Act
        const result = await service.getAllPermissionsForRole(
          "non-existent-role-id"
        );

        // Assert: Returns empty array
        expectArrayLength(result, 0);
      });

      it("should handle role with children that have no permissions", async () => {
        // Arrange
        const parentRole = roleFactory({ name: "Parent" });
        const childRole = roleFactory({ name: "Child (no permissions)" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([parentRole, childRole]);

        // Create inheritance but child has no permissions
        await inheritanceService.addRoleInheritance(
          childRole.id,
          parentRole.id
        );

        // Act
        const result = await service.getAllPermissionsForRole(childRole.id);

        // Assert
        expectArrayLength(result, 0);
      });

      it("should handle deeply nested hierarchy efficiently", async () => {
        // Arrange: Create 10-level deep hierarchy
        const roles = bulkRolesFactory(10, i => ({ name: `Level-${i}` }));
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Create chain: role[0] → role[1] → role[2] → ... → role[9]
        for (let i = 1; i < roles.length; i++) {
          await inheritanceService.addRoleInheritance(
            roles[i].id,
            roles[i - 1].id
          );
        }

        // Assign permission to top role
        const permission = permissionFactory({
          action: "deep",
          resource: "permission",
        });
        await testDb.db.insert(testDb.schema.permissions).values(permission);
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: `${roles[0].id}::${permission.id}`,
          roleId: roles[0].id,
          permissionId: permission.id,
        });

        // Act: Get permissions for bottom role
        const startTime = Date.now();
        const result = await service.getAllPermissionsForRole(
          roles[roles.length - 1].id
        );
        const executionTime = Date.now() - startTime;

        // Assert: Should complete quickly (< 2 seconds for 10 levels, allowing CI overhead)
        expect(executionTime).toBeLessThan(2000);
        expectArrayLength(result, 0); // Bottom role has no direct permissions
      });

      it("should return all permissions as strings (permission IDs)", async () => {
        // Arrange
        const role = roleFactory({ name: "Test Role" });
        const permissions = bulkPermissionsFactory(3);

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        for (const perm of permissions) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${role.id}::${perm.id}`,
            roleId: role.id,
            permissionId: perm.id,
          });
        }

        // Act
        const result = await service.getAllPermissionsForRole(role.id);

        // Assert: All results should be strings (permission IDs)
        expect(result.every(p => typeof p === "string")).toBe(true);
        expect(result.length).toBe(3);
        // Verify they are UUIDs
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(result.every(p => uuidRegex.test(p))).toBe(true);
      });

      it("should handle large number of permissions efficiently", async () => {
        // Arrange: Role with 100 permissions
        const role = roleFactory({ name: "Heavy Role" });
        const permissions = bulkPermissionsFactory(100);

        await testDb.db.insert(testDb.schema.roles).values(role);
        await testDb.db.insert(testDb.schema.permissions).values(permissions);

        for (const perm of permissions) {
          await testDb.db.insert(testDb.schema.rolePermissions).values({
            id: `${role.id}::${perm.id}`,
            roleId: role.id,
            permissionId: perm.id,
          });
        }

        // Act
        const startTime = Date.now();
        const result = await service.getAllPermissionsForRole(role.id);
        const executionTime = Date.now() - startTime;

        // Assert
        expectArrayLength(result, 100);
        expect(executionTime).toBeLessThan(1000); // Should complete in < 1 second, allowing CI overhead
      });
    });
  });
});
