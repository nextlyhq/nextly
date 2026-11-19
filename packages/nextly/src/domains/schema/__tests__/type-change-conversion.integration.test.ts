/**
 * A Schema Builder save that changes a field's type converts every stored value by its rule, on
 * SQLite, PostgreSQL and MySQL, on the live tables: the entity's own and, for a translated field,
 * every language's row of its translations table. A change that would lose a value goes ahead only
 * where the save names the field and the count of values it clears (`confirmedClears`), and then
 * clears only the values that cannot convert. Values are read back through the Direct API, as the
 * app reads them.
 *
 * What separates the right conversion from plausible wrong ones:
 * - a save that casts in the database instead of converting by the rule keeps a list's JSON text
 *   in a text field on SQLite, where the column type does not change;
 * - one that converts the main table alone leaves a translated field's other languages unconverted;
 * - one that clears every value of a consented field, rather than those that cannot convert, loses
 *   the `12` beside the `abc`;
 * - one that compares no count clears a value written after the review.
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
const TABLE = `dc_${SLUG}`;

let instance: TestNextly | undefined;

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "a Builder save converts each stored value by its rule (%s)",
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

    // On SQLite a list and a text are both stored as text, so no column changes there: the values
    // are converted all the same, or a list's JSON stays in the text field.
    it("converts a list of one item into that item, and an empty list into no value", async () => {
      const t = await boot([{ name: "v", type: "chips" }]);
      await write(t, "one", { v: ["a"] });
      await write(t, "none", { v: [] });

      expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

      expect(await read(t, "v")).toEqual({ one: "a", none: null });
    });

    it("converts every language's value of a translated field", async () => {
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

    // A translated field's change is judged over every language's value whichever road the save
    // takes (its migration file, or the push), so a value lost in one language needs its clear
    // confirmed with its count, and a count that changed is refused there too.
    it("refuses a translated change that loses a value in one language until the clear is confirmed with its count", async () => {
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
      const to = [{ name: "v", type: "number", localized: true }];

      expect(await save(t, to, { localized: true })).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(
        await save(t, to, {
          localized: true,
          confirmedClears: [{ field: "v", count: 2 }],
        })
      ).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "TYPE_CHANGE_CLEAR_COUNT_CHANGED",
            }),
          ],
        },
      });
      expect(await read(t, "v", "es")).toEqual({ a: "abc" });

      expect(
        await save(t, to, {
          localized: true,
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toBeUndefined();
      expect(await read(t, "v", "en")).toEqual({ a: 12 });
      // Read as stored: a language with no value reads the default language's, so the cleared
      // Spanish value is asked of its own row.
      const [spanish] = await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ v: unknown }>(
        `SELECT ${q("v")} AS v FROM ${q(`${TABLE}_locales`)} WHERE ${q("_locale")} = 'es'`
      );
      expect(spanish?.v ?? null).toBeNull();
    });

    // A family this conversion does not write yet keeps today's answer exactly: a date read as text
    // is a form no save writes, so the change is refused and nothing changes, never half converted.
    it("still refuses a date becoming a text, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "date" }]);
      await write(t, "a", { v: "2024-01-02T03:04:05.000Z" });
      const before = await read(t, "v");

      expect(await save(t, [{ name: "v", type: "text" }])).toMatchObject({
        code: "VALIDATION_ERROR",
      });

      expect(await read(t, "v")).toEqual(before);
    });

    // Only a save that applies its change here writes the values; outside development the change
    // is the deploy's `nextly migrate`, the database's cast, so a list becoming a text is refused
    // as before rather than written half way.
    it("still refuses a list becoming a text outside development, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "chips" }]);
      await write(t, "one", { v: ["a"] });
      // Any environment but development: the writer writes the files and applies nothing.
      vi.stubEnv("NODE_ENV", "test");

      expect(await save(t, [{ name: "v", type: "text" }])).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              code: "TYPE_CHANGE_BLOCKED",
            }),
          ],
        },
      });

      vi.stubEnv("NODE_ENV", "development");
      expect(await read(t, "v")).toEqual({ one: ["a"] });
    });

    it("refuses a change that would lose a value when no clear is confirmed, and changes nothing", async () => {
      const t = await boot([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(await save(t, [{ name: "v", type: "number" }])).toMatchObject({
        code: "VALIDATION_ERROR",
      });

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
  "a Builder save of a Single converts its stored value by its rule (%s)",
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
    // judgement the save's conversion writes by.
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

      await dispatchSingles(
        "updateSingleSchema",
        { slug: "tcc_hero" },
        { fields: [{ name: "v", type: "text" }] }
      );

      const read = (await t.nextly.findSingle({
        slug: "tcc_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
      expect(read?.item?.v ?? read?.v).toBe("a");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group converts its stored values by their rule (%s)",
  dialect => {
    // A field group answers a pair as a collection does, its values kept on the rows the entries
    // that embed it write.
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

      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent("tcc_box")) as { schemaVersion?: number };
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "tcc_box" },
        {
          fields: [{ name: "v", type: "text" }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
        }
      );

      const read = (await t.nextly.findByID({
        collection: SLUG,
        id,
      } as never)) as {
        box?: { v?: unknown };
        item?: { box?: { v?: unknown } };
      };
      expect((read.item ?? read).box?.v).toBe("a");
    });
  }
);
