/**
 * That a backfill walk cannot SKIP a document when the collection changes
 * under it.
 *
 * The rebuild pages a live collection, and other writers are free to delete
 * from it mid-walk. Under offset paging that shifts everything behind the
 * deletion back by one, so the row now sitting at the next offset has already
 * been read and the row that crossed the boundary is never visited.
 *
 * For a REPAIR that is survivable: a document the walk misses keeps the rows it
 * already had, and the orphan sweep refuses to remove them without confirming
 * the document is gone. A first FILL has no such protection — a document that
 * predates the index has no rows to keep, so nothing notices, the walk returns
 * without a failure, and the scope is recorded as finished for ever.
 *
 * @module usage-rebuild-paging.test
 */
import { describe, expect, it } from "vitest";

import { usageRebuildDocumentStore } from "./class-usage-runtime";

/** Rows as ids, with the by-id read answering a document for each. */
function collection(ids: string[]) {
  const rows = [...ids];
  const listedPages: string[][] = [];

  const nextly = {
    find: async (args: {
      limit?: number;
      where?: Record<string, unknown>;
    }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }> => {
      const after = (args.where?.id as { greater_than?: string } | undefined)
        ?.greater_than;
      // The store is asked for an ORDERED window, so the fake answers one.
      const remaining = rows
        .slice()
        .sort()
        .filter(id => after === undefined || id > after);
      const limit = args.limit ?? remaining.length;
      const page = remaining.slice(0, limit);
      listedPages.push(page);
      return {
        items: page.map(id => ({ id })),
        meta: { hasNext: remaining.length > limit },
      };
    },
    findByID: async (args: { id: string }): Promise<unknown> =>
      rows.includes(args.id) ? { id: args.id, content: {} } : undefined,
  };

  return { rows, listedPages, nextly };
}

describe("paging a collection that changes under the walk", () => {
  it("visits every surviving document when one is deleted mid-walk", async () => {
    // `b` is deleted after the first page is handed back. Under offsets the
    // second page starts at index 2, which is now `d` — and `c` is never
    // visited at all. Resuming after the last id seen asks for "> b", which
    // still answers `c`.
    const { rows, nextly } = collection(["a", "b", "c", "d"]);
    const store = usageRebuildDocumentStore(
      nextly as unknown as Parameters<typeof usageRebuildDocumentStore>[0]
    );

    const seen: string[] = [];
    const readPage = async (page: number): Promise<boolean> => {
      const result = await store.find({
        collection: "pages",
        limit: 2,
        page,
        sort: "id",
        locale: "",
        variant: "published",
      });
      for (const item of result.items) {
        seen.push((item as { id: string }).id);
      }
      return result.meta.hasNext;
    };

    await readPage(1);
    // A concurrent delete of a document the walk has ALREADY passed.
    rows.splice(rows.indexOf("b"), 1);
    await readPage(2);

    expect(seen).toEqual(["a", "b", "c", "d"]);
  });

  it("resets its cursor when a walk starts again at page one", async () => {
    // A store outlives one pass over its scope only if the cursor is reset, and
    // the rebuild signals a fresh walk by asking for page 1. Without this a
    // second walk would resume where the first stopped and report a collection
    // with no documents in it.
    const { nextly } = collection(["a", "b"]);
    const store = usageRebuildDocumentStore(
      nextly as unknown as Parameters<typeof usageRebuildDocumentStore>[0]
    );
    const args = {
      collection: "pages",
      limit: 1,
      sort: "id",
      locale: "",
      variant: "published" as const,
    };

    await store.find({ ...args, page: 1 });
    await store.find({ ...args, page: 2 });
    const restarted = await store.find({ ...args, page: 1 });

    expect((restarted.items[0] as { id: string }).id).toBe("a");
  });

  it("REFUSES a walk ordered by anything but the id it resumes from", async () => {
    // The cursor is an id, so another ordering resumes at a point in a
    // different sequence. Falling back to offsets quietly is the behaviour this
    // module exists to remove, so it refuses instead.
    const { nextly } = collection(["a"]);
    const store = usageRebuildDocumentStore(
      nextly as unknown as Parameters<typeof usageRebuildDocumentStore>[0]
    );

    await expect(
      store.find({
        collection: "pages",
        limit: 1,
        page: 1,
        sort: "createdAt",
        locale: "",
        variant: "published",
      })
    ).rejects.toThrow(/pages by id/);
  });
});
