/**
 * A Builder collection's many-to-many relation lives in a junction table, not
 * on the main row, and every language shares it. Publishing a language's
 * pending change writes the junction from that change, so a change English
 * began before Spanish published new tags would put the old ones back. The
 * junction takes part in the same base and refusal as the main row's shared
 * values. (It is compared as a set, since a junction keeps no order; the
 * read here returns one order, so `live-shared-single.test.ts` covers that.)
 *
 * SQLite only: a junction needs the Schema Builder seed and a reboot on the
 * same adapter, which the harness supports on the in-memory SQLite adapter
 * but not on the server dialects, whose dynamic-collection service validates
 * an app environment the harness does not provide. The comparison itself is
 * dialect-independent, and the shared-parts suite runs the code-first
 * relation on every dialect.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices } from "../../../../di/register";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { resolveVersionsConfig } from "../../../versions/resolve-config";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "posts";
const localization = { locales: ["en", "es"], defaultLocale: "en" };

/** A localized Builder collection of posts, sharing a junction of tags. */
async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({ dialect: "sqlite", localization });
  const adapter = handle.adapter;
  await seedBuilderCollection(adapter, {
    slug: "tags",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(adapter, {
    slug: COLLECTION,
    localized: true,
    status: true,
    versions: resolveVersionsConfig({ drafts: true }, true),
    fields: [
      // Translated.
      { name: "headline", type: "text" },
      // Shared by every language, in a junction.
      {
        name: "tags",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ],
  });
  clearServices();
  handle = await createTestNextly({ adapter, localization });
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
): Promise<{ headline: unknown; tags: unknown }> {
  const res = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale,
    depth: 0,
  });
  const data = res.data as { headline?: unknown; tags?: unknown };
  const tags = Array.isArray(data.tags)
    ? data.tags
        .map(t =>
          typeof t === "object" && t !== null ? (t as { id: unknown }).id : t
        )
        .map(String)
        .sort()
    : data.tags;
  return { headline: data.headline, tags };
}

/** Live in both languages with tags one and two; English then begins a change. */
async function englishBegins(
  entries: CollectionEntryService
): Promise<{ id: string; t1: string; t3: string }> {
  const t1 = await tag(entries, "one");
  const t2 = await tag(entries, "two");
  const t3 = await tag(entries, "three");
  const created = await entries.createEntry(
    { collectionName: COLLECTION, overrideAccess: true, locale: "en" },
    { headline: "en headline", tags: [t1, t2], status: "published" }
  );
  expect(created.success).toBe(true);
  const id = (created.data as { id: string }).id;
  expect(
    (
      await save(entries, id, "es", {
        headline: "es headline",
        status: "published",
      })
    ).success
  ).toBe(true);
  expect(
    (await save(entries, id, "en", { headline: "en edited" })).success
  ).toBe(true);
  return { id, t1, t3 };
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

describe("publishing a Builder collection's shared junction", () => {
  it("refuses English's older change after Spanish publishes new tags, and keeps them", async () => {
    const entries = await boot();
    const { id, t1, t3 } = await englishBegins(entries);
    await spanishPublishes(entries, id, { tags: [t1, t3] });

    const refused = await save(entries, id, "en", { status: "published" });

    expect(refused.statusCode).toBe(409);
    expect(refused.publicData).toEqual({
      reason: "shared-fields-out-of-date",
      fields: ["tags"],
    });
    expect(await liveDoc(entries, id, "en")).toEqual({
      headline: "en headline",
      tags: [t1, t3].sort(),
    });
    // Each language keeps its own headline: only the tags are shared.
    expect((await liveDoc(entries, id, "es")).headline).toBe("es headline");
  });

  it("publishes once English takes the live tags, and keeps them", async () => {
    const entries = await boot();
    const { id, t1, t3 } = await englishBegins(entries);
    await spanishPublishes(entries, id, { tags: [t1, t3] });

    const taken = await entries.takeLiveSharedValues({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      locale: "en",
    });
    expect(taken.data).toEqual({ taken: ["tags"], outOfDate: [] });
    const published = await save(entries, id, "en", { status: "published" });

    expect(published.success).toBe(true);
    expect(await liveDoc(entries, id, "en")).toEqual({
      headline: "en edited",
      tags: [t1, t3].sort(),
    });
  });
});
