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
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { parseSqlSections } from "../../migrate/sql-sections";
import { splitSqlStatements } from "../../migrate/split-sql";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  writeCollectionSave,
  type CollectionSaveDeps,
} from "../collection-save";
import { entityRelations } from "../single-relations";
import { singleEntity, type StoredSingle } from "../stored-entity";

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

/** The foreign keys `table` has in the database. */
async function keysOf(t: TestNextly, table: string) {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const dialect = adapter.getCapabilities().dialect;
  const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    table,
  ]);
  return live.tables.find(entry => entry.name === table)?.foreignKeys;
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

    it("stores and reads a JSON and a repeater field inside the group as values", async () => {
      const t = await boot(dialect);
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", [
          text("title"),
          {
            type: "group",
            label: "Extras",
            fields: [
              { name: "meta", type: "json" },
              {
                name: "links",
                type: "repeater",
                fields: [{ name: "label", type: "text" }],
              },
            ],
          } as Field,
        ]),
        change: "create",
      });

      // Written as JSON and read back as values, as fields beside the group are, on a dialect
      // whose JSON column is plain text as well as the others.
      const created = await t.nextly.create({
        collection: "posts",
        data: {
          title: "First",
          meta: { tone: "warm" },
          links: [{ label: "Home" }],
        },
      });
      const found = await t.nextly.findByID({
        collection: "posts",
        id: String(created.item.id),
      });
      expect(found).toMatchObject({
        meta: { tone: "warm" },
        links: [expect.objectContaining({ label: "Home" })],
      });
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

    it("fills the rows of a field inside the group a save makes required", async () => {
      const t = await boot(dialect);
      const group = (required: boolean): Field =>
        ({
          type: "group",
          label: "Byline",
          fields: [{ name: "subtitle", type: "text", required }],
        }) as Field;
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", [text("title"), group(false)]),
        change: "create",
      });
      await t.adapter.executeQuery(
        `INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('p1', 'A post', 'a-post', '2026-11-14 00:00:00', '2026-11-14 00:00:00')`
      );

      // The answer names the field as the schema dialog does, by the column it settles, and it
      // is found among the row's fields as one beside the group is.
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: collection("posts", [text("title"), group(false)]),
        entity: collection("posts", [text("title"), group(true)]),
        change: "update",
        resolutions: [{ column: "subtitle", kind: "fill", value: "Filled" }],
      });

      const rows = (await t.adapter.executeQuery(
        "SELECT subtitle FROM dc_posts"
      )) as unknown as { subtitle: string }[];
      expect(rows).toEqual([{ subtitle: "Filled" }]);
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

    /**
     * A Single as the definition file holds it, saved through the Builder save writer: the road a
     * Single holding a group with no name takes, since the Single API refuses one. Its keys and
     * field-group row moves are handed beside it, as the Single API's own saves hand them.
     */
    async function writeSingle(
      t: TestNextly,
      previous: StoredSingle | null,
      next: StoredSingle
    ): Promise<void> {
      const fieldsOf = (single: StoredSingle | null) =>
        (single?.fields ?? []) as FieldDefinition[];
      await writeCollectionSave(deps(t), {
        kind: "single",
        slug: next.slug,
        previous: previous === null ? null : singleEntity(previous),
        entity: singleEntity(next),
        change: previous === null ? "create" : "update",
        ...(await entityRelations(
          t.adapter as unknown as DrizzleAdapter,
          { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
          `single_${next.slug.replace(/-/g, "_")}`,
          fieldsOf(previous),
          fieldsOf(next)
        )),
      });
    }

    const notice = (fields: unknown[], extra: Partial<StoredSingle> = {}) =>
      ({ slug: "notice", label: "Notice", fields, ...extra }) as StoredSingle;

    it("creates a Single with the group's fields as columns of its row, stores and reads them there, and a later save adds only what was added", async () => {
      const t = await singleApp();
      const before = [text("heading"), laidOut];

      await writeSingle(t, null, notice(before));

      const created = await liveColumns(t, dialect, "single_notice");
      expect(created).toEqual(
        expect.arrayContaining(["heading", "subtitle", "rank"])
      );

      // The entry write stores the group's fields on the row, and the read returns them.
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        { heading: "Hello", subtitle: "Below", rank: 3, _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ heading: "Hello", subtitle: "Below", rank: 3 });

      await writeSingle(t, notice(before), notice([...before, text("extra")]));

      addsExtraAlone(migration(/_notice_update\.sql$/), "single_notice");
      expect(await liveColumns(t, dialect, "single_notice")).toEqual(
        [...created!, "extra"].sort()
      );
      // The values written before the save are where they were.
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ subtitle: "Below", rank: 3 });
    });

    it("refuses, through the Single API, a top-level field without a name, as the collection API does", async () => {
      const t = await singleApp({
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const refusal = {
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            {
              path: "fields[1].name",
              code: "REQUIRED",
              message: "Each field requires a name.",
            },
          ],
        },
      };

      // A create holding one is refused before anything is written.
      await expect(
        dispatchSingles(
          "createSingle",
          {},
          { slug: "held", label: "Held", fields: [text("heading"), laidOut] }
        )
      ).rejects.toMatchObject(refusal);
      expect(await t.adapter.tableExists("single_held")).toBe(false);

      // A translated field cannot be moved into one, so its translations are never left behind
      // by a move the companion would not follow: the schema save and the schema dialog refuse
      // it, and the field stays translated where it was.
      const heading = { name: "heading", type: "text" };
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [heading, text("strap")],
        }
      );
      const moved = [
        text("strap"),
        { type: "group", label: "Byline", fields: [heading] },
      ];
      await expect(
        dispatchSingles(
          "updateSingleSchema",
          { slug: "notice" },
          {
            fields: moved,
          }
        )
      ).rejects.toMatchObject(refusal);
      await expect(
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "notice" },
          { fields: moved, confirmed: true }
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await liveColumns(t, dialect, "single_notice")).not.toContain(
        "heading"
      );
    });

    it("keys a relationship inside the group on a Single's row, as one beside it is keyed", async () => {
      const t = await singleApp();
      const owner = {
        name: "owner",
        type: "relationship",
        options: { target: "people", onDelete: "set null" },
      };

      await writeSingle(
        t,
        null,
        notice([
          text("heading"),
          { type: "group", label: "Byline", fields: [owner] },
        ])
      );

      expect(await keysOf(t, "single_notice")).toEqual([
        expect.objectContaining({
          columns: ["owner"],
          referencesTable: "dc_people",
        }),
      ]);
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
      };

      await writeSingle(
        t,
        null,
        notice(
          [
            text("heading"),
            { type: "group", label: "Byline", fields: [owner] },
          ],
          { localized: true }
        )
      );

      // Translation is classified from the declared fields, so the relationship inside the group
      // is a column of the main row, and its key is the main table's.
      expect(await liveColumns(t, dialect, "single_notice")).toContain("owner");
      expect(await keysOf(t, "single_notice")).toEqual([
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
      const placed = (name: string) => [
        text("heading"),
        {
          type: "group",
          label: "Byline",
          fields: [{ name, type: "component", component: "meta" }],
        },
      ];

      await writeSingle(t, null, notice(placed("promo")));
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        { heading: "Held", promo: { note: "kept" }, _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      await writeSingle(t, notice(placed("promo")), notice(placed("banner")));

      // The instance written under the old name is read under the new one: the rename moved its
      // row, as it does for a field group placed beside the group.
      expect(
        (await singles.get("notice", { overrideAccess: true })).data
      ).toMatchObject({ banner: { note: "kept" } });
    });

    it("gives a required field inside the group its default on a Single's first read, and takes a first save", async () => {
      const t = await singleApp();
      await writeSingle(
        t,
        null,
        notice([
          text("heading"),
          {
            type: "group",
            label: "Byline",
            fields: [
              { name: "subtitle", type: "text", required: true },
              { name: "rank", type: "number", defaultValue: 4 },
            ],
          },
        ])
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
      await writeSingle(
        t,
        null,
        notice([text("heading"), laidOut], { localized: true })
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
      await writeSingle(
        t,
        null,
        notice(
          [
            text("heading"),
            {
              type: "group",
              label: "Byline",
              fields: [{ name: "promo", type: "component", component: "meta" }],
            },
          ],
          { versions: true }
        )
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

    it("expands a relationship inside the group on a Single's read, and stores the id a populated one stands for", async () => {
      const t = await singleApp();
      await writeSingle(
        t,
        null,
        notice([
          text("heading"),
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
        ])
      );
      const person = await t.nextly.create({
        collection: "people",
        data: { name: "Ana" },
      });
      const id = String(person.item.id);
      const singles = t.getService("singleEntryService");

      // A populated reference, as a read at depth hands one back, is stored as its id.
      const saved = await singles.update(
        "notice",
        { owner: { id, name: "Ana" }, _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(
        (await singles.get("notice", { overrideAccess: true, depth: 0 })).data
      ).toMatchObject({ owner: id });

      // And a read at depth expands it, as one beside the group is expanded.
      expect(
        (await singles.get("notice", { overrideAccess: true, depth: 1 })).data
      ).toMatchObject({ owner: { id, name: "Ana" } });
    });

    it("stores a date inside the group sent as text, as a JSON request sends it", async () => {
      const t = await singleApp();
      await writeSingle(
        t,
        null,
        notice([
          text("heading"),
          {
            type: "group",
            label: "When",
            fields: [{ name: "startsOn", type: "date" }],
          },
        ])
      );
      const singles = t.getService("singleEntryService");

      const saved = await singles.update(
        "notice",
        { startsOn: "2026-11-14T09:00:00.000Z", _overwrite: true },
        { overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const read = await singles.get("notice", { overrideAccess: true });
      expect(
        new Date(
          String((read.data as unknown as { startsOn: unknown }).startsOn)
        ).toISOString()
      ).toBe("2026-11-14T09:00:00.000Z");
    });

    it("expands a relationship inside the group on a collection's reads, one entry and a list", async () => {
      const t = await singleApp();
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", [
          text("title"),
          {
            type: "group",
            label: "Byline",
            fields: [
              { name: "owner", type: "relationship", relationTo: "people" },
            ],
          } as Field,
        ]),
        change: "create",
      });
      const person = await t.nextly.create({
        collection: "people",
        data: { name: "Ana" },
      });
      const id = String(person.item.id);
      const post = await t.nextly.create({
        collection: "posts",
        data: { title: "First", owner: id },
      });

      // Expanded at depth as a relationship beside the group is, on the detail read and on the
      // list read, which expands a page of entries in one batch.
      const expected = { owner: expect.objectContaining({ id, name: "Ana" }) };
      expect(
        await t.nextly.findByID({
          collection: "posts",
          id: String(post.item.id),
          depth: 1,
        })
      ).toMatchObject(expected);
      const listed = await t.nextly.find({ collection: "posts", depth: 1 });
      expect(listed.items).toEqual([expect.objectContaining(expected)]);
    });

    it("saves a field group placed inside the group on a collection's entry", async () => {
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
      await writeCollectionSave(deps(t), {
        slug: "posts",
        previous: null,
        entity: collection("posts", [
          text("title"),
          {
            type: "group",
            label: "Byline",
            fields: [{ name: "promo", type: "component", component: "meta" }],
          } as Field,
        ]),
        change: "create",
      });

      // The field group's value is stored as its instance, not left on the row, and read back.
      const post = await t.nextly.create({
        collection: "posts",
        data: { title: "First", promo: { note: "kept" } },
      });
      expect(
        await t.nextly.findByID({
          collection: "posts",
          id: String(post.item.id),
        })
      ).toMatchObject({ promo: { note: "kept" } });
    });
  }
);
