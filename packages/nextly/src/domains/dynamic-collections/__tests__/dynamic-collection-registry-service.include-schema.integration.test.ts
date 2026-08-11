/**
 * The two column projections `listCollections` can return.
 *
 * The default `select()` reads every column. `includeSchema: false` swaps in
 * an explicit column list that omits `fields`, so a list view does not pay to
 * ship the schema blob for rows it only renders a name and a status for. The
 * two shapes are separate queries over the same table, and only the narrow one
 * names its columns — so a column added to the table reaches the wide shape
 * for free while the narrow shape silently keeps serving the old set.
 *
 * Pagination and sorting are asserted against the narrow shape for the same
 * reason: `limit`, `offset` and `orderBy` are appended to whichever query was
 * chosen, so a projection that builds its own clause chain can drift from the
 * wide one without any caller noticing.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import type { Logger } from "../../../shared/types";
import { DynamicCollectionRegistryService } from "../services/dynamic-collection-registry-service";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const FIELDS_JSON = JSON.stringify([
  { name: "title", type: "text", label: "Title" },
  { name: "body", type: "richtext", label: "Body" },
]);

/**
 * Every column the narrow projection carries. `fields` is the one it drops, so
 * asserting the presence of the rest is what distinguishes "omits the schema
 * blob" from "omits whatever the last edit forgot to list".
 */
const PROJECTED_COLUMNS = [
  "id",
  "slug",
  "tableName",
  "description",
  "labels",
  "timestamps",
  "admin",
  "source",
  "locked",
  "schemaVersion",
  "migrationStatus",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

describe("DynamicCollectionRegistryService.listCollections — includeSchema projection", () => {
  let sqlite: Database.Database;
  let registry: DynamicCollectionRegistryService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");

    // The production dynamic_collections schema, sqlite dialect.
    //
    // Written out rather than reused: no generator owns this table.
    // `generateSqliteCoreTableStatements` does not emit it and the ddl
    // emitters cover user collections, not the registry that lists them, so
    // there is no equivalent of `getSchemaEventsDdl` to call here.
    //
    // It has to carry every column. The wide `select()` names all of them, so
    // one missing here fails the query outright instead of returning a
    // narrower row — which makes an incomplete fixture look like a suite that
    // simply never exercises `includeSchema: true`.
    sqlite.exec(`
      CREATE TABLE dynamic_collections (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        table_name TEXT NOT NULL,
        description TEXT,
        labels TEXT NOT NULL,
        fields TEXT NOT NULL,
        timestamps INTEGER NOT NULL DEFAULT 1,
        status INTEGER NOT NULL DEFAULT 0,
        localized INTEGER NOT NULL DEFAULT 0,
        versions TEXT,
        revalidate TEXT,
        webhooks TEXT,
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
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX dynamic_collections_slug_unique ON dynamic_collections(slug);
      CREATE UNIQUE INDEX dynamic_collections_table_name_unique ON dynamic_collections(table_name);
    `);

    // Three rows, inserted oldest-first, with slugs that are NOT in creation
    // order so the sorting assertion below cannot pass by accident.
    const baseTime = 1_700_000_000_000;
    const insert = sqlite.prepare(
      `INSERT INTO dynamic_collections
         (id, slug, table_name, description, labels, fields, schema_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "id-zebra",
      "zebra",
      "dc_zebra",
      "posts about zebras",
      `{"singular":"Zebra","plural":"Zebras"}`,
      FIELDS_JSON,
      "h1",
      baseTime,
      baseTime
    );
    insert.run(
      "id-alpha",
      "alpha",
      "dc_alpha",
      "posts about alphas",
      `{"singular":"Alpha","plural":"Alphas"}`,
      FIELDS_JSON,
      "h2",
      baseTime + 100,
      baseTime + 100
    );
    insert.run(
      "id-mango",
      "mango",
      "dc_mango",
      "posts about mangoes",
      `{"singular":"Mango","plural":"Mangoes"}`,
      FIELDS_JSON,
      "h3",
      baseTime + 200,
      baseTime + 200
    );

    const db = drizzle({ client: sqlite });
    const fakeAdapter = {
      getDrizzle: () => db,
      getCapabilities: () => ({
        dialect: "sqlite" as const,
        supportsJsonb: false,
        supportsJson: true,
        supportsArrays: false,
        supportsIlike: false,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        supportsFts: false,
      }),
    };
    registry = new DynamicCollectionRegistryService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal hand-rolled adapter for this isolated integration test
      fakeAdapter as any,
      noopLogger
    );
  });

  it("omits fields when includeSchema is false", async () => {
    const result = await registry.listCollections({ includeSchema: false });

    expect(result.collections).toHaveLength(3);
    for (const row of result.collections as unknown as Record<
      string,
      unknown
    >[]) {
      expect(row).not.toHaveProperty("fields");
    }
  });

  it("keeps every non-schema column in the narrow projection", async () => {
    const result = await registry.listCollections({ includeSchema: false });
    const row = result.collections[0] as unknown as Record<string, unknown>;

    for (const column of PROJECTED_COLUMNS) {
      expect(row).toHaveProperty(column);
    }
  });

  it("returns fields when includeSchema is true", async () => {
    const result = await registry.listCollections({ includeSchema: true });
    const row = result.collections[0] as unknown as Record<string, unknown>;

    expect(row).toHaveProperty("fields");
    expect(row.fields).toEqual(JSON.parse(FIELDS_JSON));
  });

  it("returns fields by default when includeSchema is not supplied", async () => {
    const result = await registry.listCollections();
    const row = result.collections[0] as unknown as Record<string, unknown>;

    expect(row).toHaveProperty("fields");
  });

  it("applies pagination to the narrow projection", async () => {
    const page1 = await registry.listCollections({
      includeSchema: false,
      page: 1,
      limit: 2,
    });
    const page2 = await registry.listCollections({
      includeSchema: false,
      page: 2,
      limit: 2,
    });

    expect(page1.collections).toHaveLength(2);
    expect(page2.collections).toHaveLength(1);
    // Pages must not overlap — a broken offset would repeat the first row.
    const ids = [...page1.collections, ...page2.collections].map(
      row => (row as unknown as Record<string, unknown>).id
    );
    expect(new Set(ids).size).toBe(3);
    for (const row of page2.collections as unknown as Record<
      string,
      unknown
    >[]) {
      expect(row).not.toHaveProperty("fields");
    }
  });

  it("applies sorting to the narrow projection", async () => {
    const result = await registry.listCollections({
      includeSchema: false,
      sortBy: "name",
      sortOrder: "asc",
    });

    expect(
      (result.collections as unknown as Record<string, unknown>[]).map(
        row => row.slug
      )
    ).toEqual(["alpha", "mango", "zebra"]);
  });

  it("reports identical pagination metadata for both projections", async () => {
    const narrow = await registry.listCollections({
      includeSchema: false,
      page: 1,
      limit: 2,
    });
    const wide = await registry.listCollections({
      includeSchema: true,
      page: 1,
      limit: 2,
    });

    // Counting runs on its own query, independent of the projection — so the
    // two shapes must agree on totals or list views would paginate wrongly.
    expect(narrow.total).toBe(3);
    expect(narrow.totalPages).toBe(2);
    expect(narrow.page).toBe(1);
    expect(narrow.limit).toBe(2);
    expect({
      total: narrow.total,
      totalPages: narrow.totalPages,
      page: narrow.page,
      limit: narrow.limit,
    }).toEqual({
      total: wide.total,
      totalPages: wide.totalPages,
      page: wide.page,
      limit: wide.limit,
    });
  });
});
