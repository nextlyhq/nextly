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
  forgetDeletedDocument,
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
  // The live row rather than a pending draft: a collection with drafts holds
  // two documents under one id and they are separate subjects.
  variant: "published",
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
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    expect(report).toEqual({ inserted: 2, removed: 0, undetermined: false });
    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope,variant",
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
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    expect(report).toEqual({ inserted: 0, removed: 0, undetermined: false });
    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope,variant",
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
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("new"),
    });

    expect(calls).toEqual([
      "find:sort=id:where=entity,entityKey,field,locale,scope,variant",
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
      "find:sort=id:where=entity,entityKey,field,locale,scope,variant",
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
        limits: DEFAULT_LIMITS,
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
        limits: DEFAULT_LIMITS,
        store,
        subject: page,
        document: documentUsing("hero"),
      })
    ).rejects.toThrow(
      /has entityKey="page-2" but the query asked for "page-1"/
    );
  });
});

describe("a row written before the locale column existed", () => {
  it("is read as the non-localized sentinel rather than discarded", async () => {
    // The column was ADDED to a live table, so a new column is nullable and
    // rows written before it carry NULL. Rejecting a non-string locale would
    // make those rows invisible to every query AND to the sweep, so they could
    // never be read, reconciled or removed — the cache would hold rows nothing
    // could ever repair.
    const calls: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async () => ({
        // No `locale` key at all, which is what a legacy row looks like once
        // the driver has mapped a NULL column.
        items: [
          {
            id: "r1",
            scope: "collection",
            entity: "pages",
            entityKey: "page-1",
            field: "content",
            variant: "published",
            classId: "hero",
          },
        ],
        meta: { hasNext: false },
      }),
      create: async args => {
        calls.push(`create:${String(args.data.classId)}`);
        return {};
      },
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };

    // The document still references `hero`, so a correctly-read legacy row
    // needs no write at all. Were it discarded, the row would be invisible and
    // `hero` would be inserted a second time.
    const report = await maintainClassUsage({
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("hero"),
    });

    expect(report).toEqual({ inserted: 0, removed: 0, undetermined: false });
    expect(calls).toEqual([]);
  });
});

describe("a row carrying a variant outside the two the index models", () => {
  it("is SKIPPED rather than read as one of them", async () => {
    // `variant` partitions the index the way `scope` does: every query binds
    // one value, so a row carrying anything else belongs to a family no real
    // subject can name. Reading it as a row for the requested variant would be
    // worse than ignoring it — the reconciler would see a reference the
    // document does not make and delete a row that describes something else.
    //
    // Skipped rather than deleted, for the reason an unreadable row is: nothing
    // here knows enough about it to remove it.
    const calls: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async () => ({
        items: [
          // Would be a valid row for this subject in every column but one.
          { ...page, id: "r1", variant: "preview", classId: "hero" },
        ],
        meta: { hasNext: false },
      }),
      create: async args => {
        calls.push(`create:${String(args.data.classId)}`);
        return {};
      },
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };

    const report = await maintainClassUsage({
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("hero"),
    });

    // `hero` is inserted BECAUSE the unreadable row was not counted as one,
    // and `r1` is left alone. Had the row been read, this would be a no-op —
    // which is what makes the insert the evidence rather than the absence of a
    // delete.
    expect(report).toEqual({ inserted: 1, removed: 0, undetermined: false });
    expect(calls).toEqual(["create:hero"]);
  });
});

describe("a subject whose rows span several pages", () => {
  it("collects every page before reconciling", async () => {
    // The paging bound is a runaway guard and its VALUE asserts nothing about
    // the data — deliberately, after three versions that each encoded an
    // expectation and each rejected the state the walk existed to repair. What
    // must hold is that the walk continues past the first page: reconciling a
    // partial row set reads every unread row as a reference the document has
    // dropped, and deletes it.
    const pages = [
      [{ ...page, id: "r1", classId: "hero" }],
      [{ ...page, id: "r2", classId: "card" }],
      [{ ...page, id: "r3", classId: "stale" }],
    ];
    const deletes: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async args => ({
        items: pages[args.page - 1] ?? [],
        meta: { hasNext: args.page < pages.length },
      }),
      create: async () => ({}),
      delete: async args => {
        deletes.push(args.id);
        return {};
      },
    };

    const report = await maintainClassUsage({
      limits: DEFAULT_LIMITS,
      store,
      subject: page,
      document: documentUsing("hero", "card"),
    });

    // Only the row from the LAST page is stale. A walk that stopped early would
    // have reported `card` as an insert and never seen `stale` at all.
    expect(report).toEqual({ inserted: 0, removed: 1, undetermined: false });
    expect(deletes).toEqual(["r3"]);
  });
});

describe("forgetting a document that was deleted", () => {
  /**
   * A store holding rows for ONE document spread across the three columns a
   * delete must ignore, plus a row belonging to a different document.
   *
   * The foreign row is what makes the predicate assertions mean anything: a
   * query that bound nothing at all would also return every row of the
   * deleted document, and would pass a test that only counted deletions.
   */
  function storeWithRows() {
    const all = [
      { id: "r1", field: "content", locale: "", variant: "published" },
      { id: "r2", field: "content", locale: "", variant: "draft" },
      { id: "r3", field: "content", locale: "de", variant: "published" },
      { id: "r4", field: "sidebar", locale: "en", variant: "draft" },
    ].map(r => ({
      ...r,
      scope: "collection",
      entity: "pages",
      entityKey: "page-1",
      classId: "hero",
    }));
    const foreign = {
      id: "r9",
      scope: "collection",
      entity: "pages",
      entityKey: "page-2",
      field: "content",
      locale: "",
      variant: "published",
      classId: "hero",
    };

    const calls: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async args => {
        calls.push(`find:${Object.keys(args.where).sort().join(",")}`);
        // Answered as a real store would: only the rows matching every bound
        // predicate. A fake returning everything would let a query that
        // dropped `entityKey` pass while deleting another document's rows.
        const items = [...all, foreign].filter(row =>
          Object.entries(args.where).every(
            ([column, predicate]) =>
              (row as unknown as Record<string, unknown>)[column] ===
              predicate.equals
          )
        );
        return { items, meta: { hasNext: false } };
      },
      create: async () => ({}),
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };
    return { store, calls };
  }

  it("removes every subject's rows, whatever field, locale or variant they name", async () => {
    // A delete removes the document in every language and both lifecycle states
    // at once. Binding any of those three columns would leave the rows that did
    // not match behind, counting towards their classes with no document left to
    // reconcile them against and no sweep that visits them.
    const { store, calls } = storeWithRows();

    const result = await forgetDeletedDocument({
      store,
      scope: "collection",
      entity: "pages",
      entityKey: "page-1",
    });

    expect(result).toEqual({ removed: 4 });
    expect(calls).toEqual([
      // Bound on the DOCUMENT and on nothing else.
      "find:entity,entityKey,scope",
      "delete:r1",
      "delete:r2",
      "delete:r3",
      "delete:r4",
    ]);
  });

  it("leaves another document's rows alone", async () => {
    // The same store holds a row for `page-2`. Deleting `page-1` must not
    // touch it — an over-broad query here removes usage a live page still has.
    const { store, calls } = storeWithRows();

    await forgetDeletedDocument({
      store,
      scope: "collection",
      entity: "pages",
      entityKey: "page-1",
    });

    expect(calls).not.toContain("delete:r9");
  });

  it("reads every PAGE before deleting any row", async () => {
    // These are offset queries, so deleting while paging shifts later rows
    // behind the cursor and a row is skipped — surviving the document it
    // belonged to and counting towards its class for ever.
    //
    // The fixture spans TWO pages deliberately. On a single page, deleting as
    // each page arrives produces exactly the same call order as reading
    // everything first, so a one-page fixture asserts nothing: it passed
    // against a per-page delete when that was tried as a break.
    const calls: string[] = [];
    const rowsByPage: Record<number, string[]> = { 1: ["r1", "r2"], 2: ["r3"] };
    const store: ClassUsageIndexStore = {
      find: async args => {
        calls.push(`find:page=${args.page}`);
        const ids = rowsByPage[args.page] ?? [];
        return {
          items: ids.map(id => ({
            id,
            scope: "collection",
            entity: "pages",
            entityKey: "page-1",
            field: "content",
            locale: "",
            variant: "published",
            classId: "hero",
          })),
          meta: { hasNext: args.page < 2 },
        };
      },
      create: async () => ({}),
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };

    const result = await forgetDeletedDocument({
      store,
      scope: "collection",
      entity: "pages",
      entityKey: "page-1",
    });

    expect(result).toEqual({ removed: 3 });
    // Both reads land before the first removal. Interleaving them is the
    // failure this exists to catch.
    expect(calls).toEqual([
      "find:page=1",
      "find:page=2",
      "delete:r1",
      "delete:r2",
      "delete:r3",
    ]);
  });

  it("removes nothing when the document owned no rows", async () => {
    // A document with no blocks field, or one whose rows were never written.
    // The absence is not an error and must not be reported as one.
    const { store, calls } = storeWithRows();

    const result = await forgetDeletedDocument({
      store,
      scope: "collection",
      entity: "pages",
      entityKey: "never-indexed",
    });

    expect(result).toEqual({ removed: 0 });
    expect(calls.filter(c => c.startsWith("delete:"))).toEqual([]);
  });

  it("removes a LEGACY row whose variant is unreadable", async () => {
    // A row written before the `variant` column existed, or left NULL by a
    // restore, is rejected by the reconciler's reader — correctly, because that
    // walk binds a variant and such a row belongs to no subject it could be
    // compared against. It is therefore reachable by no reconciliation and by
    // no sweep, so if the delete spared it too it would outlive its document
    // and count towards its class for ever with nothing able to remove it.
    const deleted: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async () => ({
        items: [
          {
            id: "legacy",
            scope: "collection",
            entity: "pages",
            entityKey: "page-1",
            field: "content",
            // The two columns a legacy row is missing. Neither is bound by this
            // query, and neither is needed to know the row belongs to a
            // document that is gone.
            locale: null,
            variant: null,
            classId: "hero",
          },
        ],
        meta: { hasNext: false },
      }),
      create: async () => ({}),
      delete: async args => {
        deleted.push(args.id);
        return {};
      },
    };

    const result = await forgetDeletedDocument({
      store,
      scope: "collection",
      entity: "pages",
      entityKey: "page-1",
    });

    expect(result).toEqual({ removed: 1 });
    expect(deleted).toEqual(["legacy"]);
  });

  it("RAISES on this document's row that carries no readable id", async () => {
    // `afterRead` may reshape a list response and the Direct API applies it
    // even for a trusted caller, so a host projecting this plugin's own index
    // collection can drop the column the rows are addressed by. Skipping such a
    // row reports a clean deletion that did not happen — and because the
    // document is gone, no reconciliation visits it again and it counts towards
    // its class for ever.
    const deleted: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async () => ({
        items: [
          {
            // Addressable, and removed.
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
            // This document's row, with the id projected away.
            scope: "collection",
            entity: "pages",
            entityKey: "page-1",
            field: "content",
            locale: "",
            variant: "published",
            classId: "card",
          },
        ],
        meta: { hasNext: false },
      }),
      create: async () => ({}),
      delete: async args => {
        deleted.push(args.id);
        return {};
      },
    };

    await expect(
      forgetDeletedDocument({
        store,
        scope: "collection",
        entity: "pages",
        entityKey: "page-1",
      })
    ).rejects.toThrow(/no readable id/);
    // Nothing was deleted: the walk reads every page before removing anything,
    // so the failure is reported before a partial cleanup is begun.
    expect(deleted).toEqual([]);
  });

  it("REFUSES to delete a row the query did not ask for", async () => {
    // If a misbound query returns a foreign row, deleting it removes usage
    // belonging to a document that still exists. The refusal must raise rather
    // than skip, or a misbound query would quietly do damage on every call.
    const calls: string[] = [];
    const store: ClassUsageIndexStore = {
      find: async () => ({
        items: [
          {
            id: "r9",
            scope: "collection",
            entity: "pages",
            entityKey: "page-2",
            field: "content",
            locale: "",
            variant: "published",
            classId: "hero",
          },
        ],
        meta: { hasNext: false },
      }),
      create: async () => ({}),
      delete: async args => {
        calls.push(`delete:${args.id}`);
        return {};
      },
    };

    await expect(
      forgetDeletedDocument({
        store,
        scope: "collection",
        entity: "pages",
        entityKey: "page-1",
      })
    ).rejects.toThrow(/entityKey/);
    expect(calls).toEqual([]);
  });
});
