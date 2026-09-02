/**
 * The migration a Schema Builder create writes has to carry the REGISTRY ROW,
 * not only the table.
 *
 * The file is committed and replayed against a database that has never seen the
 * Builder. That database has the `dynamic_collections` row this service writes
 * locally only if the migration recreates it — so without the upsert a deploy
 * gets the table and no row, and the collection is absent from the admin rather
 * than showing a stale status.
 *
 * The control that matters is the LAST test: the statement this path appends
 * must be the one `migrate:create` writes for the same entity. Two authoring
 * paths that both emit "the metadata row" and can disagree about its contents
 * are the defect, not the fix.
 *
 * @module domains/dynamic-collections/services/__tests__/generate-collection-metadata-row
 */

import { beforeAll, describe, expect, it } from "vitest";

import { buildCollectionMetadataUpsert } from "../../../schema/ui-schema/metadata-sql";
import { DynamicCollectionService } from "../dynamic-collection-service";

beforeAll(() => {
  process.env.DB_DIALECT ??= "sqlite";
  process.env.DATABASE_URL ??= "file::memory:";
});

function service(): DynamicCollectionService {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  // The registry's existence check runs before any SQL is generated, so the
  // stub answers that one query and nothing else: a select chain resolving to
  // no rows, which is "this slug is free".
  const emptySelect = {
    select: () => emptySelect,
    from: () => emptySelect,
    where: () => emptySelect,
    limit: async () => [] as unknown[],
  };
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => emptySelect,
    dialect: "sqlite" as const,
  } as unknown as ConstructorParameters<typeof DynamicCollectionService>[0];
  return new DynamicCollectionService(adapter, logger);
}

const FIELDS = [{ name: "title", type: "text" }];

async function generate(overrides: Record<string, unknown> = {}) {
  return (await service().generateCollection({
    name: "articles",
    fields: FIELDS,
    ...overrides,
  } as never)) as unknown as {
    migrationSQL: string;
    metadata: {
      slug: string;
      labels: { singular: string; plural: string };
      fields: unknown;
      status: boolean;
      localized: boolean;
    };
  };
}

async function sqlFor(
  overrides: Record<string, unknown> = {}
): Promise<string> {
  return (await generate(overrides)).migrationSQL;
}

describe("the migration a Builder create writes", () => {
  it("carries the dynamic_collections row, not only the table", async () => {
    const sql = await sqlFor();
    // The control first: the table itself is still created, so a filter that
    // dropped the DDL would not pass this by only adding the row.
    expect(sql).toContain("dc_articles");
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("dynamic_collections");
  });

  it("records the row as applied, because replaying the file IS the apply", async () => {
    // On the database this file is replayed against, running it is exactly the
    // moment the table arrives — so the row it inserts describes a table that
    // is present, and anything reading the status to decide queryability may
    // believe it.
    expect(await sqlFor()).toContain("'applied'");
  });

  it("separates the upsert with the breakpoint marker", async () => {
    // 🔴 Not cosmetic. The runner splits the file on this marker and a driver
    // with multi-statements disabled — MySQL — rejects a chunk holding both the
    // CREATE and the INSERT. Without it the whole migration fails on one
    // dialect and passes on the other two.
    const sql = await sqlFor();
    const afterLastMarker = sql.slice(
      sql.lastIndexOf("--> statement-breakpoint")
    );
    expect(afterLastMarker).toContain("dynamic_collections");
  });

  it("carries the author's own labels rather than the slug-derived default", async () => {
    // A custom label is the thing a slug-derived default silently replaces, and
    // the replacement reads as correct everywhere the slug happens to match.
    const sql = await sqlFor({ label: "Story" });
    expect(sql).toContain("Story");
  });

  it("emits EXACTLY what migrate:create emits for the same entity", async () => {
    // 🔴 The control the other four exist for. Each of them passes against a
    // second, separately written statement that merely looks right — which is
    // the divergence this change removes rather than adds to. The two authoring
    // paths are disjoint by construction: this one writes no `meta/` snapshot,
    // so `migrate:create` never sees its tables and cannot correct it.
    const { migrationSQL, metadata } = await generate();
    // Built from the row this service says it WROTE, not from the raw input:
    // the fields it stores are normalised, so an expectation assembled from the
    // request would differ in both the fields JSON and the schema hash derived
    // from it — and would be asserting a row nobody has.
    const expected = buildCollectionMetadataUpsert(
      {
        slug: metadata.slug,
        labels: metadata.labels,
        admin: {},
        status: metadata.status,
        localized: metadata.localized,
        fields: metadata.fields,
      } as never,
      "sqlite"
    );
    expect(migrationSQL).toContain(expected);
  });
});
