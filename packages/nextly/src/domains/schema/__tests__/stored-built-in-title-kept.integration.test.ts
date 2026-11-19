/**
 * A built-in field stored in a collection's definition is kept by every save, untouched.
 *
 * The admin shows a collection's `title` and `slug` as built-in rows and never sends them, so a
 * save that leaves one out has not removed it. A collection a code-first config declared
 * with its own `title`, moved to the Builder with `nextly db:sync --demote`, keeps that `title` in
 * its stored definition as declared: on a translated collection a text field is translated, so its
 * values live in the translations table. A save of anything else must neither ask whether `title`
 * was renamed into a field the save adds, nor drop its translations column: its values in every
 * language stay as they were. Held on every road that saves a collection's fields: the Builder's
 * schema dialog, the collection's settings update carrying a field list, and the root-exported
 * service's update, as a plugin's `ctx.services.collections` calls it.
 *
 * The stored shape is written as the demote writes it (the field in the registry row, its column in
 * the translations table) after an entry is saved, so the entry's values are already in place.
 * Run as a development server runs it, where a Builder save applies at once.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoteCollection } from "../../../cli/commands/db-sync-demote";
import { baselineCore } from "../../../cli/commands/migrate-baseline";
import { createLogger } from "../../../cli/utils/logger";
import { defineCollection, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { getCollectionRegistryFromDI } from "../../../dispatcher/helpers/di";
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
/** The project folder a collection demoted from code is built in, where a case made one. */
let basePath = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  await t?.destroy();
  t = undefined;
  if (basePath !== "") await rm(basePath, { recursive: true, force: true });
  basePath = "";
});

const LOCALES = { locales: ["en", "es"], defaultLocale: "en" };
/** Where the project's migrations and definition file live, for the instance and its commands. */
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
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

    /**
     * The demote's shape reached the way a project reaches it: a code-first translated collection
     * declaring its own title, its tables made by the code-first sync (`db:sync`) and adopted into
     * a history by `nextly migrate:baseline`, an entry with a Spanish title, then `nextly db:sync
     * --demote`. Its history records the translations table's `title` as the database has it.
     */
    async function demotedFromCode(slug: string): Promise<void> {
      await t?.destroy();
      basePath = await mkdtemp(join(tmpdir(), "nextly-demoted-title-"));
      const coded = defineCollection({
        slug,
        localized: true,
        fields: [
          text({ name: "title", label: "Headline", localized: true }),
          text({ name: "body", localized: true }),
        ],
      });
      t = await createTestNextly({
        dialect,
        basePath,
        db: DB,
        localization: LOCALES,
        collections: [coded],
      });
      const adapter = app().adapter as unknown as DrizzleAdapter;
      const adopted = await baselineCore({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: adapter.getCapabilities().dialect,
        migrationsDir: join(basePath, "migrations"),
        logger: createLogger({ quiet: true }),
      });
      expect(adopted.kind).toBe("baselined");
      const entry = await app().nextly.create({
        collection: slug as never,
        data: { title: "Headline", slug: `${slug}-1`, body: "Body" } as never,
      });
      await run(
        `INSERT INTO ${q(`dc_${slug}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("title")}) VALUES ('${(entry.item as { id: string }).id}', 'es', 'Titular')`
      );
      const registry = getCollectionRegistryFromDI();
      if (!registry) throw new Error("the collection registry is not set up");
      const demoted = await demoteCollection({
        collection: coded as never,
        logger: createLogger({ quiet: true }),
        registry,
        adapter,
        confirm: async () => true,
      });
      expect(demoted).toBe("demoted");
      clearRegistryRowCache();
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

    // Skipped: a code-first collection's registry row is locked by its sync, and the demote's
    // update of it is refused as defined in code, so no project reaches this state through
    // `nextly db:sync --demote` today. The fixture builds it as a project would, and these run once
    // the demote can unlock the row it moves to the Schema Builder.
    it.skip("is kept by a save that adds another field, which is not taken for its rename", async () => {
      await demotedFromCode("tka");

      await builderSave("tka", [BODY, { name: "note", type: "text" }]);

      expect(await columnsOf("dc_tka_locales")).toEqual(
        expect.arrayContaining(["title", "body", "note"])
      );
      expect((await titlesIn("dc_tka_locales")).es).toBe("Titular");
    });

    // Skipped: a code-first collection's registry row is locked by its sync, and the demote's
    // update of it is refused as defined in code, so no project reaches this state through
    // `nextly db:sync --demote` today. The fixture builds it as a project would, and these run once
    // the demote can unlock the row it moves to the Schema Builder.
    it.skip("is kept by a save that adds nothing, its translations column not dropped", async () => {
      await demotedFromCode("tkb");

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

    // The root-exported service, as a plugin's `ctx.services.collections` calls it: no dispatcher
    // in between to hand the stored built-in back, so the service keeps it from the row.
    it.each([
      ["with another field added", [BODY, { name: "note", type: "text" }]],
      ["with its field list unchanged", [{ ...BODY, label: "Text" }]],
    ])(
      "is kept by the root-exported service's update %s",
      async (_case, fields) => {
        const slug = fields.length > 1 ? "tke" : "tkf";
        await demotedCollection(slug);

        await app()
          .getService("collectionService")
          .updateCollection(slug, { fields } as never, {});

        expect(await columnsOf(`dc_${slug}_locales`)).toContain("title");
        expect((await titlesIn(`dc_${slug}_locales`)).es).toBe("Titular");
      }
    );
  });
}
