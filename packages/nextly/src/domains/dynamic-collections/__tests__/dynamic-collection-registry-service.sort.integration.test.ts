// Integration regression test for the sort-by-name bug surfaced during the
// Task 3 admin redesign work.
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

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import { DynamicCollectionRegistryService } from "../services/dynamic-collection-registry-service";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof DynamicCollectionRegistryService["prototype"]["constructor"]> extends [
  unknown,
  infer L,
  ...unknown[],
]
  ? L
  : never;

describe("DynamicCollectionRegistryService.listCollections — sortBy parameter", () => {
  let sqlite: Database.Database;
  let registry: DynamicCollectionRegistryService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");

    // Mirror the production dynamic_collections schema (sqlite dialect).
    sqlite.exec(`
      CREATE TABLE dynamic_collections (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        table_name TEXT NOT NULL,
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
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX dynamic_collections_slug_unique ON dynamic_collections(slug);
      CREATE UNIQUE INDEX dynamic_collections_table_name_unique ON dynamic_collections(table_name);
    `);

    // Insert three rows with deliberately non-alphabetical createdAt order so
    // sort-by-createdAt and sort-by-name diverge:
    //   created in this order: zebra (oldest), alpha (middle), mango (newest)
    //   alphabetical by slug:  alpha, mango, zebra
    const baseTime = 1_700_000_000;
    sqlite
      .prepare(
        `INSERT INTO dynamic_collections (id, slug, table_name, labels, fields, schema_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "id-zebra",
        "zebra",
        "dc_zebra",
        '{"singular":"Zebra","plural":"Zebras"}',
        "[]",
        "h1",
        baseTime,
        baseTime
      );
    sqlite
      .prepare(
        `INSERT INTO dynamic_collections (id, slug, table_name, labels, fields, schema_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "id-alpha",
        "alpha",
        "dc_alpha",
        '{"singular":"Alpha","plural":"Alphas"}',
        "[]",
        "h2",
        baseTime + 100,
        baseTime + 100
      );
    sqlite
      .prepare(
        `INSERT INTO dynamic_collections (id, slug, table_name, labels, fields, schema_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "id-mango",
        "mango",
        "dc_mango",
        '{"singular":"Mango","plural":"Mangoes"}',
        "[]",
        "h3",
        baseTime + 200,
        baseTime + 200
      );

    const db = drizzle(sqlite);
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
