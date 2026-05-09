/**
 * Seed Helpers for Test Data
 *
 * Functions to seed test data for collections, singles, components, and users
 * into an in-memory test database. Built on top of the existing fixture
 * factories for users, roles, and permissions.
 *
 * ## Important: Table Compatibility
 *
 * The `createTestDb()` fixture from `../fixtures/db.ts` creates tables with
 * an older DDL that does NOT include `dynamic_singles` or `dynamic_components`,
 * and its `dynamic_collections` columns do not match the current Drizzle schema.
 *
 * Before using `seedTestCollection`, `seedTestSingle`, or `seedTestComponent`,
 * call `ensureDynamicTables(sqlite)` to create the required tables with the
 * correct column layout matching the Drizzle schema.
 *
 * @example
 * ```typescript
 * import { createTestDb } from "../fixtures/db";
 * import { ensureDynamicTables, seedTestCollection, seedTestUser } from "../helpers/seed-helpers";
 *
 * const testDb = await createTestDb();
 * ensureDynamicTables(testDb.sqlite);
 *
 * const collection = await seedTestCollection(testDb.db, {
 *   name: "Blog Posts",
 *   fields: [
 *     { name: "title", type: "text", required: true },
 *     { name: "body", type: "richtext" },
 *   ],
 * });
 *
 * const user = await seedTestUser(testDb.db, { role: "admin" });
 * ```
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "crypto";

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@nextly/database/schema/sqlite";

// Re-export existing factories for convenience
export { userFactory, bulkUsersFactory } from "../fixtures/users";
export {
  roleFactory,
  systemRoleFactory,
  bulkRolesFactory,
  superAdminRoleFactory,
} from "../fixtures/roles";
export {
  permissionFactory,
  bulkPermissionsFactory,
  crudPermissionsFactory,
  PermissionSets,
} from "../fixtures/permissions";

// ============================================================
// Types
// ============================================================

/** Field definition used when seeding collections, singles, and components. */
export interface SeedField {
  name: string;
  type: string;
  required?: boolean;
  label?: string;
  [key: string]: unknown;
}

// ============================================================
// Table Setup
// ============================================================

/**
 * Create the dynamic_collections, dynamic_singles, and dynamic_components
 * tables with the current Drizzle schema column layout.
 *
 * Call this on the raw `sqlite` instance from `createTestDb()` before
 * using any of the seed functions for collections, singles, or components.
 *
 * This function is idempotent (uses IF NOT EXISTS). If the tables already
 * exist (e.g., from `createTestDatabase()` in `database/setup.ts`), the
 * existing tables will not be modified.
 *
 * Note: This function will DROP the old `dynamic_collections` table first
 * if it exists, since the fixture's DDL uses incompatible columns.
 * Only call this for fresh test databases.
 *
 * @param sqlite - Raw better-sqlite3 Database instance
 */
export function ensureDynamicTables(sqlite: Database.Database): void {
  sqlite.exec(`
    DROP TABLE IF EXISTS dynamic_collections;

    CREATE TABLE IF NOT EXISTS dynamic_collections (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      table_name TEXT NOT NULL UNIQUE,
      description TEXT,
      labels TEXT NOT NULL,
      fields TEXT NOT NULL,
      timestamps INTEGER NOT NULL DEFAULT 1,
      admin TEXT,
      source TEXT NOT NULL DEFAULT 'ui',
      locked INTEGER NOT NULL DEFAULT 0,
      config_path TEXT,
      schema_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      migration_status TEXT NOT NULL DEFAULT 'pending',
      last_migration_id TEXT,
      access_rules TEXT,
      hooks TEXT,
      created_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS dc_slug_unique ON dynamic_collections(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS dc_table_name_unique ON dynamic_collections(table_name);
    CREATE INDEX IF NOT EXISTS dc_source_idx ON dynamic_collections(source);
    CREATE INDEX IF NOT EXISTS dc_created_by_idx ON dynamic_collections(created_by);
    CREATE INDEX IF NOT EXISTS dc_created_at_idx ON dynamic_collections(created_at);
    CREATE INDEX IF NOT EXISTS dc_updated_at_idx ON dynamic_collections(updated_at);

    CREATE TABLE IF NOT EXISTS dynamic_singles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      table_name TEXT NOT NULL UNIQUE,
      description TEXT,
      fields TEXT NOT NULL,
      admin TEXT,
      access_rules TEXT,
      source TEXT NOT NULL DEFAULT 'ui',
      locked INTEGER NOT NULL DEFAULT 0,
      config_path TEXT,
      schema_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      migration_status TEXT NOT NULL DEFAULT 'pending',
      last_migration_id TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ds_slug_unique ON dynamic_singles(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS ds_table_name_unique ON dynamic_singles(table_name);
    CREATE INDEX IF NOT EXISTS ds_source_idx ON dynamic_singles(source);
    CREATE INDEX IF NOT EXISTS ds_migration_status_idx ON dynamic_singles(migration_status);
    CREATE INDEX IF NOT EXISTS ds_created_by_idx ON dynamic_singles(created_by);
    CREATE INDEX IF NOT EXISTS ds_created_at_idx ON dynamic_singles(created_at);
    CREATE INDEX IF NOT EXISTS ds_updated_at_idx ON dynamic_singles(updated_at);

    CREATE TABLE IF NOT EXISTS dynamic_components (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      table_name TEXT NOT NULL UNIQUE,
      description TEXT,
      fields TEXT NOT NULL,
      admin TEXT,
      source TEXT NOT NULL DEFAULT 'ui',
      locked INTEGER NOT NULL DEFAULT 0,
      config_path TEXT,
      schema_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      migration_status TEXT NOT NULL DEFAULT 'pending',
      last_migration_id TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS dcomp_slug_unique ON dynamic_components(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS dcomp_table_name_unique ON dynamic_components(table_name);
    CREATE INDEX IF NOT EXISTS dcomp_source_idx ON dynamic_components(source);
    CREATE INDEX IF NOT EXISTS dcomp_migration_status_idx ON dynamic_components(migration_status);
    CREATE INDEX IF NOT EXISTS dcomp_created_by_idx ON dynamic_components(created_by);
    CREATE INDEX IF NOT EXISTS dcomp_created_at_idx ON dynamic_components(created_at);
    CREATE INDEX IF NOT EXISTS dcomp_updated_at_idx ON dynamic_components(updated_at);
  `);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Convert a human-readable name to a snake_case table name.
 *
 * @param name - Display name (e.g., "Blog Posts")
 * @param prefix - Table prefix (e.g., "coll_", "single_", "comp_")
 * @returns Snake-cased table name (e.g., "coll_blog_posts")
 */
function toTableName(name: string, prefix: string): string {
  const snake = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${prefix}${snake}`;
}

/**
 * Convert a human-readable name to a URL-friendly slug.
 *
 * @param name - Display name (e.g., "Blog Posts")
 * @returns Kebab-cased slug (e.g., "blog-posts")
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Compute a SHA-256 hash of the fields array for schema change detection.
 */
function computeSchemaHash(fields: SeedField[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

// ============================================================
// Collection Seeding
// ============================================================

/**
 * Seed a test collection into the `dynamic_collections` table.
 *
 * Generates a slug from the name, computes a schema hash from the fields,
 * and inserts a row using Drizzle's typed insert API.
 *
 * **Prerequisite:** Call `ensureDynamicTables(sqlite)` before using this
 * function if the database was created via `createTestDb()`.
 *
 * @param db - Drizzle database instance (from createTestDb or similar)
 * @param options - Collection configuration
 * @returns The inserted collection's ID and generated table name
 *
 * @example
 * ```typescript
 * const { id, tableName } = await seedTestCollection(db, {
 *   name: "Blog Posts",
 *   fields: [
 *     { name: "title", type: "text", required: true },
 *     { name: "body", type: "richtext" },
 *     { name: "publishedAt", type: "date" },
 *   ],
 * });
 * ```
 */
export async function seedTestCollection(
  db: BetterSQLite3Database<typeof schema>,
  options: {
    name: string;
    fields: SeedField[];
    slug?: string;
    description?: string;
    source?: "code" | "ui" | "built-in";
  }
): Promise<{ id: string; tableName: string; slug: string }> {
  const id = randomUUID();
  const slug = options.slug ?? toSlug(options.name);
  const tableName = toTableName(options.name, "coll_");
  const schemaHash = computeSchemaHash(options.fields);

  await db.insert(schema.dynamicCollections).values({
    id,
    slug,
    tableName,
    description: options.description ?? null,
    labels: {
      singular: options.name.replace(/s$/i, ""),
      plural: options.name,
    },
    fields: options.fields,
    schemaHash,
    source: options.source ?? "ui",
  });

  return { id, tableName, slug };
}

// ============================================================
// Single Seeding
// ============================================================

/**
 * Seed a test single into the `dynamic_singles` table.
 *
 * **Prerequisite:** Call `ensureDynamicTables(sqlite)` before using this
 * function if the database was created via `createTestDb()`.
 *
 * @param db - Drizzle database instance
 * @param options - Single configuration
 * @returns The inserted single's ID and slug
 *
 * @example
 * ```typescript
 * const { id } = await seedTestSingle(db, {
 *   name: "Site Settings",
 *   fields: [
 *     { name: "siteTitle", type: "text", required: true },
 *     { name: "logo", type: "media" },
 *   ],
 * });
 * ```
 */
export async function seedTestSingle(
  db: BetterSQLite3Database<typeof schema>,
  options: {
    name: string;
    fields: SeedField[];
    slug?: string;
    description?: string;
    source?: "code" | "ui" | "built-in";
  }
): Promise<{ id: string; slug: string; tableName: string }> {
  const id = randomUUID();
  const slug = options.slug ?? toSlug(options.name);
  const tableName = toTableName(options.name, "single_");
  const schemaHash = computeSchemaHash(options.fields);

  await db.insert(schema.dynamicSingles).values({
    id,
    slug,
    label: options.name,
    tableName,
    description: options.description ?? null,
     
    fields: options.fields as any,
    schemaHash,
     
    source: (options.source ?? "ui") as any,
  });

  return { id, slug, tableName };
}

// ============================================================
// Component Seeding
// ============================================================

/**
 * Seed a test component into the `dynamic_components` table.
 *
 * **Prerequisite:** Call `ensureDynamicTables(sqlite)` before using this
 * function if the database was created via `createTestDb()`.
 *
 * @param db - Drizzle database instance
 * @param options - Component configuration
 * @returns The inserted component's ID and slug
 *
 * @example
 * ```typescript
 * const { id } = await seedTestComponent(db, {
 *   slug: "seo-meta",
 *   fields: [
 *     { name: "metaTitle", type: "text", required: true },
 *     { name: "metaDescription", type: "textarea" },
 *     { name: "ogImage", type: "media" },
 *   ],
 * });
 * ```
 */
export async function seedTestComponent(
  db: BetterSQLite3Database<typeof schema>,
  options: {
    slug: string;
    fields: SeedField[];
    label?: string;
    description?: string;
    source?: "code" | "ui";
  }
): Promise<{ id: string; slug: string; tableName: string }> {
  const id = randomUUID();
  const tableName = `comp_${options.slug.replace(/-/g, "_")}`;
  const schemaHash = computeSchemaHash(options.fields);

  // Default label from slug: "seo-meta" -> "Seo Meta"
  const label =
    options.label ??
    options.slug
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  await db.insert(schema.dynamicComponents).values({
    id,
    slug: options.slug,
    label,
    tableName,
    description: options.description ?? null,
     
    fields: options.fields as any,
    schemaHash,
     
    source: (options.source ?? "ui") as any,
  });

  return { id, slug: options.slug, tableName };
}

// ============================================================
// User + Role Seeding
// ============================================================

/**
 * Seed a test user with an assigned role.
 *
 * Combines the existing `userFactory` and `roleFactory` fixtures,
 * inserts both records, and links them via the `user_roles` join table.
 *
 * Works with the base `createTestDb()` fixture (no extra table setup needed).
 *
 * @param db - Drizzle database instance
 * @param options - Optional role type and custom permissions
 * @returns The created user ID and role ID
 *
 * @example
 * ```typescript
 * // Admin user
 * const { userId, roleId } = await seedTestUser(db, { role: "admin" });
 *
 * // User with specific permissions
 * const { userId } = await seedTestUser(db, {
 *   role: "editor",
 *   permissions: ["read:content", "update:content"],
 * });
 *
 * // Default user (viewer role)
 * const { userId } = await seedTestUser(db);
 * ```
 */
export async function seedTestUser(
  db: BetterSQLite3Database<typeof schema>,
  options?: {
    role?: "admin" | "editor" | "viewer";
    permissions?: string[];
    email?: string;
    name?: string;
  }
): Promise<{ userId: string; roleId: string }> {
  const { userFactory } = await import("../fixtures/users");
  const { roleFactory, superAdminRoleFactory } = await import(
    "../fixtures/roles"
  );
  const { permissionFactory } = await import("../fixtures/permissions");

  // Create role based on type
  const roleType = options?.role ?? "viewer";
  let roleData;

  switch (roleType) {
    case "admin":
      roleData = superAdminRoleFactory();
      break;
    case "editor":
      roleData = roleFactory({
        name: "Editor",
        slug: "editor",
        level: 500,
      });
      break;
    case "viewer":
    default:
      roleData = roleFactory({
        name: "Viewer",
        slug: "viewer",
        level: 100,
      });
      break;
  }

  // Insert role - cast isSystem to boolean for Drizzle schema compatibility
  // (roleFactory returns number | boolean, Drizzle schema expects boolean)
  await db.insert(schema.roles).values({
    ...roleData,
    isSystem: Boolean(roleData.isSystem),
  });

  // Create and insert user
  const userData = userFactory({
    email: options?.email,
    name: options?.name,
  });
   
  await db.insert(schema.users).values(userData as any);

  // Link user to role
  const userRoleId = randomUUID();
  await db.insert(schema.userRoles).values({
    id: userRoleId,
    userId: userData.id,
    roleId: roleData.id,
  });

  // Create and attach permissions if specified
  if (options?.permissions?.length) {
    for (const permSlug of options.permissions) {
      const [action, resource] = permSlug.includes(":")
        ? permSlug.split(":")
        : ["read", permSlug];

      const permData = permissionFactory({
        action,
        resource,
        name: permSlug,
        slug: permSlug.replace(/:/g, "-"),
      });

      await db.insert(schema.permissions).values(permData);

      // Link permission to role
      await db.insert(schema.rolePermissions).values({
        id: randomUUID(),
        roleId: roleData.id,
        permissionId: permData.id,
      });
    }
  }

  return { userId: userData.id, roleId: roleData.id };
}
