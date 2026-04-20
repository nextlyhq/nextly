import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../__tests__/fixtures/db";
import { listRoleSlugsForUser } from "../lib/permissions";
import type { Logger } from "../shared";

import {
  ApiKeyService,
  invalidateApiKeyPermissionsCache,
} from "./api-key-service";

// Mock listRoleSlugsForUser — it uses a global db singleton (not the test DB).
// We must mock it so tests do not depend on the runtime database connection.
vi.mock("../lib/permissions", () => ({
  listRoleSlugsForUser: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Create a minimal DrizzleAdapter mock that delegates raw Drizzle calls to
 * the provided in-memory SQLite database.  ApiKeyService accesses the DB via
 * `this.db` (set from adapter.getDrizzle()) and switches schema tables based
 * on `this.dialect` (from adapter.getCapabilities().dialect).
 */
function createTestAdapter(db: unknown) {
  return {
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  } as any;  
}

// Key IDs used across tests — kept as constants so afterEach can evict them
// from the module-level permissions cache without over-clearing.
const KEY_A = "test-key-a";
const KEY_B = "test-key-b";
const KEY_CACHE = "test-key-cache";

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("ApiKeyService – Token Type Permission Resolution", () => {
  let testDb: TestDb;
  let service: ApiKeyService;

  // Seeded entity IDs — assigned in beforeEach
  let userId: string;
  let editorRoleId: string;
  let viewerRoleId: string;
  let readPostsPermId: string;
  let readUsersPermId: string;
  let createPostsPermId: string;
  let updatePostsPermId: string;
  let readMediaPermId: string;
  let deletePostsPermId: string;

  // ── Scenario ──────────────────────────────────────────────────────────────
  //
  //  Roles & permissions seeded for every test:
  //
  //  "editor" role  → read-posts, read-users, create-posts, update-posts, delete-posts
  //  "viewer" role  → read-posts, read-media
  //
  //  Test user is assigned the "editor" role.
  //
  //  This lets us verify:
  //   • read-only key  → only ["read-posts", "read-users"] (editor's read-* subset)
  //   • full-access key → all 5 editor permissions
  //   • role-based key (viewer) → ["read-posts", "read-media"] regardless of creator
  // ──────────────────────────────────────────────────────────────────────────

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ApiKeyService(createTestAdapter(testDb.db), noopLogger);

    // ── Users ────────────────────────────────────────────────────────────────
    userId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: userId,
      email: `test-${userId}@example.com`,
      isActive: true,
    });

    // ── Roles ────────────────────────────────────────────────────────────────
    editorRoleId = randomUUID();
    viewerRoleId = randomUUID();
    await testDb.db.insert(testDb.schema.roles).values([
      {
        id: editorRoleId,
        name: "Editor",
        slug: "editor",
        level: 10,
        isSystem: false,
      },
      {
        id: viewerRoleId,
        name: "Viewer",
        slug: "viewer",
        level: 5,
        isSystem: false,
      },
    ]);

    // ── Permissions ──────────────────────────────────────────────────────────
    readPostsPermId = randomUUID();
    readUsersPermId = randomUUID();
    createPostsPermId = randomUUID();
    updatePostsPermId = randomUUID();
    readMediaPermId = randomUUID();
    deletePostsPermId = randomUUID();

    await testDb.db.insert(testDb.schema.permissions).values([
      {
        id: readPostsPermId,
        name: "Read Posts",
        slug: "read-posts",
        action: "read",
        resource: "posts",
      },
      {
        id: readUsersPermId,
        name: "Read Users",
        slug: "read-users",
        action: "read",
        resource: "users",
      },
      {
        id: createPostsPermId,
        name: "Create Posts",
        slug: "create-posts",
        action: "create",
        resource: "posts",
      },
      {
        id: updatePostsPermId,
        name: "Update Posts",
        slug: "update-posts",
        action: "update",
        resource: "posts",
      },
      {
        id: readMediaPermId,
        name: "Read Media",
        slug: "read-media",
        action: "read",
        resource: "media",
      },
      {
        id: deletePostsPermId,
        name: "Delete Posts",
        slug: "delete-posts",
        action: "delete",
        resource: "posts",
      },
    ]);

    // ── Editor role: read-posts, read-users, create-posts, update-posts, delete-posts ──
    await testDb.db.insert(testDb.schema.rolePermissions).values([
      { id: randomUUID(), roleId: editorRoleId, permissionId: readPostsPermId },
      { id: randomUUID(), roleId: editorRoleId, permissionId: readUsersPermId },
      {
        id: randomUUID(),
        roleId: editorRoleId,
        permissionId: createPostsPermId,
      },
      {
        id: randomUUID(),
        roleId: editorRoleId,
        permissionId: updatePostsPermId,
      },
      {
        id: randomUUID(),
        roleId: editorRoleId,
        permissionId: deletePostsPermId,
      },
    ]);

    // ── Viewer role: read-posts, read-media ──────────────────────────────────
    await testDb.db.insert(testDb.schema.rolePermissions).values([
      { id: randomUUID(), roleId: viewerRoleId, permissionId: readPostsPermId },
      { id: randomUUID(), roleId: viewerRoleId, permissionId: readMediaPermId },
    ]);

    // ── Assign user to editor role ───────────────────────────────────────────
    await testDb.db.insert(testDb.schema.userRoles).values({
      id: randomUUID(),
      userId,
      roleId: editorRoleId,
    });
  });

  afterEach(async () => {
    // Evict all cache entries created during the test
    invalidateApiKeyPermissionsCache(KEY_A);
    invalidateApiKeyPermissionsCache(KEY_B);
    invalidateApiKeyPermissionsCache(KEY_CACHE);
    await testDb.reset();
    testDb.close();
    vi.resetAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolveApiKeyPermissions()
  // ─────────────────────────────────────────────────────────────────────────

  describe("resolveApiKeyPermissions()", () => {
    // ── read-only ──────────────────────────────────────────────────────────

    describe("read-only token type", () => {
      it("should return only read-* permission slugs from the creator's permission set", async () => {
        // User has editor role: read-posts, read-users, create-posts, update-posts, delete-posts
        const slugs = await service.resolveApiKeyPermissions(
          "read-only",
          null,
          userId,
          KEY_A
        );

        // Only read-* slugs pass the filter
        expect(slugs.every(s => s.startsWith("read-"))).toBe(true);
        expect(slugs).toContain("read-posts");
        expect(slugs).toContain("read-users");
      });

      it("should NOT include non-read-* permissions (create, update, delete)", async () => {
        const slugs = await service.resolveApiKeyPermissions(
          "read-only",
          null,
          userId,
          KEY_A
        );

        expect(slugs).not.toContain("create-posts");
        expect(slugs).not.toContain("update-posts");
        expect(slugs).not.toContain("delete-posts");
      });

      it("should return empty array when user has no read-* permissions", async () => {
        // Create a user whose role has only write permissions
        const writeUserId = randomUUID();
        const writeRoleId = randomUUID();
        await testDb.db.insert(testDb.schema.users).values({
          id: writeUserId,
          email: `write-${writeUserId}@example.com`,
          isActive: true,
        });
        await testDb.db.insert(testDb.schema.roles).values({
          id: writeRoleId,
          name: "Write Only",
          slug: "write-only",
          level: 5,
          isSystem: false,
        });
        await testDb.db.insert(testDb.schema.rolePermissions).values([
          {
            id: randomUUID(),
            roleId: writeRoleId,
            permissionId: createPostsPermId,
          },
          {
            id: randomUUID(),
            roleId: writeRoleId,
            permissionId: updatePostsPermId,
          },
        ]);
        await testDb.db.insert(testDb.schema.userRoles).values({
          id: randomUUID(),
          userId: writeUserId,
          roleId: writeRoleId,
        });

        const slugs = await service.resolveApiKeyPermissions(
          "read-only",
          null,
          writeUserId,
          KEY_A
        );

        expect(slugs).toHaveLength(0);
      });

      it("should return empty array when user has no role assignments", async () => {
        const noRoleUserId = randomUUID();
        await testDb.db.insert(testDb.schema.users).values({
          id: noRoleUserId,
          email: `norole-${noRoleUserId}@example.com`,
          isActive: true,
        });

        const slugs = await service.resolveApiKeyPermissions(
          "read-only",
          null,
          noRoleUserId,
          KEY_A
        );

        expect(slugs).toHaveLength(0);
      });
    });

    // ── full-access ────────────────────────────────────────────────────────

    describe("full-access token type", () => {
      it("should return all permission slugs for the creator", async () => {
        // User has editor role: 5 permissions total
        const slugs = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_A
        );

        expect(slugs).toContain("read-posts");
        expect(slugs).toContain("read-users");
        expect(slugs).toContain("create-posts");
        expect(slugs).toContain("update-posts");
        expect(slugs).toContain("delete-posts");
        expect(slugs).toHaveLength(5);
      });

      it("should return a strict superset of the read-only result for the same user", async () => {
        const readOnlySlugs = await service.resolveApiKeyPermissions(
          "read-only",
          null,
          userId,
          KEY_A
        );
        const fullAccessSlugs = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_B
        );

        // Every slug in read-only must also be present in full-access
        for (const slug of readOnlySlugs) {
          expect(fullAccessSlugs).toContain(slug);
        }
        // full-access has additional non-read-* slugs
        expect(fullAccessSlugs.length).toBeGreaterThan(readOnlySlugs.length);
      });

      it("should return empty array when user has no role assignments", async () => {
        const noRoleUserId = randomUUID();
        await testDb.db.insert(testDb.schema.users).values({
          id: noRoleUserId,
          email: `norole-fa-${noRoleUserId}@example.com`,
          isActive: true,
        });

        const slugs = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          noRoleUserId,
          KEY_A
        );

        expect(slugs).toHaveLength(0);
      });
    });

    // ── role-based ─────────────────────────────────────────────────────────

    describe("role-based token type", () => {
      it("should return the assigned role's permissions, NOT the creator's", async () => {
        // Viewer role has: read-posts, read-media (2 perms)
        // Creator (userId) has editor role with 5 perms — must NOT bleed through
        const slugs = await service.resolveApiKeyPermissions(
          "role-based",
          viewerRoleId,
          userId,
          KEY_A
        );

        expect(slugs).toContain("read-posts");
        expect(slugs).toContain("read-media");
        expect(slugs).toHaveLength(2);
      });

      it("should not include any of the creator's extra permissions", async () => {
        const slugs = await service.resolveApiKeyPermissions(
          "role-based",
          viewerRoleId,
          userId,
          KEY_A
        );

        // Creator has these; viewer does not
        expect(slugs).not.toContain("create-posts");
        expect(slugs).not.toContain("update-posts");
        expect(slugs).not.toContain("delete-posts");
        expect(slugs).not.toContain("read-users");
      });

      it("should return permissions distinct from the creator's full-access set", async () => {
        // editor does NOT have read-media; viewer does
        const creatorSlugs = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_A
        );
        const roleBasedSlugs = await service.resolveApiKeyPermissions(
          "role-based",
          viewerRoleId,
          userId,
          KEY_B
        );

        expect(creatorSlugs).not.toContain("read-media");
        expect(roleBasedSlugs).toContain("read-media");
        expect(creatorSlugs.length).toBeGreaterThan(roleBasedSlugs.length);
      });

      it("should return empty array when roleId is null (role was deleted via onDelete: set null)", async () => {
        const slugs = await service.resolveApiKeyPermissions(
          "role-based",
          null, // simulates deleted role
          userId,
          KEY_A
        );

        expect(slugs).toHaveLength(0);
      });

      it("should return empty array for a role that has no permissions", async () => {
        const emptyRoleId = randomUUID();
        await testDb.db.insert(testDb.schema.roles).values({
          id: emptyRoleId,
          name: "Empty Role",
          slug: "empty-role",
          level: 1,
          isSystem: false,
        });
        // No role_permissions inserted for this role

        const slugs = await service.resolveApiKeyPermissions(
          "role-based",
          emptyRoleId,
          userId,
          KEY_A
        );

        expect(slugs).toHaveLength(0);
      });
    });

    // ── permission cache ───────────────────────────────────────────────────

    describe("permission cache", () => {
      it("should cache results so a subsequent call with the same keyId returns the same slugs", async () => {
        // First call — populates the module-level cache
        const firstResult = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_CACHE
        );
        expect(firstResult).toHaveLength(5);

        // Mutate the DB: add a new permission to the editor role
        const newPermId = randomUUID();
        await testDb.db.insert(testDb.schema.permissions).values({
          id: newPermId,
          name: "Publish Posts",
          slug: "publish-posts",
          action: "publish",
          resource: "posts",
        });
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: randomUUID(),
          roleId: editorRoleId,
          permissionId: newPermId,
        });

        // Second call with the same keyId — must return CACHED result (before mutation)
        const cachedResult = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_CACHE
        );

        expect(cachedResult).toEqual(firstResult);
        expect(cachedResult).not.toContain("publish-posts");
      });

      it("should return fresh data after invalidateApiKeyPermissionsCache() is called", async () => {
        // First call — populates cache
        const before = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_CACHE
        );
        expect(before).toHaveLength(5);

        // Mutate the DB: add a new permission
        const newPermId = randomUUID();
        await testDb.db.insert(testDb.schema.permissions).values({
          id: newPermId,
          name: "Archive Posts",
          slug: "archive-posts",
          action: "archive",
          resource: "posts",
        });
        await testDb.db.insert(testDb.schema.rolePermissions).values({
          id: randomUUID(),
          roleId: editorRoleId,
          permissionId: newPermId,
        });

        // Evict the cache entry
        invalidateApiKeyPermissionsCache(KEY_CACHE);

        // Next call — must re-query DB and return the updated set
        const after = await service.resolveApiKeyPermissions(
          "full-access",
          null,
          userId,
          KEY_CACHE
        );

        expect(after).toContain("archive-posts");
        expect(after.length).toBeGreaterThan(before.length);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolveApiKeyRoles()
  // ─────────────────────────────────────────────────────────────────────────

  describe("resolveApiKeyRoles()", () => {
    // ── role-based ─────────────────────────────────────────────────────────

    describe("role-based token type", () => {
      it("should return the assigned role's slug as a single-element array", async () => {
        const roles = await service.resolveApiKeyRoles(
          "role-based",
          editorRoleId,
          userId
        );

        expect(roles).toEqual(["editor"]);
      });

      it("should return the viewer role's slug when assigned to the viewer role", async () => {
        const roles = await service.resolveApiKeyRoles(
          "role-based",
          viewerRoleId,
          userId
        );

        expect(roles).toEqual(["viewer"]);
      });

      it("should return empty array when roleId is null (role was deleted)", async () => {
        const roles = await service.resolveApiKeyRoles(
          "role-based",
          null,
          userId
        );

        expect(roles).toHaveLength(0);
      });
    });

    // ── read-only ──────────────────────────────────────────────────────────

    describe("read-only token type", () => {
      it("should delegate to listRoleSlugsForUser and return the creator's role slugs", async () => {
        vi.mocked(listRoleSlugsForUser).mockResolvedValueOnce(["editor"]);

        const roles = await service.resolveApiKeyRoles(
          "read-only",
          null,
          userId
        );

        expect(vi.mocked(listRoleSlugsForUser)).toHaveBeenCalledWith(userId);
        expect(roles).toEqual(["editor"]);
      });

      it("should return multiple slugs when the creator has multiple roles", async () => {
        vi.mocked(listRoleSlugsForUser).mockResolvedValueOnce([
          "editor",
          "viewer",
        ]);

        const roles = await service.resolveApiKeyRoles(
          "read-only",
          null,
          userId
        );

        expect(roles).toEqual(["editor", "viewer"]);
      });
    });

    // ── full-access ────────────────────────────────────────────────────────

    describe("full-access token type", () => {
      it("should delegate to listRoleSlugsForUser and return the creator's role slugs", async () => {
        vi.mocked(listRoleSlugsForUser).mockResolvedValueOnce(["super-admin"]);

        const roles = await service.resolveApiKeyRoles(
          "full-access",
          null,
          userId
        );

        expect(vi.mocked(listRoleSlugsForUser)).toHaveBeenCalledWith(userId);
        expect(roles).toEqual(["super-admin"]);
      });

      it("should return empty array when creator has no roles", async () => {
        vi.mocked(listRoleSlugsForUser).mockResolvedValueOnce([]);

        const roles = await service.resolveApiKeyRoles(
          "full-access",
          null,
          userId
        );

        expect(roles).toHaveLength(0);
      });
    });
  });
});
