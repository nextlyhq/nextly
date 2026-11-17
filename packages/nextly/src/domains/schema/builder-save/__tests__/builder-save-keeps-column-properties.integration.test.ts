/**
 * A Schema Builder save that renames a field, alone or with other changes, changes only the
 * column's name and what the change itself names, on every dialect; and a save that does not touch
 * a column leaves it as the database reports it.
 *
 * Each case gives a field's column what a site or a plugin can give it outside the schema (a
 * comment where the dialect has one, a collation other than the table's, and a check), reads the
 * table's whole definition from the database, makes the save, and requires the definition after to
 * be the one before with only the named change applied (`helpers/table-definition.ts`), so a
 * property nobody listed here is held too.
 *
 * Every road a Builder save takes to the database is driven: a collection's save, a Single's and a
 * field group's schema dialog, and a Single's settings save run the migration file the save writes
 * where the save moves no values; a translated collection's runs the development push. A SQLite rebuild that cannot keep what it would drop must refuse, say
 * why, and leave the table as it was. A file over a default given by hand, which its snapshot does
 * not record, is refused as drift and changes nothing.
 *
 * A road that still loses something names each such case as known (`known`): it runs, and fails
 * here, as the case would; fixed, it turns red, and the entry goes.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import {
  readTableDefinition,
  withNamedChange,
  type NamedChange,
  type TableDefinition,
} from "../../__tests__/helpers/table-definition";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown>;

const RENAME = "renames the column and changes nothing else";
const RENAME_NOT_NULL =
  "renames the column and makes it NOT NULL, changing nothing else, or refuses and changes nothing";
const ADD = "adds an unrelated field and leaves the column as it was";
const HAND_DEFAULT =
  "adds an unrelated field and keeps a default given to the column by hand";
type Case =
  | typeof RENAME
  | typeof RENAME_NOT_NULL
  | typeof ADD
  | typeof HAND_DEFAULT;

/** One kind of entity the Builder saves, and the table and road its `heading` field takes. */
interface Road {
  name: string;
  /** The table `heading`'s column is on. */
  table: string;
  /**
   * The road runs the migration file the save writes, which a default given by hand, recorded in
   * no snapshot, refuses as drift.
   */
  runsFile?: boolean;
  /** The cases this road still fails, on the dialects named, and why. */
  known?: Partial<Record<Case, { on: readonly TestDialect[]; why: string }>>;
  /** Creates the entity with `fields`. */
  create(t: TestNextly, fields: Field[]): Promise<void>;
  /** The Builder's save of `fields`, `renamed` naming a rename of `heading`. */
  save(t: TestNextly, fields: Field[], renamed?: string): Promise<unknown>;
}

/** The Single both of its roads change. */
async function createHero(_t: TestNextly, fields: Field[]): Promise<void> {
  await dispatchSingles(
    "createSingle",
    {},
    { slug: "hero", label: "Hero", fields }
  );
}

const ROADS: Road[] = [
  {
    name: "a collection (its migration file)",
    table: "dc_posts",
    runsFile: true,
    async create(t, fields) {
      await t
        .getService("collectionService")
        .createCollection(
          { name: "posts", label: "Post", fields } as Parameters<
            CollectionService["createCollection"]
          >[0],
          {}
        );
    },
    save: (_t, fields, renamed) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: 1,
          ...(renamed === undefined
            ? {}
            : {
                renameResolutions: [
                  {
                    tableName: "dc_posts",
                    fromColumn: "heading",
                    toColumn: renamed,
                    choice: "rename",
                  },
                ],
              }),
        }
      ),
  },
  {
    name: "a translated collection's shared field (the push)",
    table: "dc_posts",
    // Every translated collection's save is pushed, a shared field's included.
    known: Object.fromEntries(
      [RENAME, RENAME_NOT_NULL, HAND_DEFAULT].map(name => [
        name,
        {
          on: ["sqlite", "postgresql", "mysql"],
          why: "the push restates the table from its declared schema",
        },
      ])
    ),
    async create(t, fields) {
      await t.getService("collectionService").createCollection(
        {
          name: "posts",
          label: "Post",
          localized: true,
          fields,
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
    },
    save: (_t, fields, renamed) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: 1,
          localized: true,
          ...(renamed === undefined
            ? {}
            : {
                renameResolutions: [
                  {
                    tableName: "dc_posts",
                    fromColumn: "heading",
                    toColumn: renamed,
                    choice: "rename",
                  },
                ],
              }),
        }
      ),
  },
  {
    name: "a Single's schema dialog (its migration file)",
    table: "single_hero",
    runsFile: true,
    create: createHero,
    save: async (t, fields, renamed) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "hero" },
        {
          fields,
          confirmed: true,
          // The version the Single stands at, as the Builder sends it.
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("hero")
          ).schemaVersion,
          ...(renamed === undefined
            ? {}
            : {
                renameResolutions: [
                  {
                    tableName: "single_hero",
                    fromColumn: "heading",
                    toColumn: renamed,
                    choice: "rename",
                  },
                ],
              }),
        }
      ),
  },
  {
    name: "a Single's settings save (its migration file)",
    table: "single_hero",
    // The service writes the save's migration file, and in development the writer runs it, as the
    // dialog's save does where the push would carry no values.
    runsFile: true,
    create: createHero,
    save: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields }),
  },
  {
    // A translated Single renaming a shared field: no companion value moves, so its own file runs.
    name: "a translated Single's settings save (its migration file)",
    table: "single_tale",
    runsFile: true,
    async create(_t, fields) {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "tale", label: "Tale", localized: true, fields }
      );
    },
    save: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "tale" }, { fields }),
  },
  {
    name: "a field group (its migration file)",
    table: "comp_card",
    runsFile: true,
    async create(_t, fields) {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields }
      );
    },
    save: async (t, fields, renamed) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "card" },
        {
          fields,
          confirmed: true,
          // The version the field group stands at, as the Builder sends it.
          schemaVersion: (
            await t.getService("fieldGroupRegistryService").getComponent("card")
          ).schemaVersion,
          ...(renamed === undefined
            ? {}
            : {
                renameResolutions: [
                  {
                    tableName: "comp_card",
                    fromColumn: "heading",
                    toColumn: renamed,
                    choice: "rename",
                  },
                ],
              }),
        }
      ),
  },
];

/** `heading` and `views`, `heading` shared (never translated) and given `extra`. */
function fieldsWith(name: string, extra: Field = {}): Field[] {
  return [
    { name, type: "text", localized: false, ...extra },
    { name: "views", type: "number", localized: false },
  ];
}

for (const dialect of getConfiguredTestDialects()) {
  describe.each(ROADS)(
    `a Builder save keeps what it does not name — $name (${dialect})`,
    road => {
      let t: TestNextly;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-builder-keeps-"));
        // The Builder's save runs its change in development only.
        vi.stubEnv("NODE_ENV", "development");
        t = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db: DB,
          localization: LOCALIZATION,
        });
      });

      afterEach(async () => {
        await t?.destroy();
        vi.unstubAllEnvs();
        await rm(basePath, { recursive: true, force: true });
      });

      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const exec = <T>(statement: string): Promise<T[]> =>
        (
          t.adapter as unknown as {
            executeQuery<R>(sql: string): Promise<R[]>;
          }
        ).executeQuery<T>(statement);
      const definitionOf = (): Promise<TableDefinition> =>
        readTableDefinition(statement => exec(statement), dialect, road.table);

      /**
       * Gives `views` a default by hand: a number column, because a MySQL TEXT column takes none.
       */
      async function defaultViews(): Promise<void> {
        const table = road.table;
        if (dialect === "postgresql") {
          await exec(
            `ALTER TABLE ${q(table)} ALTER COLUMN "views" SET DEFAULT 5`
          );
          return;
        }
        if (dialect === "mysql") {
          const [current] = await exec<{ type: string; nullable: string }>(
            `SELECT COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\` FROM information_schema.COLUMNS ` +
              `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'views'`
          );
          await exec(
            `ALTER TABLE ${q(table)} MODIFY COLUMN \`views\` ${current.type}${current.nullable === "YES" ? " NULL" : " NOT NULL"} DEFAULT 5`
          );
          return;
        }
        const [info] = await exec<{ type: string }>(
          `SELECT type FROM pragma_table_info('${table}') WHERE name = 'views'`
        );
        await exec(`ALTER TABLE ${q(table)} DROP COLUMN "views"`);
        await exec(
          `ALTER TABLE ${q(table)} ADD COLUMN "views" ${info.type} DEFAULT 5`
        );
      }

      /**
       * Gives `heading` a comment, a collation other than the table's and a check, where the dialect
       * has each, or, with `columnDefault`, gives `views` a default instead.
       */
      async function decorate(columnDefault?: string): Promise<void> {
        if (columnDefault !== undefined) {
          await defaultViews();
          return;
        }
        if (dialect === "postgresql") await decoratePostgres(road.table);
        else if (dialect === "mysql") await decorateMysql(road.table);
        else await decorateSqlite(road.table);
      }

      /** On PostgreSQL: `heading` collated "C", with a comment and a check. */
      async function decoratePostgres(table: string): Promise<void> {
        await exec(
          `ALTER TABLE ${q(table)} ALTER COLUMN "heading" TYPE text COLLATE "C"`
        );
        await exec(
          `COMMENT ON COLUMN ${q(table)}."heading" IS 'it''s kept by the change'`
        );
        await exec(
          `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length("heading") <= 60)`
        );
      }

      /** On MySQL: `heading` in a binary collation, with a comment and a check. */
      async function decorateMysql(table: string): Promise<void> {
        const [current] = await exec<{ type: string; nullable: string }>(
          `SELECT COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\` FROM information_schema.COLUMNS ` +
            `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'heading'`
        );
        const nullability = current.nullable === "YES" ? " NULL" : " NOT NULL";
        await exec(
          `ALTER TABLE ${q(table)} MODIFY COLUMN \`heading\` ${current.type} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin${nullability} COMMENT 'it''s kept by the change'`
        );
        await exec(
          `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length(\`heading\`) <= 60)`
        );
      }

      /**
       * On SQLite, which keeps a collation and a check only in the CREATE statement: the column made
       * again with them, its indexes dropped and put back around it. The table is empty.
       */
      async function decorateSqlite(table: string): Promise<void> {
        const indexes = await exec<{ name: string; sql: string | null }>(
          `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql LIKE '%"heading"%'`
        );
        for (const index of indexes) await exec(`DROP INDEX ${q(index.name)}`);
        await exec(`ALTER TABLE ${q(table)} DROP COLUMN "heading"`);
        await exec(
          `ALTER TABLE ${q(table)} ADD COLUMN "heading" text COLLATE NOCASE CHECK (length("heading") <= 60)`
        );
        for (const index of indexes) {
          if (index.sql !== null) await exec(index.sql);
        }
      }

      async function seeded(columnDefault?: string): Promise<TableDefinition> {
        await road.create(t, fieldsWith("heading"));
        await decorate(columnDefault);
        return definitionOf();
      }

      async function expectOnly(
        before: TableDefinition,
        change: NamedChange
      ): Promise<void> {
        expect(await definitionOf()).toEqual(withNamedChange(before, change));
      }

      /**
       * The case as this road holds it: one it still fails on this dialect runs expecting the
       * failure (`it.fails`), shown, not skipped.
       */
      const holds = (name: Case) =>
        road.known?.[name]?.on.includes(dialect as TestDialect) ? it.fails : it;

      holds(RENAME)(RENAME, async () => {
        const before = await seeded();

        await road.save(t, fieldsWith("title2"), "title2");

        await expectOnly(before, { rename: { from: "heading", to: "title2" } });
      });

      holds(RENAME_NOT_NULL)(RENAME_NOT_NULL, async () => {
        const before = await seeded();

        const refused = await road
          .save(t, fieldsWith("title2", { required: true }), "title2")
          .then(
            () => undefined,
            (error: unknown) => error
          );

        if (refused !== undefined) {
          expect(String((refused as Error).message)).toMatch(
            /does not track|cannot/
          );
          expect(await definitionOf()).toEqual(before);
          return;
        }
        await expectOnly(before, {
          rename: { from: "heading", to: "title2" },
          column: "title2",
          nullable: false,
        });
      });

      holds(ADD)(ADD, async () => {
        const before = await seeded();

        await road.save(t, [
          ...fieldsWith("heading"),
          { name: "extra", type: "text", localized: false },
        ]);

        const after = await definitionOf();
        expect({
          ...after,
          columns: after.columns.filter(column => column.name !== "extra"),
        }).toEqual(before);
      });

      if (road.runsFile === true) {
        // The file's snapshot records no default, so the database differs from it before the
        // file runs: refused as drift, before anything changes.
        it("adds an unrelated field over a default given to the column by hand, refused as drift, changing nothing", async () => {
          const before = await seeded("kept");

          await expect(
            road.save(t, [
              ...fieldsWith("heading"),
              { name: "extra", type: "text", localized: false },
            ])
          ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

          expect(await definitionOf()).toEqual(before);
        });
      } else {
        holds(HAND_DEFAULT)(HAND_DEFAULT, async () => {
          const before = await seeded("kept");

          await road.save(t, [
            ...fieldsWith("heading"),
            { name: "extra", type: "text", localized: false },
          ]);

          const after = await definitionOf();
          expect({
            ...after,
            columns: after.columns.filter(column => column.name !== "extra"),
          }).toEqual(before);
        });
      }
    }
  );
}
