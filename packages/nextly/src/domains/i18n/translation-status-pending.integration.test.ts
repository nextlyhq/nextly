/**
 * The translation overview reports which languages have unpublished changes.
 *
 * An author looking at a document sees a list of its languages. The failure
 * this exists to prevent is the one every CMS runs into: the document looks
 * finished while pending work sits inside it, visible only if you open the
 * language it is in. With several languages there is no reason to open any of
 * them, so the fact has to travel with the overview.
 *
 * Both halves are asserted in the same case. "German reports nothing pending"
 * is satisfied just as well by a builder that reports nothing for any language,
 * so the language that DOES have a pending change is asserted beside it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "pendingpages";

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), text({ name: "body" })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService("collectionsHandler");
}

function entriesOf(t: TestNextly): CollectionEntryService {
  return handlerOf(t).getEntryService() as CollectionEntryService;
}

interface TranslationMeta {
  translated?: boolean;
  status?: string;
  pendingChange?: boolean;
}

describe("translation overview reports pending changes (integration)", () => {
  it("names the language holding unpublished changes, and only that one", async () => {
    const t = await boot();
    const entries = entriesOf(t);

    const created = await entries.createEntry(
      { collectionName: SLUG, overrideAccess: true, locale: "en" },
      { title: "EN", body: "EN body", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await entries.updateEntry(
      { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "de" },
      { title: "DE", body: "DE body", status: "published" }
    );

    // Hold an edit in German only.
    const held = await entries.updateEntry(
      { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "de" },
      { body: "DE edited" }
    );
    expect(held.success).toBe(true);

    const res = await handlerOf(t).getEntry({
      collectionName: SLUG,
      entryId: id,
      translationStatus: true,
      overrideAccess: true,
    });
    const translations = (
      res.data as { _translations?: Record<string, TranslationMeta> }
    )?._translations;

    expect(translations?.de?.pendingChange).toBe(true);
    // The other language, in the same read: without this the assertion above
    // would pass against a builder that marks everything pending.
    expect(translations?.en?.pendingChange ?? false).toBe(false);
  });
});
