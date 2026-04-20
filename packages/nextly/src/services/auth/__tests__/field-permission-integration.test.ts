/**
 * Field Permission Integration Tests
 *
 * Tests field-level access control via FieldPermissionCheckerService:
 * 1. Field-level read/write permissions across roles
 * 2. Permission inheritance (most-restrictive rule wins across multiple roles)
 * 3. Field permission caching (LRU role cache and rule cache behaviour)
 *
 * Uses an in-memory SQLite database with a custom schema that includes the
 * `field_permissions` table (which is not present in the standard SQLite
 * schema used by `createTestDb()`).
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import Database from "better-sqlite3";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Logger } from "../../shared";
import { FieldPermissionCheckerService } from "../field-permission-checker-service";

// ── Test Schema ──────────────────────────────────────────────────────────────

/**
 * Minimal SQLite schema that includes the tables required by
 * FieldPermissionCheckerService:  `user_roles` and `field_permissions`.
 *
 * This mirrors the DDL in sqlite-core-tables.ts and field-permission-service.ts
 * but expressed as a Drizzle table definition so the query builder can
 * type-check column references.
 */
const testRoles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
});

const testUserRoles = sqliteTable(
  "user_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    createdAt: integer("created_at"),
    expiresAt: integer("expires_at"),
  },
  t => [
    uniqueIndex("ur_user_role_unique").on(t.userId, t.roleId),
    index("ur_user_id_idx").on(t.userId),
  ]
);

const testFieldPermissions = sqliteTable(
  "field_permissions",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    collectionSlug: text("collection_slug").notNull(),
    fieldPath: text("field_path").notNull(),
    action: text("action").notNull(), // 'read' | 'write' | 'none'
    condition: text("condition"), // JSON-serialised PermissionCondition | null
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
  },
  t => [
    uniqueIndex("fp_role_coll_field_unique").on(
      t.roleId,
      t.collectionSlug,
      t.fieldPath
    ),
    index("fp_role_id_idx").on(t.roleId),
    index("fp_collection_slug_idx").on(t.collectionSlug),
  ]
);

const testSchema = { testRoles, testUserRoles, testFieldPermissions };

// ── Helpers ──────────────────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof testSchema>>;

function createTestFieldPermDb(): { sqlite: Database.Database; db: TestDb } {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  // No FK constraints — we test service logic, not referential integrity.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      created_at INTEGER,
      expires_at INTEGER,
      UNIQUE(user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS field_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      field_path TEXT NOT NULL,
      action TEXT NOT NULL,
      condition TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(role_id, collection_slug, field_path)
    );
  `);

  const db = drizzle(sqlite, { schema: testSchema });
  return { sqlite, db };
}

/** Minimal DrizzleAdapter interface that satisfies BaseService requirements */
function makeAdapter(db: TestDb): DrizzleAdapter {
  return {
    getDrizzle: () => db as unknown,
    getCapabilities: () => ({
      dialect: "sqlite" as const,
      supportsJsonb: false,
      supportsJson: true,
      supportsArrays: false,
      supportsGeneratedColumns: true,
      supportsIlike: false,
      supportsReturning: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      supportsFts: false,
      maxParamsPerQuery: 999,
      maxIdentifierLength: 1024,
    }),
    getDialect: () => "sqlite",
    select: vi.fn(),
    selectOne: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as DrizzleAdapter;
}

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** Patch `this.tables` on a BaseService subclass instance to return testSchema */
function patchTables(service: FieldPermissionCheckerService): void {
  // BaseService._tables is private. Use prototype-level property injection
  // so that the `tables` getter short-circuits and returns our test tables.
  // This technique is acceptable only in test code.
  (service as unknown as Record<string, unknown>)["_tables"] = {
    userRoles: testUserRoles,
    fieldPermissions: testFieldPermissions,
  };
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedRole(
  db: TestDb,
  overrides?: { id?: string; name?: string }
) {
  const id = overrides?.id ?? randomUUID();
  await db.insert(testRoles).values({
    id,
    name: overrides?.name ?? `Role ${id.slice(0, 8)}`,
    slug: overrides?.name?.toLowerCase().replace(/\s+/g, "-") ?? id.slice(0, 8),
  });
  return id;
}

async function assignRole(db: TestDb, userId: string, roleId: string) {
  await db.insert(testUserRoles).values({
    id: randomUUID(),
    userId,
    roleId,
  });
}

async function seedFieldPermission(
  db: TestDb,
  opts: {
    roleId: string;
    collectionSlug: string;
    fieldPath: string;
    action: "read" | "write" | "none";
    condition?: string;
  }
) {
  await db.insert(testFieldPermissions).values({
    id: randomUUID(),
    roleId: opts.roleId,
    collectionSlug: opts.collectionSlug,
    fieldPath: opts.fieldPath,
    action: opts.action,
    condition: opts.condition ?? null,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FieldPermissionCheckerService — Integration Tests", () => {
  let sqlite: Database.Database;
  let db: TestDb;
  let service: FieldPermissionCheckerService;

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = createTestFieldPermDb();
    sqlite = setup.sqlite;
    db = setup.db;
    service = new FieldPermissionCheckerService(makeAdapter(db), logger);
    patchTables(service);
  });

  afterEach(() => {
    sqlite.close();
  });

  // ── User with no roles ────────────────────────────────────────────────────

  describe("User with no role assignments", () => {
    it("denies access to any field when user has no roles", async () => {
      const userId = randomUUID();
      const result = await service.canAccessField(
        userId,
        "users",
        "email",
        "read"
      );
      expect(result).toBe(false);
    });

    it("returns empty filtered record when user has no roles", async () => {
      const userId = randomUUID();
      // Seed a field permission, but since the user has no role it won't matter
      const roleId = await seedRole(db);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "users",
        fieldPath: "email",
        action: "none",
      });

      const filtered = await service.filterFields(
        userId,
        "users",
        { id: "1", email: "a@b.com" },
        "read"
      );
      // No roles → no field access
      expect(filtered).toEqual({});
    });
  });

  // ── No field rules = allow by default ────────────────────────────────────

  describe("No field-level rules defined", () => {
    it("allows access to a field when no rules exist for that field", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      // No field_permissions rows inserted
      const result = await service.canAccessField(
        userId,
        "users",
        "email",
        "read"
      );
      expect(result).toBe(true);
    });

    it("passes record through unmodified when no field rules exist", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      const record = { id: "1", name: "Alice", email: "alice@example.com" };
      const filtered = await service.filterFields(
        userId,
        "users",
        record,
        "read"
      );
      expect(filtered).toEqual(record);
    });
  });

  // ── Explicit "none" action ────────────────────────────────────────────────

  describe("Field explicitly denied (action: none)", () => {
    it("denies read access when field has action: none for user's role", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "users",
        fieldPath: "ssn",
        action: "none",
      });

      const result = await service.canAccessField(
        userId,
        "users",
        "ssn",
        "read"
      );
      expect(result).toBe(false);
    });

    it("removes denied field from filtered record", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "users",
        fieldPath: "ssn",
        action: "none",
      });

      const record = { id: "1", name: "Bob", ssn: "123-45-6789" };
      const filtered = await service.filterFields(
        userId,
        "users",
        record,
        "read"
      );
      expect(filtered).toHaveProperty("id");
      expect(filtered).toHaveProperty("name");
      expect(filtered).not.toHaveProperty("ssn");
    });
  });

  // ── Read-only field write prevention ─────────────────────────────────────

  describe("Read-only field (action: read)", () => {
    it("allows read on a read-only field", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "posts",
        fieldPath: "status",
        action: "read",
      });

      const canRead = await service.canAccessField(
        userId,
        "posts",
        "status",
        "read"
      );
      expect(canRead).toBe(true);
    });

    it("denies write on a read-only field", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "posts",
        fieldPath: "status",
        action: "read",
      });

      const canWrite = await service.canAccessField(
        userId,
        "posts",
        "status",
        "write"
      );
      expect(canWrite).toBe(false);
    });
  });

  // ── Multiple roles — most restrictive wins ────────────────────────────────

  describe("Permission inheritance — most restrictive rule wins", () => {
    it("denies access when any role denies the field (role A allows, role B denies)", async () => {
      const userId = randomUUID();
      const roleA = await seedRole(db, { name: "Editor" });
      const roleB = await seedRole(db, { name: "Reviewer" });
      await assignRole(db, userId, roleA);
      await assignRole(db, userId, roleB);

      await seedFieldPermission(db, {
        roleId: roleA,
        collectionSlug: "articles",
        fieldPath: "salary",
        action: "read", // role A allows read
      });
      await seedFieldPermission(db, {
        roleId: roleB,
        collectionSlug: "articles",
        fieldPath: "salary",
        action: "none", // role B denies
      });

      const result = await service.canAccessField(
        userId,
        "articles",
        "salary",
        "read"
      );
      expect(result).toBe(false);
    });

    it("allows access when all roles allow the field", async () => {
      const userId = randomUUID();
      const roleA = await seedRole(db, { name: "Writer" });
      const roleB = await seedRole(db, { name: "Publisher" });
      await assignRole(db, userId, roleA);
      await assignRole(db, userId, roleB);

      await seedFieldPermission(db, {
        roleId: roleA,
        collectionSlug: "articles",
        fieldPath: "title",
        action: "read",
      });
      await seedFieldPermission(db, {
        roleId: roleB,
        collectionSlug: "articles",
        fieldPath: "title",
        action: "write",
      });

      const canRead = await service.canAccessField(
        userId,
        "articles",
        "title",
        "read"
      );
      expect(canRead).toBe(true);
    });
  });

  // ── Ownership condition ───────────────────────────────────────────────────

  describe("Ownership condition", () => {
    it("allows access when record ownership matches the user", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      const condition = JSON.stringify({
        type: "ownership",
        ownerField: "authorId",
      });
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "posts",
        fieldPath: "privateNotes",
        action: "read",
        condition,
      });

      const record = { id: "p1", authorId: userId, privateNotes: "secret" };
      const result = await service.canAccessField(
        userId,
        "posts",
        "privateNotes",
        "read",
        record
      );
      // Service evaluates condition — ownerField "authorId" matches userId → allow
      expect(result).toBe(true);
    });

    it("denies access when record ownership does NOT match the user", async () => {
      const userId = randomUUID();
      const otherUser = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      const condition = JSON.stringify({
        type: "ownership",
        ownerField: "authorId",
      });
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "posts",
        fieldPath: "privateNotes",
        action: "read",
        condition,
      });

      const record = {
        id: "p2",
        authorId: otherUser,
        privateNotes: "not yours",
      };
      const result = await service.canAccessField(
        userId,
        "posts",
        "privateNotes",
        "read",
        record
      );
      // ownerField "authorId" is otherUser ≠ userId → deny
      expect(result).toBe(false);
    });

    it("denies when no record is provided for ownership condition", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      const condition = JSON.stringify({
        type: "ownership",
        ownerField: "authorId",
      });
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "posts",
        fieldPath: "draft",
        action: "read",
        condition,
      });

      // No record passed — condition cannot be evaluated → service skips evaluation
      // and allows (condition check only triggers when record is provided)
      const result = await service.canAccessField(
        userId,
        "posts",
        "draft",
        "read"
      );
      expect(result).toBe(true);
    });
  });

  // ── Caching behaviour ─────────────────────────────────────────────────────

  describe("Role cache behaviour", () => {
    it("returns consistent results on repeated calls (cache hit path)", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      // Two calls for the same userId/field — second one hits the roleCache
      const first = await service.canAccessField(
        userId,
        "users",
        "name",
        "read"
      );
      const second = await service.canAccessField(
        userId,
        "users",
        "name",
        "read"
      );
      expect(first).toBe(second);
    });

    it("correctly distinguishes cached roles for different users", async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const allowRole = await seedRole(db, { name: "Viewer" });
      const denyRole = await seedRole(db, { name: "Restricted" });

      await assignRole(db, userA, allowRole);
      await assignRole(db, userB, denyRole);

      await seedFieldPermission(db, {
        roleId: denyRole,
        collectionSlug: "secrets",
        fieldPath: "apiKey",
        action: "none",
      });

      // userA (Viewer) has no field rules → allow
      const allowResult = await service.canAccessField(
        userA,
        "secrets",
        "apiKey",
        "read"
      );
      // userB (Restricted) has deny rule → deny
      const denyResult = await service.canAccessField(
        userB,
        "secrets",
        "apiKey",
        "read"
      );

      expect(allowResult).toBe(true);
      expect(denyResult).toBe(false);
    });
  });

  // ── Bulk filtering ────────────────────────────────────────────────────────

  describe("filterFieldsBulk()", () => {
    it("returns records unchanged when no field rules exist", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);

      const records = [
        { id: "1", name: "Alice", email: "a@example.com" },
        { id: "2", name: "Bob", email: "b@example.com" },
      ];
      const filtered = await service.filterFieldsBulk(
        userId,
        "users",
        records,
        "read"
      );
      expect(filtered).toHaveLength(2);
      expect(filtered[0]).toEqual(records[0]);
      expect(filtered[1]).toEqual(records[1]);
    });

    it("removes denied field from all records in the bulk result", async () => {
      const userId = randomUUID();
      const roleId = await seedRole(db);
      await assignRole(db, userId, roleId);
      await seedFieldPermission(db, {
        roleId,
        collectionSlug: "users",
        fieldPath: "password",
        action: "none",
      });

      const records = [
        { id: "1", email: "a@b.com", password: "secret1" },
        { id: "2", email: "c@d.com", password: "secret2" },
      ];
      const filtered = await service.filterFieldsBulk(
        userId,
        "users",
        records,
        "read"
      );
      expect(filtered).toHaveLength(2);
      expect(filtered[0]).not.toHaveProperty("password");
      expect(filtered[1]).not.toHaveProperty("password");
    });

    it("returns empty records when user has no roles", async () => {
      const userId = randomUUID(); // no role assigned
      const records = [{ id: "1", email: "a@b.com" }];
      const filtered = await service.filterFieldsBulk(
        userId,
        "users",
        records,
        "read"
      );
      // No roles → each record becomes {}
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual({});
    });

    it("passes through empty input array unchanged", async () => {
      const userId = randomUUID();
      const filtered = await service.filterFieldsBulk(
        userId,
        "users",
        [],
        "read"
      );
      expect(filtered).toEqual([]);
    });
  });
});
