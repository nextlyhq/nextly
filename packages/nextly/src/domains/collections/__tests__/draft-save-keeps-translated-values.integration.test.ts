/**
 * A save to a working draft that already exists keeps what it sends, in every
 * language: a translated named group, a translated text field and a field
 * group, set for the first time or edited, through the ordinary update the
 * admin's save and the Direct API's update reach. The locale split moves a
 * translated value out of the main payload, and a save that built on the
 * stored draft from what was left dropped it while reporting success. A type
 * that is not translated, and one without drafts, are held to the same.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "dlpages";

interface Shape {
  translated: boolean;
  drafts: boolean;
}

async function boot(
  dialect: TestDialect,
  shape: Shape
): Promise<CollectionEntryService> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "dlseo",
        ...(shape.translated ? { localized: true } : {}),
        fields: [
          text({
            name: "metaTitle",
            ...(shape.translated ? { localized: true } : {}),
          }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: SLUG,
        ...(shape.translated ? { localized: true } : {}),
        status: true,
        ...(shape.drafts ? { versions: { drafts: true } } : {}),
        fields: [
          text({
            name: "title",
            ...(shape.translated ? { localized: true } : {}),
          }),
          text({
            name: "subtitle",
            ...(shape.translated ? { localized: true } : {}),
          }),
          fieldGroup({ name: "seo", component: "dlseo" }),
          group({
            name: "meta",
            ...(shape.translated ? { localized: true } : {}),
            fields: [text({ name: "seoTitle" })],
          }),
        ],
      }),
    ],
    ...(shape.translated
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
  });
  return (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

type Doc = {
  title?: unknown;
  subtitle?: unknown;
  seo?: { metaTitle?: unknown } | null;
  meta?: { seoTitle?: unknown } | null;
  _isWorkingDraft?: unknown;
};

async function save(
  entries: CollectionEntryService,
  id: string,
  data: Record<string, unknown>,
  locale: string | undefined
): Promise<void> {
  const saved = await entries.updateEntry(
    {
      collectionName: SLUG,
      entryId: id,
      overrideAccess: true,
      ...(locale === undefined ? {} : { locale }),
    },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The document as its editor reads it: the working draft where one waits. */
async function edited(
  entries: CollectionEntryService,
  id: string,
  locale: string | undefined
): Promise<Doc> {
  const read = await entries.getEntry({
    collectionName: SLUG,
    entryId: id,
    overrideAccess: true,
    includeWorkingDraft: true,
    ...(locale === undefined ? {} : { locale, fallbackLocale: false }),
  });
  expect(read.success, JSON.stringify(read)).toBe(true);
  return read.data as Doc;
}

/** The document as it is published. */
async function live(
  entries: CollectionEntryService,
  id: string,
  locale: string | undefined
): Promise<Doc> {
  const read = await entries.getEntry({
    collectionName: SLUG,
    entryId: id,
    overrideAccess: true,
    ...(locale === undefined ? {} : { locale, fallbackLocale: false }),
  });
  expect(read.success, JSON.stringify(read)).toBe(true);
  return read.data as Doc;
}

/** The two group values of a document. */
function groups(doc: Doc): [unknown, unknown] {
  return [doc.seo?.metaTitle ?? null, doc.meta?.seoTitle ?? null];
}

/**
 * A document published in `languages` (each with group values unless
 * `withGroups` is false), then given a working draft in each by a save that
 * sends no group, so every later save goes to an existing draft.
 */
async function publishedWithDrafts(
  entries: CollectionEntryService,
  languages: (string | undefined)[],
  shape: Shape,
  withGroups: boolean
): Promise<string> {
  const [first, ...rest] = languages;
  const values = (tag: string) =>
    withGroups
      ? {
          seo: { metaTitle: `${tag} live` },
          meta: { seoTitle: `${tag} live` },
        }
      : {};
  const created = await entries.createEntry(
    {
      collectionName: SLUG,
      overrideAccess: true,
      ...(first === undefined ? {} : { locale: first }),
    },
    {
      title: `${first ?? "only"} title`,
      status: "published",
      ...values(first ?? "only"),
    }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  for (const locale of rest) {
    await save(
      entries,
      id,
      {
        title: `${locale} title`,
        status: "published",
        ...values(locale ?? "only"),
      },
      locale
    );
  }
  if (shape.drafts) {
    for (const locale of languages) {
      await save(entries, id, { title: `${locale ?? "only"} draft` }, locale);
      expect((await edited(entries, id, locale))._isWorkingDraft).toBe(true);
    }
  }
  return id;
}

const SHAPES: {
  name: string;
  shape: Shape;
  languages: (string | undefined)[];
}[] = [
  {
    name: "a translated type keeping drafts",
    shape: { translated: true, drafts: true },
    languages: ["en", "de"],
  },
  {
    name: "a type keeping drafts that is not translated",
    shape: { translated: false, drafts: true },
    languages: [undefined],
  },
  {
    name: "a translated type without drafts",
    shape: { translated: true, drafts: false },
    languages: ["en", "de"],
  },
];

for (const dialect of getConfiguredTestDialects()) {
  for (const { name, shape, languages } of SHAPES) {
    describe(`a save to a working draft keeps what it sends: ${name} — ${dialect}`, () => {
      it("edits group values already there", async () => {
        const entries = await boot(dialect, shape);
        const id = await publishedWithDrafts(entries, languages, shape, true);

        for (const locale of languages) {
          const tag = locale ?? "only";
          await save(
            entries,
            id,
            {
              subtitle: `${tag} edited`,
              seo: { metaTitle: `${tag} edited` },
              meta: { seoTitle: `${tag} edited` },
            },
            locale
          );
        }

        // Every language at once, so one language's loss doesn't hide another's.
        const read: Record<string, [unknown, unknown]> = {};
        const wanted: Record<string, [unknown, unknown]> = {};
        for (const locale of languages) {
          const tag = locale ?? "only";
          read[tag] = groups(await edited(entries, id, locale));
          wanted[tag] = [`${tag} edited`, `${tag} edited`];
        }
        expect(read).toEqual(wanted);

        for (const locale of languages) {
          const tag = locale ?? "only";
          const doc = await edited(entries, id, locale);
          // A translatable text field the same save sent is kept beside them.
          expect(doc.subtitle).toBe(`${tag} edited`);
          if (shape.drafts) {
            // The draft's earlier edit is still there, and nothing went live.
            expect(doc.title).toBe(`${tag} draft`);
            expect(groups(await live(entries, id, locale))).toEqual([
              `${tag} live`,
              `${tag} live`,
            ]);
          }
        }
      });

      it("sets group values for the first time", async () => {
        const entries = await boot(dialect, shape);
        const id = await publishedWithDrafts(entries, languages, shape, false);

        for (const locale of languages) {
          const tag = locale ?? "only";
          await save(
            entries,
            id,
            {
              seo: { metaTitle: `${tag} new` },
              meta: { seoTitle: `${tag} new` },
            },
            locale
          );
        }

        // Every language at once, so one language's loss doesn't hide another's.
        const read: Record<string, [unknown, unknown]> = {};
        const wanted: Record<string, [unknown, unknown]> = {};
        for (const locale of languages) {
          const tag = locale ?? "only";
          read[tag] = groups(await edited(entries, id, locale));
          wanted[tag] = [`${tag} new`, `${tag} new`];
        }
        expect(read).toEqual(wanted);

        for (const locale of languages) {
          const tag = locale ?? "only";
          const doc = await edited(entries, id, locale);
          if (shape.drafts) {
            expect(doc.title).toBe(`${tag} draft`);
            expect(groups(await live(entries, id, locale))).toEqual([
              null,
              null,
            ]);
          }
        }
      });

      it("publishes the values the draft kept", async () => {
        const entries = await boot(dialect, shape);
        const id = await publishedWithDrafts(entries, languages, shape, true);

        for (const locale of languages) {
          const tag = locale ?? "only";
          await save(
            entries,
            id,
            {
              seo: { metaTitle: `${tag} edited` },
              meta: { seoTitle: `${tag} edited` },
            },
            locale
          );
          // Naming the state publishes what the draft holds.
          await save(entries, id, { status: "published" }, locale);
        }

        const read: Record<string, [unknown, unknown]> = {};
        const wanted: Record<string, [unknown, unknown]> = {};
        for (const locale of languages) {
          const tag = locale ?? "only";
          read[tag] = groups(await live(entries, id, locale));
          wanted[tag] = [`${tag} edited`, `${tag} edited`];
        }
        expect(read).toEqual(wanted);
      });
    });
  }
}
