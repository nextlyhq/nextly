/**
 * A publish or unpublish of every language at once, whose rule answers a
 * filter, changes an entry only if the filter matches it in each language the
 * write is judged in.
 *
 * A publish of every language asks its rule once for each language it puts
 * live, each time told that language, so the entry is matched against the
 * filter answered in each, in that language. An unpublish of every language
 * asks once, in all of them, and matches in the default language. An entry
 * outside a filter is refused and left as it was.
 *
 * @module domains/collections/__tests__/write-rule-filter-limits-every-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { AccessControlContext } from "../../../shared/types/access";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const POSTS = "allfilter_posts";
// The publish rule refuses every entry in German, and lets its owner publish
// in English.
const GERMAN_REFUSED = "allfilter_german_refused";
// The publish rule matches each language's own title: "english" in English,
// "deutsch" in German.
const BY_TITLE = "allfilter_by_title";

const AUTHOR = "allfilter-author";
const OTHER = "allfilter-other";

/** "Only the caller's own": a filter over the entry's `owner`. */
const ownEntries = ({ user }: { user: { id: string } | null }) =>
  ({ owner: { equals: user?.id ?? "" } }) as unknown as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
});

async function boot(): Promise<TestNextly> {
  const fields = [
    text({ name: "title" }),
    text({ name: "owner", localized: false }),
  ];
  current = await createTestNextly({
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        localized: true,
        access: {
          read: () => true,
          update: ownEntries,
          publish: ownEntries,
          unpublish: ownEntries,
        },
        fields,
      }),
      defineCollection({
        slug: GERMAN_REFUSED,
        status: true,
        localized: true,
        access: {
          read: () => true,
          update: ownEntries,
          publish: (context: AccessControlContext) =>
            context.locale === "de"
              ? ({ owner: { equals: "nobody" } } as unknown as boolean)
              : ownEntries(context),
          unpublish: ownEntries,
        },
        fields,
      }),
      defineCollection({
        slug: BY_TITLE,
        status: true,
        localized: true,
        access: {
          read: () => true,
          update: ownEntries,
          publish: (context: AccessControlContext) =>
            ({
              title: {
                equals: context.locale === "de" ? "deutsch" : "english",
              },
            }) as unknown as boolean,
          unpublish: ownEntries,
        },
        fields,
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds each one.
  const all = [POSTS, GERMAN_REFUSED, BY_TITLE];
  await userWhoMay(current, AUTHOR, "read", all);
  for (const action of ["update", "publish", "unpublish"]) {
    await grantTo(current, AUTHOR, action, all);
  }
  return current;
}

const entries = (t: TestNextly) =>
  t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;

/** An entry of `owner` in `collection`, translated into both languages. */
async function seed(
  t: TestNextly,
  collection: string,
  owner: string,
  status = "draft"
): Promise<string> {
  const created = await entries(t).createEntry(
    { collectionName: collection, overrideAccess: true, locale: "en" },
    { title: "english", owner, status }
  );
  const id = String((created.data as { id: unknown }).id);
  await entries(t).updateEntry(
    {
      collectionName: collection,
      entryId: id,
      overrideAccess: true,
      locale: "de",
    },
    { title: "deutsch", status }
  );
  return id;
}

/** The entry's stored row and its translations, read past every check. */
async function stored(
  t: TestNextly,
  collection: string,
  id: string
): Promise<unknown> {
  const main = await t.adapter.select<Record<string, unknown>>(
    `dc_${collection}`,
    {}
  );
  const translations = await t.adapter.select<Record<string, unknown>>(
    `dc_${collection}_locales`,
    {}
  );
  return {
    main: main.find(row => String(row.id) === id),
    translations: translations
      .filter(row => String(row._parent_id ?? row.parent_id) === id)
      .map(row => ({ locale: row._locale ?? row.locale, status: row._status }))
      .sort((a, b) => String(a.locale).localeCompare(String(b.locale))),
  };
}

/** Moves `id`'s status in every language, as the author. */
const everyLanguage = (
  t: TestNextly,
  collection: string,
  id: string,
  status: "published" | "draft"
) =>
  entries(t).updateEntry(
    {
      collectionName: collection,
      entryId: id,
      locale: "*",
      user: { id: AUTHOR },
      overrideAccess: false,
    } as never,
    { status }
  );

describe("a publish of every language whose rule answers a filter", () => {
  it("publishes an entry the filter matches, and refuses another's, leaving it", async () => {
    const t = await boot();
    const own = await seed(t, POSTS, AUTHOR);
    const others = await seed(t, POSTS, OTHER);
    const before = await stored(t, POSTS, others);

    const published = await everyLanguage(t, POSTS, own, "published");
    const refused = await everyLanguage(t, POSTS, others, "published");

    expect(published.success).toBe(true);
    expect(
      ((await stored(t, POSTS, own)) as { main?: { status?: string } }).main
        ?.status
    ).toBe("published");
    expect(refused.success).toBe(false);
    expect(refused.statusCode).toBe(403);
    expect(await stored(t, POSTS, others)).toEqual(before);
  });

  it("refuses an entry the filter answered in one of its languages does not match, changing nothing", async () => {
    // The author's own post: the English filter matches it, the German one
    // matches no entry, and the publish puts German live too.
    const t = await boot();
    const own = await seed(t, GERMAN_REFUSED, AUTHOR);
    const before = await stored(t, GERMAN_REFUSED, own);

    const refused = await everyLanguage(t, GERMAN_REFUSED, own, "published");

    expect(refused.success).toBe(false);
    expect(refused.statusCode).toBe(403);
    expect(await stored(t, GERMAN_REFUSED, own)).toEqual(before);
  });
});

describe("a publish of every language whose filter names a translated field", () => {
  it("matches each language's filter in that language", async () => {
    // Each language's filter matches its own translation, "english" or
    // "deutsch": matched in another language, either would refuse.
    const t = await boot();
    const own = await seed(t, BY_TITLE, AUTHOR);

    const published = await everyLanguage(t, BY_TITLE, own, "published");

    expect(published.success).toBe(true);
    expect(
      ((await stored(t, BY_TITLE, own)) as { main?: { status?: string } }).main
        ?.status
    ).toBe("published");
  });
});

describe("an unpublish of every language whose rule answers a filter", () => {
  it("unpublishes an entry the filter matches, and refuses another's, leaving it", async () => {
    const t = await boot();
    const own = await seed(t, POSTS, AUTHOR, "published");
    const others = await seed(t, POSTS, OTHER, "published");
    const before = await stored(t, POSTS, others);

    const unpublished = await everyLanguage(t, POSTS, own, "draft");
    const refused = await everyLanguage(t, POSTS, others, "draft");

    expect(unpublished.success).toBe(true);
    expect(
      ((await stored(t, POSTS, own)) as { main?: { status?: string } }).main
        ?.status
    ).toBe("draft");
    expect(refused.success).toBe(false);
    expect(refused.statusCode).toBe(403);
    expect(await stored(t, POSTS, others)).toEqual(before);
  });
});
