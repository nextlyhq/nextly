/**
 * Deleting a collection or single must not strand its embedded component rows.
 *
 * Component values are not stored on the parent row — the parent table has no column for
 * them. They are rows in `comp_<slug>` associated back by three plain string columns
 * (`_parent_id`, `_parent_table`, `_parent_field`) with NO foreign key, so dropping the
 * parent table cascades nothing and every instance is left pointing at a table that is
 * gone, so the sweep has to find and remove them explicitly.
 *
 * The cases that make this non-trivial are all asserted here:
 *   - instances belonging to a DIFFERENT entity that shares the same component survive,
 *   - nested component instances (a component inside a component) are followed,
 *   - a nested instance owned by another entity survives that recursion,
 *   - a localized component's `comp_<slug>_locales` rows go with their instance.
 *
 * Runs on every dialect whose URL is set; SQLite always runs in-memory.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SchemaRegistry } from "../../../database/schema-registry";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { ComponentSchemaService } from "../services/component-schema-service";
import { teardownEntityComponentData } from "../services/teardown-entity-component-data";

interface TestAdapter {
  dialect: SupportedDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tableExists(name: string): Promise<boolean>;
  listTables(): Promise<string[]>;
  select<T = Record<string, unknown>>(t: string, o: unknown): Promise<T[]>;
  delete(t: string, w: unknown): Promise<number>;
}

const DIALECTS: Array<{
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}> = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

for (const entry of DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`entity delete component data — ${entry.dialect}`, () => {
    let adapter: TestAdapter;

    // Unique per run so this suite can never collide with real tables.
    const tag = randomBytes(5).toString("hex");
    const parent = `dc_p${tag}`;
    const otherParent = `dc_o${tag}`;
    // `comp_` prefix is required — the sweep discovers component tables by that prefix.
    const hero = `comp_h${tag}`;
    const nested = `comp_n${tag}`;
    const heroLocales = `${hero}_locales`;

    const q = (id: string) =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
    const txt = entry.dialect === "postgresql" ? "text" : "varchar(191)";

    // Component tables are resolved through the schema registry by adapter.select/delete,
    // exactly as at runtime, so the suite registers them the way the dispatcher does.
    let registry: SchemaRegistry;
    let schemaService: ComponentSchemaService;

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();
      registry = new SchemaRegistry();
      (
        adapter as unknown as { setTableResolver(r: SchemaRegistry): void }
      ).setTableResolver(registry);
      schemaService = new ComponentSchemaService(
        entry.dialect as ConstructorParameters<typeof ComponentSchemaService>[0]
      );
    });

    afterAll(async () => {
      for (const t of [heroLocales, nested, hero, parent, otherParent]) {
        try {
          await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(t)}`);
        } catch {
          // best-effort cleanup
        }
      }
      await adapter.disconnect();
    });

    /**
     * Creates a component table from the PRODUCTION DDL generator and registers the
     * matching runtime schema, so table shape and Drizzle definition cannot drift.
     */
    async function componentTable(name: string): Promise<void> {
      const fields = [{ name: "heading", type: "text" }] as never;
      // Companion first: it holds an FK to `<name>.id`, so Postgres refuses the main drop
      // while it exists. The same ordering constraint this suite's subject deals with.
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${q(`${name}_locales`)}`
      );
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(name)}`);
      for (const stmt of splitStatements([
        schemaService.generateMigrationSQL(name, fields),
      ])) {
        await adapter.executeQuery(stmt);
      }
      registry.registerDynamicSchema(
        name,
        schemaService.generateRuntimeSchema(name, fields)
      );
    }

    async function insertInstance(
      table: string,
      id: string,
      parentId: string,
      parentTable: string,
      field: string
    ): Promise<void> {
      await adapter.executeQuery(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("_order")}, ${q("heading")}) VALUES ('${id}', '${parentId}', '${parentTable}', '${field}', 0, 'h')`
      );
    }

    async function idsIn(table: string): Promise<string[]> {
      const rows = await adapter.executeQuery<{ id: string }>(
        `SELECT ${q("id")} FROM ${q(table)} ORDER BY ${q("id")}`
      );
      return rows.map(r => r.id);
    }

    beforeEach(async () => {
      await componentTable(hero);
      await componentTable(nested);

      // Localized component companion, keyed by the component INSTANCE id. Built and
      // registered with the production helpers so it matches a real localized component.
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(heroLocales)}`);
      await adapter.executeQuery(
        buildCompanionCreateOnlySql({
          dialect: entry.dialect,
          collection: hero,
          mainTable: hero,
          companionTable: heroLocales,
          defaultLocale: "en",
          parentIdType: txt,
          columns: [{ name: "heading", kind: "text" }],
        }).replace(/;$/, "")
      );
      const companionRuntime = buildCompanionRuntimeTable({
        slug: hero,
        tableName: hero,
        fields: [{ name: "heading", type: "text" }],
        dialect: entry.dialect,
        localized: true,
        status: false,
      });
      if (companionRuntime) {
        registry.registerDynamicSchema(
          companionRuntime.companionTableName,
          companionRuntime.table
        );
      }

      // Two hero instances on the doomed entity, one on an unrelated entity.
      await insertInstance(hero, "h1", "p1", parent, "hero");
      await insertInstance(hero, "h2", "p2", parent, "hero");
      await insertInstance(hero, "keep1", "o1", otherParent, "hero");

      // Nested: a component inside hero h1, and one inside the OTHER entity's hero.
      await insertInstance(nested, "n1", "h1", hero, "inner");
      await insertInstance(nested, "keepN", "keep1", hero, "inner");

      // Translations for both the doomed and the surviving hero instance.
      for (const parentId of ["h1", "keep1"]) {
        await adapter.executeQuery(
          `INSERT INTO ${q(heroLocales)} (${q("_parent")}, ${q("_locale")}, ${q("heading")}) VALUES ('${parentId}', 'fr', 'Bonjour')`
        );
      }
    });

    it("removes the deleted entity's component instances and leaves other entities' alone", async () => {
      const result = await teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: parent,
      });

      // h1 and h2 gone; the unrelated entity's instance survives.
      expect(await idsIn(hero)).toEqual(["keep1"]);
      expect(result.instancesDeleted).toBeGreaterThanOrEqual(2);
      expect(result.tablesTouched).toContain(hero);
    });

    it("follows nesting — a component inside a component goes too", async () => {
      await teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: parent,
      });

      // n1 belonged to h1 (deleted). keepN belonged to the other entity's hero.
      expect(await idsIn(nested)).toEqual(["keepN"]);
    });

    it("removes the localized component's translations with its instance", async () => {
      await teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: parent,
      });

      const rows = await adapter.executeQuery<{ _parent: string }>(
        `SELECT ${q("_parent")} FROM ${q(heroLocales)} ORDER BY ${q("_parent")}`
      );
      // h1's translation is gone; the surviving instance keeps its own.
      expect(rows.map(r => r._parent)).toEqual(["keep1"]);
    });

    it("fails the delete when an unregistered component table still holds this entity's rows", async () => {
      // The dangerous shape: a real component table the ORM cannot address, holding rows
      // for the entity being deleted. Skipping it would drop the parent table and strand
      // them while reporting success, so the delete must fail instead.
      const unregistered = `comp_u${tag}`;
      const fields = [{ name: "heading", type: "text" }] as never;
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(unregistered)}`);
      for (const stmt of splitStatements([
        schemaService.generateMigrationSQL(unregistered, fields),
      ])) {
        await adapter.executeQuery(stmt);
      }
      // Deliberately NOT registered with the schema registry.
      await insertInstance(unregistered, "u1", "p1", parent, "hero");

      await expect(
        teardownEntityComponentData({
          adapter: adapter as never,
          parentTable: parent,
        })
      ).rejects.toThrow();

      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(unregistered)}`);
    });

    it("skips a component table the ORM cannot resolve instead of blocking the delete", async () => {
      // A leftover `comp_` table with no registered runtime schema — the state an earlier
      // deleted component leaves behind. It must not make the whole delete fail.
      const stray = `comp_s${tag}`;
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(stray)}`);
      await adapter.executeQuery(
        `CREATE TABLE ${q(stray)} (${q("id")} ${txt} PRIMARY KEY)`
      );

      const result = await teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: parent,
      });

      expect(result.skippedTables).toContain(stray);
      // The resolvable tables were still swept.
      expect(await idsIn(hero)).toEqual(["keep1"]);

      await adapter.executeQuery(`DROP TABLE IF EXISTS ${q(stray)}`);
    });

    it("is a no-op for an entity that embeds no components", async () => {
      const result = await teardownEntityComponentData({
        adapter: adapter as never,
        parentTable: `dc_nothing${tag}`,
      });

      expect(result.instancesDeleted).toBe(0);
      expect(await idsIn(hero)).toEqual(["h1", "h2", "keep1"]);
    });
  });
}
