/**
 * A Schema Builder save that changes a field's type, on SQLite, PostgreSQL and MySQL, goes ahead
 * only where the migration that deploys it to every other database reaches the same values: where
 * the database's cast reads each stored value as its rule does. Anything else is refused, saying
 * it can't be deployed yet, and changes nothing: a value the cast would not rewrite (a list's one
 * item), one it would not clear (a text that is no number), and any change of a translated field,
 * kept in a translations table whose column a type change does not convert. Values are read back through the
 * Direct API, as the app reads them.
 *
 * What separates the right answer from plausible wrong ones:
 * - a save that judges the entity's own table alone lets a translated change through, leaving
 *   each language's value in the old type;
 * - one that refuses a translated change only where a value is held lets one through that leaves
 *   the column, and every value written after, in the old type;
 * - a refusal without its reason gives the person no way to tell a value to fix from a change
 *   that can't be deployed yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

const SLUG = "tcc_posts";

let instance: TestNextly | undefined;

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
      const t = await createTestNextly({
        dialect,
        ...(options.localized === true
          ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
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

    // A list's one item is its reading as a text, but a list is stored as JSON, which the
    // database's cast in the deploying migration would keep as it is: the change can't be deployed.
    it("refuses a list becoming a text, saying it can't be deployed yet, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "chips" }]);
      await write(t, "one", { v: ["a"] });
      await write(t, "none", { v: [] });

      expect(await save(t, [{ name: "v", type: "text" }])).toMatchObject(
        refusedAs("TYPE_CHANGE_BLOCKED", "Rewriting values")
      );

      expect(await read(t, "v")).toEqual({ one: ["a"], none: [] });
    });

    // Every language's value is kept in the translations table, which no type change's migration
    // converts: refused, rather than leaving each language's value in the old type.
    it("refuses a translated field holding a value, saying it can't be deployed yet, and changes nothing", async () => {
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
      ).toMatchObject(refusedAs("TYPE_CHANGE_BLOCKED", "kept per language"));

      expect(await read(t, "v", "en")).toEqual({ a: "12" });
      expect(await read(t, "v", "es")).toEqual({ a: "34" });
    });

    // Holding no value is no exception: the translations table's column would keep the old type,
    // so a value written after the change would be stored, and read, as the old type.
    it("refuses a translated field holding no value too, and changes nothing", async () => {
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
      ).toMatchObject(refusedAs("TYPE_CHANGE_BLOCKED", "kept per language"));

      await write(t, "c", { v: "7" }, "en");
      expect(await read(t, "v", "en")).toEqual({ a: null, b: null, c: "7" });
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

    // The file the save writes deploys to every database, so a translations column that keeps its
    // type here but not on another (a checkbox's integer on SQLite, boolean or tinyint elsewhere)
    // is refused on every one, SQLite included.
    it("refuses a translated checkbox becoming a number on every database, as its column changes on some", async () => {
      const t = await boot(
        [
          { name: "v", type: "checkbox", localized: true },
          { name: "w", type: "text", localized: true },
        ],
        { localized: true }
      );
      await write(t, "a", { w: "x" }, "en");

      expect(
        await save(
          t,
          [
            { name: "v", type: "number", localized: true },
            { name: "w", type: "text", localized: true },
          ],
          { localized: true }
        )
      ).toMatchObject(refusedAs("TYPE_CHANGE_BLOCKED", "kept per language"));
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

    // A translated change is blocked whatever its values, so a value that cannot convert is named
    // beside that reason, rather than sending the person to clear it first.
    it("refuses a translated change with a value that cannot convert, naming both reasons, as blocked", async () => {
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

      expect(refused).toMatchObject(
        refusedAs("TYPE_CHANGE_BLOCKED", "kept per language")
      );
      expect(refused).toMatchObject(
        refusedAs("TYPE_CHANGE_BLOCKED", "Clearing the values")
      );
      expect(await read(t, "v", "es")).toEqual({ a: "abc" });
    });

    // A family no rule reaches yet keeps today's answer exactly: a date read as text is a form the
    // database's cast does not write, so the change is refused and nothing changes.
    it("still refuses a date becoming a text, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "date" }]);
      await write(t, "a", { v: "2024-01-02T03:04:05.000Z" });
      const before = await read(t, "v");

      expect(await save(t, [{ name: "v", type: "text" }])).toMatchObject({
        code: "VALIDATION_ERROR",
      });

      expect(await read(t, "v")).toEqual(before);
    });

    // The deploying migration's cast would fail on, or keep, a value that cannot convert, so no
    // save clears one yet: the change is refused, saying so.
    it("refuses a change that would lose a value, saying clearing it can't be deployed yet, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(await save(t, [{ name: "v", type: "number" }])).toMatchObject(
        refusedAs("TYPE_CHANGE_LOSES_VALUES", "Clearing the values")
      );

      expect(await read(t, "v")).toEqual({ kept: "12", lost: "abc" });
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

    // A Single answers a pair as a collection does: its own check before the save asks the same
    // judgement, and says the same of why.
    it("refuses a Single's list becoming a text, saying it can't be deployed yet", async () => {
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
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group changes a field's type only where its migration deploys it alike (%s)",
  dialect => {
    // A field group answers a pair as a collection does, its values kept on the rows the entries
    // that embed it write, and says the same of why.
    it("refuses a field group's list becoming a text, saying it can't be deployed yet", async () => {
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
    });
  }
);
