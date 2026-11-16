/**
 * Hooks are told the language a write or a read is for, every language it
 * involves, and whether it moves the shared part (the fields kept the same in
 * every language), so a hook acting on translated content knows whose it is.
 *
 * Every hook a collection or a Single declares records what its context says;
 * each case asserts what each phase was told.
 *
 * @module hooks/__tests__/hooks-know-the-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

const POSTS = "hkl_posts";
const SITE = "hkl_site";

/** What one hook was told. */
interface Told {
  hook: string;
  locale: unknown;
  locales: unknown;
  shared: unknown;
}

const told: Told[] = [];

/** Records what a hook's context says, under the hook's name. */
const record =
  (hook: string) =>
  (context: { locale?: unknown; locales?: unknown; shared?: unknown }) => {
    told.push({
      hook,
      locale: context.locale,
      locales: context.locales,
      shared: context.shared,
    });
  };

/** The same hook in every phase a collection or a Single declares. */
const everyHook = (scope: string) => ({
  beforeOperation: [record(`${scope}:beforeOperation`)],
  beforeValidate: [record(`${scope}:beforeValidate`)],
  beforeChange: [record(`${scope}:beforeChange`)],
  afterChange: [record(`${scope}:afterChange`)],
  beforeRead: [record(`${scope}:beforeRead`)],
  afterRead: [record(`${scope}:afterRead`)],
  beforeDelete: [record(`${scope}:beforeDelete`)],
  afterDelete: [record(`${scope}:afterDelete`)],
});

/** A field hook in `phase`, recorded as `<scope>:field:<phase>`. */
const fieldHook = (scope: string, phase: "beforeChange" | "afterRead") => ({
  [phase]: [
    (args: {
      value: unknown;
      locale?: unknown;
      locales?: unknown;
      shared?: unknown;
    }) => {
      record(`${scope}:field:${phase}`)(args);
      return args.value;
    },
  ],
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  told.length = 0;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        hooks: everyHook("posts"),
        fields: [
          text({
            name: "title",
            hooks: {
              ...fieldHook("posts", "beforeChange"),
              ...fieldHook("posts", "afterRead"),
            },
          }),
          // Shared: one value for every language.
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        hooks: everyHook("site"),
        fields: [
          text({ name: "title" }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

/** What the hooks named with `prefix` were told, by hook. */
const toldBy = (prefix: string) =>
  told.filter(entry => entry.hook.startsWith(prefix));

/** A document published in English, its Spanish published too; the record is cleared. */
async function publishedInBoth(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: POSTS,
    locale: "en",
    data: { title: "Harbour", code: "a", status: "published" },
  });
  const id = String(created.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "es",
    data: { title: "Puerto", status: "published", _overwrite: true },
  });
  told.length = 0;
  return id;
}

const WRITE_HOOKS = [
  "posts:beforeOperation",
  "posts:beforeValidate",
  "posts:beforeChange",
  "posts:afterChange",
];

describe.each(getConfiguredTestDialects())(
  "hooks know the language (integration, %s)",
  dialect => {
    it("tells an update's hooks its language, and that it leaves the shared part", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { title: "Puerto 2", _overwrite: true },
      });
      const hooks = toldBy("posts:");
      // Every write hook ran, so what they were told is what is asserted.
      expect(hooks.map(entry => entry.hook)).toEqual(
        expect.arrayContaining([...WRITE_HOOKS, "posts:field:beforeChange"])
      );
      for (const entry of hooks.filter(e => !e.hook.includes("Read"))) {
        expect(entry, entry.hook).toMatchObject({
          locale: "es",
          locales: ["es"],
          shared: false,
        });
      }
    }, 90_000);

    it("tells an update's hooks it moves the shared part when it sets a shared field", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { code: "b", _overwrite: true },
      });
      const writes = toldBy("posts:").filter(e => WRITE_HOOKS.includes(e.hook));
      expect(writes.length).toBe(WRITE_HOOKS.length);
      for (const entry of writes) {
        expect(entry, entry.hook).toMatchObject({ locale: "es", shared: true });
      }
    }, 90_000);

    it("tells a create's hooks its language and the shared part", async () => {
      const t = await boot(dialect);
      await t.nextly.create({
        collection: POSTS,
        locale: "en",
        data: { title: "Harbour", code: "a" },
      });
      const writes = toldBy("posts:").filter(e => WRITE_HOOKS.includes(e.hook));
      expect(writes.length).toBe(WRITE_HOOKS.length);
      for (const entry of writes) {
        expect(entry, entry.hook).toMatchObject({
          locale: "en",
          locales: ["en"],
          shared: true,
        });
      }
    }, 90_000);

    it("tells a read's hooks the language read, and nothing of the shared part", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await t.nextly.findByID({ collection: POSTS, id, locale: "es" });
      const reads = toldBy("posts:").filter(e => e.hook.includes("Read"));
      expect(reads.map(entry => entry.hook)).toEqual(
        expect.arrayContaining([
          "posts:beforeRead",
          "posts:afterRead",
          "posts:field:afterRead",
        ])
      );
      for (const entry of reads) {
        expect(entry, entry.hook).toMatchObject({ locale: "es" });
        expect(entry.locales, entry.hook).toEqual(
          expect.arrayContaining(["es"])
        );
        expect(entry.shared, entry.hook).toBeUndefined();
      }
    }, 90_000);

    it("tells a delete's hooks every language and the shared part", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await t.nextly.delete({ collection: POSTS, id });
      const deletes = toldBy("posts:").filter(e => e.hook.includes("Delete"));
      expect(deletes.map(entry => entry.hook).sort()).toEqual([
        "posts:afterDelete",
        "posts:beforeDelete",
      ]);
      for (const entry of deletes) {
        expect(entry.locale, entry.hook).toBeUndefined();
        expect(entry, entry.hook).toMatchObject({
          locales: ["en", "es"],
          shared: true,
        });
      }
    }, 90_000);

    it("tells a publish of every language's before-hooks every language and the shared part", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: POSTS,
        locale: "en",
        data: { title: "Harbour", code: "a" },
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { title: "Puerto", _overwrite: true },
      });
      told.length = 0;
      const entries = t.getService("collectionsHandler") as unknown as {
        getEntryService(): {
          publishAllLocales(args: Record<string, unknown>): Promise<{
            success: boolean;
          }>;
        };
      };
      const published = await entries.getEntryService().publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      const before = toldBy("posts:").filter(e =>
        ["posts:beforeOperation", "posts:beforeChange"].includes(e.hook)
      );
      expect(before.length).toBeGreaterThan(0);
      for (const entry of before) {
        expect(entry.locale, entry.hook).toBeUndefined();
        expect(entry, entry.hook).toMatchObject({
          locales: ["en", "es"],
          shared: true,
        });
      }
    }, 90_000);

    it("tells a Single's update hooks its language and whether it moves the shared part", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const saved = await singles.update(
        SITE,
        { title: "Sitio", _overwrite: true },
        { locale: "es", overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const writes = toldBy("site:").filter(
        e => e.hook === "site:beforeChange" || e.hook === "site:afterChange"
      );
      expect(writes.length).toBe(2);
      for (const entry of writes) {
        expect(entry, entry.hook).toMatchObject({
          locale: "es",
          locales: ["es"],
          shared: false,
        });
      }
    }, 90_000);
  }
);
