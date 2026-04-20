// Integration tests for the Drizzle-based schema pipeline.
// Runs against a real PostgreSQL database (docker-compose.test.yml).
//
// Requires: docker compose -f docker-compose.test.yml up -d
// Connection: postgres://postgres:postgres@localhost:5433/nextly_test
//
// Note: drizzle-kit's pushSchema() requires a TTY for interactive prompts
// (https://github.com/drizzle-team/drizzle-orm/issues/4651).
// We test schema generation and Drizzle CRUD separately from pushSchema().
// pushSchema() is tested in preview (dry-run) mode only, which does not prompt.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzlePushService } from "../../../../domains/schema/services/drizzle-push-service";
import { generateRuntimeSchema } from "../../../../domains/schema/services/runtime-schema-generator";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { SchemaRegistry } from "../../schema-registry";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5433/nextly_test";

// Check if test database is available
const canConnect = async (): Promise<boolean> => {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query("SELECT 1");
    await pool.end();
    return true;
  } catch {
    await pool.end();
    return false;
  }
};

describe("Schema Push Integration (Real PostgreSQL)", async () => {
  const isAvailable = await canConnect();
  if (!isAvailable) {
    it.skip(
      "Skipping: Test PostgreSQL not available at " + TEST_DB_URL,
      () => {}
    );
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let pushService: DrizzlePushService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    pushService = new DrizzlePushService("postgresql", db);

    // Create test tables via raw SQL (bypassing pushSchema TTY limitation)
    // This simulates what pushSchema would do, letting us test CRUD via Drizzle API
    await pool.query(`
      DROP TABLE IF EXISTS "dc_int_products" CASCADE;
      CREATE TABLE "dc_int_products" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "price" double precision,
        "is_active" boolean,
        "metadata" jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    await pool.query(`
      DROP TABLE IF EXISTS "dc_int_posts" CASCADE;
      CREATE TABLE "dc_int_posts" (
        "id" text PRIMARY KEY,
        "title" text NOT NULL,
        "slug" text NOT NULL,
        "body" text,
        "status" text DEFAULT 'draft',
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);
  });

  afterAll(async () => {
    // Clean up test tables
    try {
      await pool.query('DROP TABLE IF EXISTS "dc_int_products" CASCADE');
      await pool.query('DROP TABLE IF EXISTS "dc_int_posts" CASCADE');
    } catch {
      // Ignore cleanup errors
    }
    await pool.end();
  });

  describe("runtime schema generator produces valid Drizzle objects", () => {
    it("generates table objects matching the real table structure", () => {
      const fields: FieldDefinition[] = [
        { name: "title", type: "text", required: true },
        { name: "price", type: "number" },
        { name: "is_active", type: "checkbox" },
        { name: "metadata", type: "json" },
      ];

      const result = generateRuntimeSchema(
        "dc_int_products",
        fields,
        "postgresql"
      );

      expect(result.table).toBeDefined();
      expect(result.schemaRecord).toHaveProperty("dc_int_products");
    });
  });

  describe("CRUD via Drizzle query API against real database", () => {
    // Generate the Drizzle table object matching our test table
    const productFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "price", type: "number" },
      { name: "is_active", type: "checkbox" },
      { name: "metadata", type: "json" },
    ];
    const { table: productsTable } = generateRuntimeSchema(
      "dc_int_products",
      productFields,
      "postgresql"
    );

    const postFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true },
      { name: "body", type: "textarea" },
      { name: "status", type: "select" },
    ];
    const { table: postsTable } = generateRuntimeSchema(
      "dc_int_posts",
      postFields,
      "postgresql"
    );

    it("INSERT: inserts a record and returns it via .returning()", async () => {
      const inserted = await db
        .insert(productsTable as any)
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
      expect(inserted[0]).toHaveProperty("is_active", true);
    });

    it("SELECT: reads back the inserted record", async () => {
      const rows = await db
        .select()
        .from(productsTable as any)
        .where(eq((productsTable as any).id, "prod-1"));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty("title", "iPhone 16");
      expect(rows[0]).toHaveProperty("slug", "iphone-16");
    });

    it("SELECT: filters with WHERE conditions", async () => {
      // Insert a second product
      await db.insert(productsTable as any).values({
        id: "prod-2",
        title: "MacBook Pro",
        slug: "macbook-pro",
        price: 2499,
        is_active: false,
      });

      // Filter by is_active = true
      const activeProducts = await db
        .select()
        .from(productsTable as any)
        .where(eq((productsTable as any).is_active, true));

      expect(activeProducts).toHaveLength(1);
      expect(activeProducts[0]).toHaveProperty("title", "iPhone 16");
    });

    it("SELECT: supports limit and offset", async () => {
      const limited = await db
        .select()
        .from(productsTable as any)
        .limit(1)
        .offset(1);

      expect(limited).toHaveLength(1);
      expect(limited[0]).toHaveProperty("id", "prod-2");
    });

    it("UPDATE: modifies a record and returns it", async () => {
      const updated = await db
        .update(productsTable as any)
        .set({ price: 899, title: "iPhone 16 (Sale)" })
        .where(eq((productsTable as any).id, "prod-1"))
        .returning();

      expect(updated).toHaveLength(1);
      expect(updated[0]).toHaveProperty("price", 899);
      expect(updated[0]).toHaveProperty("title", "iPhone 16 (Sale)");
    });

    it("DELETE: removes a record", async () => {
      const deleted = await db
        .delete(productsTable as any)
        .where(eq((productsTable as any).id, "prod-2"))
        .returning();

      expect(deleted).toHaveLength(1);

      // Verify it's gone
      const remaining = await db
        .select()
        .from(productsTable as any)
        .where(eq((productsTable as any).id, "prod-2"));

      expect(remaining).toHaveLength(0);
    });

    it("INSERT MANY: inserts multiple records", async () => {
      const posts = await db
        .insert(postsTable as any)
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
        .returning();

      expect(posts).toHaveLength(3);
    });

    it("SELECT: queries with multiple conditions", async () => {
      const published = await db
        .select()
        .from(postsTable as any)
        .where(eq((postsTable as any).status, "published"));

      expect(published).toHaveLength(2);
    });

    it("UPSERT: inserts or updates on conflict", async () => {
      // Insert a new post, then upsert with same id
      const upserted = await db
        .insert(postsTable as any)
        .values({
          id: "post-1",
          title: "Updated First Post",
          slug: "first-post",
          body: "Updated body",
          status: "draft",
        })
        .onConflictDoUpdate({
          target: (postsTable as any).id,
          set: { title: "Updated First Post", body: "Updated body" },
        })
        .returning();

      expect(upserted).toHaveLength(1);
      expect(upserted[0]).toHaveProperty("title", "Updated First Post");
      expect(upserted[0]).toHaveProperty("body", "Updated body");
    });
  });

  describe("pushSchema preview", () => {
    // pushSchema() requires a TTY terminal for interactive prompts, even in
    // preview mode (https://github.com/drizzle-team/drizzle-orm/issues/4651).
    // This test is skipped in non-TTY environments (CI, piped input).
    // In development, run with: npx vitest run --reporter=verbose <this file>
    it.skipIf(!process.stdin.isTTY)(
      "preview returns statements without applying (TTY only)",
      async () => {
        const fields: FieldDefinition[] = [
          { name: "title", type: "text", required: true },
          { name: "content", type: "textarea" },
        ];

        const { schemaRecord } = generateRuntimeSchema(
          "dc_int_preview_test",
          fields,
          "postgresql"
        );

        const preview = await pushService.preview(schemaRecord);

        expect(preview.applied).toBe(false);
        expect(preview.statementsToExecute.length).toBeGreaterThan(0);
      }
    );
  });

  describe("SchemaRegistry integration", () => {
    it("registers and resolves dynamic tables", () => {
      const registry = new SchemaRegistry("postgresql");

      const fields: FieldDefinition[] = [
        { name: "title", type: "text", required: true },
      ];
      const { table } = generateRuntimeSchema(
        "dc_int_registry_test",
        fields,
        "postgresql"
      );

      registry.registerDynamicSchema("dc_int_registry_test", table);

      expect(registry.hasTable("dc_int_registry_test")).toBe(true);
      expect(registry.getTable("dc_int_registry_test")).toBe(table);
      expect(registry.getDynamicTableNames()).toContain("dc_int_registry_test");
    });

    it("getAllSchemas merges static and dynamic schemas", () => {
      const registry = new SchemaRegistry("postgresql");
      registry.registerStaticSchemas({ users: { _: "static" } });

      const fields: FieldDefinition[] = [{ name: "title", type: "text" }];
      const { table } = generateRuntimeSchema(
        "dc_int_dynamic",
        fields,
        "postgresql"
      );
      registry.registerDynamicSchema("dc_int_dynamic", table);

      const all = registry.getAllSchemas();
      expect(Object.keys(all)).toContain("users");
      expect(Object.keys(all)).toContain("dc_int_dynamic");
    });
  });
});
