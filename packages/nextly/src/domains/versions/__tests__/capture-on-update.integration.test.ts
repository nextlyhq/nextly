/**
 * Wiring test for automatic version capture on update.
 *
 * Proves that `updateEntry` (collections) and the single `update` path each
 * record a new `nextly_versions` snapshot inside the write transaction when the
 * schema opts into versioning, that the version number increments per document,
 * and that the snapshot reflects the updated values.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  component,
  defineCollection,
  defineComponent,
  defineSingle,
  json,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type VersionRow = {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
  snapshot: unknown;
};

async function versions(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows
    .filter(r => r.scopeSlug === slug)
    .sort((a, b) => a.versionNo - b.versionNo);
}

describe("version capture on update (integration)", () => {
  it("captures a new version on each collection update (versionNo increments)", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "v2" }
    );

    const rows = await versions(current, "posts");
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.versionNo)).toEqual([1, 2]);
    // The second version snapshots the updated document.
    expect((rows[1].snapshot as { title?: string }).title).toBe("v2");
    expect(rows.every(r => r.entryId === id)).toBe(true);
  });

  it("captures a version on a single update when versioning is enabled", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.update(
      "settings",
      { title: "hello" },
      { overrideAccess: true }
    );

    const rows = await versions(current, "settings");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const latest = rows[rows.length - 1];
    expect(latest.scopeKind).toBe("single");
    expect((latest.snapshot as { title?: string }).title).toBe("hello");
  });

  it("preserves an omitted component subtree in a scalar-only update snapshot", async () => {
    // A partial update carries only the fields in the request. Without reading
    // the current component state the snapshot would drop the untouched
    // component, silently losing it on a later restore.
    current = await createTestNextly({
      components: [
        defineComponent({
          slug: "hero",
          fields: [text({ name: "heading" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          versions: true,
          fields: [
            text({ name: "title" }),
            component({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "v1", hero: { heading: "Welcome" } }
    );
    const id = (created.data as { id: string }).id;

    // Scalar-only update — the component field is NOT in the payload.
    await handler.updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { title: "v2" }
    );

    const rows = await versions(current, "pages");
    expect(rows).toHaveLength(2);
    const latest = rows[1].snapshot as {
      title?: string;
      hero?: { heading?: string };
    };
    expect(latest.title).toBe("v2");
    // The untouched component survives into the new version.
    expect(latest.hero?.heading).toBe("Welcome");
  });

  it("captures JSON-backed fields parsed to the read shape, not as strings", async () => {
    // On SQLite a json/richtext/group field is stored as a string; the snapshot
    // must parse it so a restored version equals a normal read.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "docs",
          versions: true,
          fields: [text({ name: "title" }), json({ name: "meta" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "docs", overrideAccess: true },
      { title: "d1", meta: { views: 3, tags: ["a", "b"] } }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "docs", entryId: id, overrideAccess: true },
      { title: "d2", meta: { views: 4, tags: ["c"] } }
    );

    const rows = await versions(current, "docs");
    const latest = rows[rows.length - 1].snapshot as {
      meta?: unknown;
    };
    // Parsed object, not a JSON string.
    expect(latest.meta).toEqual({ views: 4, tags: ["c"] });
  });

  it("records no version when the schema does not opt in", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "a" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: "notes", entryId: id, overrideAccess: true },
      { title: "b" }
    );

    expect(await versions(current, "notes")).toHaveLength(0);
  });
});
