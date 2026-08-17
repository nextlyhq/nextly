// Integration regression test for the sort-by-name bug surfaced during the
//
// Bug: DynamicCollectionRegistryService.listCollections has a switch that
// only handles sortBy in {"slug", "createdAt", "updatedAt"}. The frontend
// (admin) sends sortBy="name" (its public-facing alias for slug) but the
// switch falls to the default case and orders by createdAt. The visible
// symptom: the admin sidebar's Collections icon "smart-default" always
// points to whichever collection was created first (typically a code-first
// "posts" from the blog template), regardless of which collection the user
// just created via the Builder.
//
// Fix: handle sortBy="name" by ordering on the slug column. (Frontend's
// "name" maps to backend's "slug" — they're semantically the same field.)

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { sqliteTableDdl } from "../../../__tests__/fixtures/sqlite-table-ddl";
import { dynamicCollectionsSqlite } from "../../../schemas/dynamic-collections/sqlite";
import { DynamicCollectionRegistryService } from "../services/dynamic-collection-registry-service";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<
  (typeof DynamicCollectionRegistryService)["prototype"]["constructor"]
> extends [unknown, infer L, ...unknown[]]
  ? L
  : never;

describe("DynamicCollectionRegistryService.listCollections — sortBy parameter", () => {
  let sqlite: Database.Database;
  let registry: DynamicCollectionRegistryService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");

    // Built from the schema the service reads, so this fixture cannot fall
    // behind the table it stands in for — which matters because every case
    // here asks for a projection, and the wide one names every column.
    for (const statement of sqliteTableDdl(dynamicCollectionsSqlite)) {
      sqlite.exec(statement);
    }

    // Insert three rows with deliberately non-alphabetical createdAt order so
    // sort-by-createdAt and sort-by-name diverge:
    //   created in this order: zebra (oldest), alpha (middle), mango (newest)
    //   alphabetical by slug:  alpha, mango, zebra
    const baseTime = 1_700_000_000;
    const insert = sqlite.prepare(
      `INSERT INTO dynamic_collections
         (id, slug, table_name, labels, fields, timestamps, status, localized,
          source, locked, schema_hash, schema_version, migration_status,
          created_at, updated_at)
       VALUES (@id, @slug, @tableName, @labels, '[]', 1, 0, 0,
          'ui', 0, @schemaHash, 1, 'pending',
          @createdAt, @createdAt)`
    );
    const seed = (slug: string, schemaHash: string, createdAt: number) =>
      insert.run({
        id: `id-${slug}`,
        slug,
        tableName: `dc_${slug}`,
        labels: JSON.stringify({ singular: slug, plural: `${slug}s` }),
        schemaHash,
        createdAt,
      });
    seed("zebra", "h1", baseTime);
    seed("alpha", "h2", baseTime + 100);
    seed("mango", "h3", baseTime + 200);

    const db = drizzle({ client: sqlite });
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

    // `satisfies` checks the two members the registry reaches for against the
    // adapter's own declarations, so a signature change fails here rather than
    // leaving this suite exercising a shape production no longer accepts.
    registry = new DynamicCollectionRegistryService(
      adapter as unknown as DrizzleAdapter,
      noopLogger
    );
  });

  afterEach(() => {
    // better-sqlite3 holds a native handle per in-memory database, and this
    // suite opens one per test.
    sqlite.close();
  });

  it("sortBy=name asc returns collections ordered alphabetically by slug", async () => {
    const result = await registry.listCollections({
      sortBy: "name",
      sortOrder: "asc",
      page: 1,
      limit: 10,
      includeSchema: false,
    });

    const slugs = result.collections.map(c => c.slug);
    expect(slugs).toEqual(["alpha", "mango", "zebra"]);
  });

  it("sortBy=name desc returns collections ordered reverse-alphabetically by slug", async () => {
    const result = await registry.listCollections({
      sortBy: "name",
      sortOrder: "desc",
      page: 1,
      limit: 10,
      includeSchema: false,
    });

    const slugs = result.collections.map(c => c.slug);
    expect(slugs).toEqual(["zebra", "mango", "alpha"]);
  });

  it("sortBy=slug remains supported (no regression)", async () => {
    const result = await registry.listCollections({
      sortBy: "slug",
      sortOrder: "asc",
      page: 1,
      limit: 10,
      includeSchema: false,
    });

    const slugs = result.collections.map(c => c.slug);
    expect(slugs).toEqual(["alpha", "mango", "zebra"]);
  });

  it("sortBy=createdAt remains supported (no regression)", async () => {
    const result = await registry.listCollections({
      sortBy: "createdAt",
      sortOrder: "asc",
      page: 1,
      limit: 10,
      includeSchema: false,
    });

    const slugs = result.collections.map(c => c.slug);
    expect(slugs).toEqual(["zebra", "alpha", "mango"]);
  });

  it("default (no sortBy) falls back to createdAt desc — original behavior", async () => {
    const result = await registry.listCollections({
      page: 1,
      limit: 10,
      includeSchema: false,
    });

    const slugs = result.collections.map(c => c.slug);
    expect(slugs).toEqual(["mango", "alpha", "zebra"]);
  });
});
