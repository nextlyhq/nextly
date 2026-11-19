/**
 * A translated entity's Schema Builder save that takes a field out of translation runs a migration
 * file that archives the field's other languages into `nextly_i18n_archive`, and so does one that
 * turns translation off. A Builder save runs
 * without `nextly migrate` having run first, so it makes the archive ready before its file runs:
 * on a database without one, the default language stays on the entity and the others are
 * archived, for a Single and a field group alike, on every dialect.
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
import type { SingleEntryService } from "../../../singles/services/single-entry-service";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown>;
type Exec = <T>(statement: string) => Promise<T[]>;
type Quote = (name: string) => string;

/** A translated field and a shared one. */
const TRANSLATED: Field[] = [
  { name: "title", type: "text", localized: true },
  { name: "views", type: "number", localized: false },
];

/** The same, with `title` made shared. */
const SHARED: Field[] = [
  { name: "title", type: "text", localized: false },
  { name: "views", type: "number", localized: false },
];

interface Kind {
  name: string;
  /** The entity's main table. */
  table: string;
  /** The entity, translated, with `title` in English and Spanish; the row's id. */
  seed(t: TestNextly, exec: Exec, q: Quote): Promise<string>;
  /** The Builder's schema dialog, saving `fields`, translated or not. */
  save(t: TestNextly, fields: Field[], localized: boolean): Promise<unknown>;
}

const KINDS: Kind[] = [
  {
    name: "a Single",
    table: "single_tale",
    seed: async (t, exec, q) => {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "tale", label: "Tale", localized: true, fields: TRANSLATED }
      );
      const singles: SingleEntryService = t.getService("singleEntryService");
      for (const [locale, title] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ]) {
        const written = await singles.update(
          "tale",
          { title, views: 7, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
      const [row] = await exec<{ id: unknown }>(
        `SELECT ${q("id")} AS id FROM ${q("single_tale")}`
      );
      return String(row.id);
    },
    save: async (t, fields, localized) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tale" },
        {
          fields,
          confirmed: true,
          localized,
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("tale")
          ).schemaVersion,
        }
      ),
  },
  {
    name: "a field group",
    table: "comp_band",
    // Its rows belong to the entries that embed it, written as an embedding entry's save writes them.
    seed: async (_t, exec, q) => {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "band", label: "Band", localized: true, fields: TRANSLATED }
      );
      const id = "band-1";
      await exec(
        `INSERT INTO ${q("comp_band")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(q).join(", ")}) ` +
          `VALUES ('${id}', 'entry-1', 'dc_pages', 'band', 7)`
      );
      await exec(
        `INSERT INTO ${q("comp_band_locales")} (${["_parent", "_locale", "title"].map(q).join(", ")}) ` +
          `VALUES ('${id}', 'en', 'Hello'), ('${id}', 'es', 'Hola')`
      );
      return id;
    },
    save: async (t, fields, localized) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "band" },
        {
          fields,
          confirmed: true,
          localized,
          schemaVersion: (
            await t.getService("fieldGroupRegistryService").getComponent("band")
          ).schemaVersion,
        }
      ),
  },
];

for (const dialect of getConfiguredTestDialects()) {
  describe.each(KINDS)(
    `a field taken out of translation on a database without the archive — $name (${dialect})`,
    kind => {
      let t: TestNextly;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-save-archive-"));
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

      const q: Quote = name =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const exec: Exec = <T>(statement: string): Promise<T[]> =>
        (
          t.adapter as unknown as {
            executeQuery<R>(sql: string): Promise<R[]>;
          }
        ).executeQuery<T>(statement);

      it.each([
        ["a field made shared", SHARED, true],
        ["translation turned off", TRANSLATED, false],
      ] as const)(
        "keeps the default language on the entity and archives the others, for %s",
        async (_change, fields, localized) => {
          const id = await kind.seed(t, exec, q);
          // A database `nextly migrate` has not prepared: no archive.
          await exec(`DROP TABLE IF EXISTS ${q("nextly_i18n_archive")}`);

          await kind.save(t, [...fields], localized);

          const [row] = await exec<{ value: unknown }>(
            `SELECT ${q("title")} AS value FROM ${q(kind.table)} WHERE ${q("id")} = '${id}'`
          );
          expect(row?.value).toBe("Hello");
          const [archived] = await exec<{ value: unknown }>(
            `SELECT ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
              `WHERE ${q("field")} = 'title' AND ${q("locale")} = 'es'`
          );
          expect(String(archived?.value)).toContain("Hola");
        }
      );
    }
  );
}
