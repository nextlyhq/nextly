/**
 * `nextly migrate` applying a file that makes a column required over rows that hold no value in
 * it, on every dialect, through the real command core (`migrateCore`) and a migrations folder of
 * the test's own.
 *
 * - A collection's, a Single's and a field group's column made NOT NULL over null rows: refused
 *   before any statement, naming the entity, the field and the count (a field group: each
 *   collection and Single holding null rows, with its count, and not one holding none). Nothing
 *   is applied and the ledger records nothing.
 * - A file that fills every null row first and then makes the column NOT NULL is applied.
 * - A file whose fill leaves null rows is refused at the NOT NULL statement with the count. On
 *   PostgreSQL and SQLite the file's transaction rolls back, fill included.
 * - MySQL, which commits each schema change as it runs: a NOT NULL as the file's last statement,
 *   after other DDL, leaves every earlier statement unapplied and the ledger empty; a fill that
 *   leaves null rows is refused at the NOT NULL statement naming the statements that ran, and
 *   the attempt is never recorded applied.
 *
 * The statements are each dialect's own form, in a file written by `migrate:create`'s own
 * formatter; SQLite's is the rebuild `migrate:create` writes (`sqliteTableRebuildStatements`).
 * The tables come from the production generators. Each test runs on a database of its own,
 * because each runs the whole command.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { NextlyError } from "../../../../errors/nextly-error";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { formatMigrationFile } from "../../migrate-create/format-file";
import {
  introspectLiveColumns,
  introspectLiveSnapshot,
} from "../../pipeline/diff/introspect-live";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import { splitStatements } from "../../pipeline/sql-statement-utils";
import { resolveComponentTableName } from "../../utils/resolve-table-name";

const logger = createLogger({ quiet: true });
const NAME = "20261102_000001_required_column";
const FILE = `${NAME}.sql`;

const POSTS = "dc_posts";
const PAGES = "dc_pages";
const SETTINGS = resolveSingleTableName({ slug: "settings" });
const SEO = resolveComponentTableName("seo");

describe.each(LOCK_DIALECTS)(
  "nextly migrate making a column required over null rows on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-required-column-"));
      // Nextly's own tables, the registry among them, so the file is all a run has left to do.
      await migrate();
      await seedEntities();
    }, 120_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    function migrate() {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    async function run(statements: string[]): Promise<void> {
      for (const statement of statements) await adapter.executeQuery(statement);
    }

    /**
     * Two collections and a Single, each with an optional text field, and a field group they all
     * use: their tables from the production generators, their registry rows, and their rows.
     */
    async function seedEntities(): Promise<void> {
      const tables = new DynamicCollectionSchemaService(undefined, dialect);
      const field = (name: string) => [{ name, type: "text" }];
      await run(
        splitStatements([
          tables.generateMigrationSQL(POSTS, field("subtitle") as never),
          tables.generateMigrationSQL(PAGES, field("subtitle") as never),
          tables.generateMigrationSQL(SETTINGS, field("tagline") as never, {
            isSingle: true,
          }),
          new FieldGroupSchemaService(dialect).generateMigrationSQL(
            SEO,
            field("meta_title") as never
          ),
        ])
      );
      const seo = { name: "seo", type: "component", component: "seo" };
      for (const [registry, slug, tableName, fields] of [
        ["dynamic_collections", "posts", POSTS, [...field("subtitle"), seo]],
        ["dynamic_collections", "pages", PAGES, [...field("subtitle"), seo]],
        ["dynamic_singles", "settings", SETTINGS, [...field("tagline"), seo]],
        ["dynamic_components", "seo", SEO, field("meta_title")],
      ] as const) {
        await adapter.insert(registry, {
          // The registries key rows by UUID on PostgreSQL.
          id: randomUUID(),
          slug,
          ...(registry === "dynamic_collections"
            ? { labels: { singular: slug, plural: slug } }
            : { label: slug }),
          tableName,
          fields,
          source: "ui",
          locked: false,
          schemaHash: "test",
          schemaVersion: 1,
          migrationStatus: "applied",
        } as never);
      }
      // posts: 3 entries, 2 with no subtitle. pages: 1, with one. settings: 1, with no tagline.
      const entry = (
        table: string,
        id: string,
        column: string,
        value: string | null
      ) =>
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q(column)}) VALUES ('${id}', '${id}', '${id}', ${value === null ? "NULL" : `'${value}'`})`;
      await run([
        entry(POSTS, "p1", "subtitle", "kept"),
        entry(POSTS, "p2", "subtitle", null),
        entry(POSTS, "p3", "subtitle", null),
        entry(PAGES, "g1", "subtitle", "kept"),
        entry(SETTINGS, "s1", "tagline", null),
      ]);
      // The field group's rows: 2 null on posts, none null on pages, 1 null on settings.
      const seoRow = (id: string, parent: string, value: string | null) =>
        `INSERT INTO ${q(SEO)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("meta_title")}) VALUES ('${id}', 'x', '${parent}', 'seo', ${value === null ? "NULL" : `'${value}'`})`;
      await run([
        seoRow("m1", POSTS, null),
        seoRow("m2", POSTS, null),
        seoRow("m3", POSTS, "kept"),
        seoRow("m4", PAGES, "kept"),
        seoRow("m5", SETTINGS, null),
      ]);
    }

    /** The statements that make `column` of `table` NOT NULL, in this dialect's own form. */
    async function makeRequired(
      table: string,
      column: string
    ): Promise<string[]> {
      if (dialect === "postgresql") {
        return [
          `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} SET NOT NULL`,
        ];
      }
      if (dialect === "mysql") {
        return [
          `ALTER TABLE ${q(table)} MODIFY COLUMN ${q(column)} text NOT NULL`,
        ];
      }
      // SQLite has no ALTER COLUMN: `migrate:create` writes a rebuild to the target table.
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        table,
      ]);
      const spec = live.tables[0];
      return sqliteTableRebuildStatements({
        ...spec,
        columns: spec.columns.map(c => ({
          ...c,
          ...(c.name === column ? { nullable: false } : {}),
          ...(c.name === "id" ? { primaryKey: true } : {}),
        })),
      });
    }

    /**
     * The statements that add `column` to `table` holding no value, then make it NOT NULL with
     * no fill, in this dialect's own form: on SQLite the rebuild carries the new column.
     */
    async function addEmptyThenRequire(
      table: string,
      column: string
    ): Promise<string[]> {
      const add = `ALTER TABLE ${q(table)} ADD COLUMN ${q(column)} text`;
      if (dialect === "postgresql") {
        return [
          add,
          `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} SET NOT NULL`,
        ];
      }
      if (dialect === "mysql") {
        return [
          add,
          `ALTER TABLE ${q(table)} MODIFY COLUMN ${q(column)} text NOT NULL`,
        ];
      }
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        table,
      ]);
      const spec = live.tables[0];
      const text = spec.columns.find(c => c.name === "subtitle");
      if (text === undefined) throw new Error("no text column to model on");
      return [
        add,
        ...sqliteTableRebuildStatements({
          ...spec,
          columns: [
            ...spec.columns.map(c => ({
              ...c,
              ...(c.name === "id" ? { primaryKey: true } : {}),
            })),
            { ...text, name: column, nullable: false },
          ],
        }),
      ];
    }

    /** The file as `migrate:create` writes it. */
    function writeFile(statements: string[]): void {
      writeFileSync(
        join(migrationsDir, FILE),
        formatMigrationFile({
          name: NAME,
          dialect,
          sqlStatements: statements,
          downSqlStatements: [],
          collections: [],
          singles: [],
          components: [],
          hasUserExt: false,
        }),
        "utf8"
      );
    }

    async function refusal(): Promise<NextlyError> {
      const error = await migrate().then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error)).toBe(true);
      return error as NextlyError;
    }

    /** The messages of each column the refusal names, under the shared code. */
    function issues(error: NextlyError): string[] {
      const data = error.publicData as {
        errors: Array<{ code: string; message: string }>;
      };
      expect(
        data.errors.every(e => e.code === "REQUIRED_COLUMN_HAS_NULLS")
      ).toBe(true);
      return data.errors.map(e => e.message);
    }

    async function ledger(): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        adapter.getDrizzle(),
        dialect
      ).findFileApplies(FILE);
      return rows.map(row => row.status);
    }

    async function nullable(
      table: string,
      column: string
    ): Promise<boolean | undefined> {
      const live = await introspectLiveColumns(adapter.getDrizzle(), dialect, [
        table,
      ]);
      return live.tables[0]?.columns.find(c => c.name === column)?.nullable;
    }

    async function hasColumn(table: string, column: string): Promise<boolean> {
      return (await nullable(table, column)) !== undefined;
    }

    async function nulls(table: string, column: string): Promise<number> {
      const rows = await adapter.executeQuery<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(column)} IS NULL`
      );
      return Number(rows[0]?.n);
    }

    it("refuses a collection's field, naming the collection, the field and the count; nothing applied", async () => {
      writeFile(await makeRequired(POSTS, "subtitle"));
      const error = await refusal();
      expect(issues(error)).toEqual([
        "Collection 'posts': field 'subtitle' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the field optional.",
      ]);
      expect(error.publicMessage).toContain(FILE);
      expect(await nullable(POSTS, "subtitle")).toBe(true);
      expect(await ledger()).toEqual([]);
    }, 120_000);

    // A column the file adds holding no value is empty in each existing row, so making it
    // required later in the same file breaks every one of them.
    it("refuses a file that adds a column empty to a table with rows and then makes it required, counting every row; nothing applied", async () => {
      writeFile(await addEmptyThenRequire(POSTS, "summary"));
      const error = await refusal();
      expect(issues(error)).toEqual([
        "Collection 'posts': field 'summary' cannot be added as required without a default while 3 rows exist, which would hold no value in it. Give it a default, or add it as optional.",
      ]);
      expect(await hasColumn(POSTS, "summary")).toBe(false);
      expect(await ledger()).toEqual([]);
    }, 120_000);

    it("refuses a Single's field, naming the Single", async () => {
      writeFile(await makeRequired(SETTINGS, "tagline"));
      expect(issues(await refusal())).toEqual([
        "Single 'settings': field 'tagline' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional.",
      ]);
      expect(await nullable(SETTINGS, "tagline")).toBe(true);
      expect(await ledger()).toEqual([]);
    }, 120_000);

    it("refuses a field group's field, naming each collection and Single holding null rows, and not one holding none", async () => {
      writeFile(await makeRequired(SEO, "meta_title"));
      const [message] = issues(await refusal());
      expect(message).toBe(
        "Field group 'seo': field 'meta_title' cannot become required while 3 rows hold no value in it: 2 in collection 'posts', 1 in Single 'settings'. Give those rows a value first, or keep the field optional."
      );
      expect(message).not.toContain("pages");
      expect(await nullable(SEO, "meta_title")).toBe(true);
      expect(await ledger()).toEqual([]);
    }, 120_000);

    it("applies a file that fills every null row and then makes the column required", async () => {
      writeFile([
        `UPDATE ${q(POSTS)} SET ${q("subtitle")} = 'filled' WHERE ${q("subtitle")} IS NULL`,
        ...(await makeRequired(POSTS, "subtitle")),
      ]);
      const result = await migrate();
      expect(result.applied).toBe(1);
      expect(await nullable(POSTS, "subtitle")).toBe(false);
      expect(await nulls(POSTS, "subtitle")).toBe(0);
      expect(await ledger()).toEqual(["applied"]);
    }, 120_000);

    it("refuses a file whose fill leaves null rows, at the NOT NULL statement, with the count", async () => {
      writeFile([
        `UPDATE ${q(POSTS)} SET ${q("subtitle")} = 'filled' WHERE ${q("id")} = 'p2'`,
        ...(await makeRequired(POSTS, "subtitle")),
      ]);
      const error = await refusal();
      expect(issues(error)).toEqual([
        "Collection 'posts': field 'subtitle' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional.",
      ]);
      expect(error.logContext?.phase).toBe("at-statement");
      expect(await nullable(POSTS, "subtitle")).toBe(true);
      if (dialect !== "mysql") {
        // One transaction: the fill rolled back with the rest, and nothing was recorded.
        expect(error.publicMessage).toContain("rolled back");
        expect(await nulls(POSTS, "subtitle")).toBe(2);
        expect(await ledger()).toEqual([]);
      }
    }, 120_000);

    describe.runIf(dialect === "mysql")(
      "on MySQL, which commits DDL as it runs",
      () => {
        it("a NOT NULL as the last statement after other DDL leaves every earlier statement unapplied, and nothing recorded", async () => {
          writeFile([
            `ALTER TABLE ${q(POSTS)} ADD COLUMN ${q("extra")} varchar(255)`,
            `CREATE TABLE ${q("dc_marker")} (${q("id")} varchar(36) PRIMARY KEY)`,
            ...(await makeRequired(POSTS, "subtitle")),
          ]);
          expect(issues(await refusal())).toHaveLength(1);
          expect(await hasColumn(POSTS, "extra")).toBe(false);
          expect((await adapter.listTables()).includes("dc_marker")).toBe(
            false
          );
          expect(await ledger()).toEqual([]);
        }, 120_000);

        it("a fill leaving null rows is refused naming the statements that ran, and the attempt is never recorded applied", async () => {
          writeFile([
            `ALTER TABLE ${q(POSTS)} ADD COLUMN ${q("extra")} varchar(255)`,
            `UPDATE ${q(POSTS)} SET ${q("subtitle")} = 'filled' WHERE ${q("id")} = 'p2'`,
            ...(await makeRequired(POSTS, "subtitle")),
          ]);
          const error = await refusal();
          expect(issues(error)).toHaveLength(1);
          expect(error.publicMessage).toContain(
            "The statements that ran before it: 1. ALTER TABLE `dc_posts` ADD COLUMN `extra` varchar; 2. UPDATE `dc_posts` SET `subtitle` ="
          );
          // The DDL committed as it ran; the attempt is recorded, and not as applied.
          expect(await hasColumn(POSTS, "extra")).toBe(true);
          const statuses = await ledger();
          expect(statuses.length).toBeGreaterThan(0);
          expect(statuses).not.toContain("applied");
        }, 120_000);
      }
    );
  }
);
