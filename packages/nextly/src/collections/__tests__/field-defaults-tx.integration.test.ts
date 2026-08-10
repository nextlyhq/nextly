/**
 * Where declared defaults stop.
 *
 * Defaults are applied on the pooled create path only. The transactional and
 * bulk paths build their insert payload directly and run none of the pooled
 * path's preparation — no JSON serialization, no nested-relationship
 * normalization, and no companion write for a localized collection's
 * translatable values. Seeding defaults into them means reproducing all three,
 * on paths whose behaviour cannot currently be exercised against Postgres or
 * MySQL, so that is left until both paths share one write pipeline.
 *
 * This asserts the boundary rather than leaving it implicit: a transactional
 * create stores nothing for an omitted field, exactly as it did before
 * defaults existed. Moving the boundary should be a deliberate change that
 * updates this test, not a silent one.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, json, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("field defaults on a transactional create (integration)", () => {
  it("does not apply declared defaults", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "txdefaults",
          fields: [
            text({ name: "title" }),
            text({ name: "subtitle", defaultValue: "from-default" }),
            json({ name: "settings", defaultValue: { a: 1 } }),
          ],
        }),
      ],
    });

    const entries = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    const created = await current.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx as never,
        { collectionName: "txdefaults", overrideAccess: true },
        { title: "T" }
      )
    );
    const id = (created as { data?: { id?: unknown } }).data?.id;
    expect(typeof id, JSON.stringify(created)).toBe("string");

    const read = await entries.getEntry({
      collectionName: "txdefaults",
      entryId: String(id),
      overrideAccess: true,
    });
    const data = ((read as { data?: unknown }).data ?? {}) as Record<
      string,
      unknown
    >;

    // Unchanged from before this feature: the create succeeds and the omitted
    // fields are simply empty.
    expect(data.title).toBe("T");
    expect(data.subtitle).toBeNull();
    expect(data.settings).toBeNull();
  });
});
