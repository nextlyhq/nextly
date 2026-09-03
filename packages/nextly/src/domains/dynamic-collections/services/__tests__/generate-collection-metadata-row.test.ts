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
    localMigrationSQL?: string;
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

  it("carries EVERY admin key the local row gets, not just the queryable two", async () => {
    // 🔴 These decide what a reader SEES — whether the collection appears at
    // all, where in the sidebar, under which icon. A narrower mapping rebuilt a
    // visibly different collection wherever the file was replayed while looking
    // correct in the one place it was authored, which is the failure that does
    // not announce itself.
    const sql = await sqlFor({
      icon: "Sparkles",
      hidden: true,
      order: 7,
      sidebarGroup: "Editorial",
      useAsTitle: "title",
      group: "Content",
    });
    // Asserted as the whole serialized block rather than as a handful of
    // fragments: a fragment list is a SAMPLE, and the key it happens to omit is
    // the one that goes missing. `order` is the interesting member — it is the
    // only number, so a mapping that survived every string would still drop it.
    expect(sql).toContain(
      JSON.stringify({
        useAsTitle: "title",
        group: "content",
        icon: "Sparkles",
        hidden: true,
        order: 7,
        sidebarGroup: "Editorial",
      })
    );
  });

  it("does not run the registry row against THIS database", async () => {
    // 🔴 The artefact and the local execution are not the same statement. Here
    // the row is written by `registerCollection`, which refuses a slug that
    // already exists — so running the upsert locally would take the slug, make
    // that refusal fire, and leave a created table beside a half-written
    // registry with every retry failing on the slug it just took.
    const { migrationSQL, localMigrationSQL } = await generate();
    expect(migrationSQL).toContain("dynamic_collections");
    expect(localMigrationSQL).toBeDefined();
    expect(localMigrationSQL).not.toContain("dynamic_collections");
    // The control: the local SQL is still the DDL, not empty — a variant that
    // returned nothing would satisfy the refusal above and create no table.
    expect(localMigrationSQL).toContain("dc_articles");
  });

  it("carries the collection's own description", async () => {
    // 🔴 The Builder's create modal collects it and the local row stores it, so
    // an entity that omitted it wrote NULL wherever the file was replayed and
    // the help text vanished on the deployed copy — visible only to whoever
    // opened the collection there.
    const sql = await sqlFor({ description: "Long-form editorial pieces" });
    expect(sql).toContain("Long-form editorial pieces");
  });

  it("OMITS the description column entirely when there is none", async () => {
    // 🔴 Searching the statement for NULL cannot separate the two
    // implementations: the default `versions`, `revalidate` and `webhooks`
    // columns already emit NULL, so that assertion passes on an unconditional
    // description column as readily as on an omitted one. Whether the column is
    // NAMED at all is the property that differs — omitted, it is absent from
    // the INSERT and from the DO UPDATE SET, so replaying a manifest that
    // carries no description leaves a deployed one alone.
    const sql = await sqlFor();
    expect(sql).not.toContain('"description"');
    // A mapping that stringified an absent value would store the characters
    // "undefined" as the help text of every collection created without one.
    expect(sql).not.toContain("'undefined'");
    // The control: a run that generated no statement would satisfy both
    // refusals above without the column having been omitted by anything.
    expect(sql).toContain("dynamic_collections");
  });

  it("carries stored hooks, which the hook service runs off the row", async () => {
    // 🔴 The hook service reads `collection.hooks` from the registry row and
    // executes them, so a replayed row without them runs none — the collection
    // validates and transforms where it was authored and silently does neither
    // where it was deployed. Not reachable from the Builder's own modal, which
    // sends no hooks, but the service accepts them and stores them.
    const sql = await sqlFor({
      hooks: [
        {
          hookId: "slugify",
          hookType: "beforeChange",
          enabled: true,
          config: {},
          order: 0,
        },
      ],
    });
    expect(sql).toContain("slugify");
  });

  it("hashes the local row the SAME way the migration does", async () => {
    // 🔴 One question, one answer. The row this service writes and the row the
    // migration recreates must agree about the schema hash, because
    // `syncCodeFirstCollections` decides whether a definition changed by
    // comparing it — so two values mean the two databases reach opposite
    // answers, one reopening `migration_status` for a collection the other
    // considers settled.
    const { migrationSQL, metadata } = await generate();
    expect(migrationSQL).toContain(
      (metadata as unknown as { schemaHash: string }).schemaHash
    );
  });

  it("emits EXACTLY what migrate:create emits for the same entity", async () => {
    // 🔴 The control the other four exist for. Each of them passes against a
    // second, separately written statement that merely LOOKS right, so none of
    // them can tell the two authoring paths apart. The statement this path
    // appends must be byte-for-byte the one `migrate:create` writes for the
    // same entity, because the committed file is the only thing replayed
    // against the target database.
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
