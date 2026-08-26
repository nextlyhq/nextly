/**
 * Whether maintaining the index issues the right writes, in the right order,
 * against a store that records what it was asked to do.
 *
 * The store is observed rather than reimplemented: the cases assert the calls
 * the code actually made, so a test cannot go on passing after the line it
 * watches is edited.
 *
 * @module class-usage-maintenance.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";

import {
  maintainClassUsage,
  type ClassUsageIndexStore,
} from "./class-usage-maintenance";
import { UNDETERMINED_CLASS_ID } from "./class-usage-reconcile";
import type { ClassUsageSubject } from "./class-usage-reconcile";

const page: ClassUsageSubject = {
  scope: "collection",
  entity: "pages",
  entityKey: "page-1",
  field: "content",
  // Empty because this field is not localized. A localized blocks field stores
  // a document per locale, and each is its own subject.
  locale: "",
};

const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/** A store that answers from a fixed row set and records every call in order. */
function recordingStore(rows: { id: string; classId: string }[] = []) {
  const calls: string[] = [];
  const store: ClassUsageIndexStore = {
    find: async args => {
      // The predicates are recorded, not just the fact of a call. Without them
      // a dropped `where` clause is invisible to every assertion here.
      calls.push(
        `find:sort=${args.sort}:where=${Object.keys(args.where).sort().join(",")}`
      );
      return {
        items: rows.map(r => ({ ...page, ...r })),
        meta: { hasNext: false },
      };
    },
    create: async args => {
      calls.push(`create:${String(args.data.classId)}`);
      return {};
    },
    delete: async args => {
      calls.push(`delete:${args.id}`);
      return {};
    },
  };
  return { store, calls };
}

describe("maintaining one subject's rows", () => {
  it("inserts a row per reference a new document has", async () => {
    const { store, calls } = recordingStore([]);

    const report = await maintainClassUsage({
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    expect(report).toEqual({ inserted: 2, removed: 0, undetermined: false });
    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope",
      "create:card",
      "create:hero",
    ]);
  });

  it("issues NO writes when the document's references are unchanged", async () => {
    // The common case: editing a page's text changes no class references. A
    // maintenance pass that rewrote the rows anyway would move every row on
    // every save, for nothing.
    const { store, calls } = recordingStore([
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "card" },
    ]);

    const report = await maintainClassUsage({
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    expect(report).toEqual({ inserted: 0, removed: 0, undetermined: false });
    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope",
    ]);
  });

  it("inserts before it removes", async () => {
    // Between the two statements the index is read by the class library. This
    // order leaves it reporting the subject as referencing both the old class
    // and the new one — an over-count, which warns about a delete that was
    // safe. The other order reports it as referencing neither, which permits
    // a delete that was not.
    const { store, calls } = recordingStore([{ id: "r1", classId: "old" }]);

    await maintainClassUsage({
      store,
      subject: page,
      document: documentUsing("new"),
    });

    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope",
      "create:new",
      "delete:r1",
    ]);
    expect(calls.indexOf("create:new")).toBeLessThan(
      calls.indexOf("delete:r1")
    );
  });

  it("writes the marker and keeps nothing else when the document is too large", async () => {
    // The prefix it managed to read is NOT written. Reconciling against a
    // prefix removes the rows for every reference past the bound, turning
    // "could not read it all" into "references nothing".
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`c${i}`],
    }));
    const { store, calls } = recordingStore([]);

    const report = await maintainClassUsage({
      store,
      subject: page,
      document: { formatVersion: 1, kind: "page", nodes: many },
      limits: { ...DEFAULT_LIMITS, maxNodes: 5 },
    });

    expect(report).toEqual({ inserted: 1, removed: 0, undetermined: true });
    // One create, and it carries the marker rather than any id it did read.
    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope",
      `create:${UNDETERMINED_CLASS_ID}`,
    ]);
  });

  it("refuses a row set the store could not finish reporting", async () => {
    // `hasNext` comes from the store, and a walk that trusts it completely is
    // one malformed response away from running forever. Reaching the guard
    // means the row set is PARTIAL, and reconciling a partial set reads every
    // unread row as a reference the document has dropped.
    const store: ClassUsageIndexStore = {
      find: async () => ({ items: [], meta: { hasNext: true } }),
      create: async () => ({}),
      delete: async () => ({}),
    };

    await expect(
      maintainClassUsage({
        store,
        subject: page,
        document: documentUsing("hero"),
      })
    ).rejects.toThrow(/stopped after \d+ pages/);
  });

  it("passes a stored row's OWN subject through, so a foreign row is refused", async () => {
    // The reconciler's mismatch guard exists to catch a query that misbound one
    // of the four subject predicates. Stamping the expected subject onto
    // whatever came back would make that guard unfalsifiable, and its removals
    // would delete another document's rows.
    const store: ClassUsageIndexStore = {
      find: async () => ({
        items: [{ ...page, entityKey: "page-2", id: "r9", classId: "hero" }],
        meta: { hasNext: false },
      }),
      create: async () => ({}),
      delete: async () => ({}),
    };

    await expect(
      maintainClassUsage({
        store,
        subject: page,
        document: documentUsing("hero"),
      })
    ).rejects.toThrow(
      /has entityKey="page-2" but the query asked for "page-1"/
    );
  });
});
