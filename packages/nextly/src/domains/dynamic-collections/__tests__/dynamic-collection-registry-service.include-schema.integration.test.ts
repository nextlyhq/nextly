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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { sqliteTableDdl } from "../../../database/sqlite-table-ddl";
import { dynamicCollectionsSqlite } from "../../../schemas/dynamic-collections/sqlite";
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
 * Every column the narrow projection carries: the table's, less `fields`.
 *
 * The list is exhaustive on purpose. `ListCollectionsResponse<false>` is
 * `Omit<CollectionMetadata, "fields">`, so a column the query forgets to name
 * still type-checks at every call site and simply arrives `undefined` — the
 * failure a reader of `status` or `versions` sees is a missing value, never a
 * missing property. Asserting only a subset reproduces exactly that blind
 * spot, which is how ten columns went missing from the shape unnoticed.
 */
const PROJECTED_COLUMNS = [
  "id",
  "slug",
  "tableName",
  "description",
  "labels",
  "timestamps",
  "status",
  "localized",
  "versions",
  "revalidate",
  "webhooks",
  "admin",
  "hooks",
  "source",
  "locked",
  "configPath",
  "schemaHash",
  "schemaVersion",
  "migrationStatus",
  "lastMigrationId",
  "accessRules",
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

    // Built from the schema the service itself reads, so the fixture cannot
    // describe a table shape that production does not have. A column added to
    // `dynamicCollectionsSqlite` appears here without anyone maintaining it —
    // which matters most for the wide `select()`, whose statement names every
    // column and fails outright when the fixture is one behind.
    for (const statement of sqliteTableDdl(dynamicCollectionsSqlite)) {
      sqlite.exec(statement);
    }

    // Three rows, inserted oldest-first, with slugs that are NOT in creation
    // order so the sorting assertion below cannot pass by accident.
    //
    // Every NOT NULL column is given a value rather than left to a default:
    // the generated DDL emits no defaults, and a row that leans on one is a
    // row this suite did not describe.
    const baseTime = 1_700_000_000_000;
    const insert = sqlite.prepare(
      `INSERT INTO dynamic_collections
         (id, slug, table_name, description, labels, fields, timestamps,
          status, localized, source, locked, schema_hash, schema_version,
          migration_status, created_at, updated_at)
       VALUES (@id, @slug, @tableName, @description, @labels, @fields, 1,
          0, 0, 'ui', 0, @schemaHash, 1,
          'pending', @createdAt, @updatedAt)`
    );
    const seed = (
      slug: string,
      schemaHash: string,
      createdAt: number
    ): void => {
      insert.run({
        id: `id-${slug}`,
        slug,
        tableName: `dc_${slug}`,
        description: `posts about ${slug}`,
        labels: JSON.stringify({ singular: slug, plural: `${slug}s` }),
        fields: FIELDS_JSON,
        schemaHash,
        createdAt,
        updatedAt: createdAt,
      });
    };
    seed("zebra", "h1", baseTime);
    seed("alpha", "h2", baseTime + 100);
    seed("mango", "h3", baseTime + 200);

    const db = drizzle({ client: sqlite });
    // `satisfies` rather than a cast: the two methods the registry reaches for
    // are checked against the adapter's own declarations, so a change to
    // either signature fails here instead of leaving the suite exercising a
    // shape production no longer accepts. The widening that follows is the
    // narrow part — this stands in for an adapter, and only these two members
    // are ever called.
    const adapter = {
      getDrizzle: <T>() => db as T,
      // The values @nextlyhq/adapter-sqlite reports. A fixture that claims a
      // capability the real adapter does not have steers the query builder
      // down a branch production never takes.
      getCapabilities: () => ({
        dialect: "sqlite" as const,
        supportsJsonb: false,
        supportsJson: true,
        supportsArrays: false,
        supportsGeneratedColumns: true,
        supportsFts: true,
        supportsIlike: false,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        maxParamsPerQuery: 999,
        maxIdentifierLength: 128,
      }),
    } satisfies Pick<DrizzleAdapter, "getDrizzle" | "getCapabilities">;

    registry = new DynamicCollectionRegistryService(
      adapter as unknown as DrizzleAdapter,
      noopLogger
    );
  });

  afterEach(() => {
    // better-sqlite3 holds a native handle; an in-memory database is only
    // reclaimed when it is closed, and this suite opens one per test.
    sqlite.close();
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
