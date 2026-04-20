import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestDb, type TestDb } from "../../__tests__/fixtures/db";
import { roleFactory, bulkRolesFactory } from "../../__tests__/fixtures/roles";
import { expectArrayLength } from "../../__tests__/utils/assertions";

import { RoleInheritanceService } from "./role-inheritance-service";

describe("RoleInheritanceService", () => {
  let testDb: TestDb;
  let service: RoleInheritanceService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new RoleInheritanceService(testDb.db, testDb.schema);
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  describe("addRoleInheritance()", () => {
    describe("valid relationships", () => {
      it("should create valid parent-child relationship", async () => {
        // Arrange
        const parentRole = roleFactory({ name: "Admin" });
        const childRole = roleFactory({ name: "Editor" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([parentRole, childRole]);

        // Act
        await service.addRoleInheritance(childRole.id, parentRole.id);

        // Assert: Verify relationship was created
        const relationships = await testDb.db.query.roleInherits.findMany({
          where: (roleInherits, { eq }) =>
            eq(roleInherits.childRoleId, childRole.id),
        });

        expect(relationships).toHaveLength(1);
        expect(relationships[0].parentRoleId).toBe(parentRole.id);
        expect(relationships[0].childRoleId).toBe(childRole.id);
      });

      it("should allow multi-level hierarchy (grandparent-parent-child)", async () => {
        // Arrange
        const grandparent = roleFactory({ name: "Super Admin" });
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([grandparent, parent, child]);

        // Act: Create 3-level hierarchy
        await service.addRoleInheritance(parent.id, grandparent.id);
        await service.addRoleInheritance(child.id, parent.id);

        // Assert: Verify both relationships exist
        const allRelationships = await testDb.db.query.roleInherits.findMany();
        expectArrayLength(allRelationships, 2);

        const parentToGrandparent = allRelationships.find(
          r => r.childRoleId === parent.id
        );
        const childToParent = allRelationships.find(
          r => r.childRoleId === child.id
        );

        expect(parentToGrandparent).toBeDefined();
        expect(parentToGrandparent!.parentRoleId).toBe(grandparent.id);

        expect(childToParent).toBeDefined();
        expect(childToParent!.parentRoleId).toBe(parent.id);
      });

      it("should allow multiple parents (diamond inheritance)", async () => {
        // Arrange: Create diamond pattern
        //     top
        //    /   \
        //  left  right
        //    \   /
        //    bottom
        const top = roleFactory({ name: "Top" });
        const left = roleFactory({ name: "Left" });
        const right = roleFactory({ name: "Right" });
        const bottom = roleFactory({ name: "Bottom" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([top, left, right, bottom]);

        // Act: Create diamond
        await service.addRoleInheritance(left.id, top.id);
        await service.addRoleInheritance(right.id, top.id);
        await service.addRoleInheritance(bottom.id, left.id);
        await service.addRoleInheritance(bottom.id, right.id);

        // Assert: Bottom should have 2 parents
        const bottomRelationships = await testDb.db.query.roleInherits.findMany(
          {
            where: (roleInherits, { eq }) =>
              eq(roleInherits.childRoleId, bottom.id),
          }
        );

        expectArrayLength(bottomRelationships, 2);
        const parentIds = bottomRelationships.map(r => r.parentRoleId);
        expect(parentIds).toContain(left.id);
        expect(parentIds).toContain(right.id);
      });
    });

    describe("duplicate prevention", () => {
      it("should prevent duplicate relationships", async () => {
        // Arrange
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db.insert(testDb.schema.roles).values([parent, child]);

        // Act: Try to add same relationship twice
        await service.addRoleInheritance(child.id, parent.id);
        await service.addRoleInheritance(child.id, parent.id); // Should not throw

        // Assert: Should only have one relationship
        const relationships = await testDb.db.query.roleInherits.findMany({
          where: (roleInherits, { eq }) =>
            eq(roleInherits.childRoleId, child.id),
        });

        expectArrayLength(relationships, 1);
      });
    });

    describe("cycle detection", () => {
      it("should prevent self-inheritance (role inheriting from itself)", async () => {
        // Arrange
        const role = roleFactory({ name: "Admin" });
        await testDb.db.insert(testDb.schema.roles).values(role);

        // Act & Assert: Should throw error
        await expect(
          service.addRoleInheritance(role.id, role.id)
        ).rejects.toThrow("INHERIT_SELF_FORBIDDEN");
      });

      it("should prevent direct cycle (A → B → A)", async () => {
        // Arrange
        const roleA = roleFactory({ name: "Role A" });
        const roleB = roleFactory({ name: "Role B" });

        await testDb.db.insert(testDb.schema.roles).values([roleA, roleB]);

        // Create A → B
        await service.addRoleInheritance(roleB.id, roleA.id);

        // Act & Assert: Try to create B → A (would create cycle)
        await expect(
          service.addRoleInheritance(roleA.id, roleB.id)
        ).rejects.toThrow("INHERIT_CYCLE_FORBIDDEN");
      });

      it("should prevent indirect cycle (A → B → C → A)", async () => {
        // Arrange
        const roleA = roleFactory({ name: "Role A" });
        const roleB = roleFactory({ name: "Role B" });
        const roleC = roleFactory({ name: "Role C" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([roleA, roleB, roleC]);

        // Create chain: A → B → C
        await service.addRoleInheritance(roleB.id, roleA.id);
        await service.addRoleInheritance(roleC.id, roleB.id);

        // Act & Assert: Try to create C → A (would create cycle)
        await expect(
          service.addRoleInheritance(roleA.id, roleC.id)
        ).rejects.toThrow("INHERIT_CYCLE_FORBIDDEN");
      });

      it("should prevent cycle in complex hierarchy", async () => {
        // Arrange: Create complex hierarchy
        //     A
        //    / \
        //   B   C
        //   |   |
        //   D   E
        //    \ /
        //     F
        const roles = ["A", "B", "C", "D", "E", "F"].map(name =>
          roleFactory({ name: `Role ${name}` })
        );
        const [A, B, C, D, E, F] = roles;

        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Create hierarchy
        await service.addRoleInheritance(B.id, A.id);
        await service.addRoleInheritance(C.id, A.id);
        await service.addRoleInheritance(D.id, B.id);
        await service.addRoleInheritance(E.id, C.id);
        await service.addRoleInheritance(F.id, D.id);
        await service.addRoleInheritance(F.id, E.id);

        // Act & Assert: Try to create F → A (would create cycle through multiple paths)
        await expect(service.addRoleInheritance(A.id, F.id)).rejects.toThrow(
          "INHERIT_CYCLE_FORBIDDEN"
        );
      });
    });
  });

  describe("removeRoleInheritance()", () => {
    it("should remove existing relationship", async () => {
      // Arrange
      const parent = roleFactory({ name: "Admin" });
      const child = roleFactory({ name: "Editor" });

      await testDb.db.insert(testDb.schema.roles).values([parent, child]);
      await service.addRoleInheritance(child.id, parent.id);

      // Verify it exists
      let relationships = await testDb.db.query.roleInherits.findMany({
        where: (roleInherits, { eq }) => eq(roleInherits.childRoleId, child.id),
      });
      expect(relationships).toHaveLength(1);

      // Act: Remove relationship
      await service.removeRoleInheritance(child.id, parent.id);

      // Assert: Relationship should be gone
      relationships = await testDb.db.query.roleInherits.findMany({
        where: (roleInherits, { eq }) => eq(roleInherits.childRoleId, child.id),
      });
      expect(relationships).toHaveLength(0);
    });

    it("should handle non-existent relationship gracefully", async () => {
      // Arrange
      const parent = roleFactory({ name: "Admin" });
      const child = roleFactory({ name: "Editor" });

      await testDb.db.insert(testDb.schema.roles).values([parent, child]);

      // Act & Assert: Should not throw even though relationship doesn't exist
      await expect(
        service.removeRoleInheritance(child.id, parent.id)
      ).resolves.not.toThrow();
    });

    it("should only remove specified relationship (not affect others)", async () => {
      // Arrange: Child has two parents
      const parent1 = roleFactory({ name: "Admin" });
      const parent2 = roleFactory({ name: "Manager" });
      const child = roleFactory({ name: "Editor" });

      await testDb.db
        .insert(testDb.schema.roles)
        .values([parent1, parent2, child]);

      await service.addRoleInheritance(child.id, parent1.id);
      await service.addRoleInheritance(child.id, parent2.id);

      // Act: Remove only one relationship
      await service.removeRoleInheritance(child.id, parent1.id);

      // Assert: Other relationship should remain
      const relationships = await testDb.db.query.roleInherits.findMany({
        where: (roleInherits, { eq }) => eq(roleInherits.childRoleId, child.id),
      });

      expect(relationships).toHaveLength(1);
      expect(relationships[0].parentRoleId).toBe(parent2.id);
    });
  });

  describe("listAncestorRoles()", () => {
    describe("basic ancestry", () => {
      it("should return direct parent only for one-level hierarchy", async () => {
        // Arrange
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db.insert(testDb.schema.roles).values([parent, child]);
        await service.addRoleInheritance(child.id, parent.id);

        // Act
        const ancestors = await service.listAncestorRoles(child.id);

        // Assert
        expectArrayLength(ancestors, 1);
        expect(ancestors).toContain(parent.id);
      });

      it("should return all ancestors for multi-level hierarchy", async () => {
        // Arrange: Create 4-level hierarchy
        const greatGrandparent = roleFactory({ name: "Super Admin" });
        const grandparent = roleFactory({ name: "Admin" });
        const parent = roleFactory({ name: "Manager" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([greatGrandparent, grandparent, parent, child]);

        // Create chain: child → parent → grandparent → greatGrandparent
        await service.addRoleInheritance(child.id, parent.id);
        await service.addRoleInheritance(parent.id, grandparent.id);
        await service.addRoleInheritance(grandparent.id, greatGrandparent.id);

        // Act
        const ancestors = await service.listAncestorRoles(child.id);

        // Assert: Should include all 3 ancestors
        expectArrayLength(ancestors, 3);
        expect(ancestors).toContain(parent.id);
        expect(ancestors).toContain(grandparent.id);
        expect(ancestors).toContain(greatGrandparent.id);
      });

      it("should return empty array for root role (no parents)", async () => {
        // Arrange
        const rootRole = roleFactory({ name: "Super Admin" });
        await testDb.db.insert(testDb.schema.roles).values(rootRole);

        // Act
        const ancestors = await service.listAncestorRoles(rootRole.id);

        // Assert
        expectArrayLength(ancestors, 0);
      });

      it("should NOT include the starting role in results", async () => {
        // Arrange
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db.insert(testDb.schema.roles).values([parent, child]);
        await service.addRoleInheritance(child.id, parent.id);

        // Act
        const ancestors = await service.listAncestorRoles(child.id);

        // Assert: Should not include child itself
        expect(ancestors).not.toContain(child.id);
      });
    });

    describe("multiple inheritance paths", () => {
      it("should handle diamond inheritance (deduplicate shared ancestors)", async () => {
        // Arrange: Diamond pattern
        //     top
        //    /   \
        //  left  right
        //    \   /
        //    bottom
        const top = roleFactory({ name: "Top" });
        const left = roleFactory({ name: "Left" });
        const right = roleFactory({ name: "Right" });
        const bottom = roleFactory({ name: "Bottom" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([top, left, right, bottom]);

        await service.addRoleInheritance(left.id, top.id);
        await service.addRoleInheritance(right.id, top.id);
        await service.addRoleInheritance(bottom.id, left.id);
        await service.addRoleInheritance(bottom.id, right.id);

        // Act
        const ancestors = await service.listAncestorRoles(bottom.id);

        // Assert: Should include left, right, and top (deduplicated)
        expectArrayLength(ancestors, 3);
        expect(ancestors).toContain(left.id);
        expect(ancestors).toContain(right.id);
        expect(ancestors).toContain(top.id);

        // Verify top is not duplicated
        const topCount = ancestors.filter(id => id === top.id).length;
        expect(topCount).toBe(1);
      });

      it("should handle complex graph with multiple paths to same ancestor", async () => {
        // Arrange: Create web of relationships
        const roles = bulkRolesFactory(6, i => ({ name: `Role-${i}` }));
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Create multiple paths from role[5] to role[0]
        // Path 1: 5 → 3 → 1 → 0
        // Path 2: 5 → 4 → 2 → 0
        // Path 3: 5 → 3 → 2 → 0 (another path)
        await service.addRoleInheritance(roles[5].id, roles[3].id);
        await service.addRoleInheritance(roles[5].id, roles[4].id);
        await service.addRoleInheritance(roles[3].id, roles[1].id);
        await service.addRoleInheritance(roles[3].id, roles[2].id);
        await service.addRoleInheritance(roles[4].id, roles[2].id);
        await service.addRoleInheritance(roles[1].id, roles[0].id);
        await service.addRoleInheritance(roles[2].id, roles[0].id);

        // Act
        const ancestors = await service.listAncestorRoles(roles[5].id);

        // Assert: All ancestors deduplicated
        expect(ancestors.length).toBeGreaterThan(0);
        const uniqueAncestors = new Set(ancestors);
        expect(uniqueAncestors.size).toBe(ancestors.length); // No duplicates
      });
    });

    describe("edge cases", () => {
      it("should handle non-existent role gracefully", async () => {
        // Act
        const ancestors = await service.listAncestorRoles(
          "non-existent-role-id"
        );

        // Assert
        expectArrayLength(ancestors, 0);
      });

      it("should handle deeply nested hierarchy efficiently (10 levels)", async () => {
        // Arrange: Create 10-level deep hierarchy
        const roles = bulkRolesFactory(10, i => ({ name: `Level-${i}` }));
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Create chain: role[9] → role[8] → ... → role[0]
        for (let i = 9; i > 0; i--) {
          await service.addRoleInheritance(roles[i].id, roles[i - 1].id);
        }

        // Act
        const startTime = Date.now();
        const ancestors = await service.listAncestorRoles(roles[9].id);
        const executionTime = Date.now() - startTime;

        // Assert
        expectArrayLength(ancestors, 9); // All 9 ancestors
        expect(executionTime).toBeLessThan(2000); // Should complete quickly, allowing CI overhead
      });
    });
  });

  describe("listDescendantRoles()", () => {
    describe("basic descendants", () => {
      it("should return direct children only for one-level hierarchy", async () => {
        // Arrange
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db.insert(testDb.schema.roles).values([parent, child]);
        await service.addRoleInheritance(child.id, parent.id);

        // Act
        const descendants = await service.listDescendantRoles(parent.id);

        // Assert
        expectArrayLength(descendants, 1);
        expect(descendants).toContain(child.id);
      });

      it("should return all descendants for multi-level hierarchy", async () => {
        // Arrange: Create 4-level hierarchy
        const greatGrandparent = roleFactory({ name: "Super Admin" });
        const grandparent = roleFactory({ name: "Admin" });
        const parent = roleFactory({ name: "Manager" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([greatGrandparent, grandparent, parent, child]);

        // Create chain: greatGrandparent → grandparent → parent → child
        await service.addRoleInheritance(grandparent.id, greatGrandparent.id);
        await service.addRoleInheritance(parent.id, grandparent.id);
        await service.addRoleInheritance(child.id, parent.id);

        // Act
        const descendants = await service.listDescendantRoles(
          greatGrandparent.id
        );

        // Assert: Should include all 3 descendants
        expectArrayLength(descendants, 3);
        expect(descendants).toContain(grandparent.id);
        expect(descendants).toContain(parent.id);
        expect(descendants).toContain(child.id);
      });

      it("should return empty array for leaf role (no children)", async () => {
        // Arrange
        const leafRole = roleFactory({ name: "Viewer" });
        await testDb.db.insert(testDb.schema.roles).values(leafRole);

        // Act
        const descendants = await service.listDescendantRoles(leafRole.id);

        // Assert
        expectArrayLength(descendants, 0);
      });

      it("should NOT include the starting role in results", async () => {
        // Arrange
        const parent = roleFactory({ name: "Admin" });
        const child = roleFactory({ name: "Editor" });

        await testDb.db.insert(testDb.schema.roles).values([parent, child]);
        await service.addRoleInheritance(child.id, parent.id);

        // Act
        const descendants = await service.listDescendantRoles(parent.id);

        // Assert: Should not include parent itself
        expect(descendants).not.toContain(parent.id);
      });
    });

    describe("multiple children", () => {
      it("should return all children when role has multiple children", async () => {
        // Arrange: One parent with 3 children
        const parent = roleFactory({ name: "Admin" });
        const child1 = roleFactory({ name: "Editor" });
        const child2 = roleFactory({ name: "Moderator" });
        const child3 = roleFactory({ name: "Reviewer" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([parent, child1, child2, child3]);

        await service.addRoleInheritance(child1.id, parent.id);
        await service.addRoleInheritance(child2.id, parent.id);
        await service.addRoleInheritance(child3.id, parent.id);

        // Act
        const descendants = await service.listDescendantRoles(parent.id);

        // Assert
        expectArrayLength(descendants, 3);
        expect(descendants).toContain(child1.id);
        expect(descendants).toContain(child2.id);
        expect(descendants).toContain(child3.id);
      });

      it("should handle diamond pattern (deduplicate shared descendants)", async () => {
        // Arrange: Diamond pattern
        //     top
        //    /   \
        //  left  right
        //    \   /
        //    bottom
        const top = roleFactory({ name: "Top" });
        const left = roleFactory({ name: "Left" });
        const right = roleFactory({ name: "Right" });
        const bottom = roleFactory({ name: "Bottom" });

        await testDb.db
          .insert(testDb.schema.roles)
          .values([top, left, right, bottom]);

        await service.addRoleInheritance(left.id, top.id);
        await service.addRoleInheritance(right.id, top.id);
        await service.addRoleInheritance(bottom.id, left.id);
        await service.addRoleInheritance(bottom.id, right.id);

        // Act
        const descendants = await service.listDescendantRoles(top.id);

        // Assert: Should include left, right, and bottom (deduplicated)
        expectArrayLength(descendants, 3);
        expect(descendants).toContain(left.id);
        expect(descendants).toContain(right.id);
        expect(descendants).toContain(bottom.id);

        // Verify bottom is not duplicated
        const bottomCount = descendants.filter(id => id === bottom.id).length;
        expect(bottomCount).toBe(1);
      });
    });

    describe("edge cases", () => {
      it("should handle non-existent role gracefully", async () => {
        // Act
        const descendants = await service.listDescendantRoles(
          "non-existent-role-id"
        );

        // Assert
        expectArrayLength(descendants, 0);
      });

      it("should handle deeply nested hierarchy efficiently (10 levels)", async () => {
        // Arrange: Create 10-level deep hierarchy
        const roles = bulkRolesFactory(10, i => ({ name: `Level-${i}` }));
        await testDb.db.insert(testDb.schema.roles).values(roles);

        // Create chain: role[0] → role[1] → ... → role[9]
        for (let i = 1; i < 10; i++) {
          await service.addRoleInheritance(roles[i].id, roles[i - 1].id);
        }

        // Act
        const startTime = Date.now();
        const descendants = await service.listDescendantRoles(roles[0].id);
        const executionTime = Date.now() - startTime;

        // Assert
        expectArrayLength(descendants, 9); // All 9 descendants
        expect(executionTime).toBeLessThan(2000); // Should complete quickly, allowing CI overhead
      });
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete role hierarchy lifecycle", async () => {
      // Arrange
      const superAdmin = roleFactory({ name: "Super Admin" });
      const admin = roleFactory({ name: "Admin" });
      const editor = roleFactory({ name: "Editor" });

      await testDb.db
        .insert(testDb.schema.roles)
        .values([superAdmin, admin, editor]);

      // Act: Build hierarchy
      await service.addRoleInheritance(admin.id, superAdmin.id);
      await service.addRoleInheritance(editor.id, admin.id);

      // Verify ancestors of editor
      let ancestors = await service.listAncestorRoles(editor.id);
      expectArrayLength(ancestors, 2);

      // Verify descendants of superAdmin
      let descendants = await service.listDescendantRoles(superAdmin.id);
      expectArrayLength(descendants, 2);

      // Act: Remove middle relationship
      await service.removeRoleInheritance(editor.id, admin.id);

      // Verify ancestors of editor (should only have direct parent now)
      ancestors = await service.listAncestorRoles(editor.id);
      expectArrayLength(ancestors, 0); // No parents anymore

      // Verify descendants of superAdmin (should still have admin)
      descendants = await service.listDescendantRoles(superAdmin.id);
      expectArrayLength(descendants, 1);
      expect(descendants).toContain(admin.id);
    });

    it("should handle role with both ancestors and descendants", async () => {
      // Arrange: Middle role in hierarchy
      const top = roleFactory({ name: "Top" });
      const middle = roleFactory({ name: "Middle" });
      const bottom = roleFactory({ name: "Bottom" });

      await testDb.db.insert(testDb.schema.roles).values([top, middle, bottom]);

      await service.addRoleInheritance(middle.id, top.id);
      await service.addRoleInheritance(bottom.id, middle.id);

      // Act
      const ancestors = await service.listAncestorRoles(middle.id);
      const descendants = await service.listDescendantRoles(middle.id);

      // Assert
      expectArrayLength(ancestors, 1);
      expect(ancestors).toContain(top.id);

      expectArrayLength(descendants, 1);
      expect(descendants).toContain(bottom.id);
    });
  });

  describe("edge cases and boundary conditions", () => {
    it("should handle removing non-existent relationship gracefully", async () => {
      // Arrange: Two roles with no relationship
      const role1 = roleFactory({ name: "Role 1" });
      const role2 = roleFactory({ name: "Role 2" });

      await testDb.db.insert(testDb.schema.roles).values([role1, role2]);

      // Act: Try to remove relationship that doesn't exist (should not throw)
      await expect(
        service.removeRoleInheritance(role1.id, role2.id)
      ).resolves.not.toThrow();

      // Assert: No relationships exist
      const relationships = await testDb.db.query.roleInherits.findMany();
      expectArrayLength(relationships, 0);
    });

    it("should list ancestors/descendants for isolated role (no relationships)", async () => {
      // Arrange: Single role with no relationships
      const isolatedRole = roleFactory({ name: "Isolated" });
      await testDb.db.insert(testDb.schema.roles).values(isolatedRole);

      // Act
      const ancestors = await service.listAncestorRoles(isolatedRole.id);
      const descendants = await service.listDescendantRoles(isolatedRole.id);

      // Assert: Both should be empty
      expectArrayLength(ancestors, 0);
      expectArrayLength(descendants, 0);
    });

    it("should handle adding same relationship multiple times (idempotent)", async () => {
      // Arrange
      const parent = roleFactory({ name: "Parent" });
      const child = roleFactory({ name: "Child" });

      await testDb.db.insert(testDb.schema.roles).values([parent, child]);

      // Act: Add same relationship 3 times
      await service.addRoleInheritance(child.id, parent.id);
      await service.addRoleInheritance(child.id, parent.id);
      await service.addRoleInheritance(child.id, parent.id);

      // Assert: Should only have one relationship (idempotent)
      const relationships = await testDb.db.query.roleInherits.findMany({
        where: (roleInherits, { eq }) => eq(roleInherits.childRoleId, child.id),
      });

      expectArrayLength(relationships, 1);
      expect(relationships[0].parentRoleId).toBe(parent.id);
    });
  });
});
