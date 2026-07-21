/**
 * Deleting an entity must leave no localization artifacts behind.
 *
 * Companion `_locales` tables are excluded from the schema pipeline and owned by the
 * localization migration layer, so an entity delete must remove them explicitly. The same
 * applies to the entity's rows in the shared `nextly_i18n_archive`.
 *
 * Two layers are proved here against a real in-memory SQLite database:
 *   1. `teardownEntityI18n` itself — drops the companion, purges only the deleted entity's
 *      archive rows, and stays a no-op when either artifact is absent.
 *   2. `ComponentRegistryService.deleteComponent` — the real delete path must invoke that
 *      teardown, not only drop the main table.
 *
 * System tables come from the production DDL helpers (`getI18nArchiveDdl`, drizzle-kit over
 * the real table definition), never hand-copied CREATE TABLE (see
 * .claude/rules/integration-tests.md).
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../../database/schema-registry";
import { dynamicComponentsSqlite } from "../../../../schemas/dynamic-components/sqlite";
import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive";
import { ComponentRegistryService } from "../../../components/services/component-registry-service";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { buildCompanionCreateOnlySql } from "../generate-up";
import { teardownEntityI18n } from "../teardown-entity-i18n";

process.env.DB_DIALECT = "sqlite";

type Adapter = ReturnType<typeof createSqliteAdapter>;

let adapter: Adapter;

/** Production DDL for the component registry table this suite writes through. */
async function registryDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      dynamicComponents: dynamicComponentsSqlite,
    })
  );
  return splitStatements(statements);
}

/** Live table names, so "was it dropped" is asserted against the real catalog. */
async function tableNames(): Promise<string[]> {
  const rows = await adapter.executeQuery<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  );
  return rows.map(r => r.name);
}

/** Creates `<main>` plus its companion, mirroring a localized entity's real shape. */
async function createLocalizedEntity(mainTable: string): Promise<void> {
  await adapter.executeQuery(
    `CREATE TABLE "${mainTable}" ("id" text PRIMARY KEY, "price" integer)`
  );
  // Production generator, so the companion's FK-to-main shape is the real one.
  await adapter.executeQuery(
    buildCompanionCreateOnlySql({
      dialect: "sqlite",
      collection: mainTable,
      mainTable,
      companionTable: `${mainTable}_locales`,
      defaultLocale: "en",
      parentIdType: "text",
      columns: [{ name: "body", kind: "longText" }],
    }).replace(/;$/, "")
  );
}

/** Seeds archive rows for a slug so purge-scoping is observable. */
async function seedArchive(slug: string, entryId: string): Promise<void> {
  await adapter.executeQuery(
    `INSERT INTO "nextly_i18n_archive" ("collection","entry_id","locale","field","value") VALUES (?,?,?,?,?)`,
    [slug, entryId, "fr", "body", "Bonjour"]
  );
}

async function archiveSlugs(): Promise<string[]> {
  const rows = await adapter.executeQuery<{ collection: string }>(
    `SELECT "collection" FROM "nextly_i18n_archive" ORDER BY "collection"`
  );
  return rows.map(r => r.collection);
}

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();

  const schemaRegistry = new SchemaRegistry();
  schemaRegistry.registerStaticSchemas({
    dynamicComponents: dynamicComponentsSqlite,
  });
  adapter.setTableResolver(schemaRegistry);
});

afterEach(async () => {
  try {
    await adapter?.disconnect?.();
  } catch {
    // ignore teardown errors
  }
});

describe("teardownEntityI18n (real SQLite)", () => {
  it("drops the companion table and purges only the deleted entity's archive rows", async () => {
    for (const stmt of getI18nArchiveDdl("sqlite")) {
      await adapter.executeQuery(stmt);
    }
    await createLocalizedEntity("dc_pages");
    await createLocalizedEntity("dc_docs");
    await seedArchive("pages", "p1");
    await seedArchive("docs", "d1");

    const result = await teardownEntityI18n({
      adapter,
      slug: "pages",
      tableName: "dc_pages",
    });

    expect(result.companionDropped).toBe(true);
    expect(result.archiveRowsPurged).toBe(1);

    // The deleted entity's companion is gone; the untouched entity's survives.
    const tables = await tableNames();
    expect(tables).not.toContain("dc_pages_locales");
    expect(tables).toContain("dc_docs_locales");

    // The archive is shared — the other entity's restore trail must be intact.
    expect(await archiveSlugs()).toEqual(["docs"]);
  });

  it("is a no-op when the entity was never localized (no companion table)", async () => {
    for (const stmt of getI18nArchiveDdl("sqlite")) {
      await adapter.executeQuery(stmt);
    }
    await adapter.executeQuery(
      `CREATE TABLE "dc_plain" ("id" text PRIMARY KEY)`
    );

    const result = await teardownEntityI18n({
      adapter,
      slug: "plain",
      tableName: "dc_plain",
    });

    expect(result).toEqual({ companionDropped: false, archiveRowsPurged: 0 });
  });

  it("succeeds when the archive table was never created", async () => {
    // The archive is created lazily on the first localization DISABLE, so databases where
    // that never happened have no archive table. An unguarded purge would fail every delete.
    await createLocalizedEntity("dc_pages");
    expect(await tableNames()).not.toContain("nextly_i18n_archive");

    const result = await teardownEntityI18n({
      adapter,
      slug: "pages",
      tableName: "dc_pages",
    });

    expect(result).toEqual({ companionDropped: true, archiveRowsPurged: 0 });
    expect(await tableNames()).not.toContain("dc_pages_locales");
  });

  it("drops the companion before the main table, so the FK never blocks the main drop", async () => {
    await createLocalizedEntity("dc_pages");

    await teardownEntityI18n({ adapter, slug: "pages", tableName: "dc_pages" });
    await adapter.executeQuery(`DROP TABLE IF EXISTS "dc_pages"`);

    const tables = await tableNames();
    expect(tables).not.toContain("dc_pages");
    expect(tables).not.toContain("dc_pages_locales");
  });
});

describe("ComponentRegistryService.deleteComponent (real SQLite)", () => {
  let service: ComponentRegistryService;

  beforeEach(async () => {
    for (const stmt of await registryDdl()) await adapter.executeQuery(stmt);
    for (const stmt of getI18nArchiveDdl("sqlite")) {
      await adapter.executeQuery(stmt);
    }

    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    service = new ComponentRegistryService(
      adapter as unknown as ConstructorParameters<
        typeof ComponentRegistryService
      >[0],
      logger as unknown as ConstructorParameters<
        typeof ComponentRegistryService
      >[1]
    );
  });

  async function registerComponent(slug: string): Promise<void> {
    await adapter.executeQuery(
      `INSERT INTO "dynamic_components" ("id","slug","label","table_name","fields","source","locked","schema_hash","schema_version","migration_status","created_at","updated_at")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `comp-${slug}`,
        slug,
        slug,
        `comp_${slug}`,
        JSON.stringify([{ name: "body", type: "longText", localized: true }]),
        "ui",
        0,
        `hash-${slug}`,
        1,
        "applied",
        "2026-07-20T00:00:00.000Z",
        "2026-07-20T00:00:00.000Z",
      ]
    );
    await createLocalizedEntity(`comp_${slug}`);
  }

  it("removes the companion table and archive rows along with the main table", async () => {
    await registerComponent("seo");
    await registerComponent("hero");
    await seedArchive("seo", "s1");
    await seedArchive("hero", "h1");

    await service.deleteComponent("seo");

    const tables = await tableNames();
    expect(tables).not.toContain("comp_seo");
    // The companion is excluded from the schema pipeline, so only the teardown removes it.
    expect(tables).not.toContain("comp_seo_locales");
    // An unrelated component is untouched.
    expect(tables).toContain("comp_hero");
    expect(tables).toContain("comp_hero_locales");

    expect(await archiveSlugs()).toEqual(["hero"]);
  });
});
