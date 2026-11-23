/**
 * A Schema Builder save that changes a field's type, on SQLite, PostgreSQL and MySQL, converts each
 * stored value as the new type reads it: a list's one item becomes that item, a whole number held
 * as text becomes a number, and a value that cannot convert is cleared only where the person
 * confirmed the count the review showed, else the change is refused and nothing changes. Its
 * migration file carries the same conversion, so every database it deploys to converts its own
 * values alike. A translated field's values are judged in each language, and its translations
 * table's column takes the new type in the file the save writes, where its column changes on the
 * save's database; one whose column changes only on another database is refused. Values are read
 * back through the Direct API, as the app reads them.
 *
 * What separates the right answer from plausible wrong ones:
 * - a save that judges the entity's own table alone lets a value in another language through
 *   that the new type cannot read;
 * - one that changes the entity's own column alone leaves each language's value, and every value
 *   written after, in the old type, read back as a text;
 * - a refusal without its reason gives the person no way to tell a value to fix from a change
 *   that can't be deployed yet.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { typeConversionOf } from "../builder-save/type-conversion";
import {
  type EntityTypeChangeInput,
  judgeEntityTypeChanges,
} from "../value-conversion/type-change/field-type-changes";

const SLUG = "tcc_posts";

let instance: TestNextly | undefined;
/** The project folder a translated case's saves write their migrations in, removed after it. */
let project: string | undefined;

/** A refusal of field `v`'s type change, coded `code`, saying why it can't be deployed yet. */
function refusedAs(code: string, why: string) {
  return {
    code: "VALIDATION_ERROR",
    publicData: {
      errors: [
        expect.objectContaining({
          path: "fields.v",
          code,
          message: expect.stringMatching(
            new RegExp(`${why}.*can't be deployed yet`)
          ),
        }),
      ],
    },
  };
}

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  if (project !== undefined)
    await rm(project, { recursive: true, force: true });
  project = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "a Builder save changes a field's type only where its migration deploys it alike (%s)",
  dialect => {
    const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);

    async function boot(
      fields: Record<string, unknown>[],
      options: { localized?: boolean } = {}
    ): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      // A translated collection's saves write their migrations, as a Builder project's do: its
      // translations column takes a new type only in the file a save writes and runs.
      if (options.localized === true) {
        project = await mkdtemp(join(tmpdir(), "type-change-conversion-"));
      }
      const t = await createTestNextly({
        dialect,
        ...(options.localized === true
          ? {
              localization: { locales: ["en", "es"], defaultLocale: "en" },
              basePath: project,
              db: {
                migrationsDir: "./database/history",
                uiSchemaFile: "./schema/builder.json",
              },
            }
          : {}),
      });
      instance = t;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Post",
          ...(options.localized === true ? { localized: true } : {}),
          fields,
        }
      );
      return t;
    }

    async function schemaVersion(t: TestNextly): Promise<number> {
      const [row] = await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ v: number | string | null }>(
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      );
      return Number(row?.v ?? 1);
    }

    /** The schema dialog's save of `fields`, with the clears the person confirmed, if any. */
    async function save(
      t: TestNextly,
      fields: Record<string, unknown>[],
      extra: Record<string, unknown> = {}
    ): Promise<unknown> {
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersion(t),
          ...extra,
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** An entry written through the Direct API, as the app writes it. */
    async function write(
      t: TestNextly,
      title: string,
      data: Record<string, unknown>,
      locale?: string
    ): Promise<string> {
      const created = (await t.nextly.create({
        collection: SLUG,
        data: { title, ...data },
        ...(locale === undefined ? {} : { locale }),
      } as never)) as { item?: { id?: string }; id?: string };
      const id = created.item?.id ?? created.id;
      if (id === undefined) throw new Error(`no id for ${title}`);
      return id;
    }

    /** `field` of each entry, by title, read through the Direct API. */
    async function read(
      t: TestNextly,
      field: string,
      locale?: string
    ): Promise<Record<string, unknown>> {
      const found = (await t.nextly.find({
        collection: SLUG,
        limit: 100,
        ...(locale === undefined ? {} : { locale }),
      } as never)) as { items: Array<Record<string, unknown>> };
      return Object.fromEntries(
        found.items.map(item => [String(item.title), item[field] ?? null])
      );
    }

    it("converts a text field's whole numbers into a number field, and keeps an empty one empty", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "a", { v: "12" });
      await write(t, "b", {});

      expect(await save(t, [{ name: "v", type: "number" }])).toBeUndefined();

      expect(await read(t, "v")).toEqual({ a: 12, b: null });
    });

    // A change the cast reaches goes ahead whatever else the column carries: its NOT NULL here.
    it("converts a required field's whole numbers into a required number field", async () => {
      const t = await boot([{ name: "v", type: "text", required: true }]);
      await write(t, "a", { v: "12" });
      await write(t, "b", { v: "7" });

      expect(
        await save(t, [{ name: "v", type: "number", required: true }])
      ).toBeUndefined();

      expect(await read(t, "v")).toEqual({ a: 12, b: 7 });
    });

    // A default of the old type does not stop it either: the column takes the new field's default.
    it("converts a text field with a default of its own into a number field", async () => {
      const t = await boot([{ name: "v", type: "text", defaultValue: "5" }]);
      await write(t, "a", { v: "12" });

      expect(
        await save(t, [{ name: "v", type: "number", defaultValue: 5 }])
      ).toBeUndefined();

      expect(await read(t, "v")).toEqual({ a: 12 });
    });

    // A list's one item is its reading as a text. The cast would keep the list's JSON, so the save
    // writes each value as the text reads it, and its migration file carries the same conversion
    // for every database it deploys to.
    it("converts a list of one item into that item, and an empty list into no value", async () => {
      const t = await boot([{ name: "v", type: "chips" }]);
      await write(t, "one", { v: ["a"] });
      await write(t, "none", { v: [] });

      expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

      expect(await read(t, "v")).toEqual({ one: "a", none: null });
    });

    // Every language's value is kept in the translations table, which no type change's migration
    // converts: refused, rather than leaving each language's value in the old type.
    it("converts a translated field's whole numbers into a number field in every language", async () => {
      const t = await boot([{ name: "v", type: "text", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: "12" }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "34", _overwrite: true },
        locale: "es",
      } as never);

      expect(
        await save(t, [{ name: "v", type: "number", localized: true }], {
          localized: true,
        })
      ).toBeUndefined();

      expect(await read(t, "v", "en")).toEqual({ a: 12 });
      expect(await read(t, "v", "es")).toEqual({ a: 34 });
    });

    // On SQLite the translations column is replaced by one of the new type, which a view naming the
    // table would stop part-way: refused before any value is written, naming the view.
    it.runIf(dialect === "sqlite")(
      "refuses a translated change whose translations table a view depends on, naming it, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text", localized: true }], {
          localized: true,
        });
        await write(t, "a", { v: "12" }, "en");
        await (
          t.adapter as unknown as { executeQuery(s: string): Promise<unknown> }
        ).executeQuery(
          `CREATE VIEW "tcc_view" AS SELECT "v" FROM "dc_${SLUG}_locales"`
        );

        const refused = await save(
          t,
          [{ name: "v", type: "number", localized: true }],
          { localized: true }
        );

        // The save's own refusal, before any statement: SQLite's error for the swap names the
        // view too, so the code and the words are what tell them apart.
        expect(refused).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.v",
                code: "TYPE_CHANGE_BLOCKED",
                message: expect.stringContaining(
                  "while view tcc_view depends on the table"
                ),
              }),
            ],
          },
        });
        expect(await read(t, "v", "en")).toEqual({ a: "12" });
      }
    );

    // The save counts on a translations column's new type only where its own file carries it, which
    // `migrate:create` plans from the folder's newest snapshot: one that records the fields but not
    // which columns the translations table keeps (a snapshot written before those were kept) gives
    // the file no `retypes` step, so the change is refused as before, every value as it was.
    it("refuses a translated change where the newest snapshot keeps no record of the translations columns", async () => {
      const t = await boot([{ name: "v", type: "text", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: "12" }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "34", _overwrite: true },
        locale: "es",
      } as never);
      const meta = join(project ?? "", "database", "history", "meta");
      const [newest] = readdirSync(meta)
        .filter(file => file.endsWith(".snapshot.json"))
        .sort()
        .reverse();
      const file = JSON.parse(readFileSync(join(meta, newest), "utf-8")) as {
        snapshot: { tables: { name: string; localizedColumns?: string[] }[] };
        entities?: { collections: Record<string, unknown> };
      };
      // The fixture's controls: the snapshot records the fields and the translations columns.
      expect(file.entities?.collections[SLUG]).toBeDefined();
      const table = file.snapshot.tables.find(t => t.name === `dc_${SLUG}`);
      expect(table?.localizedColumns).toContain("v");
      delete table?.localizedColumns;
      writeFileSync(join(meta, newest), JSON.stringify(file, null, 2));

      expect(
        await save(t, [{ name: "v", type: "number", localized: true }], {
          localized: true,
        })
      ).toMatchObject(refusedAs("TYPE_CHANGE_BLOCKED", "kept per language"));

      expect(await read(t, "v", "en")).toEqual({ a: "12" });
      expect(await read(t, "v", "es")).toEqual({ a: "34" });
    });

    // Holding no value is no exception: the translations table's column takes the new type, so a
    // value written after the change is stored, and read, as a number.
    it("changes a translated field holding no value too, so a value written after is a number", async () => {
      const t = await boot(
        [
          { name: "v", type: "text", localized: true },
          { name: "w", type: "text", localized: true },
        ],
        { localized: true }
      );
      await write(t, "a", { w: "x" }, "en");
      await write(t, "b", { w: "y" }, "es");

      expect(
        await save(
          t,
          [
            { name: "v", type: "number", localized: true },
            { name: "w", type: "text", localized: true },
          ],
          { localized: true }
        )
      ).toBeUndefined();

      await write(t, "c", { v: 7 }, "en");
      expect(await read(t, "v", "en")).toEqual({ a: null, b: null, c: 7 });
    });

    // Where the translations column keeps its type, nothing in that table changes: a long text
    // becoming code is held there as it is, in every language.
    it("changes a translated long text into code, keeping every language's value", async () => {
      const t = await boot([{ name: "v", type: "textarea", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: "hello" }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "hola", _overwrite: true },
        locale: "es",
      } as never);

      expect(
        await save(t, [{ name: "v", type: "code", localized: true }], {
          localized: true,
        })
      ).toBeUndefined();

      expect(await read(t, "v", "en")).toEqual({ a: "hello" });
      expect(await read(t, "v", "es")).toEqual({ a: "hola" });
    });

    // The file the save writes changes the translations column as this database makes it: a
    // checkbox's integer on SQLite is a number's column too, so a file written there changes
    // nothing, and the column another database makes (boolean, tinyint) would keep the old type.
    // Refused on SQLite; elsewhere the file changes the column.
    it("changes a translated checkbox into a number where its column changes here, and refuses it on SQLite", async () => {
      const t = await boot(
        [
          { name: "v", type: "checkbox", localized: true },
          { name: "w", type: "text", localized: true },
        ],
        { localized: true }
      );
      await write(t, "a", { w: "x" }, "en");

      const outcome = await save(
        t,
        [
          { name: "v", type: "number", localized: true },
          { name: "w", type: "text", localized: true },
        ],
        { localized: true }
      );

      if (dialect === "sqlite") {
        expect(outcome).toMatchObject(
          refusedAs("TYPE_CHANGE_BLOCKED", "kept per language")
        );
      } else {
        expect(outcome).toBeUndefined();
        await write(t, "b", { v: 3 }, "es");
        expect(await read(t, "v", "es")).toMatchObject({ b: 3 });
      }
    });

    // The translations column is cast as the entity's own column is, so a value the cast would not
    // read alike never reaches it: a text a checkbox reads only once rewritten ("TRUE") is refused
    // in each language before anything runs, every value as it was.
    it("refuses a translated text becoming a checkbox over a value it reads only once rewritten, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: "yes" }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "TRUE", _overwrite: true },
        locale: "es",
      } as never);

      const refused = await save(
        t,
        [{ name: "v", type: "checkbox", localized: true }],
        { localized: true }
      );

      expect(refused).toMatchObject(
        refusedAs("TYPE_CHANGE_BLOCKED", "rewritten into its form")
      );
      expect(await read(t, "v", "es")).toEqual({ a: "TRUE" });
    });

    // A save that stops translating the whole collection moves each language's value out of the
    // translations table as it is stored, before the entity's own table takes the new type, which
    // PostgreSQL refuses part-way: refused with the two saves that make it, not as kept per language.
    it("refuses a type change as the collection stops being translated, naming the two saves, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text", localized: true }], {
        localized: true,
      });
      await write(t, "a", { v: "12" }, "en");

      const refused = await save(
        t,
        [{ name: "v", type: "number", localized: true }],
        { localized: false }
      );

      expect(refused).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              code: "TYPE_CHANGE_BLOCKED",
              message: expect.stringContaining(
                "turn off translation and save first, then change the field's type"
              ),
            }),
          ],
        },
      });
      // One refusal for the field, naming the two saves, never the translated column's.
      expect(
        (refused as { publicData: { errors: { message: string }[] } })
          .publicData.errors
      ).toEqual([
        expect.objectContaining({
          message: expect.not.stringMatching(/kept per language/),
        }),
      ]);
      expect(await read(t, "v", "en")).toEqual({ a: "12" });
    });

    // Each language's value is judged before the save changes anything: a value no number reads in
    // one language alone refuses the change, naming that language's row, until its clear is
    // confirmed, and nothing changes.
    it("refuses a translated change over a value one language holds that cannot convert, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: "12" }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "abc", _overwrite: true },
        locale: "es",
      } as never);

      const refused = await save(
        t,
        [{ name: "v", type: "number", localized: true }],
        { localized: true }
      );

      expect(refused).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              code: "TYPE_CHANGE_LOSES_VALUES",
              message: expect.stringContaining(
                "Confirm clearing the values that cannot convert"
              ),
            }),
          ],
        },
      });
      expect(JSON.stringify(refused)).not.toMatch(/kept per language/);
      expect(JSON.stringify(refused)).not.toContain("can't be deployed yet");
      expect(JSON.stringify(refused)).toMatch(/\bes\b/);
      expect(await read(t, "v", "en")).toEqual({ a: "12" });
      expect(await read(t, "v", "es")).toEqual({ a: "abc" });
    });

    // A value that cannot convert is cleared only with the person's consent, for the count the
    // review showed: without it the change is refused, and nothing changes.
    it("refuses a change that would lose a value when no clear is confirmed, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      const refused = await save(t, [{ name: "v", type: "number" }]);
      expect(refused).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              code: "TYPE_CHANGE_LOSES_VALUES",
            }),
          ],
        },
      });
      expect(JSON.stringify(refused)).not.toContain("can't be deployed yet");

      expect(await read(t, "v")).toEqual({ kept: "12", lost: "abc" });
    });

    // The count the person confirms is the review's, judged as the save judges it.
    it("reviews the values a change would clear, by field, for the person to confirm", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      const answer = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: SLUG },
        { fields: [{ name: "v", type: "number" }] }
      )) as Response | Record<string, unknown>;
      const json = (
        answer instanceof Response ? await answer.json() : answer
      ) as Record<string, unknown>;
      const review = (json.data ?? json) as { clears?: unknown };

      expect(review.clears).toEqual([{ field: "v", count: 1 }]);
    });

    it("clears only the values that cannot convert when the clear is confirmed with its count, and converts the rest", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(
        await save(t, [{ name: "v", type: "number" }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toBeUndefined();

      expect(await read(t, "v")).toEqual({ kept: 12, lost: null });
    });

    /** A statement on `t`'s database, outside any save. */
    async function exec(t: TestNextly, statement: string): Promise<void> {
      await (
        t.adapter as unknown as { executeQuery(s: string): Promise<unknown> }
      ).executeQuery(statement);
    }

    /** A save refused before anything ran, whose message says `why`. */
    function refusedSaying(why: string) {
      return {
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              message: expect.stringContaining(why),
            }),
          ],
        },
      };
    }

    // On MySQL a column is emptied before it takes its new type: a NOT NULL column refuses to be
    // emptied unless the constraint is set aside first and put back once its values are in.
    it("converts a required field's lists of one item into a required text field", async () => {
      const t = await boot([{ name: "v", type: "chips", required: true }]);
      await write(t, "a", { v: ["x"] });
      await write(t, "b", { v: ["y"] });

      expect(
        await save(t, [{ name: "v", type: "text", required: true }])
      ).toBeUndefined();

      expect(await read(t, "v")).toEqual({ a: "x", b: "y" });
    });

    // On PostgreSQL a column's default of the old type stops `ALTER … USING`: it is dropped first
    // and the new field's default set after.
    it("converts a field with a default of its own, clearing a confirmed value, and keeps the new default", async () => {
      const t = await boot([{ name: "v", type: "text", defaultValue: "5" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(
        await save(t, [{ name: "v", type: "number", defaultValue: 5 }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toBeUndefined();

      expect(await read(t, "v")).toEqual({ kept: 12, lost: null });
      await write(t, "fresh", {});
      expect((await read(t, "v")).fresh).toBe(5);
    });

    // Two values that read as one under a unique field would break its index part way through: the
    // change is refused before any value is written, for that reason alone, now that the save
    // writes each value as the new type reads it.
    it("refuses a unique field whose values read as one under the new type, naming them, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text", unique: true }]);
      await write(t, "a", { v: "12" });
      await write(t, "b", { v: "012" });

      const refused = await save(t, [
        { name: "v", type: "number", unique: true },
      ]);
      expect(refused).toMatchObject(
        refusedSaying("which a unique field holds once (2 rows")
      );
      expect(JSON.stringify(refused)).not.toContain("a save does not do yet");

      expect(await read(t, "v")).toEqual({ a: "12", b: "012" });
    });

    // A cleared value is no value, which a required field refuses: the clear is refused, even confirmed.
    it("refuses a confirmed clear into a required field, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text", required: true }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(
        await save(t, [{ name: "v", type: "number", required: true }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toMatchObject(refusedSaying("required"));

      expect(await read(t, "v")).toEqual({ kept: "12", lost: "abc" });
    });

    // Each value is written by an UPDATE of its row, which a table's update trigger fires on once per
    // row, doing whatever it does: refused before any value is written, naming the trigger.
    it("refuses a conversion of a table with an update trigger, naming it, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "chips" }]);
      await write(t, "one", { v: ["a"] });
      const table = `dc_${SLUG}`;
      if (dialect === "postgresql") {
        await exec(
          t,
          `CREATE FUNCTION tcc_touch_fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`
        );
      }
      await exec(
        t,
        dialect === "mysql"
          ? `CREATE TRIGGER ${q("tcc_touch")} AFTER UPDATE ON ${q(table)} FOR EACH ROW SET @tcc_touched = 1`
          : dialect === "postgresql"
            ? `CREATE TRIGGER ${q("tcc_touch")} AFTER UPDATE ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION tcc_touch_fn()`
            : `CREATE TRIGGER ${q("tcc_touch")} AFTER UPDATE ON ${q(table)} BEGIN SELECT 1; END`
      );

      expect(await save(t, [{ name: "v", type: "text" }])).toMatchObject(
        refusedSaying("tcc_touch")
      );

      expect(await read(t, "v")).toEqual({ one: ["a"] });
    });

    /** `v` of each entry, by title, as the table holds it: its text, or null for no value. */
    async function stored(
      t: TestNextly
    ): Promise<Record<string, string | null>> {
      const rows = await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ title: string; v: unknown }>(
        `SELECT ${q("title")} AS title, ${q("v")} AS v FROM ${q(`dc_${SLUG}`)}`
      );
      return Object.fromEntries(
        rows.map(row => [row.title, row.v === null ? null : String(row.v)])
      );
    }

    /** The judgement of `v` becoming a number on `t`'s table, as a save makes it, and its conversion. */
    async function judgedThenConversion(t: TestNextly, confirmed: number) {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const input: EntityTypeChangeInput = {
        label: `Collection '${SLUG}'`,
        table: `dc_${SLUG}`,
        previous: [{ name: "v", type: "text" }] as never,
        next: [{ name: "v", type: "number" }] as never,
        builtBy: "collection",
        acknowledged: new Set(["v"]),
        rewrites: true,
      };
      const { judged } = await judgeEntityTypeChanges(
        adapter.getDrizzle(),
        dialect,
        input
      );
      const conversion = typeConversionOf({
        dialect,
        input,
        judged,
        consent: {
          kind: "review",
          confirmed: [{ field: "v", count: confirmed }],
        },
      });
      if (conversion === undefined) throw new Error("nothing converts");
      return { db: adapter.getDrizzle(), conversion };
    }

    // The conversion judges its values again on the handle that writes them, so a value written
    // after the save judged them is converted with the rest: one carried over from the judgement
    // alone would leave it empty.
    it("converts a value written after the save judged the values, as the rest", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });
      const { db, conversion } = await judgedThenConversion(t, 1);
      await write(t, "late", { v: "34" });

      await conversion.run(db);

      const after = await stored(t);
      expect(Number(after.late)).toBe(34);
      expect(Number(after.kept)).toBe(12);
      expect(after.lost).toBeNull();
    });

    it("refuses a conversion once a value written after the save's judgement changes the count to clear, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });
      const { db, conversion } = await judgedThenConversion(t, 1);
      await write(t, "late", { v: "xyz" });

      await expect(conversion.run(db)).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
              message: expect.stringContaining("2"),
            }),
          ],
        },
      });

      expect(await stored(t)).toEqual({ kept: "12", lost: "abc", late: "xyz" });
    });

    // A default the column carries of the old type need not cast to the new one: it goes before the
    // column changes type, as a field's column declares none. A save refuses such a column as drift
    // before anything runs, so the conversion is asked directly; on MySQL a text column holds no
    // default, and SQLite's keeps its own through the rebuild that types it.
    it.runIf(dialect === "postgresql")(
      "converts a column carrying a default of the old type that cannot cast to the new one",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "a", { v: "12" });
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} SET DEFAULT 'none'`
        );
        const { db, conversion } = await judgedThenConversion(t, 0);

        await conversion.run(db);

        expect(Number((await stored(t)).a)).toBe(12);
      }
    );

    // A conversion writes the values while the old field's unique index still holds the column,
    // its file dropping it only after: two that read as one are refused, saying why. A collection
    // turning Unique off takes its push, so the judgement is asked as a file that converts asks it.
    it("refuses values that read as one under the old field's Unique index where the change converts them", async () => {
      const t = await boot([{ name: "v", type: "text", unique: true }]);
      await write(t, "a", { v: "12" });
      await write(t, "b", { v: "012" });

      const { refusals } = await judgeEntityTypeChanges(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect,
        {
          label: `Collection '${SLUG}'`,
          table: `dc_${SLUG}`,
          previous: [{ name: "v", type: "text", unique: true }] as never,
          next: [{ name: "v", type: "number" }] as never,
          builtBy: "collection",
          rewrites: true,
        }
      );

      expect(refusals).toEqual([
        expect.objectContaining({
          path: "v",
          message: expect.stringContaining("turn Unique off and save first"),
        }),
      ]);
    });

    // A save its push applies converts by the push's own statements, the database's cast, outside
    // any transaction a conversion could share: it is judged as that cast, and nothing is written
    // ahead of the push. A relationship switched from one entry to many in the same save reaches
    // its storage, which only the push plans from the live table, so the save keeps its push.
    it("judges a type change by the cast where the save's push applies it, converting nothing ahead of it", async () => {
      const related = (hasMany: boolean) => ({
        name: "rel",
        type: "relationship",
        relationTo: SLUG,
        ...(hasMany ? { hasMany: true } : {}),
      });
      const t = await boot([{ name: "v", type: "chips" }, related(false)]);
      await write(t, "one", { v: ["a"] });

      expect(
        await save(t, [{ name: "v", type: "text" }, related(true)])
      ).toMatchObject(refusedAs("TYPE_CHANGE_BLOCKED", "Rewriting values"));

      expect(await read(t, "v")).toEqual({ one: ["a"] });
    });

    it("refuses a confirmed clear whose count no longer holds, naming the new count, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });
      // Written after the review counted one value to clear.
      await write(t, "late", { v: "xyz" });

      expect(
        await save(t, [{ name: "v", type: "number" }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              code: "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
              message: expect.stringContaining("2"),
            }),
          ],
        },
      });

      expect(await read(t, "v")).toEqual({
        kept: "12",
        lost: "abc",
        late: "xyz",
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder save of a Single changes a field's type only where its migration deploys it alike (%s)",
  dialect => {
    it("converts a Single's whole number held as text into a number field", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({ dialect });
      instance = t;
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcc_hero",
          label: "Hero",
          fields: [{ name: "v", type: "text" }],
        }
      );
      await t.nextly.updateSingle({
        slug: "tcc_hero",
        data: { v: "12", _overwrite: true },
      } as never);

      await dispatchSingles(
        "updateSingleSchema",
        { slug: "tcc_hero" },
        { fields: [{ name: "v", type: "number" }] }
      );

      const read = (await t.nextly.findSingle({
        slug: "tcc_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
      expect(read?.item?.v ?? read?.v).toBe(12);
    });

    // A Single's save in production is applied by its push, which changes no translations column's
    // type: the file it writes carries the column's new type, but that file is not what runs. So a
    // translated field's type change is refused there, with its reason, and nothing changes.
    it("refuses a translated Single's type change in production, where its push runs rather than its file", async () => {
      vi.stubEnv("NODE_ENV", "development");
      project = await mkdtemp(join(tmpdir(), "type-change-conversion-single-"));
      const t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        basePath: project,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcc_hero",
          label: "Hero",
          localized: true,
          fields: [{ name: "v", type: "text", localized: true }],
        }
      );
      for (const [locale, v] of [
        ["en", "12"],
        ["es", "34"],
      ] as const) {
        await t.nextly.updateSingle({
          slug: "tcc_hero",
          data: { v, _overwrite: true },
          locale,
        } as never);
      }
      vi.stubEnv("NODE_ENV", "production");

      const refused = await dispatchSingles(
        "updateSingleSchema",
        { slug: "tcc_hero" },
        { fields: [{ name: "v", type: "number", localized: true }] }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(JSON.stringify(refused)).toMatch(/kept per language/);
      for (const [locale, v] of [
        ["en", "12"],
        ["es", "34"],
      ] as const) {
        const held = (await t.nextly.findSingle({
          slug: "tcc_hero",
          locale,
        } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
        expect(held?.item?.v ?? held?.v).toBe(v);
      }
    });

    // A Single answers a pair as a collection does: its own check before the save asks the same
    // judgement, and its row is converted the same way.
    it("converts a Single's list of one item into that item", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({ dialect });
      instance = t;
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcc_hero",
          label: "Hero",
          fields: [{ name: "v", type: "chips" }],
        }
      );
      await t.nextly.updateSingle({
        slug: "tcc_hero",
        data: { v: ["a"], _overwrite: true },
      } as never);

      const refused = await dispatchSingles(
        "updateSingleSchema",
        { slug: "tcc_hero" },
        { fields: [{ name: "v", type: "text" }] }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeUndefined();
      const read = (await t.nextly.findSingle({
        slug: "tcc_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
      expect(read?.item?.v ?? read?.v).toBe("a");
    });

    // The Single's save takes the person's confirmed clears as a collection's does.
    it("clears a Single's value that cannot convert once the clear is confirmed with its count", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({ dialect });
      instance = t;
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcc_hero",
          label: "Hero",
          fields: [{ name: "v", type: "text" }],
        }
      );
      await t.nextly.updateSingle({
        slug: "tcc_hero",
        data: { v: "abc", _overwrite: true },
      } as never);
      const single = (await t
        .getService("singleRegistryService")
        .getSingleBySlug("tcc_hero")) as { schemaVersion?: number } | null;

      const refused = await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tcc_hero" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: single?.schemaVersion ?? 1,
          confirmedClears: [{ field: "v", count: 1 }],
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeUndefined();
      const read = (await t.nextly.findSingle({
        slug: "tcc_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
      expect(read?.item?.v ?? read?.v ?? null).toBeNull();
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group changes a field's type only where its migration deploys it alike (%s)",
  dialect => {
    // A field group answers a pair as a collection does, its values kept on the rows the entries
    // that embed it write, each converted the same way.
    it("converts a field group's list of one item into that item", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({ dialect });
      instance = t;
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "tcc_box",
          label: "Box",
          fields: [{ name: "v", type: "chips" }],
        }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Post",
          fields: [{ name: "box", type: "component", component: "tcc_box" }],
        }
      );
      const created = (await t.nextly.create({
        collection: SLUG,
        data: { title: "a", box: { v: ["a"] } },
      } as never)) as { item?: { id?: string }; id?: string };
      const id = created.item?.id ?? created.id;
      const boxValue = async () => {
        const read = (await t.nextly.findByID({
          collection: SLUG,
          id,
        } as never)) as {
          box?: { v?: unknown };
          item?: { box?: { v?: unknown } };
        };
        return (read.item ?? read).box?.v;
      };

      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent("tcc_box")) as { schemaVersion?: number };
      const refused = await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "tcc_box" },
        {
          fields: [{ name: "v", type: "text" }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeUndefined();

      expect(await boxValue()).toBe("a");
    });

    // A field group's save takes the person's confirmed clears as a collection's does.
    it("clears a field group's value that cannot convert once the clear is confirmed with its count", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const t = await createTestNextly({ dialect });
      instance = t;
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "tcc_box", label: "Box", fields: [{ name: "v", type: "text" }] }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Post",
          fields: [{ name: "box", type: "component", component: "tcc_box" }],
        }
      );
      for (const [title, v] of [
        ["kept", "12"],
        ["lost", "abc"],
      ] as const) {
        await t.nextly.create({
          collection: SLUG,
          data: { title, box: { v } },
        } as never);
      }
      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent("tcc_box")) as { schemaVersion?: number };

      const refused = await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "tcc_box" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
          confirmedClears: [{ field: "v", count: 1 }],
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeUndefined();
      const found = (await t.nextly.find({
        collection: SLUG,
        limit: 10,
      } as never)) as unknown as {
        items: Array<{ title: string; box?: { v?: unknown } }>;
      };
      expect(
        Object.fromEntries(
          found.items.map(item => [item.title, item.box?.v ?? null])
        )
      ).toEqual({ kept: 12, lost: null });
    });
  }
);
