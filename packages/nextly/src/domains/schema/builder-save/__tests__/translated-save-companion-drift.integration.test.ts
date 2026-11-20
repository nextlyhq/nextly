/**
 * A translated entity's Schema Builder save runs a migration file planned from the migration
 * history, and its translations table is planned from what that history records of it. Where the
 * live translations table is not what the history records, the save is refused before anything
 * changes, with the error `nextly migrate` gives for a database that matches neither end of a
 * migration (`NEXTLY_MIGRATION_DRIFT`), on every dialect, for a Single and a field group alike. So
 * is one whose main table already holds a column the history records as translated, one whose
 * translations table is there where the history records none, and one whose per-language unique
 * indexes are not the ones the history records. Names are compared as the dialect compares them.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { COMPANION_LOCALE_COLUMN } from "../../../i18n/companion-columns";
import { companionUniqueIndexName } from "../../../i18n/migration/companion-unique-indexes";
import { readIndexUniqueness } from "../../pipeline/live-table-facts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  readTableDefinition,
  type TableDefinition,
} from "../../__tests__/helpers/table-definition";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown>;

/** A translated field and a shared one. */
const FIELDS: Field[] = [
  { name: "title", type: "text", localized: true },
  { name: "views", type: "number", localized: false },
];

/** The schema dialog's answer that a column was renamed. */
interface Rename {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename";
}

/** The same fields, untranslated. */
const UNTRANSLATED: Field[] = FIELDS.map(({ localized: _, ...field }) => field);

interface Kind {
  name: string;
  table: string;
  /** Created translated, with `FIELDS`, unless `untranslated`. */
  create(untranslated?: boolean): Promise<unknown>;
  /** The Builder's schema dialog, saving `fields` with translation on and its rename answers. */
  save(t: TestNextly, fields: Field[], renames?: Rename[]): Promise<unknown>;
}

const KINDS: Kind[] = [
  {
    name: "a Single",
    table: "single_tale",
    create: untranslated =>
      dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tale",
          label: "Tale",
          localized: untranslated !== true,
          fields: untranslated === true ? UNTRANSLATED : FIELDS,
        }
      ),
    save: async (t, fields, renames = []) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tale" },
        {
          fields,
          confirmed: true,
          localized: true,
          renameResolutions: renames,
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("tale")
          ).schemaVersion,
        }
      ),
  },
  {
    name: "a field group",
    table: "comp_band",
    create: untranslated =>
      dispatchComponents(
        "createComponent",
        {},
        {
          slug: "band",
          label: "Band",
          localized: untranslated !== true,
          fields: untranslated === true ? UNTRANSLATED : FIELDS,
        }
      ),
    save: async (t, fields, renames = []) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "band" },
        {
          fields,
          confirmed: true,
          localized: true,
          renameResolutions: renames,
          schemaVersion: (
            await t.getService("fieldGroupRegistryService").getComponent("band")
          ).schemaVersion,
        }
      ),
  },
];

for (const dialect of getConfiguredTestDialects()) {
  describe.each(KINDS)(
    `a translated save over a translations table the history does not record — $name (${dialect})`,
    kind => {
      let t: TestNextly;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-companion-drift-"));
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
      const definitionOf = (table: string): Promise<TableDefinition> =>
        readTableDefinition(statement => exec(statement), dialect, table);

      it("is refused as drift before anything changes", async () => {
        await kind.create();
        const companion = `${kind.table}_locales`;
        // A column the history never recorded, added to the translations table by hand.
        await exec(
          `ALTER TABLE ${q(companion)} ADD COLUMN ${q("subtitle")} text`
        );
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(
          kind.save(t, [
            ...FIELDS,
            { name: "note", type: "text", localized: false },
          ])
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });

      // A field made shared brings its translated column home to the main table. One the main
      // table already holds, which the history records on the translations table, is drift too:
      // the file would add it again.
      it("is refused as drift before anything changes, when a field is made shared over a main table already holding its column", async () => {
        await kind.create();
        const companion = `${kind.table}_locales`;
        await exec(
          `ALTER TABLE ${q(kind.table)} ADD COLUMN ${q("title")} text`
        );
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(
          kind.save(t, [{ ...FIELDS[0], localized: false }, FIELDS[1]])
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });

      // MySQL and SQLite take `TITLE` for `title`: a translations column the history records
      // under another case is the same column, and the save is not refused over it. PostgreSQL
      // holds the two apart.
      it.skipIf(dialect === "postgresql")(
        "is not refused as drift over a translated column the database holds under another case",
        async () => {
          await kind.create();
          const companion = `${kind.table}_locales`;
          await exec(
            `ALTER TABLE ${q(companion)} RENAME COLUMN ${q("title")} TO ${q("TITLE")}`
          );

          await kind.save(t, [
            ...FIELDS,
            { name: "note", type: "text", localized: false },
          ]);

          expect(
            (await definitionOf(kind.table)).columns.map(c => c.name)
          ).toContain("note");
        }
      );

      // The same for a structural column: `_LOCALE` is the translations table's `_locale` there.
      it.skipIf(dialect === "postgresql")(
        "is not refused as drift over a structural column the database holds under another case",
        async () => {
          await kind.create();
          const companion = `${kind.table}_locales`;
          await exec(
            `ALTER TABLE ${q(companion)} RENAME COLUMN ${q(COMPANION_LOCALE_COLUMN)} TO ${q("_LOCALE")}`
          );

          await kind.save(t, [
            ...FIELDS,
            { name: "note", type: "text", localized: false },
          ]);

          expect(
            (await definitionOf(kind.table)).columns.map(c => c.name)
          ).toContain("note");
        }
      );

      // A translations table left with its structural columns alone, where the history records
      // none: the file turning translation on would create it again.
      it("is refused as drift before anything changes, when translation is turned on over a translations table the history does not record", async () => {
        await kind.create(true);
        const companion = `${kind.table}_locales`;
        await exec(
          `CREATE TABLE ${q(companion)} (${q(COMPANION_LOCALE_COLUMN)} varchar(16))`
        );
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(kind.save(t, FIELDS)).rejects.toMatchObject({
          code: "NEXTLY_MIGRATION_DRIFT",
        });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });

      // A translated unique field's per-language index, which the file drops and creates by name.
      const UNIQUE: Field[] = [{ ...FIELDS[0], unique: true }, FIELDS[1]];
      const titleIndex = () =>
        companionUniqueIndexName(`${kind.table}_locales`, "title");

      it("is refused as drift before anything changes, when a translated unique field's index is missing and the field is renamed", async () => {
        await kind.create();
        await kind.save(t, UNIQUE);
        const companion = `${kind.table}_locales`;
        await exec(
          dialect === "mysql"
            ? `DROP INDEX ${q(titleIndex())} ON ${q(companion)}`
            : `DROP INDEX ${q(titleIndex())}`
        );
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(
          kind.save(
            t,
            [{ ...UNIQUE[0], name: "heading" }, UNIQUE[1]],
            [
              {
                tableName: companion,
                fromColumn: "title",
                toColumn: "heading",
                choice: "rename",
              },
            ]
          )
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });

      it("renames a translated unique field over its own per-language index", async () => {
        await kind.create();
        await kind.save(t, UNIQUE);
        const companion = `${kind.table}_locales`;

        await kind.save(
          t,
          [{ ...UNIQUE[0], name: "heading" }, UNIQUE[1]],
          [
            {
              tableName: companion,
              fromColumn: "title",
              toColumn: "heading",
              choice: "rename",
            },
          ]
        );

        const indexes = await readIndexUniqueness(
          t.adapter.getDrizzle(),
          dialect,
          companion
        );
        expect(
          indexes.get(companionUniqueIndexName(companion, "heading"))?.unique
        ).toBe(true);
      });

      // An index under the per-language index's name that is unique on other keys leaves a title
      // free to repeat within a language. The file would drop it by name and create the right one.
      it("is refused as drift before anything changes, when a translated unique field's index stands on other keys and the field is renamed", async () => {
        await kind.create();
        await kind.save(t, UNIQUE);
        const companion = `${kind.table}_locales`;
        await exec(
          dialect === "mysql"
            ? `DROP INDEX ${q(titleIndex())} ON ${q(companion)}`
            : `DROP INDEX ${q(titleIndex())}`
        );
        await exec(
          `CREATE UNIQUE INDEX ${q(titleIndex())} ON ${q(companion)} (${q("_parent")}, ${q(COMPANION_LOCALE_COLUMN)})`
        );
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(
          kind.save(
            t,
            [{ ...UNIQUE[0], name: "heading" }, UNIQUE[1]],
            [
              {
                tableName: companion,
                fromColumn: "title",
                toColumn: "heading",
                choice: "rename",
              },
            ]
          )
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });

      /** A plain index the history does not record, under the name `title`'s unique index takes. */
      const plantPlainTitleIndex = (companion: string) =>
        exec(
          `CREATE INDEX ${q(titleIndex())} ON ${q(companion)} (${q("title")}${dialect === "mysql" ? "(191)" : ""})`
        );

      // On MySQL a text field made unique changes its column's type, which keeps the save on the
      // push; the push is judged before it runs as the file is, so it is refused the same way.
      it("is refused as drift before anything changes, when a translated field gains Unique over an index already under its name", async () => {
        await kind.create();
        const companion = `${kind.table}_locales`;
        await plantPlainTitleIndex(companion);
        const main = await definitionOf(kind.table);
        const translations = await definitionOf(companion);

        await expect(kind.save(t, UNIQUE)).rejects.toMatchObject({
          code: "NEXTLY_MIGRATION_DRIFT",
        });

        expect(await definitionOf(kind.table)).toEqual(main);
        expect(await definitionOf(companion)).toEqual(translations);
      });
    }
  );
}
