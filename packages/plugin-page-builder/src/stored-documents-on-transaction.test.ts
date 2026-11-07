/**
 * The stored documents a removal walks under the composition graph lock,
 * read on the write's own transaction: rows a page at a time until a short
 * page, the plugin's own reads for its own collections and Singles and the
 * host reads for the others, every other language by id with its fallback
 * off, and every working draft through the stored read of the blocks type.
 */
import type { PluginStoredValueTarget } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { RESCAN_PAGE_SIZE, storedUsesOf } from "./shared-style-rescan";
import type { BuilderDocumentType } from "./site-style-route";
import {
  storedDocumentsOnTransaction,
  type TransactionDocumentSource,
  type TransactionReads,
} from "./stored-documents-on-transaction";

/** The write's transaction, as the in-transaction phase hands it. */
const TRANSACTION = { transaction: "the write's own" } as never;

const PAGES: BuilderDocumentType = {
  slug: "pages",
  label: "Pages",
  paths: ["content"],
};
const POSTS: BuilderDocumentType = {
  slug: "posts",
  label: "Posts",
  paths: ["hero.body"],
};
const HOME: BuilderDocumentType = {
  slug: "home",
  label: "Home",
  paths: ["content"],
};

/**
 * A plain read's option: no row lock. A read under the graph lock that took
 * one would wait for a page save's row while that save waits for the graph
 * lock (`composition-graph-lock`).
 */
const PLAIN = { lock: "none" };

/** `count` rows, ids `r000` up, each placing nothing. */
const rows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${String(from + index).padStart(3, "0")}`,
    content: null,
  }));

/** A paginated answer holding `data`, with a total no reader should trust. */
const listed = (data: unknown[]) => ({
  data,
  pagination: { total: 0, limit: RESCAN_PAGE_SIZE, offset: 0, hasMore: false },
});

/** Reads recording their calls, answering nothing unless told. */
function readsAnswering(): TransactionReads & {
  [K in keyof TransactionReads]: ReturnType<typeof vi.fn>;
} {
  return {
    listEntriesInTransaction: vi.fn(async () => listed([])),
    listHostEntriesInTransaction: vi.fn(async () => listed([])),
    findEntryByIdInTransaction: vi.fn(async () => ({})),
    findHostEntryByIdInTransaction: vi.fn(async () => ({})),
    getSingleInTransaction: vi.fn(async () => ({})),
    getHostSingleInTransaction: vi.fn(async () => ({})),
  } as never;
}

/** A source over `reads`, on a site with `locales`. */
function sourceOf(
  reads: TransactionReads,
  overrides: Partial<TransactionDocumentSource> = {}
): TransactionDocumentSource {
  return {
    reads,
    transaction: TRANSACTION,
    readStored: vi.fn(async () => ({ kind: "absent" as const })),
    ownCollections: new Set(["pages"]),
    ownSingles: new Set<string>(),
    locales: () => [],
    collections: async () => [PAGES],
    singles: async () => [],
    ...overrides,
  };
}

describe("the stored documents, read on the write's transaction", () => {
  it("pages by id with a limit, and stops on a short page rather than on the total", async () => {
    const reads = readsAnswering();
    reads.listEntriesInTransaction
      .mockResolvedValueOnce(listed(rows(RESCAN_PAGE_SIZE)))
      .mockResolvedValueOnce(listed(rows(3, RESCAN_PAGE_SIZE)));
    const documents = storedDocumentsOnTransaction(sourceOf(reads));

    const first = await documents.rowsAfter(PAGES, undefined);
    expect(first.items).toHaveLength(RESCAN_PAGE_SIZE);
    expect(first.hasNext).toBe(true);
    const second = await documents.rowsAfter(PAGES, "r099");
    expect(second.items).toHaveLength(3);
    expect(second.hasNext).toBe(false);

    // On the transaction, the first page past the cursor, in id order, with
    // only the id and the blocks fields.
    expect(reads.listEntriesInTransaction).toHaveBeenNthCalledWith(
      1,
      TRANSACTION,
      "pages",
      {
        select: { id: true, content: true },
        sort: { field: "id", direction: "asc" },
        pagination: { limit: RESCAN_PAGE_SIZE, page: 1 },
        depth: 0,
      },
      PLAIN
    );
    expect(reads.listEntriesInTransaction).toHaveBeenNthCalledWith(
      2,
      TRANSACTION,
      "pages",
      expect.objectContaining({ where: { id: { greater_than: "r099" } } }),
      PLAIN
    );
  });

  it("reads the plugin's own collections with its own reads and every other with the host reads", async () => {
    const reads = readsAnswering();
    const documents = storedDocumentsOnTransaction(sourceOf(reads));
    await documents.rowsAfter(POSTS, undefined);
    expect(reads.listHostEntriesInTransaction).toHaveBeenCalledWith(
      TRANSACTION,
      "posts",
      expect.objectContaining({ select: { id: true, hero: true } }),
      PLAIN
    );
    expect(reads.listEntriesInTransaction).not.toHaveBeenCalled();
  });

  it("reads a row's other languages by id with the fallback off, and each working draft by the stored read", async () => {
    const reads = readsAnswering();
    reads.findHostEntryByIdInTransaction.mockResolvedValue({
      id: "p1",
      hero: { body: null },
    });
    const readStored = vi.fn(async (target: PluginStoredValueTarget) =>
      target.locale === "fr"
        ? { kind: "value" as const, value: { nodes: ["the french draft"] } }
        : { kind: "absent" as const }
    );
    const documents = storedDocumentsOnTransaction(
      sourceOf(reads, { readStored, locales: () => ["en", "fr"] })
    );

    const forms = await documents.rowForms(POSTS, "p1");

    // Every language as stored, the listed one (no language) excepted.
    expect(reads.findHostEntryByIdInTransaction.mock.calls).toEqual([
      [
        TRANSACTION,
        "posts",
        "p1",
        { locale: "en", fallbackLocale: false, ...PLAIN },
      ],
      [
        TRANSACTION,
        "posts",
        "p1",
        { locale: "fr", fallbackLocale: false, ...PLAIN },
      ],
    ]);
    // The draft in each language, field by field.
    expect(readStored.mock.calls).toEqual([
      [
        {
          collection: "posts",
          id: "p1",
          field: "hero.body",
          form: "draft",
          locale: "en",
        },
      ],
      [
        {
          collection: "posts",
          id: "p1",
          field: "hero.body",
          form: "draft",
          locale: "fr",
        },
      ],
    ]);
    // A draft found is put back at its path, as the walk reads a row.
    expect(forms).toContainEqual({
      hero: { body: { nodes: ["the french draft"] } },
    });
    expect(forms).toHaveLength(3);
  });

  it("reads a Single in each form, its document by the Single read and its draft by the stored read", async () => {
    const reads = readsAnswering();
    const readStored = vi.fn(async () => ({
      kind: "value" as const,
      value: "draft value",
    }));
    const documents = storedDocumentsOnTransaction(
      sourceOf(reads, { readStored, ownSingles: new Set(["home"]) })
    );

    const forms = await documents.singleForms(HOME);

    expect(reads.getSingleInTransaction).toHaveBeenCalledWith(
      TRANSACTION,
      "home",
      PLAIN
    );
    expect(reads.getHostSingleInTransaction).not.toHaveBeenCalled();
    expect(readStored).toHaveBeenCalledWith({
      single: "home",
      field: "content",
      form: "draft",
    });
    expect(forms).toEqual([{}, { content: "draft value" }]);
  });

  it("reads every row, language and Single of a walk plainly, own and host alike", async () => {
    const reads = readsAnswering();
    reads.listEntriesInTransaction.mockResolvedValueOnce(
      listed([{ id: "p1", content: null }])
    );
    reads.listHostEntriesInTransaction.mockResolvedValueOnce(
      listed([{ id: "q1", hero: { body: null } }])
    );
    const documents = storedDocumentsOnTransaction(
      sourceOf(reads, {
        locales: () => ["en", "fr"],
        collections: async () => [PAGES, POSTS],
        singles: async () => [HOME, { ...HOME, slug: "about" }],
        ownSingles: new Set(["home"]),
      })
    );

    await storedUsesOf(["t-spare"], documents, () => []);

    // Every read the walk made, of each kind, was made, and each with the
    // plain read's option as its last argument: a share or update lock on
    // any of them would wait against a page save holding its row.
    const calls = Object.values(reads).flatMap(read => read.mock.calls);
    for (const read of Object.values(reads)) {
      expect(read.mock.calls.length).toBeGreaterThan(0);
    }
    for (const call of calls) {
      expect(call.at(-1)).toEqual(expect.objectContaining(PLAIN));
    }
  });

  it("lets the walk find a use only a row's working draft holds", async () => {
    const reads = readsAnswering();
    reads.listEntriesInTransaction.mockResolvedValueOnce(
      listed([{ id: "p1", content: null }])
    );
    const readStored = vi.fn(async () => ({
      kind: "value" as const,
      value: "uses t-spare",
    }));
    const documents = storedDocumentsOnTransaction(
      sourceOf(reads, { readStored })
    );

    const uses = await storedUsesOf(["t-spare"], documents, stored =>
      typeof stored === "string" && stored.includes("t-spare")
        ? ["t-spare"]
        : []
    );

    expect(uses).toEqual([{ kind: "collection", slug: "pages", id: "p1" }]);
  });
});
