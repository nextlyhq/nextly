/**
 * A group with no name in a collection's or a Single's fields only lays fields out: the fields it
 * holds are stored where it sits, as columns of the entity's own row. That is where the entry
 * reads and writes address them, and every builder of the row's columns has to agree: the SQL
 * that creates the table, the runtime table, and the desired table each Builder save diffs a
 * migration from.
 *
 * Handed the group itself, each of those read its missing name and stopped, so a Single holding
 * one could not be created, and a collection holding one in the definition file stopped every
 * later Builder save. Leaving the group's fields out instead would have planned dropping columns
 * that hold values, so these cases read what the migrations say, not only that a save returned.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection } from "../../../../collections/config/define-collection";
import { text as textField } from "../../../../collections/fields/helpers";
import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { parseSqlSections } from "../../migrate/sql-sections";
import { splitSqlStatements } from "../../migrate/split-sql";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  writeCollectionSave,
  type CollectionSaveDeps,
} from "../collection-save";

type Field = UiSchemaEntity["fields"][number];

const text = (name: string): Field => ({ name, type: "text" }) as Field;

/** A group with no name holding two fields of different kinds, which only lays them out. */
const laidOut = {
  type: "group",
  label: "Byline",
  fields: [
    { name: "subtitle", type: "text" },
    { name: "rank", type: "number" },
  ],
} as Field;

/** A collection as the Builder's definition file records it. */
function collection(slug: string, fields: Field[]): UiSchemaEntity {
  return {
    slug,
    labels: { singular: slug, plural: `${slug}s` },
    fields,
  } as UiSchemaEntity;
}

/**
 * The schema statements a migration file runs: its UP section, split as `nextly migrate` splits
 * it, without the registry rows it records (which restate every field, the group's included).
 */
function schemaStatementsOf(path: string): string[] {
  return splitSqlStatements(parseSqlSections(readFileSync(path, "utf-8")).upSql)
    .map(statement => statement.trim())
    .filter(statement => /^(ALTER|CREATE|DROP)\b/i.test(statement));
}

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-nameless-group-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** An app over a fresh database of `dialect`; SQLite in a file of this case's folder. */
async function boot(
  dialect: TestDialect,
  extra: Partial<Parameters<typeof createTestNextly>[0]> = {}
): Promise<TestNextly> {
  if (dialect !== "sqlite") {
    instance = await createTestNextly({ dialect, ...extra });
    return instance;
  }
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  instance = await createTestNextly({ adapter, ...extra });
  return instance;
}

/** The columns `table` has in the database, sorted; undefined when it does not exist. */
async function liveColumns(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<string[] | undefined> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    table,
  ]);
  return live.tables
    .find(entry => entry.name === table)
    ?.columns.map(column => column.name)
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "a Builder save of an entity holding a group with no name (%s)",
  dialect => {
    function deps(t: TestNextly): CollectionSaveDeps {
      return {
        adapter: t.adapter as unknown as DrizzleAdapter,
        config: defineConfig({
          collections: [],
          db: { migrationsDir: "./migrations" },
        }),
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        applies: true,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      };
    }

    const migration = (pattern: RegExp): string[] => {
      const found = readdirSync(join(dir, "migrations")).filter(f =>
        pattern.test(f)
      );
      expect(found).toHaveLength(1);
      return schemaStatementsOf(join(dir, "migrations", found[0]!));
    };

    /** One statement adding the column `extra` to `table`, and nothing else. */
    const addsExtraAlone = (statements: string[], table: string): void => {
      expect(statements, statements.join("\n")).toHaveLength(1);
      expect(statements[0]).toMatch(
        new RegExp(
          `^ALTER TABLE [\`"]?${table}[\`"]? ADD (COLUMN )?[\`"]?extra[\`"]?`,
          "i"
        )
      );
    };

    it("creates a collection with the group's fields as columns of its row, and a later save of it adds only what was added", async () => {
      const t = await boot(dialect);
      const before = [text("title"), laidOut];

      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", before),
        change: "create",
      });

      // The group's fields are columns of the row; the group, which has no name, is none.
      const created = await liveColumns(t, dialect, "dc_posts");
      expect(created).toEqual(
        expect.arrayContaining(["title", "subtitle", "rank"])
      );

      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: collection("posts", before),
        entity: collection("posts", [...before, text("extra")]),
        change: "update",
      });

      // The update's migration adds the new column and touches none of the group's: a desired
      // table missing them would have dropped them, and one reading the group itself stopped.
      addsExtraAlone(migration(/_posts_update\.sql$/), "dc_posts");
      expect(await liveColumns(t, dialect, "dc_posts")).toEqual(
        [...created!, "extra"].sort()
      );
    });

    it("judges a unique field inside the group as one beside it is judged", async () => {
      const t = await boot(dialect);
      const unique = { name: "code", type: "text", unique: true } as Field;
      /** How a create of `slug` holding `fields` ends: refused with a code, or made. */
      const outcome = async (slug: string, fields: Field[]) => {
        try {
          await writeCollectionSave(deps(t), {
            slug,
            previous: null,
            entity: collection(slug, fields),
            change: "create",
          });
          return "made";
        } catch (error) {
          return `refused ${String((error as { code?: unknown }).code)}`;
        }
      };

      // Where the database cannot key the column (an unbounded MySQL TEXT) both are refused, and
      // where it can both are made: the group does not hide the field from the check.
      const beside = await outcome("beside", [unique]);
      const inside = await outcome("inside", [
        { type: "group", label: "Codes", fields: [unique] } as Field,
      ]);
      expect(inside).toBe(beside);
    });

    it("saves another collection while one holding the group is in the definition file, touching only the one saved", async () => {
      const t = await boot(dialect);
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", [text("title"), laidOut]),
        change: "create",
      });
      const posts = await liveColumns(t, dialect, "dc_posts");

      await writeCollectionSave(deps(t), {
        slug: "pages",
        previous: null,
        entity: collection("pages", [text("heading")]),
        change: "create",
      });

      const create = migration(/_pages_create\.sql$/);
      expect(create.join("\n")).toMatch(/dc_pages/);
      expect(create.join("\n")).not.toMatch(/dc_posts/);
      expect(await liveColumns(t, dialect, "dc_pages")).toContain("heading");
      expect(await liveColumns(t, dialect, "dc_posts")).toEqual(posts);
    });

    it("creates a Single with the group's fields as columns of its row, stores and reads them there, and a later save adds only what was added", async () => {
      const t = await boot(dialect, {
        db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
        basePath: dir,
      });
      // As the Builder runs: each save is applied, and recorded, here.
      vi.stubEnv("NODE_ENV", "development");
      const before = [text("heading"), laidOut];

      await dispatchSingles(
        "createSingle",
        {},
        { slug: "notice", label: "Notice", fields: before }
      );

      const created = await liveColumns(t, dialect, "single_notice");
      expect(created).toEqual(
        expect.arrayContaining(["heading", "subtitle", "rank"])
      );

      // The entry write stores the group's fields on the row, and the read returns them.
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        {
          heading: "Hello",
          subtitle: "Below",
          rank: 3,
          _overwrite: true,
        },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const read = await singles.get("notice", { overrideAccess: true });
      expect(read.data).toMatchObject({
        heading: "Hello",
        subtitle: "Below",
        rank: 3,
      });

      await dispatchSingles(
        "updateSingleSchema",
        { slug: "notice" },
        { fields: [...before, text("extra")] }
      );

      addsExtraAlone(migration(/_notice_update\.sql$/), "single_notice");
      expect(await liveColumns(t, dialect, "single_notice")).toEqual(
        [...created!, "extra"].sort()
      );
      // The values written before the save are where they were.
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({
        subtitle: "Below",
        rank: 3,
      });
    });

    /** A Single app, run as the Builder runs it, with a collection `people` defined in code. */
    async function singleApp(
      extra: Partial<Parameters<typeof createTestNextly>[0]> = {}
    ): Promise<TestNextly> {
      const t = await boot(dialect, {
        ...extra,
        db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
        basePath: dir,
        collections: [
          defineCollection({
            slug: "people",
            fields: [textField({ name: "name" })],
          }),
        ],
      });
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    it("keys a relationship inside the group on a Single's row, as one beside it is keyed", async () => {
      const t = await singleApp();
      const owner = {
        name: "owner",
        type: "relationship",
        options: { target: "people", onDelete: "set null" },
      } as Field;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [
            text("heading"),
            { type: "group", label: "Byline", fields: [owner] } as Field,
          ],
        }
      );

      // The key the creating SQL declares for the column: the migration the save wrote builds the
      // table from the desired schema and the keys handed beside it, which read the group through.
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        "single_notice",
      ]);
      const keys = live.tables.find(
        entry => entry.name === "single_notice"
      )?.foreignKeys;
      expect(keys, JSON.stringify(keys)).toEqual([
        expect.objectContaining({
          columns: ["owner"],
          referencesTable: "dc_people",
        }),
      ]);
    });

    it("refuses a Single save that renames a field inside the group to a width its stored value does not fit, and changes nothing", async () => {
      const t = await singleApp();
      const short = (name: string, maxLength: number): Field =>
        ({
          name,
          type: "text",
          options: { variant: "short" },
          validation: { maxLength },
        }) as Field;
      const group = (field: Field): Field =>
        ({ type: "group", label: "Byline", fields: [field] }) as Field;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [text("heading"), group(short("subtitle", 40))],
        }
      );
      const singles = t.getService("singleEntryService");
      await singles.update(
        "notice",
        { subtitle: "a value longer than ten", _overwrite: true },
        { overrideAccess: true }
      );
      const before = await liveColumns(t, dialect, "single_notice");

      // The renamed field is the same column, so its stored value is judged against the new width
      // before anything runs, as a rename beside the group is.
      await expect(
        dispatchSingles(
          "updateSingleSchema",
          { slug: "notice" },
          { fields: [text("heading"), group(short("strap", 10))] }
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(await liveColumns(t, dialect, "single_notice")).toEqual(before);
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ subtitle: "a value longer than ten" });
    });

    it("refuses a Single save that adds a field inside the group whose default its own rules refuse, over the row it holds", async () => {
      const t = await singleApp();
      const group = (...fields: Field[]): Field =>
        ({ type: "group", label: "Byline", fields }) as Field;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [text("heading"), group(text("subtitle"))],
        }
      );
      await t
        .getService("singleEntryService")
        .update(
          "notice",
          { heading: "Held", _overwrite: true },
          { overrideAccess: true }
        );
      const before = await liveColumns(t, dialect, "single_notice");

      // The row the Single holds would be filled with 0, which the field's own minimum refuses,
      // so the save is refused before anything runs, as it is for such a field beside the group.
      await expect(
        dispatchSingles(
          "updateSingleSchema",
          { slug: "notice" },
          {
            fields: [
              text("heading"),
              group(text("subtitle"), {
                name: "rank",
                type: "number",
                defaultValue: 0,
                validation: { min: 1 },
              } as Field),
            ],
          }
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await liveColumns(t, dialect, "single_notice")).toEqual(before);
    });

    it("makes a required translated field of a translated Single holding the group shared", async () => {
      const t = await boot(dialect, {
        db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
        basePath: dir,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      vi.stubEnv("NODE_ENV", "development");
      const heading = { name: "heading", type: "text", required: true };

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [heading as Field, laidOut],
        }
      );
      // Translated, the heading lives in the companion; the group's fields stay on the row.
      expect(await liveColumns(t, dialect, "single_notice")).not.toContain(
        "heading"
      );

      // Leaving translation plans restoring its requiredness over the column types the creating
      // SQL gives the row, which reads the group through.
      await dispatchSingles(
        "updateSingleSchema",
        { slug: "notice" },
        {
          fields: [{ ...heading, localized: false } as Field, laidOut],
        }
      );

      expect(await liveColumns(t, dialect, "single_notice")).toEqual(
        expect.arrayContaining(["heading", "subtitle", "rank"])
      );
    });

    it("keys a relationship inside the group on a translated Single's row, whatever it says of translation", async () => {
      const t = await singleApp({
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const owner = {
        name: "owner",
        type: "relationship",
        localized: true,
        options: { target: "people", onDelete: "set null" },
      } as Field;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [
            text("heading"),
            { type: "group", label: "Byline", fields: [owner] } as Field,
          ],
        }
      );

      // Translation is classified from the declared fields, so the relationship inside the group
      // is a column of the main row, and its key is the main table's.
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        "single_notice",
      ]);
      const table = live.tables.find(entry => entry.name === "single_notice");
      expect(table?.columns.map(column => column.name)).toContain("owner");
      expect(table?.foreignKeys, JSON.stringify(table?.foreignKeys)).toEqual([
        expect.objectContaining({
          columns: ["owner"],
          referencesTable: "dc_people",
        }),
      ]);
    });

    it("keeps a field group's instances when a Single save renames its field inside the group", async () => {
      const t = await singleApp();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );
      const placed = (name: string): Field =>
        ({
          type: "group",
          label: "Byline",
          fields: [{ name, type: "component", component: "meta" }],
        }) as Field;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [text("heading"), placed("promo")],
        }
      );
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        { heading: "Held", promo: { note: "kept" }, _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      await dispatchSingles(
        "updateSingleSchema",
        { slug: "notice" },
        { fields: [text("heading"), placed("banner")] }
      );

      // The instance written under the old name is read under the new one: the rename moved its
      // row, as it does for a field group placed beside the group.
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ banner: { note: "kept" } });
    });

    it("gives a required field inside the group its default on a Single's first read, and takes a first save", async () => {
      const t = await singleApp();
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [
            text("heading"),
            {
              type: "group",
              label: "Byline",
              fields: [
                { name: "subtitle", type: "text", required: true },
                { name: "rank", type: "number", defaultValue: 4 },
              ],
            } as Field,
          ],
        }
      );
      const singles = t.getService("singleEntryService");

      // The first read makes the row, NOT NULL column included, with the defaults declared inside
      // the group, as it does for fields beside it.
      const first = await singles.get("notice", { overrideAccess: true });
      expect(first.success, JSON.stringify(first)).toBe(true);
      expect(first.data).toMatchObject({ rank: 4 });

      const saved = await singles.update(
        "notice",
        { subtitle: "Below", _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ subtitle: "Below", rank: 4 });
    });

    it("reads a selected field inside the group of a translated Single from the main row", async () => {
      const t = await singleApp({
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [text("heading"), laidOut],
        }
      );
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        { heading: "Hello", subtitle: "Below", _overwrite: true },
        { overrideAccess: true, locale: "en" }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      // The group's text field is shared, on the main row, so a read selecting it asks the
      // translations table for nothing it does not hold.
      const read = await singles.get("notice", {
        overrideAccess: true,
        locale: "en",
        select: { subtitle: true },
      });
      expect(read.success, JSON.stringify(read)).toBe(true);
      expect(read.data).toMatchObject({ subtitle: "Below" });
    });

    it("records a field group inside the group in a Single's versions", async () => {
      const t = await singleApp();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          versions: true,
          fields: [
            text("heading"),
            {
              type: "group",
              label: "Byline",
              fields: [{ name: "promo", type: "component", component: "meta" }],
            } as Field,
          ],
        }
      );
      const singles = t.getService("singleEntryService");
      for (const note of ["first", "second"]) {
        const saved = await singles.update(
          "notice",
          { heading: note, promo: { note }, _overwrite: true },
          { overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }

      // Each version holds the field group's content as the save left it, as one beside the
      // group is held, so a restore can put it back.
      const versions = (
        await t.adapter.select<{
          scopeSlug: string;
          versionNo: number | null;
          snapshot: unknown;
        }>("nextly_versions")
      )
        .filter(row => row.scopeSlug === "notice" && row.versionNo !== null)
        .sort((a, b) => (a.versionNo ?? 0) - (b.versionNo ?? 0));
      const snapshot = (row: { snapshot: unknown }) =>
        (typeof row.snapshot === "string"
          ? JSON.parse(row.snapshot)
          : row.snapshot) as Record<string, unknown>;
      expect(versions.length).toBeGreaterThan(0);
      expect(snapshot(versions[versions.length - 1]!)).toMatchObject({
        heading: "second",
        promo: { note: "second" },
      });
    });

    it("changes a field group holding a relationship inside a group with no name, which the field group stores no column for", async () => {
      await singleApp();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      // The field group's creator gives the fields inside a group with no name no column, so the
      // save plans no key for one: a key over a column the table does not have fails the save.
      await dispatchComponents(
        "updateComponent",
        { slug: "meta" },
        {
          fields: [
            { name: "note", type: "text" },
            {
              type: "group",
              label: "Byline",
              fields: [
                {
                  name: "owner",
                  type: "relationship",
                  options: { target: "people", onDelete: "set null" },
                },
              ],
            },
          ],
        }
      );
    });
  }
);
