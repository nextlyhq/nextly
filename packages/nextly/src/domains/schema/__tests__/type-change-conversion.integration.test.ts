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
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { typeChangeCountsOf } from "../builder-save/type-change-counts";
import { typeConversionOf } from "../builder-save/type-conversion";
import {
  type EntityTypeChangeInput,
  judgeEntityTypeChanges,
  rewritesValuesOn,
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

/** A type change's refusal, wherever its path names the field, saying why it can't be deployed yet. */
function refusedWith(why: string) {
  return {
    code: "VALIDATION_ERROR",
    publicData: {
      errors: [
        expect.objectContaining({
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
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a list of one item into that item, and an empty list into no value",
      async () => {
        const t = await boot([{ name: "v", type: "chips" }]);
        await write(t, "one", { v: ["a"] });
        await write(t, "none", { v: [] });

        expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

        expect(await read(t, "v")).toEqual({ one: "a", none: null });
      }
    );

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

    // `migrate:create` plans a translations column's new type from the folder's newest snapshot: one
    // that records the fields but not which columns the translations table keeps (a snapshot written
    // before those were kept) gives the file no `retypes` step. The save is refused, every value as
    // it was: where a road rewrites values, for the column the history does not record; where none
    // does (MySQL), as only that step could give the column its new type.
    it("refuses a translated change where the newest snapshot keeps no record of the translations columns, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "checkbox", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: true }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: false, _overwrite: true },
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

      const outcome = await save(
        t,
        [{ name: "v", type: "number", localized: true }],
        { localized: true }
      );

      expect(outcome).toMatchObject(
        rewritesValuesOn(dialect)
          ? { code: "NEXTLY_MIGRATION_DRIFT" }
          : refusedAs("TYPE_CHANGE_BLOCKED", "kept per language")
      );
      expect(await read(t, "v", "en")).toEqual({ a: true });
      expect(await read(t, "v", "es")).toEqual({ a: false });
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

    // A checkbox's integer on SQLite is a number's column too, so the save's file changes no column
    // there, and the column another database makes (boolean, tinyint) is given its new type by the
    // conversion where the file deploys: the save goes ahead on every database, as it converts on
    // each.
    it("converts a translated checkbox into a number in every language", async () => {
      const t = await boot([{ name: "v", type: "checkbox", localized: true }], {
        localized: true,
      });
      const id = await write(t, "a", { v: true }, "en");
      await t.nextly.update({
        collection: SLUG,
        id,
        data: { v: false, _overwrite: true },
        locale: "es",
      } as never);

      expect(
        await save(t, [{ name: "v", type: "number", localized: true }], {
          localized: true,
        })
      ).toBeUndefined();

      expect(await read(t, "v", "en")).toEqual({ a: 1 });
      expect(await read(t, "v", "es")).toEqual({ a: 0 });
      await write(t, "b", { v: 3 }, "es");
      expect(await read(t, "v", "es")).toMatchObject({ b: 3 });
    });

    // Each language's value is judged and written on its own: a text a checkbox reads only once
    // rewritten ("TRUE") is written as it reads, and one that says neither is cleared only with the
    // count confirmed, in the language that holds it.
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a translated text into a checkbox, clearing a confirmed value one language holds",
      async () => {
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
        const asCheckbox = [{ name: "v", type: "checkbox", localized: true }];

        expect(await save(t, asCheckbox, { localized: true })).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({ code: "TYPE_CHANGE_LOSES_VALUES" }),
            ],
          },
        });
        expect(await read(t, "v", "es")).toEqual({ a: "TRUE" });

        expect(
          await save(t, asCheckbox, {
            localized: true,
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
          })
        ).toBeUndefined();
        expect(await read(t, "v", "es")).toEqual({ a: true });
        // Its own language holds none: read without another language standing in for it.
        const en = (await t.nextly.find({
          collection: SLUG,
          locale: "en",
          fallbackLocale: false,
        } as never)) as { items: Array<{ v?: unknown }> };
        expect(en.items[0]?.v ?? null).toBeNull();
      }
    );

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
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a translated change over a value one language holds that cannot convert, and changes nothing",
      async () => {
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
      }
    );

    // A value that cannot convert is cleared only with the person's consent, for the count the
    // review showed: without it the change is refused, and nothing changes.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a change that would lose a value when no clear is confirmed, and changes nothing",
      async () => {
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
      }
    );

    // The counts the person confirms are the review's, judged as the save judges them.
    it("reviews how many values a change keeps, changes and loses, by field, for the person to confirm", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      const kept = await write(t, "kept", { v: "12" });
      const lost = await write(t, "lost", { v: "abc" });

      const answer = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: SLUG },
        { fields: [{ name: "v", type: "number" }] }
      )) as Response | Record<string, unknown>;
      const json = (
        answer instanceof Response ? await answer.json() : answer
      ) as Record<string, unknown>;
      const review = (json.data ?? json) as {
        typeChanges?: Array<{ reasons?: unknown }>;
      };

      expect(review.typeChanges).toEqual([
        expect.objectContaining({ field: "v", kept: 0, changed: 1, lost: 1 }),
      ]);
      // Each kind of value not kept, its count and the rows that hold it, by key alone.
      expect(review.typeChanges?.[0]?.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "new-form",
            rows: {
              first: [expect.objectContaining({ id: kept })],
              count: 1,
            },
          }),
          expect.objectContaining({
            kind: "not-a-number",
            rows: {
              first: [expect.objectContaining({ id: lost })],
              count: 1,
            },
          }),
        ])
      );
      expect(JSON.stringify(review.typeChanges)).not.toContain("abc");
    });

    it.skipIf(!rewritesValuesOn(dialect))(
      "clears only the values that cannot convert when the clear is confirmed with its count, and converts the rest",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });

        expect(
          await save(t, [{ name: "v", type: "number" }], {
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
          })
        ).toBeUndefined();

        expect(await read(t, "v")).toEqual({ kept: 12, lost: null });
      }
    );

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
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a required field's lists of one item into a required text field",
      async () => {
        const t = await boot([{ name: "v", type: "chips", required: true }]);
        await write(t, "a", { v: ["x"] });
        await write(t, "b", { v: ["y"] });

        expect(
          await save(t, [{ name: "v", type: "text", required: true }])
        ).toBeUndefined();

        expect(await read(t, "v")).toEqual({ a: "x", b: "y" });
      }
    );

    // On PostgreSQL a column's default of the old type stops `ALTER … USING`: it is dropped first
    // and the new field's default set after.
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a field with a default of its own, clearing a confirmed value, and keeps the new default",
      async () => {
        const t = await boot([{ name: "v", type: "text", defaultValue: "5" }]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });

        expect(
          await save(t, [{ name: "v", type: "number", defaultValue: 5 }], {
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
          })
        ).toBeUndefined();

        expect(await read(t, "v")).toEqual({ kept: 12, lost: null });
        await write(t, "fresh", {});
        expect((await read(t, "v")).fresh).toBe(5);
      }
    );

    // Two values that read as one under a unique field would break its index part way through: the
    // change is refused before any value is written, for that reason alone, now that the save
    // writes each value as the new type reads it.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a unique field whose values read as one under the new type, naming them, and changes nothing",
      async () => {
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
      }
    );

    // A cleared value is no value, which a required field refuses: the clear is refused, even confirmed.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a confirmed clear into a required field, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text", required: true }]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });

        expect(
          await save(t, [{ name: "v", type: "number", required: true }], {
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
          })
        ).toMatchObject(refusedSaying("required"));

        expect(await read(t, "v")).toEqual({ kept: "12", lost: "abc" });
      }
    );

    // A required column refuses a cleared value until it is optional, which the file's own statement
    // makes it only after the conversion: the clear waits for no constraint on any database, whether
    // the column keeps its type (an email, kept as text) or takes another.
    it.skipIf(!rewritesValuesOn(dialect)).each([
      { to: "email", kept: "a@b.co", reads: "a@b.co", counts: [1, 0] },
      { to: "number", kept: "12", reads: 12, counts: [0, 1] },
    ])(
      "clears a confirmed value of a required text becoming an optional $to",
      async ({ to, kept, reads, counts: [keeps, changes] }) => {
        const t = await boot([{ name: "v", type: "text", required: true }]);
        await write(t, "kept", { v: kept });
        await write(t, "lost", { v: "no such value" });

        expect(
          await save(t, [{ name: "v", type: to }], {
            confirmedTypeChanges: [
              { field: "v", kept: keeps, changed: changes, lost: 1 },
            ],
          })
        ).toBeUndefined();

        expect(await read(t, "v")).toEqual({ kept: reads, lost: null });
        // The column takes no value now, as an optional field's does.
        await write(t, "later", {});
        expect((await read(t, "v")).later).toBeNull();
      }
    );

    // A value the new type keeps as no value (a list's `[]`) empties its row as a cleared one does,
    // with nothing lost to confirm: a required list keeps one it held while it was optional.
    it.skipIf(!rewritesValuesOn(dialect))(
      "writes a required list's empty list as no value of the optional text it becomes",
      async () => {
        const t = await boot([{ name: "v", type: "chips" }]);
        await write(t, "one", { v: ["x"] });
        await write(t, "none", { v: [] });
        expect(
          await save(t, [{ name: "v", type: "chips", required: true }])
        ).toBeUndefined();
        // The fixture's control: the empty list is stored, under a column that takes no null.
        expect((await stored(t)).none).not.toBeNull();

        expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

        expect(await read(t, "v")).toEqual({ one: "x", none: null });
      }
    );

    // The same into a required text would leave the row with no value: refused with the count, though
    // nothing is lost to confirm.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a required list's empty list becoming a required text, naming the count, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "chips" }]);
        await write(t, "one", { v: ["x"] });
        await write(t, "none", { v: [] });
        expect(
          await save(t, [{ name: "v", type: "chips", required: true }])
        ).toBeUndefined();

        expect(
          await save(t, [{ name: "v", type: "text", required: true }])
        ).toMatchObject(refusedSaying("1 row would be left with no value"));

        expect(await read(t, "v")).toEqual({ one: ["x"], none: [] });
      }
    );

    // PostgreSQL's driver hands a JSON column's string back as a text, which the read path reads as
    // JSON once more: a text that is itself JSON would come back as what it says rather than as the
    // text it is. Refused, naming the rows, rather than counted as kept; SQLite reads each back as
    // it was.
    it.skipIf(!rewritesValuesOn(dialect)).each([
      { name: "an object", text: '{"a":1}' },
      { name: "a list", text: "[1]" },
      { name: "a number", text: "12" },
      { name: "a number with an exponent", text: "-1.5e3" },
      { name: "true", text: "true" },
      { name: "null", text: "null" },
      { name: "a quoted text", text: '"quoted"' },
    ])(
      "keeps a text that is itself JSON ($name) as that text, or refuses it by its row",
      async ({ text }) => {
        const t = await boot([{ name: "v", type: "text" }]);
        const id = await write(t, "json", { v: text });
        await write(t, "word", { v: "word" });

        const outcome = await save(t, [{ name: "v", type: "json" }]);

        if (dialect === "postgresql") {
          expect(outcome).toMatchObject(refusedSaying(`id ${id}`));
          expect(outcome).toMatchObject({
            publicData: {
              errors: [
                expect.objectContaining({ code: "TYPE_CHANGE_BLOCKED" }),
              ],
            },
          });
        } else {
          expect(outcome).toBeUndefined();
        }
        expect(await read(t, "v")).toEqual({ json: text, word: "word" });
      }
    );

    // Each value is written by an UPDATE of its row, which a table's update trigger fires on once per
    // row, doing whatever it does: refused before any value is written, naming the trigger.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a conversion of a table with an update trigger, naming it, and changes nothing",
      async () => {
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
      }
    );

    /**
     * On SQLite, `table`, holding the rows it held, made again from its own statement as `edit`
     * leaves it, its indexes after it: SQLite adds nothing to a table's statement otherwise.
     */
    async function remade(
      t: TestNextly,
      table: string,
      edit: (create: string) => string
    ): Promise<void> {
      const made = await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ type: string; sql: string | null }>(
        `SELECT type, sql FROM sqlite_master WHERE tbl_name = '${table}' ORDER BY type DESC`
      );
      const [create = "", ...indexes] = made.flatMap(
        object => object.sql ?? []
      );
      // An edit that changes nothing would leave the fixture without what it is for.
      expect(edit(create)).not.toBe(create);
      await exec(t, `ALTER TABLE ${q(table)} RENAME TO ${q(`${table}_was`)}`);
      for (const index of indexes) {
        const name = /INDEX\s+(?:IF NOT EXISTS\s+)?["`]?([\w]+)/i.exec(
          index
        )?.[1];
        await exec(t, `DROP INDEX ${q(name ?? "")}`);
      }
      await exec(t, edit(create));
      await exec(
        t,
        `INSERT INTO ${q(table)} SELECT * FROM ${q(`${table}_was`)}`
      );
      await exec(t, `DROP TABLE ${q(`${table}_was`)}`);
      for (const index of indexes) await exec(t, index);
    }

    /**
     * The collection's table with the CHECK a field's validation put on a table an earlier version
     * made, which no migration file tracks or drops.
     */
    async function addValidationCheck(
      t: TestNextly,
      check: string
    ): Promise<void> {
      const table = `dc_${SLUG}`;
      const constraint = `CONSTRAINT ${q(`chk_${table}_validation`)} CHECK (${check})`;
      if (dialect === "sqlite") {
        await remade(t, table, create =>
          create.replace(/\)\s*$/, `, ${constraint})`)
        );
        return;
      }
      await exec(t, `ALTER TABLE ${q(table)} ADD ${constraint}`);
    }

    // A CHECK written for the old type's values judges the new type's as they are written: MySQL
    // would refuse one once the column was emptied for it, with nothing to roll back, and
    // PostgreSQL the type itself. Refused before any value is written, naming the constraint.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a change of a column a CHECK constraint names, naming it, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await addValidationCheck(t, `LENGTH(${q("v")}) >= 2`);
        await write(t, "a", { v: "012" });

        expect(await save(t, [{ name: "v", type: "number" }])).toMatchObject(
          refusedSaying(`chk_dc_${SLUG}_validation`)
        );

        expect(await read(t, "v")).toEqual({ a: "012" });
      }
    );

    // A change that keeps the kind of value, and every value as it is, leaves the constraint reading
    // what it read before: no bar to it, and it holds after.
    // Where no road rewrites values (MySQL) the collection's push changes the column, as on dev, and
    // it drops the constraint with it.
    it.skipIf(!rewritesValuesOn(dialect))(
      "changes a column a CHECK constraint names where its kind and every value stay",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await addValidationCheck(t, `LENGTH(${q("v")}) >= 2`);
        await write(t, "a", { v: "a@b.co" });

        expect(await save(t, [{ name: "v", type: "email" }])).toBeUndefined();

        expect(await read(t, "v")).toEqual({ a: "a@b.co" });
        await expect(
          exec(t, `UPDATE ${q(`dc_${SLUG}`)} SET ${q("v")} = 'x'`)
        ).rejects.toThrow();
      }
    );

    // Where no value needs writing, PostgreSQL's own statement changes the column: a constraint the new
    // type takes holds after, and one it does not take stops the statement, nothing changed.
    it.runIf(dialect === "postgresql").each([
      { takes: true, check: "v IS NOT NULL OR title <> 'none'" },
      { takes: false, check: "LENGTH(v) >= 2" },
    ])(
      "leaves a column a CHECK constraint names to the database where no value needs writing (takes the new type: $takes)",
      async ({ takes, check }) => {
        const t = await boot([{ name: "v", type: "text" }]);
        await addValidationCheck(t, check);
        await write(t, "a", { v: "12" });

        const outcome = await save(t, [{ name: "v", type: "number" }]);

        if (takes) {
          expect(outcome).toBeUndefined();
          expect(await read(t, "v")).toEqual({ a: 12 });
          await expect(
            exec(
              t,
              `UPDATE ${q(`dc_${SLUG}`)} SET title = 'none', ${q("v")} = NULL`
            )
          ).rejects.toThrow();
          return;
        }
        expect(outcome).toBeInstanceOf(Error);
        expect(await read(t, "v")).toEqual({ a: "12" });
      }
    );

    // The same constraint naming another column of the table is no bar to the change.
    it.skipIf(!rewritesValuesOn(dialect))(
      "changes a column beside one a CHECK constraint names",
      async () => {
        const t = await boot([
          { name: "v", type: "text" },
          { name: "kept", type: "text" },
        ]);
        const { db, conversion } = await judgedThenConversion(t, "unconfirmed");
        await addValidationCheck(t, `LENGTH(${q("kept")}) >= 2`);
        await write(t, "a", { v: "012", kept: "words" });

        await conversion.run(db);

        expect((await stored(t)).a).toBe("12");
      }
    );

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

    /**
     * The judgement of `v` becoming a number (or `to`, from `from`) on `t`'s table, as a save
     * makes it, and its conversion.
     */
    async function judgedThenConversion(
      t: TestNextly,
      confirms: "confirmed" | "unconfirmed",
      pair: { from: string; to: string } = { from: "text", to: "number" }
    ) {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const input: EntityTypeChangeInput = {
        label: `Collection '${SLUG}'`,
        table: `dc_${SLUG}`,
        previous: [{ name: "v", type: pair.from }] as never,
        next: [{ name: "v", type: pair.to }] as never,
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
          confirmed:
            confirms === "confirmed" ? typeChangeCountsOf(judged) : undefined,
        },
      });
      if (conversion === undefined) throw new Error("nothing converts");
      return { db: adapter.getDrizzle(), conversion };
    }

    // The conversion judges its values again on the handle that writes them, so a value written
    // after a save that confirmed no counts judged them is converted with the rest: one carried over
    // from the judgement alone would leave it empty.
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a value written after an unconfirmed save judged the values, as the rest",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "12" });
        const { db, conversion } = await judgedThenConversion(t, "unconfirmed");
        await write(t, "late", { v: "34" });

        await conversion.run(db);

        const after = await stored(t);
        expect(Number(after.late)).toBe(34);
        expect(Number(after.kept)).toBe(12);
      }
    );

    it.skipIf(!rewritesValuesOn(dialect)).each([
      ["changes", "34", "changes 2 and loses 1"],
      ["loses", "xyz", "changes 1 and loses 2"],
    ])(
      "refuses a confirmed conversion once a value written after the save's judgement %s the counts, and changes nothing",
      async (_, late, says) => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });
        const { db, conversion } = await judgedThenConversion(t, "confirmed");
        await write(t, "late", { v: late });

        await expect(conversion.run(db)).rejects.toMatchObject({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "TYPE_CHANGE_COUNTS_CHANGED",
                message: expect.stringContaining(says),
              }),
            ],
          },
        });

        expect(await stored(t)).toEqual({ kept: "12", lost: "abc", late });
      }
    );

    // The column of the new type is made with no default of its own, so one the column carries would
    // go without a word: refused where the conversion runs, naming it, as where its file deploys. A
    // save refuses such a column as drift before it, so the conversion is asked directly.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses to convert a column carrying a default, naming it, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "a", { v: "012" });
        if (dialect === "sqlite") {
          await remade(t, `dc_${SLUG}`, create =>
            create.replace(/("v"\s+text)/i, "$1 DEFAULT 'none'")
          );
        } else {
          await exec(
            t,
            `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} SET DEFAULT 'none'`
          );
        }
        const { db, conversion } = await judgedThenConversion(t, "confirmed");

        await expect(conversion.run(db)).rejects.toMatchObject(
          refusedSaying("has a default ('none'")
        );

        expect(await stored(t)).toEqual({ a: "012" });
      }
    );

    // A collation the column was given is lost with its type: PostgreSQL's `ALTER … TYPE` states
    // none, so a Unique setting would compare by another rule than it did.
    it.runIf(dialect === "postgresql")(
      "refuses to convert a column of another collation than its type's, naming it, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} TYPE text COLLATE "C"`
        );
        await write(t, "a", { v: "012" });

        expect(await save(t, [{ name: "v", type: "number" }])).toMatchObject(
          refusedSaying("compares by the collation C")
        );

        expect(await read(t, "v")).toEqual({ a: "012" });
      }
    );

    // A change under an update trigger goes by its file's own statement where no value needs writing,
    // judged again in the file's transaction: a value written since that does meets the refusal there.
    it.runIf(dialect === "postgresql")(
      "asks again where it runs whether any value needs writing under an update trigger",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "a", { v: "12" });
        const { db, conversion } = await judgedThenConversion(t, "unconfirmed");
        await exec(
          t,
          `CREATE FUNCTION tcc_touch_fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`
        );
        await exec(
          t,
          `CREATE TRIGGER tcc_touch AFTER UPDATE ON ${q(`dc_${SLUG}`)} FOR EACH ROW EXECUTE FUNCTION tcc_touch_fn()`
        );

        // Nothing to write: the column is left to the statement that follows.
        await conversion.run(db);
        expect(await stored(t)).toEqual({ a: "12" });

        await exec(t, `UPDATE ${q(`dc_${SLUG}`)} SET ${q("v")} = '012'`);
        await expect(conversion.run(db)).rejects.toMatchObject(
          refusedSaying("tcc_touch")
        );
        expect(await stored(t)).toEqual({ a: "012" });
      }
    );

    // A number has no collation, so nothing is lost with the text's where no value needs writing: the
    // file's own statement changes the column, as it did before any value was converted. Into a text
    // of another column type the collation would go, and stays refused.
    it.runIf(dialect === "postgresql")(
      "changes a column of another collation into a number where no value needs writing",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} TYPE text COLLATE "C"`
        );
        await write(t, "a", { v: "12" });

        expect(await save(t, [{ name: "v", type: "number" }])).toBeUndefined();

        expect(await read(t, "v")).toEqual({ a: 12 });
      }
    );

    it.runIf(dialect === "postgresql")(
      "refuses a column of another collation becoming a text of another column type, no value needing writing",
      async () => {
        const t = await boot([{ name: "v", type: "email" }]);
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} TYPE text COLLATE "C"`
        );
        await write(t, "a", { v: "a@b.co" });

        expect(
          await save(t, [
            { name: "v", type: "text", options: { variant: "short" } },
          ])
        ).toMatchObject(refusedSaying("compares by the collation C"));

        expect(await read(t, "v")).toEqual({ a: "a@b.co" });
      }
    );

    it.runIf(dialect === "postgresql")(
      "refuses a unique text under a nondeterministic collation becoming JSON, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text", unique: true }]);
        await exec(
          t,
          `CREATE COLLATION tcc_folded (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`
        );
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} TYPE text COLLATE tcc_folded`
        );
        await write(t, "a", { v: "Word" });

        expect(
          await save(t, [{ name: "v", type: "json", unique: true }])
        ).toMatchObject(refusedSaying("its Unique setting compares by it"));

        expect(await read(t, "v")).toEqual({ a: "Word" });
      }
    );

    // SQLite keeps JSON as its text, so a unique index there would compare each value's writing;
    // PostgreSQL compares what a value parses to, so there the change goes ahead.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses a unique text becoming a unique JSON on SQLite, and keeps it unique on PostgreSQL",
      async () => {
        const t = await boot([{ name: "v", type: "text", unique: true }]);
        await write(t, "a", { v: "word" });

        const outcome = await save(t, [
          { name: "v", type: "json", unique: true },
        ]);

        if (dialect === "sqlite") {
          expect(outcome).toMatchObject(
            refusedSaying("let two equal values through")
          );
          expect(await read(t, "v")).toEqual({ a: "word" });
          return;
        }
        expect(outcome).toBeUndefined();
        expect(await read(t, "v")).toEqual({ a: "word" });
        await write(t, "b", { v: { a: 1, b: 2 } });
        await expect(write(t, "c", { v: { b: 2, a: 1 } })).rejects.toThrow();
      }
    );

    // On SQLite a translations column is replaced by the one beside it, of the new type, which has
    // neither the default nor the collation the column was given.
    it.runIf(dialect === "sqlite").each([
      ["a collation", "COLLATE NOCASE", "states a collation of its own"],
      ["a default", "DEFAULT 'none'", "has a default ('none'"],
    ])(
      "refuses a translated change of a column carrying %s, naming it, and changes nothing",
      async (_, clause, says) => {
        const t = await boot([{ name: "v", type: "text", localized: true }], {
          localized: true,
        });
        await write(t, "a", { v: "012" }, "en");
        await remade(t, `dc_${SLUG}_locales`, create =>
          create.replace(/("v"\s+text)/i, `$1 ${clause}`)
        );

        expect(
          JSON.stringify(
            await save(t, [{ name: "v", type: "number", localized: true }], {
              localized: true,
            })
          )
        ).toContain(says);

        expect(await read(t, "v", "en")).toEqual({ a: "012" });
      }
    );

    // A NOT NULL column that takes a row with no value is replaced on SQLite even where it keeps its
    // type, by a column with no default of its own: refused before any value is written. Asked
    // directly, as a save refuses the hand-set default as drift first.
    it.runIf(dialect === "sqlite")(
      "refuses to empty a row of a required column carrying a default, naming it, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text", required: true }]);
        await write(t, "kept", { v: "a@b.co" });
        await write(t, "lost", { v: "no address" });
        await remade(t, `dc_${SLUG}`, create =>
          create.replace(/("v"\s+text\s+NOT NULL)/i, "$1 DEFAULT 'none'")
        );
        const { db, conversion } = await judgedThenConversion(t, "confirmed", {
          from: "text",
          to: "email",
        });
        expect(conversion.columns).toMatchObject([{ keepsType: true }]);

        await expect(conversion.run(db)).rejects.toMatchObject(
          refusedSaying("has a default ('none')")
        );

        expect(await stored(t)).toEqual({ kept: "a@b.co", lost: "no address" });
      }
    );

    // A change that keeps the column's type (an email becoming a text, both `text` on PostgreSQL)
    // has no statement of its file to state the column again: the conversion writes its values in
    // place, so the default the column carries stays. Asked directly, as a save refuses the
    // hand-set default as drift; MySQL's column changes type here, and SQLite sets none by ALTER.
    it.runIf(dialect === "postgresql")(
      "keeps the default of a column whose type the change keeps",
      async () => {
        const t = await boot([{ name: "v", type: "email" }]);
        await write(t, "a", { v: "a@b.co" });
        await exec(
          t,
          `ALTER TABLE ${q(`dc_${SLUG}`)} ALTER COLUMN ${q("v")} SET DEFAULT 'x@y.co'`
        );
        const { db, conversion } = await judgedThenConversion(t, "confirmed", {
          from: "email",
          to: "text",
        });
        expect(conversion.columns).toMatchObject([{ keepsType: true }]);

        await conversion.run(db);

        const [column] = await (
          t.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ d: string | null }>(
          `SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'dc_${SLUG}' AND column_name = 'v'`
        );
        expect(column?.d).toContain("x@y.co");
        expect((await stored(t)).a).toBe("a@b.co");
      }
    );

    // MySQL lists a table's triggers only to an account holding TRIGGER on it, while an update
    // still fires them: an account that cannot see every trigger of the database is refused before
    // any value is written, as one that sees a trigger is, rather than read as a table with none.
    it.runIf(dialect === "mysql" && rewritesValuesOn(dialect))(
      "refuses a conversion by an account that cannot see the table's triggers, and changes nothing",
      async () => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "a", { v: "12" });
        await exec(
          t,
          `CREATE TRIGGER ${q("tcc_hidden")} AFTER UPDATE ON ${q(`dc_${SLUG}`)} FOR EACH ROW SET @tcc_touched = 1`
        );
        const { conversion } = await judgedThenConversion(t, "confirmed");
        const url = new URL(process.env.DATABASE_URL ?? "");
        const database = url.pathname.replace(/^\//, "");
        await exec(t, `CREATE USER 'tcc_limited'@'%' IDENTIFIED BY 'limited'`);
        try {
          // Every right the conversion uses on the database's tables, and not TRIGGER.
          await exec(
            t,
            `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX ON \`${database}\`.* TO 'tcc_limited'@'%'`
          );
          url.username = "tcc_limited";
          url.password = "limited";
          const limited = createMySqlAdapter({
            url: url.toString(),
          }) as unknown as DrizzleAdapter;
          await limited.connect();
          try {
            await expect(
              conversion.run(limited.getDrizzle())
            ).rejects.toMatchObject(refusedSaying("cannot see whether"));
          } finally {
            await limited.disconnect().catch(() => {});
          }
        } finally {
          await exec(t, `DROP USER 'tcc_limited'@'%'`);
        }

        expect(await stored(t)).toEqual({ a: "12" });
      }
    );

    // A conversion writes the values while the old field's unique index still holds the column,
    // its file dropping it only after: two that read as one are refused, saying why. A collection
    // turning Unique off takes its push, so the judgement is asked as a file that converts asks it.
    it.skipIf(!rewritesValuesOn(dialect))(
      "refuses values that read as one under the old field's Unique index where the change converts them",
      async () => {
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
      }
    );

    // Where no road rewrites values (MySQL, `rewritesValuesOn`), each change above that would rewrite
    // or clear one is judged by the database's cast and refused before anything runs, even with its
    // counts confirmed: the column, its values and what the entries read as they were.
    it.runIf(!rewritesValuesOn(dialect)).each([
      {
        change: "a list of one item into that item",
        from: { type: "chips" },
        to: { type: "text" },
        values: { one: ["a"], none: [] },
        code: "TYPE_CHANGE_BLOCKED",
        why: "Rewriting values",
      },
      {
        change: "a required field's list of one item into a required text",
        from: { type: "chips", required: true },
        to: { type: "text", required: true },
        values: { a: ["x"] },
        code: "TYPE_CHANGE_BLOCKED",
        why: "Rewriting values",
      },
      {
        change: "a text that is a number only once rewritten",
        from: { type: "text" },
        to: { type: "number" },
        values: { a: "012" },
        code: "TYPE_CHANGE_BLOCKED",
        why: "Rewriting values",
      },
      {
        change: "a unique field whose values read as one under the new type",
        from: { type: "text", unique: true },
        to: { type: "number" },
        values: { a: "12", b: "012" },
        code: "TYPE_CHANGE_BLOCKED",
        why: "Rewriting values",
      },
      {
        change: "a text one value of which is no number",
        from: { type: "text" },
        to: { type: "number" },
        values: { kept: "12", lost: "abc" },
        code: "TYPE_CHANGE_LOSES_VALUES",
        why: "Clearing the values",
      },
      {
        change: "the same, with its counts confirmed",
        from: { type: "text" },
        to: { type: "number" },
        values: { kept: "12", lost: "abc" },
        confirmed: { kept: 0, changed: 1, lost: 1 },
        code: "TYPE_CHANGE_LOSES_VALUES",
        why: "Clearing the values",
      },
      {
        change: "the same into a required field, with its counts confirmed",
        from: { type: "text", required: true },
        to: { type: "number", required: true },
        values: { kept: "12", lost: "abc" },
        confirmed: { kept: 0, changed: 1, lost: 1 },
        code: "TYPE_CHANGE_LOSES_VALUES",
        why: "Clearing the values",
      },
      {
        change: "the same with a default of its own, with its counts confirmed",
        from: { type: "text", defaultValue: "5" },
        to: { type: "number", defaultValue: 5 },
        values: { kept: "12", lost: "abc" },
        confirmed: { kept: 0, changed: 1, lost: 1 },
        code: "TYPE_CHANGE_LOSES_VALUES",
        why: "Clearing the values",
      },
    ])("refuses $change where no road rewrites values", async row => {
      const t = await boot([{ name: "v", ...row.from }]);
      for (const [title, v] of Object.entries(row.values)) {
        await write(t, title, { v });
      }

      expect(
        await save(
          t,
          [{ name: "v", ...row.to }],
          "confirmed" in row
            ? { confirmedTypeChanges: [{ field: "v", ...row.confirmed }] }
            : {}
        )
      ).toMatchObject(refusedAs(row.code, row.why));

      expect(await read(t, "v")).toEqual(row.values);
    });

    it.runIf(!rewritesValuesOn(dialect)).each([
      {
        change: "a text into a checkbox over a value read only once rewritten",
        to: "checkbox",
        en: "false",
        es: "TRUE",
        code: "TYPE_CHANGE_BLOCKED",
        why: "rewritten into its form",
      },
      {
        change: "a text into a number over a value one language alone loses",
        to: "number",
        en: "12",
        es: "abc",
        code: "TYPE_CHANGE_LOSES_VALUES",
        why: "Clearing the values",
      },
    ])(
      "refuses a translated field's change of $change where no road rewrites values",
      async row => {
        const t = await boot([{ name: "v", type: "text", localized: true }], {
          localized: true,
        });
        const id = await write(t, "a", { v: row.en }, "en");
        await t.nextly.update({
          collection: SLUG,
          id,
          data: { v: row.es, _overwrite: true },
          locale: "es",
        } as never);

        expect(
          await save(t, [{ name: "v", type: row.to, localized: true }], {
            localized: true,
          })
        ).toMatchObject(refusedAs(row.code, row.why));

        expect(await read(t, "v", "en")).toEqual({ a: row.en });
        expect(await read(t, "v", "es")).toEqual({ a: row.es });
      }
    );

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

    // The review opened over one value to change and one to lose; the rule changes another written
    // after it, or loses it. Nothing converts, and the refusal carries the counts now, which a
    // second confirmation then converts.
    it.skipIf(!rewritesValuesOn(dialect)).each([
      ["a value the rule changes", "34", { kept: 0, changed: 2, lost: 1 }, 34],
      ["a value the rule loses", "xyz", { kept: 0, changed: 1, lost: 2 }, null],
    ])(
      "refuses counts confirmed before %s was written, changes nothing, and converts once the new ones are confirmed",
      async (_, late, now, reads) => {
        const t = await boot([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "12" });
        await write(t, "lost", { v: "abc" });
        const reviewed = [{ field: "v", kept: 0, changed: 1, lost: 1 }];
        await write(t, "late", { v: late });

        expect(
          await save(t, [{ name: "v", type: "number" }], {
            confirmedTypeChanges: reviewed,
          })
        ).toMatchObject({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                path: "fields.v",
                code: "TYPE_CHANGE_COUNTS_CHANGED",
              }),
            ],
            reviewAgain: true,
            counts: { typeChanges: [{ field: "v", ...now }] },
          },
        });
        expect(await read(t, "v")).toEqual({ kept: "12", lost: "abc", late });

        expect(
          await save(t, [{ name: "v", type: "number" }], {
            confirmedTypeChanges: [{ field: "v", ...now }],
          })
        ).toBeUndefined();
        expect(await read(t, "v")).toEqual({
          kept: 12,
          lost: null,
          late: reads,
        });
      }
    );

    // A confirmation names every field whose type changes: one left out was never reviewed.
    it("refuses a confirmation that leaves out a field changing type, and changes nothing", async () => {
      const t = await boot([
        { name: "v", type: "text" },
        { name: "w", type: "text" },
      ]);
      await write(t, "a", { v: "12", w: "34" });

      expect(
        await save(
          t,
          [
            { name: "v", type: "number" },
            { name: "w", type: "number" },
          ],
          {
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 0 },
            ],
          }
        )
      ).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.w",
              code: "TYPE_CHANGE_COUNTS_CHANGED",
            }),
          ],
          reviewAgain: true,
        },
      });
      expect(await read(t, "v")).toEqual({ a: "12" });
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

    // Where no road rewrites values (MySQL), a Single's change that would rewrite one is refused as a
    // collection's is, saying the same of why.
    it.runIf(!rewritesValuesOn(dialect))(
      "refuses a Single's list becoming a text, saying it can't be deployed yet",
      async () => {
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

        expect(refused).toMatchObject(refusedWith("Rewriting values"));
        const read = (await t.nextly.findSingle({
          slug: "tcc_hero",
        } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
        expect(read?.item?.v ?? read?.v).toEqual(["a"]);
      }
    );

    // A Single answers a pair as a collection does: its own check before the save asks the same
    // judgement, and its row is converted the same way.
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a Single's list of one item into that item",
      async () => {
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
      }
    );

    // The Single's save takes the person's confirmed clears as a collection's does.
    it.skipIf(!rewritesValuesOn(dialect))(
      "clears a Single's value that cannot convert once the clear is confirmed with its count",
      async () => {
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
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 0, lost: 1 },
            ],
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
      }
    );

    it.runIf(!rewritesValuesOn(dialect))(
      "refuses to clear a Single's value that cannot convert, even confirmed with its count, where no road rewrites values",
      async () => {
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
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 0, lost: 1 },
            ],
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toMatchObject(refusedWith("Clearing the values"));
        const read = (await t.nextly.findSingle({
          slug: "tcc_hero",
        } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
        expect(read?.item?.v ?? read?.v).toBe("abc");
      }
    );
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group changes a field's type only where its migration deploys it alike (%s)",
  dialect => {
    // Where no road rewrites values (MySQL), a field group's change that would rewrite one is refused
    // as a collection's is, saying the same of why.
    it.runIf(!rewritesValuesOn(dialect))(
      "refuses a field group's list becoming a text, saying it can't be deployed yet",
      async () => {
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
        // As the app reads it before the save: the refusal leaves it as it was.
        const before = await boxValue();

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

        expect(refused).toMatchObject(refusedWith("Rewriting values"));

        expect(await boxValue()).toEqual(before);
      }
    );

    // A field group answers a pair as a collection does, its values kept on the rows the entries
    // that embed it write, each converted the same way.
    it.skipIf(!rewritesValuesOn(dialect))(
      "converts a field group's list of one item into that item",
      async () => {
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
      }
    );

    // A field group's save takes the person's confirmed clears as a collection's does.
    it.skipIf(!rewritesValuesOn(dialect))(
      "clears a field group's value that cannot convert once the clear is confirmed with its count",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        const t = await createTestNextly({ dialect });
        instance = t;
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "tcc_box",
            label: "Box",
            fields: [{ name: "v", type: "text" }],
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
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
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
      }
    );

    it.runIf(!rewritesValuesOn(dialect))(
      "refuses to clear a field group's value that cannot convert, even confirmed with its count, where no road rewrites values",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        const t = await createTestNextly({ dialect });
        instance = t;
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "tcc_box",
            label: "Box",
            fields: [{ name: "v", type: "text" }],
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
            confirmedTypeChanges: [
              { field: "v", kept: 0, changed: 1, lost: 1 },
            ],
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toMatchObject(refusedWith("Clearing the values"));
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
        ).toEqual({ kept: "12", lost: "abc" });
      }
    );
  }
);
