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
  blockDocumentFields,
  forgetClassUsage,
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
      calls.push(`find:sort=${args.sort}`);
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

describe("recognising a field that could hold a block document", () => {
  it("names the block-shaped fields and ignores the rest", () => {
    // The cheap filter a global hook leans on. It sees every write in the
    // application, so the common case must be answered without consulting the
    // configuration at all.
    expect(
      blockDocumentFields({
        title: "Home",
        slug: "home",
        content: documentUsing("hero"),
        meta: { nodes: "not an array" },
      })
    ).toEqual(["content"]);
  });

  it("recognises a document stored as a JSON string", () => {
    // The column is `json`, and a dialect can hand it back as text. A filter
    // that only recognised the parsed shape would reject every document on
    // that dialect — which reads as "nothing to index" rather than as an
    // error, and stops the index being maintained there at all.
    expect(
      blockDocumentFields({ content: JSON.stringify(documentUsing("hero")) })
    ).toEqual(["content"]);
  });

  it("names a field this write CLEARED, which holds no document to recognise", () => {
    // `null` and `undefined` are both accepted values for a blocks field, so
    // emptying one is an ordinary edit. A filter that recognised only documents
    // would never maintain that field again, and the document would go on
    // appearing to use every class it had before being emptied — so none of
    // them could ever be deleted.
    expect(blockDocumentFields({ content: null, title: "Home" })).toEqual([
      "content",
    ]);
    expect(blockDocumentFields({ content: undefined })).toEqual(["content"]);
  });

  it("says nothing about a field this write did not mention", () => {
    // An ABSENT key is not a clear. The write said nothing about that field, so
    // the stored document stands and its rows are still correct — naming it
    // would make every unrelated write re-maintain every blocks field there is.
    expect(blockDocumentFields({ title: "Home" })).toEqual([]);
  });
});

describe("maintaining one subject's rows", () => {
  it("inserts a row per reference a new document has", async () => {
    const { store, calls } = recordingStore([]);

    const report = await maintainClassUsage({
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    expect(report).toEqual({ inserted: 2, removed: 0, undetermined: false });
    expect(calls).toEqual(["find:sort=id", "create:card", "create:hero"]);
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
    expect(calls).toEqual(["find:sort=id"]);
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

    expect(calls).toEqual(["find:sort=id", "create:new", "delete:r1"]);
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
    expect(calls).toEqual(["find:sort=id", `create:${UNDETERMINED_CLASS_ID}`]);
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
    ).rejects.toThrow(/still reported more rows after \d+ pages/);
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
    ).rejects.toThrow(/belongs to collection:pages:page-2:content/);
  });
});

describe("forgetting a document that no longer exists", () => {
  it("removes every row describing it", async () => {
    // Without this a deleted page's references outlive it, and a class it was
    // the only user of never reaches zero — so the author is warned about
    // documents that are gone and can never delete the class.
    const { store, calls } = recordingStore([
      { id: "r1", classId: "hero" },
      { id: "r2", classId: "card" },
    ]);

    const report = await forgetClassUsage({ store, subject: page });

    expect(report).toEqual({ removed: 2 });
    expect(calls).toEqual(["find:sort=id", "delete:r1", "delete:r2"]);
  });
});
