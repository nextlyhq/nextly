// Integration tests for the PostgreSQL adapter against a real Postgres 16 database.
// Runs against the Docker dev container: nextly-postgres (port 5432).
//
// Requires: docker compose up -d postgres
// Connection: postgresql://postgres:dev_password_change_in_production@localhost:5432/nextly_test
//
// Mirrors the MySQL integration test pattern but exercises PG-specific features:
// - JSONB column type (not MySQL's JSON)
// - Native RETURNING clause (no workaround needed)
// - ON CONFLICT DO UPDATE (not ON DUPLICATE KEY UPDATE)
// - Transactions with commit and rollback
// - Unique constraint violation surfaces the Postgres SQLSTATE code (23505)

import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  varchar,
  text,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ============================================================
// Connection string for the test Postgres 16 instance
// ============================================================

// F18 canonical env var: TEST_POSTGRES_URL.
// Falls back to the dev Docker container if unset (local dev convenience).
const TEST_DB_URL =
  process.env.TEST_POSTGRES_URL ||
  "postgresql://postgres:dev_password_change_in_production@localhost:5432/nextly_test";

// ============================================================
// Drizzle table definitions matching the raw SQL schemas below.
// Exercised via Drizzle query API for all CRUD assertions.
// ============================================================

// Table 1: products — exercises numeric, boolean, JSONB columns.
const productsTable = pgTable("int_pg_products", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  price: doublePrecision("price"),
  is_active: boolean("is_active"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// Table 2: posts — exercises text, varchar, multi-condition where clauses.
const postsTable = pgTable("int_pg_posts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  body: text("body"),
  status: varchar("status", { length: 50 }).default("draft"),
  created_at: timestamp("created_at").defaultNow(),
});

// ============================================================
// Connectivity check - skip entire suite if Postgres is unavailable.
// Mirrors the MySQL and SQLite integration test pattern so the test
// runner does not fail in environments without the Docker container.
// ============================================================

const canConnect = async (): Promise<boolean> => {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

// ============================================================
// Test suite
// ============================================================

describe("PostgreSQL Adapter Integration (Real Postgres 16)", async () => {
  const isAvailable = await canConnect();

  // If the database is unreachable, skip every test rather than failing.
  if (!isAvailable) {
    it.skip(
      "Skipping: Test Postgres not available at " + TEST_DB_URL,
      () => {}
    );
    return;
  }

  // Raw pg client used for DDL setup/teardown (Drizzle does not expose raw DDL
  // in a dialect-agnostic way, and pushSchema needs TTY in tests).
  let rawClient: pg.Client;

  // Drizzle instance wrapping a dedicated pool for CRUD tests.
  let db: ReturnType<typeof drizzle>;
  let pool: pg.Pool;

  beforeAll(async () => {
    // Create a raw pg client for DDL (DROP / CREATE TABLE).
    rawClient = new pg.Client({ connectionString: TEST_DB_URL });
    await rawClient.connect();

    // Create a pool for the Drizzle ORM client used in tests.
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);

    // Drop and recreate test tables to ensure a clean slate.
    // Each column maps 1:1 to the Drizzle table definition above.
    await rawClient.query(`DROP TABLE IF EXISTS int_pg_products`);
    await rawClient.query(`
      CREATE TABLE int_pg_products (
        id          VARCHAR(36)      PRIMARY KEY,
        title       VARCHAR(255)     NOT NULL,
        slug        VARCHAR(255)     NOT NULL,
        price       DOUBLE PRECISION,
        is_active   BOOLEAN,
        metadata    JSONB,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);

    await rawClient.query(`DROP TABLE IF EXISTS int_pg_posts`);
    await rawClient.query(`
      CREATE TABLE int_pg_posts (
        id          VARCHAR(36)  PRIMARY KEY,
        title       VARCHAR(255) NOT NULL,
        slug        VARCHAR(255) NOT NULL,
        body        TEXT,
        status      VARCHAR(50)  DEFAULT 'draft',
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
  });

  afterAll(async () => {
    // Clean up test tables and close connections.
    try {
      await rawClient.query(`DROP TABLE IF EXISTS int_pg_products`);
      await rawClient.query(`DROP TABLE IF EXISTS int_pg_posts`);
    } catch {
      // Ignore cleanup errors - the container may already be gone.
    }
    await rawClient.end().catch(() => {});
    await pool.end().catch(() => {});
  });

  // ============================================================
  // Test 1: INSERT with native RETURNING
  // Postgres supports RETURNING, so the insert call itself returns the row.
  // No subsequent SELECT needed (unlike MySQL).
  // ============================================================

  it("INSERT: inserts and returns the row natively via RETURNING", async () => {
    const inserted = await db
      .insert(productsTable)
      .values({
        id: "prod-1",
        title: "iPhone 16",
        slug: "iphone-16",
        price: 999.99,
        is_active: true,
        metadata: { color: "black" },
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveProperty("title", "iPhone 16");
    expect(inserted[0]).toHaveProperty("price", 999.99);
    expect(inserted[0].metadata).toEqual({ color: "black" });
  });

  // ============================================================
  // Test 2: SELECT with eq filter
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
  // Test 3: SELECT with limit and offset for pagination
  // ============================================================

  it("SELECT: supports limit and offset for pagination", async () => {
    await db.insert(productsTable).values({
      id: "prod-2",
      title: "MacBook Pro",
      slug: "macbook-pro",
      price: 2499,
      is_active: false,
    });

    const limited = await db
      .select()
      .from(productsTable)
      .orderBy(productsTable.id)
      .limit(1)
      .offset(1);

    expect(limited).toHaveLength(1);
    expect(limited[0]).toHaveProperty("id", "prod-2");
  });

  // ============================================================
  // Test 4: UPDATE with RETURNING
  // ============================================================

  it("UPDATE: modifies and returns the updated row natively", async () => {
    const updated = await db
      .update(productsTable)
      .set({ price: 899, title: "iPhone 16 (Sale)" })
      .where(eq(productsTable.id, "prod-1"))
      .returning();

    expect(updated).toHaveLength(1);
    expect(updated[0]).toHaveProperty("price", 899);
    expect(updated[0]).toHaveProperty("title", "iPhone 16 (Sale)");
  });

  // ============================================================
  // Test 5: DELETE with RETURNING
  // ============================================================

  it("DELETE: removes a record and returns it natively", async () => {
    const deleted = await db
      .delete(productsTable)
      .where(eq(productsTable.id, "prod-2"))
      .returning();

    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toHaveProperty("id", "prod-2");

    const remaining = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-2"));
    expect(remaining).toHaveLength(0);
  });

  // ============================================================
  // Test 6: INSERT MANY (batched insert)
  // ============================================================

  it("INSERT MANY: inserts multiple records in a single call", async () => {
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

    const all = await db.select().from(postsTable);
    expect(all).toHaveLength(3);
  });

  // ============================================================
  // Test 7: SELECT with multi-condition WHERE (and)
  // ============================================================

  it("SELECT: queries with multiple WHERE conditions", async () => {
    const published = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.status, "published"));
    expect(published).toHaveLength(2);

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
  // Test 8: UPSERT via onConflictDoUpdate
  // Postgres uses ON CONFLICT DO UPDATE, not ON DUPLICATE KEY UPDATE.
  // Insert a post with an existing PK — should update the row, not duplicate it.
  // ============================================================

  it("UPSERT: inserts or updates on conflict (PG ON CONFLICT DO UPDATE)", async () => {
    await db
      .insert(postsTable)
      .values({
        id: "post-1",
        title: "Updated First Post",
        slug: "first-post",
        body: "Updated body",
        status: "draft",
      })
      .onConflictDoUpdate({
        target: postsTable.id,
        set: { title: "Updated First Post", body: "Updated body" },
      });

    const rows = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, "post-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("title", "Updated First Post");
    expect(rows[0]).toHaveProperty("body", "Updated body");
  });

  // ============================================================
  // Test 9: JSONB round-trip and query inside the JSON document
  // PG-specific: jsonb columns support ->, ->>, @> operators
  // ============================================================

  it("JSONB: round-trips a JSON column and queries inside it", async () => {
    const metadata = {
      color: "silver",
      storage: "256GB",
      tags: ["new", "sale"],
    };

    await db.insert(productsTable).values({
      id: "prod-jsonb",
      title: "iPad Pro",
      slug: "ipad-pro",
      metadata,
    });

    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-jsonb"));

    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual(metadata);

    // PG-specific: query inside the JSONB column using the ->> operator.
    const byColor = await db
      .select()
      .from(productsTable)
      .where(sql`${productsTable.metadata}->>'color' = 'silver'`);

    expect(byColor.length).toBeGreaterThanOrEqual(1);
    expect(byColor.find(r => r.id === "prod-jsonb")).toBeDefined();
  });

  // ============================================================
  // Test 10: Boolean round-trip
  // ============================================================

  it("BOOLEAN: round-trips a boolean column correctly", async () => {
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

    const activeRows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-true"));
    const inactiveRows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-bool-false"));

    expect(activeRows[0].is_active).toBe(true);
    expect(inactiveRows[0].is_active).toBe(false);
  });

  // ============================================================
  // Test 11: Transaction commit
  // Drizzle's pg driver supports native BEGIN/COMMIT via .transaction().
  // ============================================================

  it("TRANSACTION: commits successfully when the callback returns", async () => {
    await db.transaction(async tx => {
      await tx.insert(productsTable).values({
        id: "prod-tx-commit",
        title: "TX Commit Product",
        slug: "tx-commit",
        price: 100,
        is_active: true,
      });
    });

    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-tx-commit"));
    expect(rows).toHaveLength(1);
  });

  // ============================================================
  // Test 12: Transaction rollback on thrown error
  // The callback throws — Drizzle should ROLLBACK the transaction
  // and the row should NOT be persisted.
  // ============================================================

  it("TRANSACTION: rolls back when the callback throws", async () => {
    await expect(
      db.transaction(async tx => {
        await tx.insert(productsTable).values({
          id: "prod-tx-rollback",
          title: "TX Rollback Product",
          slug: "tx-rollback",
          price: 200,
          is_active: true,
        });
        throw new Error("deliberate rollback");
      })
    ).rejects.toThrow("deliberate rollback");

    const rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, "prod-tx-rollback"));
    expect(rows).toHaveLength(0);
  });

  // ============================================================
  // Test 13: Unique constraint violation surfaces the Postgres error code
  // PG error code 23505 = unique_violation. The adapter's error classifier
  // relies on this code; this test verifies the driver surfaces it raw.
  // ============================================================

  it("ERROR: unique constraint violation surfaces the Postgres error code", async () => {
    // Insert a row with id "prod-unique".
    await db.insert(productsTable).values({
      id: "prod-unique",
      title: "Unique Product",
      slug: "unique-product",
      price: 50,
      is_active: true,
    });

    // Try to insert again with the same PK — should throw a unique violation.
    //
    // Drizzle's node-postgres driver wraps the raw pg error inside err.cause,
    // so the SQLSTATE code lives at err.cause.code, not err.code. We read both
    // locations to be resilient if Drizzle's error shape changes across versions.
    let caughtCode: string | undefined;
    try {
      await db.insert(productsTable).values({
        id: "prod-unique",
        title: "Duplicate",
        slug: "duplicate",
        price: 75,
        is_active: true,
      });
    } catch (err) {
      // PG error code 23505 = unique_violation
      const e = err as { code?: string; cause?: { code?: string } };
      caughtCode = e.code ?? e.cause?.code;
    }

    expect(caughtCode).toBe("23505");
  });
});
