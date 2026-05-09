import { describe, expect, it } from "vitest";

import { hasAllRoles, hasAnyRole, hasRole, type SessionUser } from "../session";

describe("session utility functions", () => {
  // Helper function to create mock SessionUser (uses roleIds per new schema)
  const createUser = (roleIds: string[]): SessionUser => ({
    id: "user-123",
    email: "user@example.com",
    name: "Test User",
    image: null,
    roleIds,
  });

  describe("hasRole()", () => {
    describe("basic functionality", () => {
      it("should return true when user has the role", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasRole(user, "admin");

        expect(result).toBe(true);
      });

      it("should return false when user doesn't have the role", () => {
        const user = createUser(["editor", "viewer"]);

        const result = hasRole(user, "admin");

        expect(result).toBe(false);
      });

      it("should return false when user has empty roles array", () => {
        const user = createUser([]);

        const result = hasRole(user, "admin");

        expect(result).toBe(false);
      });

      it("should handle case-sensitive role matching", () => {
        const user = createUser(["Admin", "Editor"]);

        const resultExactMatch = hasRole(user, "Admin");
        const resultWrongCase = hasRole(user, "admin");

        expect(resultExactMatch).toBe(true);
        expect(resultWrongCase).toBe(false);
      });

      it("should return true when role exists anywhere in array", () => {
        const user = createUser(["viewer", "editor", "admin", "moderator"]);

        const firstRole = hasRole(user, "viewer");
        const middleRole = hasRole(user, "editor");
        const lastRole = hasRole(user, "moderator");

        expect(firstRole).toBe(true);
        expect(middleRole).toBe(true);
        expect(lastRole).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should handle roles with special characters", () => {
        const user = createUser(["admin:super", "editor-chief", "user_basic"]);

        const hasColon = hasRole(user, "admin:super");
        const hasDash = hasRole(user, "editor-chief");
        const hasUnderscore = hasRole(user, "user_basic");

        expect(hasColon).toBe(true);
        expect(hasDash).toBe(true);
        expect(hasUnderscore).toBe(true);
      });

      it("should handle roles with spaces", () => {
        const user = createUser(["super admin", "content editor"]);

        const result = hasRole(user, "super admin");

        expect(result).toBe(true);
      });

      it("should handle empty string role check", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasRole(user, "");

        expect(result).toBe(false);
      });

      it("should handle user with duplicate roles", () => {
        const user = createUser(["admin", "editor", "admin"]); // duplicate

        const result = hasRole(user, "admin");

        expect(result).toBe(true);
      });
    });
  });

  describe("hasAnyRole()", () => {
    describe("basic functionality", () => {
      it("should return true when user has one of the roles", () => {
        const user = createUser(["editor", "viewer"]);

        const result = hasAnyRole(user, ["admin", "editor", "moderator"]);

        expect(result).toBe(true);
      });

      it("should return true when user has multiple specified roles", () => {
        const user = createUser(["admin", "editor", "moderator"]);

        const result = hasAnyRole(user, ["admin", "editor"]);

        expect(result).toBe(true);
      });

      it("should return false when user has none of the roles", () => {
        const user = createUser(["viewer", "guest"]);

        const result = hasAnyRole(user, ["admin", "editor", "moderator"]);

        expect(result).toBe(false);
      });

      it("should return false with empty roles parameter", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasAnyRole(user, []);

        expect(result).toBe(false);
      });

      it("should return false when user has empty roles array", () => {
        const user = createUser([]);

        const result = hasAnyRole(user, ["admin", "editor"]);

        expect(result).toBe(false);
      });

      it("should handle single role in array", () => {
        const user = createUser(["editor"]);

        const resultMatch = hasAnyRole(user, ["editor"]);
        const resultNoMatch = hasAnyRole(user, ["admin"]);

        expect(resultMatch).toBe(true);
        expect(resultNoMatch).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should return true if user has first role in list", () => {
        const user = createUser(["admin"]);

        const result = hasAnyRole(user, ["admin", "editor", "viewer"]);

        expect(result).toBe(true);
      });

      it("should return true if user has last role in list", () => {
        const user = createUser(["viewer"]);

        const result = hasAnyRole(user, ["admin", "editor", "viewer"]);

        expect(result).toBe(true);
      });

      it("should return true if user has middle role in list", () => {
        const user = createUser(["editor"]);

        const result = hasAnyRole(user, ["admin", "editor", "viewer"]);

        expect(result).toBe(true);
      });

      it("should handle duplicate roles in request", () => {
        const user = createUser(["editor"]);

        const result = hasAnyRole(user, ["admin", "editor", "editor"]);

        expect(result).toBe(true);
      });

      it("should be case-sensitive", () => {
        const user = createUser(["Admin"]);

        const resultMatch = hasAnyRole(user, ["Admin", "Editor"]);
        const resultNoMatch = hasAnyRole(user, ["admin", "editor"]);

        expect(resultMatch).toBe(true);
        expect(resultNoMatch).toBe(false);
      });

      it("should handle roles with special characters", () => {
        const user = createUser(["admin:super", "user_basic"]);

        const result = hasAnyRole(user, [
          "editor-chief",
          "admin:super",
          "moderator",
        ]);

        expect(result).toBe(true);
      });
    });
  });

  describe("hasAllRoles()", () => {
    describe("basic functionality", () => {
      it("should return true when user has all specified roles", () => {
        const user = createUser(["admin", "editor", "moderator", "viewer"]);

        const result = hasAllRoles(user, ["admin", "editor"]);

        expect(result).toBe(true);
      });

      it("should return false when user is missing one role", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasAllRoles(user, ["admin", "editor", "moderator"]);

        expect(result).toBe(false);
      });

      it("should return false when user is missing all roles", () => {
        const user = createUser(["viewer", "guest"]);

        const result = hasAllRoles(user, ["admin", "editor", "moderator"]);

        expect(result).toBe(false);
      });

      it("should return true with empty roles parameter", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasAllRoles(user, []);

        expect(result).toBe(true);
      });

      it("should return false when user has empty roles array and roles requested", () => {
        const user = createUser([]);

        const result = hasAllRoles(user, ["admin"]);

        expect(result).toBe(false);
      });

      it("should handle single role in array", () => {
        const user = createUser(["editor"]);

        const resultMatch = hasAllRoles(user, ["editor"]);
        const resultNoMatch = hasAllRoles(user, ["admin"]);

        expect(resultMatch).toBe(true);
        expect(resultNoMatch).toBe(false);
      });

      it("should return true when requesting exact roles user has", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasAllRoles(user, ["admin", "editor"]);

        expect(result).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should handle duplicate roles in request", () => {
        const user = createUser(["admin", "editor"]);

        const result = hasAllRoles(user, ["admin", "admin", "editor"]);

        expect(result).toBe(true);
      });

      it("should be case-sensitive", () => {
        const user = createUser(["Admin", "Editor"]);

        const resultMatch = hasAllRoles(user, ["Admin", "Editor"]);
        const resultNoMatch = hasAllRoles(user, ["admin", "editor"]);

        expect(resultMatch).toBe(true);
        expect(resultNoMatch).toBe(false);
      });

      it("should handle roles with special characters", () => {
        const user = createUser(["admin:super", "editor-chief", "user_basic"]);

        const result = hasAllRoles(user, ["admin:super", "editor-chief"]);

        expect(result).toBe(true);
      });

      it("should return false if user has some but not all roles", () => {
        const user = createUser(["admin", "viewer"]);

        const result = hasAllRoles(user, ["admin", "editor", "moderator"]);

        expect(result).toBe(false);
      });

      it("should handle order independence", () => {
        const user = createUser(["admin", "editor", "moderator"]);

        const result1 = hasAllRoles(user, ["admin", "editor", "moderator"]);
        const result2 = hasAllRoles(user, ["moderator", "admin", "editor"]);
        const result3 = hasAllRoles(user, ["editor", "moderator", "admin"]);

        expect(result1).toBe(true);
        expect(result2).toBe(true);
        expect(result3).toBe(true);
      });
    });
  });

  describe("integration scenarios", () => {
    it("should correctly evaluate admin-only access", () => {
      const admin = createUser(["admin", "editor"]);
      const editor = createUser(["editor"]);
      const viewer = createUser(["viewer"]);

      // Act & Assert: Only admin should have admin role
      expect(hasRole(admin, "admin")).toBe(true);
      expect(hasRole(editor, "admin")).toBe(false);
      expect(hasRole(viewer, "admin")).toBe(false);
    });

    it("should correctly evaluate multi-role requirements", () => {
      // Arrange: User needs both admin AND editor roles
      const superUser = createUser(["admin", "editor", "moderator"]);
      const adminOnly = createUser(["admin"]);
      const editorOnly = createUser(["editor"]);

      // Act & Assert: Only superUser has both
      expect(hasAllRoles(superUser, ["admin", "editor"])).toBe(true);
      expect(hasAllRoles(adminOnly, ["admin", "editor"])).toBe(false);
      expect(hasAllRoles(editorOnly, ["admin", "editor"])).toBe(false);
    });

    it("should correctly evaluate OR conditions for access", () => {
      // Arrange: User needs admin OR editor OR moderator
      const admin = createUser(["admin"]);
      const editor = createUser(["editor"]);
      const viewer = createUser(["viewer"]);

      const allowedRoles = ["admin", "editor", "moderator"];

      // Act & Assert
      expect(hasAnyRole(admin, allowedRoles)).toBe(true);
      expect(hasAnyRole(editor, allowedRoles)).toBe(true);
      expect(hasAnyRole(viewer, allowedRoles)).toBe(false);
    });

    it("should handle complex role hierarchy checks", () => {
      // Arrange: Different user types
      const superAdmin = createUser(["super-admin", "admin", "editor"]);
      const admin = createUser(["admin", "editor"]);
      const editor = createUser(["editor"]);

      // Act & Assert: Hierarchical checks
      // Super admin has everything
      expect(hasAllRoles(superAdmin, ["super-admin", "admin", "editor"])).toBe(
        true
      );
      expect(hasAnyRole(superAdmin, ["super-admin"])).toBe(true);

      // Admin has admin + editor
      expect(hasAllRoles(admin, ["admin", "editor"])).toBe(true);
      expect(hasRole(admin, "super-admin")).toBe(false);

      // Editor only has editor
      expect(hasRole(editor, "editor")).toBe(true);
      expect(hasAnyRole(editor, ["admin", "super-admin"])).toBe(false);
    });

    it("should handle real-world permission scenarios", () => {
      // Arrange: Content management system roles
      const contentManager = createUser([
        "content:create",
        "content:edit",
        "content:delete",
      ]);
      const contentEditor = createUser(["content:edit", "content:view"]);
      const contentViewer = createUser(["content:view"]);

      // Act & Assert: Content manager can do everything
      expect(
        hasAllRoles(contentManager, [
          "content:create",
          "content:edit",
          "content:delete",
        ])
      ).toBe(true);

      // Editor can edit but not delete
      expect(hasRole(contentEditor, "content:edit")).toBe(true);
      expect(hasRole(contentEditor, "content:delete")).toBe(false);

      // Viewer can only view
      expect(hasRole(contentViewer, "content:view")).toBe(true);
      expect(
        hasAnyRole(contentViewer, ["content:edit", "content:delete"])
      ).toBe(false);
    });

    it("should validate empty role scenarios", () => {
      const userWithRoles = createUser(["admin"]);
      const userWithoutRoles = createUser([]);

      // Act & Assert: Empty checks
      expect(hasAnyRole(userWithRoles, [])).toBe(false);
      expect(hasAllRoles(userWithRoles, [])).toBe(true);
      expect(hasAnyRole(userWithoutRoles, ["admin"])).toBe(false);
      expect(hasAllRoles(userWithoutRoles, [])).toBe(true);
    });
  });
});
