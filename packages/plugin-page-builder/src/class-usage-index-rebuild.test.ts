/**
 * Whether rebuilding the index walks every document, repairs what disagrees,
 * and refuses to report a pass it did not complete.
 *
 * The stores are observed rather than reimplemented: the cases assert the calls
 * the code actually made, so a test cannot go on passing after the line it
 * watches is edited.
 *
 * @module class-usage-index-rebuild.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";

import {
  rebuildClassUsageIndex,
  type ClassUsageDocumentStore,
} from "./class-usage-index-rebuild";
import type { ClassUsageIndexStore } from "./class-usage-maintenance";

const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/** A document store answering one page, recording how it was asked. */
function documentStore(items: unknown[], pages = 1) {
  const calls: string[] = [];
  const store: ClassUsageDocumentStore = {
    find: async args => {
      calls.push(
        `find:page=${args.page}:sort=${args.sort}:locale=${args.locale}`
      );
      return { items, meta: { hasNext: args.page < pages } };
    },
    // Answers from the same fixture the walk reads, so a document present in
    // `items` is present here too — which is what makes a MISSING one a real
    // absence rather than an artefact of two fakes disagreeing.
    exists: async ({ id }) =>
      items.some(i => (i as { id?: string } | null)?.id === id),
  };
  return { store, calls };
}

/** An index store holding fixed rows and recording every write. */
function indexStore(rows: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  const store: ClassUsageIndexStore = {
    find: async args => {
      const key = args.where.entityKey?.equals;
      return {
        items: rows.filter(r => r.entityKey === key),
        meta: { hasNext: false },
      };
    },
    create: async args => {
      calls.push(
        `create:${String(args.data.entityKey)}:${String(args.data.classId)}`
      );
      return {};
    },
    delete: async args => {
      calls.push(`delete:${args.id}`);
      return {};
    },
  };
  return { store, calls };
}

describe("rebuilding the class-usage index", () => {
  it("indexes every document it walks, keyed by its own id", async () => {
    const docs = documentStore([
      { id: "page-1", content: documentUsing("hero") },
      { id: "page-2", content: documentUsing("card") },
    ]);
    const index = indexStore();

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index: index.store,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    expect(report).toEqual({
      scanned: 2,
      repaired: 2,
      undetermined: 0,
      orphansRemoved: 0,
    });
    expect(index.calls).toEqual(["create:page-1:hero", "create:page-2:card"]);
  });

  it("orders by id, which the writes it makes cannot move", async () => {
    // Offset paging reads position N of an ORDERED set. Ordering by anything
    // this walk rewrites reshuffles documents between queries and skips some,
    // and `updatedAt` — the obvious ordering for a maintenance pass — is
    // exactly the key a write moves.
    const docs = documentStore([
      { id: "page-1", content: documentUsing("hero") },
    ]);

    await rebuildClassUsageIndex({
      documents: docs.store,
      index: indexStore().store,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    expect(docs.calls).toEqual(["find:page=1:sort=id:locale="]);
  });

  it("scans a document already in agreement WITHOUT repairing it", async () => {
    // The common case on a second run. `scanned` and `repaired` answer
    // different questions, and a rebuild that reported every document as
    // repaired would say it had rewritten a site it left alone.
    const docs = documentStore([
      { id: "page-1", content: documentUsing("hero") },
    ]);
    const index = indexStore([
      {
        id: "r1",
        scope: "collection",
        entity: "pages",
        entityKey: "page-1",
        field: "content",
        locale: "",
        variant: "published",
        classId: "hero",
      },
    ]);

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index: index.store,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    expect(report).toEqual({
      scanned: 1,
      repaired: 0,
      undetermined: 0,
      orphansRemoved: 0,
    });
    expect(index.calls).toEqual([]);
  });

  it("counts a document it could not read whole as undetermined", async () => {
    // Reported apart from `scanned` because the two mean opposite things to a
    // caller deciding whether a class is safe to delete: a scanned document
    // answered, and one of these did not.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`c${i}`],
    }));
    const docs = documentStore([
      {
        id: "page-1",
        content: { formatVersion: 1, kind: "page", nodes: many },
      },
    ]);

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index: indexStore().store,
      collection: "pages",
      field: "content",
      limits: { ...DEFAULT_LIMITS, maxNodes: 5 },
    });

    expect(report).toEqual({
      scanned: 1,
      repaired: 1,
      undetermined: 1,
      orphansRemoved: 0,
    });
  });

  it("skips an item it cannot read an id out of, rather than failing the walk", async () => {
    // Persisted data arrives unvalidated. Losing the whole rebuild over one
    // unreadable row would leave every LATER document stale, and the later ones
    // are the ones nobody knows to look at.
    const docs = documentStore([
      null,
      { noId: true },
      { id: "page-1", content: documentUsing("hero") },
    ]);
    const index = indexStore();

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index: index.store,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    expect(report).toEqual({
      scanned: 1,
      repaired: 1,
      undetermined: 0,
      orphansRemoved: 0,
    });
    expect(index.calls).toEqual(["create:page-1:hero"]);
  });

  it("refuses to report a pass whose walk it could not finish", async () => {
    // The guard running out means documents after that point were never read.
    // A report reads as a completed pass and its numbers are the same numbers a
    // complete run would produce, so returning one would record a successful
    // rebuild over a site only partly walked.
    const endless: ClassUsageDocumentStore = {
      find: async () => ({ items: [], meta: { hasNext: true } }),
      exists: async () => false,
    };

    await expect(
      rebuildClassUsageIndex({
        documents: endless,
        index: indexStore().store,
        collection: "pages",
        field: "content",
        // Not localized, which is what the empty string means here.
        locale: "",
        variant: "published",
      })
    ).rejects.toThrow(/stopped after \d+ pages/);
  });
});

describe("the locale a rebuild reads under", () => {
  it("asks the document store for the SAME locale the rows are filed under", async () => {
    // The Direct API resolves a localized field from the query's locale. Filing
    // rows under one locale while reading another records one translation's
    // classes as another's — and removes the rows for classes only the real
    // translation uses, which is the under-count that permits deleting a class
    // a page still renders.
    const docs = documentStore([
      { id: "page-1", content: documentUsing("hero") },
    ]);
    const index = indexStore();

    await rebuildClassUsageIndex({
      documents: docs.store,
      index: index.store,
      collection: "pages",
      field: "content",
      locale: "fr",
      variant: "published",
    });

    expect(docs.calls).toEqual(["find:page=1:sort=id:locale=fr"]);
    expect(index.calls).toEqual(["create:page-1:hero"]);
  });
});

describe("rows whose document no longer exists", () => {
  it("removes them, and counts them apart from repairs", async () => {
    // A document deleted through a path that bypassed maintenance never appears
    // in the walk, so its rows survive a rebuild that reports success. The
    // class it referenced then reads as used by a document nobody can open.
    const docs = documentStore([
      { id: "page-1", content: documentUsing("hero") },
    ]);
    const rows = [
      {
        id: "r1",
        scope: "collection",
        entity: "pages",
        entityKey: "page-1",
        field: "content",
        locale: "",
        variant: "published",
        classId: "hero",
      },
      {
        id: "r9",
        scope: "collection",
        entity: "pages",
        entityKey: "deleted-page",
        field: "content",
        locale: "",
        variant: "published",
        classId: "ghost",
      },
    ];
    const calls: string[] = [];
    const index: ClassUsageIndexStore = {
      find: async args => {
        const key = args.where.entityKey?.equals;
        // The sweep asks WITHOUT an entityKey; maintenance asks with one.
        return {
          items:
            key === undefined ? rows : rows.filter(r => r.entityKey === key),
          meta: { hasNext: false },
        };
      },
      create: async () => ({}),
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    // `page-1` was seen and agreed, so nothing was repaired. `deleted-page` was
    // never seen, so its row went.
    expect(report).toEqual({
      scanned: 1,
      repaired: 0,
      undetermined: 0,
      orphansRemoved: 1,
    });
    expect(calls).toEqual(["delete:r9"]);
  });
});

describe("a document the walk missed but which still exists", () => {
  it("keeps its rows rather than sweeping them as orphans", async () => {
    // The walk pages by OFFSET over a collection other writers can change, so
    // a live document can be absent from the visited set through no fault of
    // its own: deleting one ahead of the cursor shifts a later document behind
    // the next offset. Sweeping it would delete the rows of a document the
    // site still serves, which under-counts and permits deleting a class it
    // renders.
    const rows = [
      {
        id: "r5",
        scope: "collection",
        entity: "pages",
        entityKey: "shifted-page",
        field: "content",
        locale: "",
        variant: "published",
        classId: "hero",
      },
    ];
    const deletes: string[] = [];
    const index: ClassUsageIndexStore = {
      find: async args => ({
        items: args.where.entityKey?.equals === undefined ? rows : [],
        meta: { hasNext: false },
      }),
      create: async () => ({}),
      delete: async args => {
        deletes.push(args.id);
        return {};
      },
    };

    // The walk returns nothing — the document was shifted past the cursor —
    // but the store still has it.
    const documents: ClassUsageDocumentStore = {
      find: async () => ({ items: [], meta: { hasNext: false } }),
      exists: async ({ id }) => id === "shifted-page",
    };

    const report = await rebuildClassUsageIndex({
      documents,
      index,
      collection: "pages",
      field: "content",
      // Not localized, which is what the empty string means here.
      locale: "",
      variant: "published",
    });

    expect(report.orphansRemoved).toBe(0);
    expect(deletes).toEqual([]);
  });
});
