// Integration tests for the SQLite adapter against a real file-based SQLite database.
// No Docker required. Uses better-sqlite3 directly for DDL setup and Drizzle ORM
// for all CRUD assertions.
//
// IMPORTANT: SQLite/better-sqlite3 is SYNCHRONOUS. Drizzle's SQLite driver uses
// .all(), .run(), .get() instead of await. All Drizzle queries here are called
// WITHOUT await because they are synchronous operations.
//
// Database file: ./test-data/sqlite-integration-test.db
// WAL mode is enabled, foreign keys are enabled.

import { existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";

import BetterSqlite3 from "better-sqlite3";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ============================================================
// Database file path - file-based for real integration testing.
// The directory is created in beforeAll and cleaned up in afterAll.
// ============================================================

const TEST_DB_DIR = resolve(
  "/Users/mobeen/Work/Products/nextly-integrations/nextly-dev/packages/adapter-sqlite",
  "test-data"
);
const TEST_DB_PATH = resolve(TEST_DB_DIR, "sqlite-integration-test.db");

// ============================================================
// Drizzle table definitions matching the raw SQL schemas below.
// SQLite uses text for IDs, real for floats, integer for booleans
// and timestamps. JSON is stored as text and round-tripped manually.
// ============================================================

// Table 1: products - tests numeric, boolean, JSON-as-TEXT, and timestamp columns
const productsTable = sqliteTable("int_sqlite_products", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  price: real("price"),
  // SQLite stores booleans as INTEGER (0/1). Drizzle converts automatically.
  is_active: integer("is_active", { mode: "boolean" }),
  // JSON is stored as TEXT in SQLite. Drizzle does NOT auto-serialize JSON
  // for sqlite-core text columns, so we serialize/deserialize explicitly.
  metadata: text("metadata"),
  // Timestamps stored as INTEGER (Unix ms). Drizzle converts with mode:"timestamp".
  created_at: integer("created_at", { mode: "timestamp" }),
  updated_at: integer("updated_at", { mode: "timestamp" }),
});

// Table 2: posts - tests text, status default, and multi-condition queries
const postsTable = sqliteTable("int_sqlite_posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  body: text("body"),
  status: text("status").default("draft"),
  created_at: integer("created_at", { mode: "timestamp" }),
  updated_at: integer("updated_at", { mode: "timestamp" }),
});

// ============================================================
// Test suite
// ============================================================

describe("SQLite Adapter Integration (Real File-Based SQLite)", () => {
  // Raw better-sqlite3 connection used for DDL and pragma checks.
  let sqlite: BetterSqlite3.Database;

  // Drizzle instance wrapping the same connection for CRUD tests.
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    // Create the test-data directory if it does not exist.
    if (!existsSync(TEST_DB_DIR)) {
      mkdirSync(TEST_DB_DIR, { recursive: true });
    }

    // Open (or create) the SQLite database file.
    sqlite = new BetterSqlite3(TEST_DB_PATH);

    // Enable WAL mode for better concurrent read performance.
    sqlite.pragma("journal_mode = WAL");

    // Enable foreign key enforcement (off by default in SQLite).
    sqlite.pragma("foreign_keys = ON");

    // Drop and recreate test tables to ensure a clean slate.
    // Columns map 1:1 to the Drizzle table definitions above.
    sqlite.exec(`DROP TABLE IF EXISTS int_sqlite_products`);
    sqlite.exec(`
      CREATE TABLE int_sqlite_products (
        id          TEXT    PRIMARY KEY,
        title       TEXT    NOT NULL,
        slug        TEXT    NOT NULL,
        price       REAL,
        is_active   INTEGER,
        metadata    TEXT,
        created_at  INTEGER,
        updated_at  INTEGER
      )
    `);

    sqlite.exec(`DROP TABLE IF EXISTS int_sqlite_posts`);
    sqlite.exec(`
      CREATE TABLE int_sqlite_posts (
        id          TEXT    PRIMARY KEY,
        title       TEXT    NOT NULL,
        slug        TEXT    NOT NULL,
        body        TEXT,
        status      TEXT    DEFAULT 'draft',
        created_at  INTEGER,
        updated_at  INTEGER
      )
    `);

    // Create the Drizzle client wrapping the raw better-sqlite3 connection.
    db = drizzle(sqlite);
  });

  afterAll(() => {
    // Close the database connection before deleting the files.
    try {
      sqlite.close();
    } catch {
      // Ignore close errors during teardown.
    }

    // Delete the database file and its WAL/SHM companion files.
    // rmSync with force:true is safe even if the files no longer exist.
    rmSync(TEST_DB_PATH, { force: true });
    rmSync(`${TEST_DB_PATH}-wal`, { force: true });
    rmSync(`${TEST_DB_PATH}-shm`, { force: true });
  });

  // ============================================================
  // Test 1: WAL mode is enabled
  // Verify the journal_mode pragma returns "wal" after setup.
  // ============================================================

  it("WAL: journal_mode pragma returns 'wal'", () => {
    // pragma() is synchronous - no await needed.
    const result = sqlite.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  // ============================================================
  // Test 2: INSERT with .returning().all()
  // SQLite 3.35+ supports RETURNING. Drizzle exposes .returning().all()
  // which is synchronous on the better-sqlite3 driver.
  // ============================================================

  it("INSERT: inserts a record and returns it via .returning().all()", () => {
    // .returning().all() is synchronous with better-sqlite3 - no await.
    const rows = db
      .insert(productsTable)
      .values({
        id: "prod-1",
        title: "iPhone 16",
        slug: "iphone-16",
        price: 999.99,
        is_active: true,
        metadata: JSON.stringify({ color: "black" }),
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-01T00:00:00Z"),
      })
      .returning()
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "prod-1",
      title: "iPhone 16",
      price: 999.99,
    });
  });

  // ============================================================
  // Test 3: SELECT with WHERE conditions
  // ============================================================

  it("SELECT: reads back a record with an eq WHERE filter", () => {
    // .all() is synchronous on the better-sqlite3 driver - no await.
    const rows = db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-1"))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("slug", "iphone-16");
    expect(rows[0]).toHaveProperty("title", "iPhone 16");
  });

  // ============================================================
  // Test 4: SELECT with limit and offset
  // Insert a second product first so there are two rows to paginate.
  // ============================================================

  it("SELECT: supports limit and offset for pagination", () => {
    // Insert a second product to have two rows available.
    db.insert(productsTable)
      .values({
        id: "prod-2",
        title: "MacBook Pro",
        slug: "macbook-pro",
        price: 2499,
        is_active: false,
      })
      .returning()
      .all();

    // Fetch the second row using limit=1 offset=1 - synchronous.
    const limited = db.select().from(productsTable).limit(1).offset(1).all();

    expect(limited).toHaveLength(1);
    expect(limited[0]).toHaveProperty("id", "prod-2");
  });

  // ============================================================
  // Test 5: UPDATE with .returning().all()
  // ============================================================

  it("UPDATE: modifies a record and returns the updated row", () => {
    // Update prod-1's price and title - synchronous with .returning().all().
    const updated = db
      .update(productsTable)
      .set({ price: 899, title: "iPhone 16 (Sale)" })
      .where(eq(productsTable.id, "prod-1"))
      .returning()
      .all();

    expect(updated).toHaveLength(1);
    expect(updated[0]).toHaveProperty("price", 899);
    expect(updated[0]).toHaveProperty("title", "iPhone 16 (Sale)");
  });

  // ============================================================
  // Test 6: DELETE with .returning().all()
  // ============================================================

  it("DELETE: removes a record and returns the deleted row", () => {
    // Delete prod-2 and confirm the returned row - synchronous.
    const deleted = db
      .delete(productsTable)
      .where(eq(productsTable.id, "prod-2"))
      .returning()
      .all();

    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toHaveProperty("id", "prod-2");

    // Confirm the row is gone from the database.
    const remaining = db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-2"))
      .all();

    expect(remaining).toHaveLength(0);
  });

  // ============================================================
  // Test 7: INSERT MANY (3 records)
  // ============================================================

  it("INSERT MANY: inserts multiple records in one call", () => {
    // Batch insert 3 posts - synchronous with .returning().all().
    const rows = db
      .insert(postsTable)
      .values([
        {
          id: "post-1",
          title: "First Post",
          slug: "first-post",
          body: "Hello",
          status: "published",
        },
        {
          id: "post-2",
          title: "Second Post",
          slug: "second-post",
          body: "World",
          status: "draft",
        },
        {
          id: "post-3",
          title: "Third Post",
          slug: "third-post",
          body: "Test",
          status: "published",
        },
      ])
      .returning()
      .all();

    expect(rows).toHaveLength(3);

    // Verify all three rows persist in the table.
    const all = db.select().from(postsTable).all();
    expect(all).toHaveLength(3);
  });

  // ============================================================
  // Test 8: SELECT with multiple conditions (and)
  // ============================================================

  it("SELECT: queries with multiple WHERE conditions using and()", () => {
    // Only "published" posts should match.
    const published = db
      .select()
      .from(postsTable)
      .where(eq(postsTable.status, "published"))
      .all();

    expect(published).toHaveLength(2);

    // Combine conditions: published AND a specific slug - synchronous.
    const specific = db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.status, "published"),
          eq(postsTable.slug, "first-post")
        )
      )
      .all();

    expect(specific).toHaveLength(1);
    expect(specific[0]).toHaveProperty("title", "First Post");
  });

  // ============================================================
  // Test 9: UPSERT with onConflictDoUpdate
  // SQLite uses ON CONFLICT syntax. Drizzle exposes .onConflictDoUpdate()
  // which requires a `target` (the conflict column) and a `set` object.
  // ============================================================

  it("UPSERT: inserts or updates on conflict (ON CONFLICT DO UPDATE)", () => {
    // post-1 already exists - this upsert should update title and body.
    const rows = db
      .insert(postsTable)
      .values({
        id: "post-1",
        title: "Updated First Post",
        slug: "first-post",
        body: "Updated body",
        status: "draft",
      })
      .onConflictDoUpdate({
        // target is the column(s) that define the conflict constraint (primary key here).
        target: postsTable.id,
        // set defines which fields to overwrite when a conflict is detected.
        set: { title: "Updated First Post", body: "Updated body" },
      })
      .returning()
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("title", "Updated First Post");
    expect(rows[0]).toHaveProperty("body", "Updated body");

    // Confirm the total row count did not change (update, not insert).
    const total = db.select().from(postsTable).all();
    expect(total).toHaveLength(3);
  });

  // ============================================================
  // Test 10: JSON-as-TEXT round-trip
  // SQLite has no native JSON column type. We store JSON.stringify()
  // output in a TEXT column and parse it back with JSON.parse().
  // ============================================================

  it("JSON: round-trips a JSON object stored as TEXT", () => {
    const metadata = {
      color: "silver",
      storage: "256GB",
      tags: ["new", "sale"],
    };

    // Serialize to string before inserting - SQLite TEXT column.
    db.insert(productsTable)
      .values({
        id: "prod-json",
        title: "iPad Pro",
        slug: "ipad-pro",
        metadata: JSON.stringify(metadata),
      })
      .returning()
      .all();

    // Read it back and parse the text column into a JS object.
    const rows = db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-json"))
      .all();

    expect(rows).toHaveLength(1);
    // metadata is stored as TEXT, so we must JSON.parse to compare the object.
    const parsed = JSON.parse(rows[0].metadata as string);
    expect(parsed).toEqual(metadata);
  });

  // ============================================================
  // Test 11: Boolean handling (integer mode)
  // SQLite stores booleans as INTEGER (0/1). Drizzle's integer() column
  // with mode:"boolean" automatically converts 0/1 back to false/true.
  // ============================================================

  it("BOOLEAN: round-trips boolean values stored as INTEGER 0/1", () => {
    // Insert two products with explicit boolean values.
    db.insert(productsTable)
      .values([
        {
          id: "prod-bool-true",
          title: "Active Product",
          slug: "active-product",
          is_active: true,
        },
        {
          id: "prod-bool-false",
          title: "Inactive Product",
          slug: "inactive-product",
          is_active: false,
        },
      ])
      .returning()
      .all();

    const activeRows = db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-true"))
      .all();

    const inactiveRows = db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-false"))
      .all();

    // Drizzle must convert INTEGER 1 -> true and INTEGER 0 -> false.
    expect(activeRows[0].is_active).toBe(true);
    expect(inactiveRows[0].is_active).toBe(false);
  });

  // ============================================================
  // Test 12: Database file exists on disk
  // Confirms the connection is truly file-based (not in-memory).
  // ============================================================

  it("FILE: database file exists on disk at the expected path", () => {
    // The file should have been created by better-sqlite3 during beforeAll.
    expect(existsSync(TEST_DB_PATH)).toBe(true);
  });

  // ============================================================
  // Test 13: Foreign keys are enabled
  // SQLite disables foreign keys by default. The test setup enables
  // them via PRAGMA foreign_keys = ON. We confirm this here.
  // ============================================================

  it("FOREIGN KEYS: foreign_keys pragma is enabled (returns 1)", () => {
    // pragma() is synchronous - returns an array of row objects.
    const result = sqlite.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });
});
