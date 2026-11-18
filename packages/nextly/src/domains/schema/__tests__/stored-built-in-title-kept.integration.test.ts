/**
 * A built-in field stored in a collection's definition is kept by every save, untouched.
 *
 * The admin shows a collection's `title` and `slug` as built-in rows and never sends them, so a
 * save that leaves one out has not removed it. A collection a code-first config declared
 * with its own `title`, moved to the Builder with `nextly db:sync --demote`, keeps that `title` in
 * its stored definition as declared: on a translated collection a text field is translated, so its
 * values live in the translations table. A save of anything else must neither ask whether `title`
 * was renamed into a field the save adds, nor drop its translations column: its values in every
 * language stay as they were. Held on both roads that save a collection's fields: the Builder's
 * schema dialog, and the collection's settings update carrying a field list.
 *
 * The stored shape is written as the demote writes it (the field in the registry row, its column in
 * the translations table) after an entry is saved, so the entry's values are already in place.
 * Run as a development server runs it, where a Builder save applies at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await t?.destroy();
  t = undefined;
});

const LOCALES = { locales: ["en", "es"], defaultLocale: "en" };
/** The title a code-first config declares, translated as a text field on a translated entity is. */
const DECLARED_TITLE = {
  name: "title",
  type: "text",
  label: "Headline",
  localized: true,
};
const BODY = { name: "body", type: "text", localized: true };

for (const dialect of getConfiguredTestDialects()) {
  describe(`a stored built-in title kept by every save — ${dialect}`, () => {
    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect, localization: LOCALES });
    });

    const app = () => t as TestNextly;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const run = (statement: string) =>
      app().adapter.executeQuery<Record<string, unknown>>(statement);

    async function columnsOf(table: string): Promise<string[]> {
      const snapshot = await introspectLiveColumns(
        app().adapter.getDrizzle(),
        dialect as TestDialect,
        [table]
      );
      return (snapshot.tables[0]?.columns ?? []).map(column => column.name);
    }

    /** Each language's title in `table`, by language. */
    async function titlesIn(table: string): Promise<Record<string, unknown>> {
      const rows = await run(
        `SELECT ${q("_locale")} AS locale, ${q("title")} AS title FROM ${q(table)} ORDER BY ${q("_locale")}`
      );
      return Object.fromEntries(rows.map(row => [row.locale, row.title]));
    }

    /**
     * The demote's shape: the declared title first in `registry`'s row for `slug`, its column in
     * `companion`, and a Spanish title for the row `parent`.
     */
    async function storeDeclaredTitle(
      registry: string,
      slug: string,
      companion: string,
      parent: string
    ): Promise<void> {
      const [row] = await run(
        `SELECT fields FROM ${registry} WHERE slug = '${slug}'`
      );
      const stored =
        typeof row?.fields === "string"
          ? JSON.parse(row.fields)
          : (row?.fields as unknown[]);
      const fields = [DECLARED_TITLE, ...stored];
      await run(
        `UPDATE ${registry} SET fields = '${JSON.stringify(fields).replace(/'/g, "''")}' WHERE slug = '${slug}'`
      );
      clearRegistryRowCache();
      if (!(await columnsOf(companion)).includes("title")) {
        await run(`ALTER TABLE ${q(companion)} ADD COLUMN ${q("title")} TEXT`);
      }
      const [existing] = await run(
        `SELECT COUNT(*) AS n FROM ${q(companion)} WHERE ${q("_parent")} = '${parent}' AND ${q("_locale")} = 'es'`
      );
      await run(
        Number(existing?.n ?? 0) > 0
          ? `UPDATE ${q(companion)} SET ${q("title")} = 'Titular' WHERE ${q("_parent")} = '${parent}' AND ${q("_locale")} = 'es'`
          : `INSERT INTO ${q(companion)} (${q("_parent")}, ${q("_locale")}, ${q("title")}) VALUES ('${parent}', 'es', 'Titular')`
      );
    }

    /** A translated collection holding one entry, with the demote's declared title stored. */
    async function demotedCollection(slug: string): Promise<void> {
      await app()
        .getService("collectionService")
        .createCollection(
          { name: slug, label: slug, localized: true, fields: [BODY] } as never,
          {}
        );
      const created = await app().nextly.create({
        collection: slug as never,
        data: { title: "Headline", slug: `${slug}-1`, body: "Body" } as never,
      });
      await storeDeclaredTitle(
        "dynamic_collections",
        slug,
        `dc_${slug}_locales`,
        (created.item as { id: string }).id
      );
    }

    /** The collection's schema save, as the Builder's dialog sends it: no title. */
    async function builderSave(slug: string, fields: unknown[]) {
      const [row] = await run(
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${slug}'`
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: slug },
        {
          fields,
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
          localized: true,
        }
      );
    }

    it("is kept by a save that adds another field, which is not taken for its rename", async () => {
      await demotedCollection("tka");

      await builderSave("tka", [BODY, { name: "note", type: "text" }]);

      expect(await columnsOf("dc_tka_locales")).toEqual(
        expect.arrayContaining(["title", "body", "note"])
      );
      expect((await titlesIn("dc_tka_locales")).es).toBe("Titular");
    });

    it("is kept by a save that adds nothing, its translations column not dropped", async () => {
      await demotedCollection("tkb");

      await builderSave("tkb", [{ ...BODY, label: "Text" }]);

      expect(await columnsOf("dc_tkb_locales")).toContain("title");
      expect((await titlesIn("dc_tkb_locales")).es).toBe("Titular");
    });

    it("is kept by the collection's settings update carrying a field list", async () => {
      await demotedCollection("tkc");

      await dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "tkc" },
        { fields: [BODY, { name: "note", type: "text" }] }
      );

      expect(await columnsOf("dc_tkc_locales")).toContain("title");
      expect((await titlesIn("dc_tkc_locales")).es).toBe("Titular");
    });

    it("is kept by the collection's settings update carrying its field list unchanged", async () => {
      await demotedCollection("tkd");

      await dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "tkd" },
        { fields: [{ ...BODY, label: "Text" }] }
      );

      expect(await columnsOf("dc_tkd_locales")).toContain("title");
      expect((await titlesIn("dc_tkd_locales")).es).toBe("Titular");
    });
  });
}
