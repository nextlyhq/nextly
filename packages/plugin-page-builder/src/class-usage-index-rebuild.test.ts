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
      calls.push(`find:page=${args.page}:sort=${args.sort}`);
      return { items, meta: { hasNext: args.page < pages } };
    },
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
    });

    expect(report).toEqual({ scanned: 2, repaired: 2, undetermined: 0 });
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
    });

    expect(docs.calls).toEqual(["find:page=1:sort=id"]);
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
        classId: "hero",
      },
    ]);

    const report = await rebuildClassUsageIndex({
      documents: docs.store,
      index: index.store,
      collection: "pages",
      field: "content",
    });

    expect(report).toEqual({ scanned: 1, repaired: 0, undetermined: 0 });
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

    expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 1 });
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
    });

    expect(report).toEqual({ scanned: 1, repaired: 1, undetermined: 0 });
    expect(index.calls).toEqual(["create:page-1:hero"]);
  });

  it("refuses to report a pass whose walk it could not finish", async () => {
    // The guard running out means documents after that point were never read.
    // A report reads as a completed pass and its numbers are the same numbers a
    // complete run would produce, so returning one would record a successful
    // rebuild over a site only partly walked.
    const endless: ClassUsageDocumentStore = {
      find: async () => ({ items: [], meta: { hasNext: true } }),
    };

    await expect(
      rebuildClassUsageIndex({
        documents: endless,
        index: indexStore().store,
        collection: "pages",
        field: "content",
      })
    ).rejects.toThrow(/stopped after \d+ pages/);
  });
});
