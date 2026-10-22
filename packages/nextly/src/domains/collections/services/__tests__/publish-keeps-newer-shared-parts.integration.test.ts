/**
 * Shared values kept outside a document's main row are shared values too: a
 * component every language shares, and a many-to-many relation. Publishing a
 * language's pending change writes them as it writes the main row, so a
 * change English began before Spanish published a new hero or new tags would
 * put the old ones back. They take part in the same base and refusal.
 *
 * Compared by content: a publish rewrites component rows, so a change whose
 * component nobody else touched must still publish.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  relationship,
  text,
} from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "pages";

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
    ],
    collections: [
      defineCollection({ slug: "tags", fields: [text({ name: "name" })] }),
      defineCollection({
        slug: COLLECTION,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          // Translated.
          text({ name: "title" }),
          // Shared by every language: a component, and a relation.
          fieldGroup({ name: "hero", component: "hero" }),
          relationship({ name: "tags", relationTo: "tags", hasMany: true }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

async function tag(entries: CollectionEntryService, name: string) {
  const created = await entries.createEntry(
    { collectionName: "tags", overrideAccess: true },
    { name }
  );
  return (created.data as { id: string }).id;
}

function save(
  entries: CollectionEntryService,
  id: string,
  locale: string,
  body: Record<string, unknown>
) {
  return entries.updateEntry(
    { collectionName: COLLECTION, entryId: id, overrideAccess: true, locale },
    body
  );
}

async function liveDoc(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<{ title: unknown; heading: unknown; tags: unknown }> {
  const res = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale,
    depth: 0,
  });
  const data = res.data as {
    title?: unknown;
    hero?: { heading?: unknown } | null;
    tags?: unknown;
  };
  const tags = Array.isArray(data.tags)
    ? data.tags.map(t =>
        typeof t === "object" && t !== null ? (t as { id: unknown }).id : t
      )
    : data.tags;
  return { title: data.title, heading: data.hero?.heading, tags };
}

/** Live in both languages; English then begins a change. */
async function englishBegins(
  entries: CollectionEntryService
): Promise<{ id: string; t1: string; t2: string }> {
  const t1 = await tag(entries, "one");
  const t2 = await tag(entries, "two");
  const created = await entries.createEntry(
    { collectionName: COLLECTION, overrideAccess: true, locale: "en" },
    {
      title: "en title",
      hero: { heading: "first hero" },
      tags: [t1],
      status: "published",
    }
  );
  const id = (created.data as { id: string }).id;
  expect(
    (await save(entries, id, "es", { title: "es title", status: "published" }))
      .success
  ).toBe(true);
  expect((await save(entries, id, "en", { title: "en edited" })).success).toBe(
    true
  );
  return { id, t1, t2 };
}

async function spanishPublishes(
  entries: CollectionEntryService,
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  expect((await save(entries, id, "es", body)).success).toBe(true);
  expect((await save(entries, id, "es", { status: "published" })).success).toBe(
    true
  );
}

describe.each(getConfiguredTestDialects())(
  "publishing shared parts outside the main row on %s",
  dialect => {
    it("refuses English's older change after Spanish publishes a new hero, and keeps it", async () => {
      const entries = await boot(dialect);
      const { id } = await englishBegins(entries);
      await spanishPublishes(entries, id, { hero: { heading: "new hero" } });

      const refused = await save(entries, id, "en", { status: "published" });

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({
        reason: "shared-fields-out-of-date",
        fields: ["hero"],
      });
      expect((await liveDoc(entries, id, "en")).heading).toBe("new hero");
    });

    it("refuses English's older change after Spanish publishes new tags, and keeps them", async () => {
      const entries = await boot(dialect);
      const { id, t2 } = await englishBegins(entries);
      await spanishPublishes(entries, id, { tags: [t2] });

      const refused = await save(entries, id, "en", { status: "published" });

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({
        reason: "shared-fields-out-of-date",
        fields: ["tags"],
      });
      expect((await liveDoc(entries, id, "en")).tags).toEqual([t2]);
    });

    it("publishes once English takes the live hero and tags, and keeps them", async () => {
      const entries = await boot(dialect);
      const { id, t2 } = await englishBegins(entries);
      await spanishPublishes(entries, id, {
        hero: { heading: "new hero" },
        tags: [t2],
      });

      const taken = await entries.takeLiveSharedValues({
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "en",
      });
      expect(taken.data).toEqual({ taken: ["hero", "tags"], outOfDate: [] });
      const published = await save(entries, id, "en", { status: "published" });

      expect(published.success).toBe(true);
      expect(await liveDoc(entries, id, "en")).toEqual({
        title: "en edited",
        heading: "new hero",
        tags: [t2],
      });
    });

    it("publishes English's change when Spanish published only its own words", async () => {
      // Spanish's publish rewrites the shared component's rows with the same
      // content: that is not a newer value, and must not refuse English.
      const entries = await boot(dialect);
      const { id, t1 } = await englishBegins(entries);
      await spanishPublishes(entries, id, { title: "es edited" });

      const published = await save(entries, id, "en", { status: "published" });

      expect(published.success).toBe(true);
      expect(await liveDoc(entries, id, "en")).toEqual({
        title: "en edited",
        heading: "first hero",
        tags: [t1],
      });
    });
  }
);
