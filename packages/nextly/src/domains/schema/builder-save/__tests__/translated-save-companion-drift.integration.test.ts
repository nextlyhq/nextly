/**
 * A translated entity's Schema Builder save runs a migration file planned from the migration
 * history, and its translations table is planned from what that history records of it. Where the
 * live translations table is not what the history records, the save is refused before anything
 * changes, with the error `nextly migrate` gives for a database that matches neither end of a
 * migration (`NEXTLY_MIGRATION_DRIFT`), on every dialect, for a Single and a field group alike. So
 * is one whose main table already holds a column the history records as translated.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
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

interface Kind {
  name: string;
  table: string;
  create(): Promise<unknown>;
  /** The Builder's schema dialog, saving `fields` with translation kept on. */
  save(t: TestNextly, fields: Field[]): Promise<unknown>;
}

const KINDS: Kind[] = [
  {
    name: "a Single",
    table: "single_tale",
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "tale", label: "Tale", localized: true, fields: FIELDS }
      ),
    save: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tale" },
        {
          fields,
          confirmed: true,
          localized: true,
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("tale")
          ).schemaVersion,
        }
      ),
  },
  {
    name: "a field group",
    table: "comp_band",
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "band", label: "Band", localized: true, fields: FIELDS }
      ),
    save: async (t, fields) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "band" },
        {
          fields,
          confirmed: true,
          localized: true,
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
        await kind.create();
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
    }
  );
}
