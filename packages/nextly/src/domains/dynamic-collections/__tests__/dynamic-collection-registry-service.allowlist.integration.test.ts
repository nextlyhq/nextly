// The permission allowlist has to be a CONDITION on the query, because the
// `total` this returns is what a client pages by.
//
// Filtering the returned page in application code instead makes the rows and
// the meta describe different sets: the total becomes the count of one
// filtered page, so `totalPages` collapses to 1 and a client reading "there is
// no next page" stops with the rest of what it may see unreachable. It also
// reports how many rows exist that the reader is not allowed to see.

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { sqliteTableDdl } from "../../../__tests__/fixtures/sqlite-table-ddl";
import { dynamicCollectionsSqlite } from "../../../schemas/dynamic-collections/sqlite";
import { DynamicCollectionRegistryService } from "../services/dynamic-collection-registry-service";

// The constructor's own parameter type, read off the class rather than
// restated: a logger shape written out here would keep compiling after the
// real one gained a method, and this fixture would then stand in for something
// production no longer accepts.
type RegistryLogger = ConstructorParameters<
  typeof DynamicCollectionRegistryService
>[1];

const noopLogger: RegistryLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as RegistryLogger;

describe("DynamicCollectionRegistryService.listCollections — slugAllowlist", () => {
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

  it("counts only the collections the allowlist names", async () => {
    // 🔴 The property that was broken. `total` is what a client turns into
    // pages, so counting rows the reader may not see reports pages that hold
    // nothing for them -- and, filtered after the fact instead, reports ONE
    // page however many there really are.
    const result = await registry.listCollections({
      slugAllowlist: ["alpha", "mango"],
      limit: 10,
    });

    expect(result.collections.map(c => c.slug).sort()).toEqual([
      "alpha",
      "mango",
    ]);
    expect(result.total).toBe(2);
  });

  it("pages the ALLOWED rows, so a second page exists when it should", async () => {
    // 🔴 The consequence, asserted as the reader meets it. With the filter
    // applied after a page was fetched, `totalPages` is computed from one
    // page's worth of survivors and comes out as 1 -- so this second page is
    // unreachable, and the collection on it cannot be opened from the list.
    const first = await registry.listCollections({
      slugAllowlist: ["alpha", "mango"],
      limit: 1,
      page: 1,
      sortBy: "slug",
      sortOrder: "asc",
    });
    const second = await registry.listCollections({
      slugAllowlist: ["alpha", "mango"],
      limit: 1,
      page: 2,
      sortBy: "slug",
      sortOrder: "asc",
    });

    expect(first.totalPages).toBe(2);
    expect(first.collections.map(c => c.slug)).toEqual(["alpha"]);
    expect(second.collections.map(c => c.slug)).toEqual(["mango"]);
  });

  it("answers an EMPTY allowlist with nothing, rather than everything", async () => {
    // 🔴 The direction that would be a disclosure, and it is one character
    // away: `if (slugAllowlist?.length)` reads an empty list as "no filter"
    // and hands back every collection in the install to a reader allowed none.
    //
    // This asserts the OUTCOME rather than the early return above it. That
    // short-circuit exists to skip a pointless round trip and to avoid
    // emitting `WHERE slug IN ()`, whose meaning is dialect-specific — neither
    // of which is visible in the result, so removing it moves nothing here.
    const result = await registry.listCollections({
      slugAllowlist: [],
      limit: 10,
    });

    expect(result.collections).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("applies NO filter when the allowlist is absent", async () => {
    // The control. A registry that always filtered would satisfy every case
    // above and hide every collection from the super-admin path, which passes
    // no allowlist precisely because it may see them all.
    const result = await registry.listCollections({ limit: 10 });

    expect(result.total).toBe(3);
    expect(result.collections.map(c => c.slug).sort()).toEqual([
      "alpha",
      "mango",
      "zebra",
    ]);
  });
});
