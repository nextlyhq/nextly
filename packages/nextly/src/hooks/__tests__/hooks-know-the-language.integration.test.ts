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
/** Held changes: a save to a published entry waits as a pending change. */
const DRAFTED = "hkl_drafted";
/** A Single whose saves to a published document wait as pending changes. */
const DRAFTED_SITE = "hkl_drafted_site";

/** What one hook was told. */
interface Told {
  hook: string;
  locale: unknown;
  locales: unknown;
  shared: unknown;
  /** The translated values the hook's documents held, after and before. */
  data?: { title?: unknown; body?: unknown };
  originalData?: { title?: unknown; body?: unknown };
}

/** A document's translated values, as a hook was handed them. */
const translatedOf = (doc: unknown) =>
  doc !== null && typeof doc === "object"
    ? {
        title: (doc as Record<string, unknown>).title,
        body: (doc as Record<string, unknown>).body,
      }
    : undefined;

const told: Told[] = [];

/** The language each user `validate` was told, in the order they ran. */
const validatedIn: unknown[] = [];
const recordValidate = (
  _value: unknown,
  { req }: { req: { locale?: unknown } }
): true => {
  validatedIn.push(req.locale);
  return true;
};

/** Records what a hook's context says, under the hook's name. */
const record =
  (hook: string) =>
  (context: {
    locale?: unknown;
    locales?: unknown;
    shared?: unknown;
    data?: unknown;
    originalData?: unknown;
  }) => {
    told.push({
      hook,
      locale: context.locale,
      locales: context.locales,
      shared: context.shared,
      data: translatedOf(context.data),
      originalData: translatedOf(context.originalData),
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
          // Translated too, and left alone by the updates below.
          text({ name: "body", validate: recordValidate as never }),
          // Shared: one value for every language.
          text({ name: "code", localized: false }),
        ],
      }),
      defineCollection({
        slug: DRAFTED,
        localized: true,
        status: true,
        versions: { drafts: true },
        hooks: everyHook("drafted"),
        fields: [text({ name: "title" })],
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
          text({ name: "body", validate: recordValidate as never }),
          text({ name: "code", localized: false }),
        ],
      }),
      defineSingle({
        slug: DRAFTED_SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        hooks: everyHook("drafted-site"),
        fields: [text({ name: "title" })],
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
    data: {
      title: "Harbour",
      body: "English body",
      code: "a",
      status: "published",
    },
  });
  const id = String(created.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "es",
    data: {
      title: "Puerto",
      body: "Cuerpo",
      status: "published",
      _overwrite: true,
    },
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

/** The collection entry service's writes in a caller's transaction, and its batch update. */
interface EntryWrites {
  createEntryInTransaction(
    tx: unknown,
    params: Record<string, unknown>,
    body: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown }>;
  updateEntryInTransaction(
    tx: unknown,
    params: Record<string, unknown>,
    body: Record<string, unknown>
  ): Promise<{ success: boolean }>;
  deleteEntryInTransaction(
    tx: unknown,
    params: Record<string, unknown>
  ): Promise<{ success: boolean }>;
  updateEntries(
    params: Record<string, unknown>,
    entries: { id: string; data: Record<string, unknown> }[]
  ): Promise<{ successful: number }>;
}

const entryService = (t: TestNextly): EntryWrites =>
  (
    t.getService("collectionsHandler") as unknown as {
      getEntryService(): EntryWrites;
    }
  ).getEntryService();

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

    // A hook handed a document sees it in the language written: the values
    // of that language, the ones this write leaves alone included, before
    // and after it.
    it("hands an update's hooks the document in its language, before and after", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { title: "Puerto 2", _overwrite: true },
      });
      const before = toldBy("posts:beforeChange")[0];
      const after = toldBy("posts:afterChange")[0];
      expect(before?.originalData).toEqual({ title: "Puerto", body: "Cuerpo" });
      expect(after?.data).toEqual({ title: "Puerto 2", body: "Cuerpo" });
      expect(after?.originalData).toEqual({ title: "Puerto", body: "Cuerpo" });
    }, 90_000);

    it("hands a Single's update hooks the document in its language, before and after", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      for (const [locale, data] of [
        ["en", { title: "Site", body: "English body" }],
        ["es", { title: "Sitio", body: "Cuerpo" }],
      ] as const) {
        const saved = await singles.update(
          SITE,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      told.length = 0;
      await singles.update(
        SITE,
        { title: "Sitio 2", _overwrite: true },
        { locale: "es", overrideAccess: true }
      );
      const before = toldBy("site:beforeChange")[0];
      const after = toldBy("site:afterChange")[0];
      expect(before?.originalData).toEqual({ title: "Sitio", body: "Cuerpo" });
      expect(after?.data).toEqual({ title: "Sitio 2", body: "Cuerpo" });
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

    // A publish of every language that puts each language's pending change
    // live runs the after-hooks once for each, as a publish of that language
    // alone runs them, and each run is told its own language.
    it("tells each after-hook run of a publish of every language its own language", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: DRAFTED,
        locale: "en",
        data: { title: "Harbour", status: "published" },
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: DRAFTED,
        id,
        locale: "es",
        data: { title: "Puerto", status: "published", _overwrite: true },
      });
      // Each held as a pending change of its language.
      for (const [locale, title] of [
        ["en", "Harbour again"],
        ["es", "Puerto otra vez"],
      ] as const) {
        await t.nextly.update({
          collection: DRAFTED,
          id,
          locale,
          data: { title, _overwrite: true },
        });
      }
      told.length = 0;
      const entries = t.getService("collectionsHandler") as unknown as {
        getEntryService(): {
          publishAllLocales(args: Record<string, unknown>): Promise<{
            success: boolean;
          }>;
        };
      };
      const published = await entries.getEntryService().publishAllLocales({
        collectionName: DRAFTED,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      const after = toldBy("drafted:afterChange");
      expect(after.map(e => e.locale).sort()).toEqual(["en", "es"]);
      for (const entry of after) {
        expect(entry.locales, String(entry.locale)).toEqual([entry.locale]);
      }
    }, 90_000);

    it("tells each after-hook run of a Single's publish of every language its own language", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
        publishAllLocales(
          slug: string,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      // Live in both languages, then a change held in each.
      for (const [locale, data] of [
        ["en", { title: "Site", status: "published" }],
        ["es", { title: "Sitio", status: "published" }],
        ["en", { title: "Site again" }],
        ["es", { title: "Sitio otra vez" }],
      ] as const) {
        const saved = await singles.update(
          DRAFTED_SITE,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      told.length = 0;
      const published = await singles.publishAllLocales(DRAFTED_SITE, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      const after = toldBy("drafted-site:afterChange");
      expect(after.map(e => e.locale).sort()).toEqual(["en", "es"]);
      for (const entry of after) {
        expect(entry.locales, String(entry.locale)).toEqual([entry.locale]);
      }
    }, 90_000);

    // A field's own `validate` is told the language the write is judged in,
    // as a plugin type's validator is: none for the default language.
    it("tells a field's validate the language written", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      validatedIn.length = 0;
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { body: "Cuerpo", _overwrite: true },
      });
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "en",
        data: { body: "Body", _overwrite: true },
      });
      expect(validatedIn).toEqual(["es", undefined]);

      validatedIn.length = 0;
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const saved = await singles.update(
        SITE,
        { body: "Cuerpo", _overwrite: true },
        { locale: "es", overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(validatedIn).toEqual(["es"]);
    }, 90_000);

    // A Single's publish of every language runs the user hooks a
    // collection's does, told what a collection's are: its before-hooks
    // once, told every language and the shared part, and so its after-hooks.
    it("runs a Single's hooks for a publish of every language, as a collection's", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
        publishAllLocales(
          slug: string,
          options: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      for (const [locale, data] of [
        ["en", { title: "Site", code: "a" }],
        ["es", { title: "Sitio" }],
      ] as const) {
        const saved = await singles.update(
          SITE,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }
      told.length = 0;
      const published = await singles.publishAllLocales(SITE, {
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);

      // A Single declares `beforeValidate` and `beforeChange` before a write
      // (it has no `beforeOperation` of its own).
      const before = toldBy("site:").filter(e =>
        ["site:beforeValidate", "site:beforeChange"].includes(e.hook)
      );
      expect(
        before.map(e => e.hook),
        "the before-hooks run once"
      ).toEqual(["site:beforeValidate", "site:beforeChange"]);
      for (const entry of before) {
        expect(entry.locale, entry.hook).toBeUndefined();
        expect(entry, entry.hook).toMatchObject({
          locales: ["en", "es"],
          shared: true,
        });
      }
      // A publish that moves the statuses puts no pending change live, so its
      // after-hooks run once, as a collection's do, told every language.
      const after = toldBy("site:afterChange");
      expect(after).toHaveLength(1);
      expect(after[0].locale).toBeUndefined();
      expect(after[0]).toMatchObject({ locales: ["en", "es"], shared: true });
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

    // An update inside an enclosing transaction holds its after-hooks until
    // that transaction commits, after the update has returned; they are told
    // what the same update outside one tells them, since the adapter runs a
    // held effect in the context that registered it. SQLite only: on
    // PostgreSQL and MySQL the Direct API's update reads the entry and its
    // translations on the pool inside a caller's transaction, which the
    // suites' escape guard refuses whatever a hook is told.
    it.skipIf(dialect !== "sqlite")(
      "tells an update's after-hooks its language when they wait for an enclosing transaction",
      async () => {
        const t = await boot(dialect);
        const id = await publishedInBoth(t);
        await t.adapter.transaction(async () => {
          await t.nextly.update({
            collection: POSTS,
            id,
            locale: "es",
            data: { title: "Puerto 2", _overwrite: true },
          });
          // Held: the update has returned and its after-hooks have not run.
          expect(toldBy("posts:afterChange")).toHaveLength(0);
        });
        const after = toldBy("posts:afterChange");
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
          locale: "es",
          locales: ["es"],
          shared: false,
        });
      },
      90_000
    );

    // A held after-hook is handed the document as its own write left it, its
    // translated values read in that write's transaction: a later update of
    // the same language, committed before the hook runs, is not what it
    // sees. Two updates in one enclosing transaction hold both writes'
    // after-hooks until it commits, after the second; SQLite only, as above.
    it.skipIf(dialect !== "sqlite")(
      "hands an update's held after-hooks the document its own write left",
      async () => {
        const t = await boot(dialect);
        const id = await publishedInBoth(t);
        await t.adapter.transaction(async () => {
          for (const title of ["Puerto 2", "Puerto 3"]) {
            const updated = await t.nextly.update({
              collection: POSTS,
              id,
              locale: "es",
              data: { title, _overwrite: true },
            });
            expect(updated.item).toBeDefined();
          }
        });
        expect(toldBy("posts:afterChange").map(e => e.data)).toEqual([
          { title: "Puerto 2", body: "Cuerpo" },
          { title: "Puerto 3", body: "Cuerpo" },
        ]);
      },
      90_000
    );

    // The same of a Single's update.
    it.skipIf(dialect !== "sqlite")(
      "hands a Single's held after-hooks the document its own write left",
      async () => {
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
          { title: "Sitio", body: "Cuerpo", _overwrite: true },
          { locale: "es", overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        told.length = 0;
        await t.adapter.transaction(async () => {
          for (const title of ["Sitio 2", "Sitio 3"]) {
            const updated = await singles.update(
              SITE,
              { title, _overwrite: true },
              { locale: "es", overrideAccess: true }
            );
            expect(updated.success, JSON.stringify(updated)).toBe(true);
          }
        });
        expect(toldBy("site:afterChange").map(e => e.data)).toEqual([
          { title: "Sitio 2", body: "Cuerpo" },
          { title: "Sitio 3", body: "Cuerpo" },
        ]);
      },
      90_000
    );

    it("tells an update's hooks in a caller's transaction whether it moves the shared part", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      const entries = entryService(t);
      for (const [data, shared] of [
        [{ title: "Harbour 2" }, false],
        [{ code: "b" }, true],
      ] as const) {
        told.length = 0;
        const updated = await t.adapter.transaction(tx =>
          entries.updateEntryInTransaction(
            tx,
            { collectionName: POSTS, entryId: id, overrideAccess: true },
            { ...data, _overwrite: true }
          )
        );
        expect(updated.success, JSON.stringify(updated)).toBe(true);
        const writes = toldBy("posts:").filter(e =>
          WRITE_HOOKS.includes(e.hook)
        );
        expect(writes.map(e => e.hook)).toEqual(WRITE_HOOKS);
        for (const entry of writes) {
          expect(entry, `${entry.hook} ${JSON.stringify(data)}`).toMatchObject({
            locale: "en",
            locales: ["en"],
            shared,
          });
        }
      }
    }, 90_000);

    it("tells a create's and a delete's hooks in a caller's transaction they move the shared part", async () => {
      const t = await boot(dialect);
      const entries = entryService(t);
      const created = await t.adapter.transaction(tx =>
        entries.createEntryInTransaction(
          tx,
          { collectionName: POSTS, overrideAccess: true },
          { title: "Harbour", code: "a" }
        )
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as { id: unknown }).id);
      const deleted = await t.adapter.transaction(tx =>
        entries.deleteEntryInTransaction(tx, {
          collectionName: POSTS,
          entryId: id,
          overrideAccess: true,
        })
      );
      expect(deleted.success, JSON.stringify(deleted)).toBe(true);
      const writes = toldBy("posts:").filter(
        e => WRITE_HOOKS.includes(e.hook) || e.hook.includes("Delete")
      );
      expect(writes.map(e => e.hook)).toEqual(
        expect.arrayContaining([
          ...WRITE_HOOKS,
          "posts:beforeDelete",
          "posts:afterDelete",
        ])
      );
      for (const entry of writes) {
        expect(entry, entry.hook).toMatchObject({ shared: true });
      }
    }, 90_000);

    // A batch update tells each entry's hooks what that entry's own update
    // moves: the first sets a translated field, the second a shared one.
    it("tells a batch update's hooks, entry by entry, whether it moves the shared part", async () => {
      const t = await boot(dialect);
      const first = await publishedInBoth(t);
      const second = String(
        (
          await t.nextly.create({
            collection: POSTS,
            locale: "en",
            data: { title: "Lighthouse", code: "l" },
          })
        ).item.id
      );
      told.length = 0;
      const result = await entryService(t).updateEntries(
        { collectionName: POSTS, overrideAccess: true },
        [
          { id: first, data: { title: "Harbour 2", _overwrite: true } },
          { id: second, data: { code: "m", _overwrite: true } },
        ]
      );
      expect(result.successful, JSON.stringify(result)).toBe(2);
      for (const hook of WRITE_HOOKS) {
        expect(
          toldBy(hook).map(e => e.shared),
          hook
        ).toEqual([false, true]);
      }
    }, 90_000);
  }
);
