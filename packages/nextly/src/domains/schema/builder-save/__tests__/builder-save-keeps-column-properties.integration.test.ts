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
 * Every road a Builder save takes to the database is driven: a collection's save runs the migration
 * file it writes; a translated collection's, a Single's and a field group's run the development
 * push. A SQLite rebuild that cannot keep what it would drop must refuse, say why, and leave the
 * table as it was.
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

/** One kind of entity the Builder saves, and the table and road its `heading` field takes. */
interface Road {
  name: string;
  /** The table `heading`'s column is on. */
  table: string;
  /** Creates the entity with `fields`. */
  create(t: TestNextly, fields: Field[]): Promise<void>;
  /** The Builder's save of `fields`, `renamed` naming a rename of `heading`. */
  save(t: TestNextly, fields: Field[], renamed?: string): Promise<unknown>;
}

const ROADS: Road[] = [
  {
    name: "a collection (its migration file)",
    table: "dc_posts",
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
    name: "a Single (the push)",
    table: "single_hero",
    async create(_t, fields) {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", fields }
      );
    },
    save: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields }),
  },
  {
    name: "a field group (the push)",
    table: "comp_card",
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
        const table = road.table;
        if (columnDefault !== undefined) {
          await defaultViews();
          return;
        }
        if (dialect === "postgresql") {
          await exec(
            `ALTER TABLE ${q(table)} ALTER COLUMN "heading" TYPE text COLLATE "C"`
          );
          await exec(
            `COMMENT ON COLUMN ${q(table)}."heading" IS 'it''s kept by the change'`
          );
          await exec(
            `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length("heading") <= 60)`
          );
          return;
        }
        if (dialect === "mysql") {
          const [current] = await exec<{ type: string; nullable: string }>(
            `SELECT COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\` FROM information_schema.COLUMNS ` +
              `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'heading'`
          );
          const nullability =
            current.nullable === "YES" ? " NULL" : " NOT NULL";
          if (columnDefault !== undefined) {
            await exec(
              `ALTER TABLE ${q(table)} MODIFY COLUMN \`heading\` ${current.type}${nullability} DEFAULT '${columnDefault}'`
            );
            return;
          }
          await exec(
            `ALTER TABLE ${q(table)} MODIFY COLUMN \`heading\` ${current.type} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin${nullability} COMMENT 'it''s kept by the change'`
          );
          await exec(
            `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length(\`heading\`) <= 60)`
          );
          return;
        }
        // SQLite keeps a collation, a check and a default only in the CREATE statement, so the column
        // is made again with them, its indexes dropped and put back around it. The table is empty.
        const indexes = await exec<{ name: string; sql: string | null }>(
          `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql LIKE '%"heading"%'`
        );
        for (const index of indexes) await exec(`DROP INDEX ${q(index.name)}`);
        await exec(`ALTER TABLE ${q(table)} DROP COLUMN "heading"`);
        await exec(
          `ALTER TABLE ${q(table)} ADD COLUMN "heading" text` +
            (columnDefault !== undefined
              ? ` DEFAULT '${columnDefault}'`
              : ` COLLATE NOCASE CHECK (length("heading") <= 60)`)
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

      it("renames the column and changes nothing else", async () => {
        const before = await seeded();

        await road.save(t, fieldsWith("title2"), "title2");

        await expectOnly(before, { rename: { from: "heading", to: "title2" } });
      });

      it("renames the column and makes it NOT NULL, changing nothing else, or refuses and changes nothing", async () => {
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

      it("adds an unrelated field and leaves the column as it was", async () => {
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

      it("adds an unrelated field and keeps a default given to the column by hand", async () => {
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
  );
}
