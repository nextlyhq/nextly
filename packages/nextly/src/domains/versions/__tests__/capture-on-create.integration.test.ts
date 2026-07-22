/**
 * Wiring test for automatic version capture on create.
 *
 * Proves that when a collection opts into versioning, `createEntry` records
 * exactly one durable `nextly_versions` snapshot inside the write transaction,
 * and that an unversioned collection records none. Locks the shared in-tx
 * capture seam (captureInTx) that later stages and the webhook event capture
 * both build on.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
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

// nextly_versions is a Drizzle-schema core table, so adapter.select returns
// camelCase property keys (scopeSlug/versionNo), unlike raw dc_ tables.
type VersionRow = {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  versionNo: number;
  status: string;
};

async function versionRows(handle: TestNextly, slug: string) {
  const rows = await handle.adapter.select<VersionRow>("nextly_versions");
  return rows.filter(r => r.scopeSlug === slug);
}

describe("version capture on create (integration)", () => {
  it("captures one published version per create in a versioned collection", async () => {
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

    await handler.createEntry(
      { collectionName: "posts", userId: "u1", overrideAccess: true },
      { title: "first" }
    );

    const rows = await versionRows(current, "posts");
    expect(rows).toHaveLength(1);
    expect(rows[0].scopeKind).toBe("collection");
    expect(rows[0].versionNo).toBe(1);
    // History-only stage: absent content status captures as "published".
    expect(rows[0].status).toBe("published");
  });

  it("records no version for an unversioned collection", async () => {
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

    await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "note" }
    );

    expect(await versionRows(current, "notes")).toHaveLength(0);
  });

  it("numbers versions independently per document (each create starts at 1)", async () => {
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

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "a" }
    );
    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "b" }
    );

    const rows = await versionRows(current, "posts");
    expect(rows).toHaveLength(2);
    // Two distinct documents, each with its own versionNo 1.
    expect(new Set(rows.map(r => r.entryId)).size).toBe(2);
    expect(rows.every(r => r.versionNo === 1)).toBe(true);
  });

  it("captures v1 when a versioned single is auto-created on first read", async () => {
    // A versioned Single that has never been written materializes its default
    // document on first read; that materialization must start the history so
    // the live row is not left without any version.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    const res = await singles.get("preferences", { overrideAccess: true });
    expect(res.success).toBe(true);

    const rows = await versionRows(current, "preferences");
    expect(rows).toHaveLength(1);
    expect(rows[0].scopeKind).toBe("single");
    expect(rows[0].versionNo).toBe(1);
  });

  it("does not version an unversioned single auto-created on read", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles =
      current.getService<SingleEntryService>("singleEntryService");

    await singles.get("preferences", { overrideAccess: true });

    expect(await versionRows(current, "preferences")).toHaveLength(0);
  });
});
