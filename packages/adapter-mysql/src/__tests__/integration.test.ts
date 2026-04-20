// Integration tests for the MySQL adapter against a real MySQL 8 database.
// Runs against a Docker container: nextly-mysql-test
//
// Requires: docker run -d --name nextly-mysql-test -e MYSQL_ROOT_PASSWORD=root \
//   -e MYSQL_DATABASE=nextly_test -p 3307:3306 mysql:8
// Connection: mysql://root:root@localhost:3307/nextly_test
//
// Note: MySQL has no RETURNING clause. All insert/update operations are verified
// with a subsequent SELECT to confirm the data was persisted correctly.
// Upsert uses ON DUPLICATE KEY UPDATE (.onDuplicateKeyUpdate), not .onConflictDoUpdate.

import { eq, and } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  text,
  double,
  boolean,
  json,
  timestamp,
} from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ============================================================
// Connection string for the test MySQL 8 instance
// ============================================================

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL_MYSQL ||
  "mysql://root:root@localhost:3307/nextly_test";

// ============================================================
// Drizzle table definitions matching the raw SQL schemas below.
// These are used for all CRUD assertions via the Drizzle query API.
// ============================================================

// Table 1: products - tests numeric, boolean, and JSON column handling
const productsTable = mysqlTable("int_mysql_products", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  price: double("price"),
  is_active: boolean("is_active"),
  metadata: json("metadata"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Table 2: posts - tests text, varchar status, and multi-condition queries
const postsTable = mysqlTable("int_mysql_posts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  body: text("body"),
  status: varchar("status", { length: 50 }).default("draft"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ============================================================
// Connectivity check - skip entire suite if MySQL is unavailable.
// This mirrors the PostgreSQL integration test pattern so the test
// runner does not fail in environments without the Docker container.
// ============================================================

const canConnect = async (): Promise<boolean> => {
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection(TEST_DB_URL);
    await conn.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    if (conn) {
      await conn.end().catch(() => {});
    }
  }
};

// ============================================================
// Test suite
// ============================================================

describe("MySQL Adapter Integration (Real MySQL 8)", async () => {
  const isAvailable = await canConnect();

  // If the database is unreachable, skip every test rather than failing.
  if (!isAvailable) {
    it.skip("Skipping: Test MySQL not available at " + TEST_DB_URL, () => {});
    return;
  }

  // Raw mysql2 connection used for DDL setup/teardown (Drizzle does not expose
  // raw DDL in a dialect-agnostic way, and we cannot use pushSchema in tests).
  let rawConn: mysql.Connection;

  // Drizzle instance wrapping a dedicated pool for CRUD tests.
  let db: ReturnType<typeof drizzle>;
  let pool: mysql.Pool;

  beforeAll(async () => {
    // Create a raw connection for DDL (DROP / CREATE TABLE).
    rawConn = await mysql.createConnection(TEST_DB_URL);

    // Create a pool for the Drizzle ORM client used in tests.
    pool = mysql.createPool(TEST_DB_URL);
    db = drizzle(pool);

    // Drop and recreate test tables to ensure a clean slate.
    // Each column maps 1:1 to the Drizzle table definition above.
    await rawConn.query(`DROP TABLE IF EXISTS int_mysql_products`);
    await rawConn.query(`
      CREATE TABLE int_mysql_products (
        id          VARCHAR(36)   PRIMARY KEY,
        title       VARCHAR(255)  NOT NULL,
        slug        VARCHAR(255)  NOT NULL,
        price       DOUBLE,
        is_active   BOOLEAN,
        metadata    JSON,
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await rawConn.query(`DROP TABLE IF EXISTS int_mysql_posts`);
    await rawConn.query(`
      CREATE TABLE int_mysql_posts (
        id          VARCHAR(36)   PRIMARY KEY,
        title       VARCHAR(255)  NOT NULL,
        slug        VARCHAR(255)  NOT NULL,
        body        TEXT,
        status      VARCHAR(50)   DEFAULT 'draft',
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  });

  afterAll(async () => {
    // Clean up test tables and close connections.
    try {
      await rawConn.query(`DROP TABLE IF EXISTS int_mysql_products`);
      await rawConn.query(`DROP TABLE IF EXISTS int_mysql_posts`);
    } catch {
      // Ignore cleanup errors - the container may already be gone.
    }
    await rawConn.end().catch(() => {});
    await pool.end().catch(() => {});
  });

  // ============================================================
  // Test 1: INSERT
  // MySQL has no RETURNING clause, so we verify the insert by
  // doing a SELECT immediately after to confirm the row exists.
  // ============================================================

  it("INSERT: inserts a record and verifies with SELECT", async () => {
    // Insert the product row via Drizzle.
    await db.insert(productsTable).values({
      id: "prod-1",
      title: "iPhone 16",
      slug: "iphone-16",
      price: 999.99,
      is_active: true,
      metadata: { color: "black" },
    });

    // SELECT the row back to confirm it was persisted.
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("title", "iPhone 16");
    expect(rows[0]).toHaveProperty("price", 999.99);
  });

  // ============================================================
  // Test 2: SELECT with WHERE (eq filter)
  // ============================================================

  it("SELECT: reads back the inserted record with eq filter", async () => {
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("slug", "iphone-16");
  });

  // ============================================================
  // Test 3: SELECT with limit and offset
  // Insert a second product first so there are two rows to paginate.
  // ============================================================

  it("SELECT: supports limit and offset for pagination", async () => {
    // Insert a second product to have two rows available.
    await db.insert(productsTable).values({
      id: "prod-2",
      title: "MacBook Pro",
      slug: "macbook-pro",
      price: 2499,
      is_active: false,
    });

    // Fetch the second row using limit=1 offset=1.
    const limited = await db.select().from(productsTable).limit(1).offset(1);

    expect(limited).toHaveLength(1);
    expect(limited[0]).toHaveProperty("id", "prod-2");
  });

  // ============================================================
  // Test 4: UPDATE a record (verify with SELECT after)
  // ============================================================

  it("UPDATE: modifies a record and verifies with SELECT", async () => {
    // Update prod-1 title and price.
    await db
      .update(productsTable)
      .set({ price: 899, title: "iPhone 16 (Sale)" })
      .where(eq(productsTable.id, "prod-1"));

    // Verify the update was applied.
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("price", 899);
    expect(rows[0]).toHaveProperty("title", "iPhone 16 (Sale)");
  });

  // ============================================================
  // Test 5: DELETE a record (verify it's gone)
  // ============================================================

  it("DELETE: removes a record and verifies it is gone", async () => {
    // Delete prod-2.
    await db.delete(productsTable).where(eq(productsTable.id, "prod-2"));

    // Confirm the row no longer exists.
    const remaining = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-2"));

    expect(remaining).toHaveLength(0);
  });

  // ============================================================
  // Test 6: INSERT MANY (3 records)
  // ============================================================

  it("INSERT MANY: inserts multiple records in a single call", async () => {
    // Batch insert 3 posts.
    await db.insert(postsTable).values([
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
    ]);

    // Verify all three rows were inserted.
    const all = await db.select().from(postsTable);
    expect(all).toHaveLength(3);
  });

  // ============================================================
  // Test 7: SELECT with multiple conditions (and)
  // ============================================================

  it("SELECT: queries with multiple WHERE conditions", async () => {
    // Only "published" posts should match.
    const published = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.status, "published"));

    expect(published).toHaveLength(2);

    // Combine conditions: published AND specific slug.
    const specific = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.status, "published"),
          eq(postsTable.slug, "first-post")
        )
      );

    expect(specific).toHaveLength(1);
    expect(specific[0]).toHaveProperty("title", "First Post");
  });

  // ============================================================
  // Test 8: UPSERT via onDuplicateKeyUpdate
  // MySQL uses ON DUPLICATE KEY UPDATE, not onConflictDoUpdate.
  // We insert a post, then upsert with the same id to update fields.
  // ============================================================

  it("UPSERT: inserts or updates on duplicate key (MySQL ON DUPLICATE KEY UPDATE)", async () => {
    // Upsert post-1 which already exists - should update title and body.
    await db
      .insert(postsTable)
      .values({
        id: "post-1",
        title: "Updated First Post",
        slug: "first-post",
        body: "Updated body",
        status: "draft",
      })
      .onDuplicateKeyUpdate({
        set: { title: "Updated First Post", body: "Updated body" },
      });

    // Verify the row was updated (not duplicated).
    const rows = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, "post-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("title", "Updated First Post");
    expect(rows[0]).toHaveProperty("body", "Updated body");
  });

  // ============================================================
  // Test 9: JSON column handling
  // MySQL stores JSON as a native JSON type. Drizzle serialises
  // JS objects on insert and deserialises them on select.
  // ============================================================

  it("JSON: round-trips a JSON column correctly", async () => {
    const metadata = {
      color: "silver",
      storage: "256GB",
      tags: ["new", "sale"],
    };

    // Insert a product with a JSON metadata value.
    await db.insert(productsTable).values({
      id: "prod-json",
      title: "iPad Pro",
      slug: "ipad-pro",
      metadata,
    });

    // Read it back and confirm the JSON was round-tripped.
    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-json"));

    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual(metadata);
  });

  // ============================================================
  // Test 10: Boolean handling (tinyint(1) to boolean round-trip)
  // MySQL stores BOOLEAN as tinyint(1). Drizzle converts 0/1 back
  // to false/true automatically when using the boolean() column type.
  // ============================================================

  it("BOOLEAN: round-trips a boolean column (tinyint(1)) correctly", async () => {
    // Insert one active and one inactive product.
    await db.insert(productsTable).values([
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
    ]);

    // Read back both rows.
    const activeRows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-true"));

    const inactiveRows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-false"));

    // Drizzle must convert tinyint(1) back to a JS boolean.
    expect(activeRows[0].is_active).toBe(true);
    expect(inactiveRows[0].is_active).toBe(false);
  });
});
