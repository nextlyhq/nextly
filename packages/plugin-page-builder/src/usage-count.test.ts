/**
 * What "used on N pages" counts, and what it admits it does not know.
 *
 * Two properties decide whether the number can be shown to an author. It has to
 * count DOCUMENTS — a page using a component in two languages is one page — and
 * it has to say when it is a FLOOR, because a short answer is short in the
 * direction that reads as reassuring.
 *
 * It is a floor for three reasons and only ONE of them is about the component
 * being counted: this read reached its cap. The other two are properties of the
 * index — a document nothing could read whole, and a scope nothing has walked —
 * and they are resolved once for a whole screen and handed in. Those live in
 * `usage-index-health`; what is tested here is that a count refuses to be
 * called complete when they say the index is not.
 *
 * @module usage-count.test
 */
import { describe, expect, it } from "vitest";

import { classUsageIndex } from "./class-usage-reconcile";
import { componentUsageIndex } from "./component-usage";
import {
  countDocumentsUsing,
  listDocumentsUsingEach,
  USAGE_ROW_PAGES_MAX,
  type UsageRowReader,
} from "./usage-count";
import type { GroupedUsageReader } from "./usage-index";
import type { UsageIndexHealth } from "./usage-index-health";

/** An index with nothing wrong with it: whole, and known to be. */
const WHOLE: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
};

/**
 * A grouped reader over ONE collection, answering a fixed document result and
 * recording what it was asked.
 *
 * The count asks two questions — which collections hold a reference, then the
 * documents in each — so the fake answers the first with a single collection
 * and the second with `answer`. `bucketCount` stands for how many document
 * buckets that one collection returns.
 */
function reader(answer: { bucketCount: number; truncated: boolean }) {
  return routedReader({
    collections: { buckets: ["pages"], truncated: false },
    perCollection: { pages: answer },
  });
}

/**
 * A grouped reader over several collections.
 *
 * `collections` answers the grouping by collection; `perCollection` answers
 * the grouping by document for each, keyed by the collection's name. A read
 * for a collection this was not told about answers nothing, loudly.
 */
function routedReader(answers: {
  collections: { buckets: readonly (string | null)[]; truncated: boolean };
  perCollection: Record<string, { bucketCount: number; truncated: boolean }>;
}) {
  const asked: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }[] = [];
  // Document ids are minted PER collection, so two collections each holding
  // one document both hold `doc-0` — which is the collision this exists to
  // model, and why an unfiltered read below folds them.
  const docsIn = (answer: { bucketCount: number }) =>
    Array.from({ length: answer.bucketCount }, (_, i) => `doc-${i}`);
  const read: GroupedUsageReader = async args => {
    asked.push(args);
    if (args.groupBy === "entity") return answers.collections;
    const entity = args.where.entity?.equals;
    if (entity === undefined) {
      // Grouped by id across every collection at once, as a real database
      // answers it: the same id in two collections is ONE bucket. A count
      // asking this way gets the folded number, which is the defect.
      const all = Object.values(answers.perCollection);
      return {
        buckets: [...new Set(all.flatMap(docsIn))],
        truncated: all.some(a => a.truncated),
      };
    }
    const answer = answers.perCollection[entity];
    if (answer === undefined) throw new Error(`no answer for ${entity}`);
    return { buckets: docsIn(answer), truncated: answer.truncated };
  };
  return { read, asked };
}

describe("counting the documents that use something", () => {
  it("groups by the DOCUMENT, so one page counts once however many rows it has", async () => {
    // The index files a row per field, per locale and per stored variant. A
    // count that read rows would report one page as several, and would climb
    // whenever somebody added a translation — a number that grows while the
    // usage does not.
    const { read, asked } = reader({ bucketCount: 2, truncated: false });

    const count = await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    // By collection first, then by document WITHIN it — the pair is what
    // identifies a document once one index spans several collections.
    expect({ count, groupedBy: asked.map(a => a.groupBy) }).toEqual({
      count: { documents: 2, complete: true },
      groupedBy: ["entity", "entityKey"],
    });
  });

  it("never re-asks the index-wide health, which was resolved for the screen", async () => {
    // The index-wide half of `complete` is the same answer for every component
    // in a library, so asking it here would issue one duplicate query per tile.
    // A hundred-component screen paid a hundred of them to learn one fact.
    //
    // What this component DOES spend is one query to learn which collections
    // reference it and one per collection found — and every one of those is
    // about this component, not about the index.
    const { read, asked } = reader({ bucketCount: 1, truncated: false });

    await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    expect(asked.map(a => a.groupBy)).toEqual(["entity", "entityKey"]);
    // And the second is scoped to the collection the first named.
    expect(asked[1]?.where.entity).toEqual({ equals: "pages" });
  });

  it("counts a document in EACH collection when two share an id", async () => {
    // Ids are minted per collection, so a restored or imported record can give
    // `pages` and `posts` a document with the same id. Grouped by id alone they
    // are one bucket, and the count reads one document where there are two —
    // below the truth, while everything else about the index says exact.
    const { read } = routedReader({
      collections: { buckets: ["pages", "posts"], truncated: false },
      perCollection: {
        pages: { bucketCount: 1, truncated: false },
        posts: { bucketCount: 1, truncated: false },
      },
    });

    const count = await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    expect(count).toEqual({ documents: 2, complete: true });
  });

  it("is a floor when one collection's read was cut off, whatever the others said", async () => {
    const { read } = routedReader({
      collections: { buckets: ["pages", "posts"], truncated: false },
      perCollection: {
        pages: { bucketCount: 3, truncated: false },
        posts: { bucketCount: 50, truncated: true },
      },
    });

    const count = await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    expect(count).toEqual({ documents: 53, complete: false });
  });

  it("is a floor when a row names no collection, since that document cannot be placed", async () => {
    const { read } = routedReader({
      collections: { buckets: ["pages", null], truncated: false },
      perCollection: { pages: { bucketCount: 2, truncated: false } },
    });

    const count = await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    expect(count).toEqual({ documents: 2, complete: false });
  });

  it("reports a capped answer as INCOMPLETE rather than as the total", async () => {
    // The direction that costs: a component used on thousands of pages comes
    // back as the cap, and a surface that shows it without this tells an author
    // it is barely used.
    const { read } = reader({ bucketCount: 50, truncated: true });

    expect(
      await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "header",
        health: WHOLE,
      })
    ).toEqual({ documents: 50, complete: false });
  });

  it("refuses to call an uncapped answer complete while a document is unreadable", async () => {
    // A document that exceeded its walk bound had its references DISCARDED and
    // only a marker stored, so it is missing from the reference read entirely —
    // this 0 is genuine and uncapped, drawn from a population that is short.
    const { read } = reader({ bucketCount: 0, truncated: false });

    expect(
      await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "header",
        health: { coversExistingDocuments: true, anyUndetermined: true },
      })
    ).toEqual({ documents: 0, complete: false });
  });

  it("refuses while the index does not cover documents that predate it", async () => {
    // The upgrade path. Write hooks fill the index going forward, so a site
    // that existed before this index has no rows for its existing pages — and
    // every component then reads as used by nothing, which is what an author
    // deletes on.
    const { read } = reader({ bucketCount: 0, truncated: false });

    expect(
      await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "header",
        health: { coversExistingDocuments: false, anyUndetermined: false },
      })
    ).toEqual({ documents: 0, complete: false });
  });

  it("asks only for rows that ARE references, not for the unreadable marker", async () => {
    // The component index keeps a marker beside its references, told apart by
    // `kind`. It stores an empty id today, so matching on the id alone happens
    // to exclude it — correct by accident, and only until the marker carries
    // something else.
    const { read, asked } = reader({ bucketCount: 1, truncated: false });

    await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
      health: WHOLE,
    });

    expect(asked[0]?.where).toEqual({
      kind: { equals: "reference" },
      componentId: { equals: "header" },
    });
  });

  it("asks the CLASS index its own question, through the same rule", async () => {
    // The control on the predicate above: an index whose rows carry nothing
    // beside the reference asks about the reference alone. Without this, a
    // hardcoded component predicate would satisfy every case here.
    const { read, asked } = reader({ bucketCount: 3, truncated: false });

    const count = await countDocumentsUsing({
      index: classUsageIndex,
      read,
      referenceId: "hero",
      health: WHOLE,
    });

    expect({ count, where: asked[0]?.where }).toEqual({
      count: { documents: 3, complete: true },
      where: { classId: { equals: "hero" } },
    });
  });

  it("answers an empty id without spending a query", async () => {
    // Nothing can reference what is not a reference, so this is COMPLETE rather
    // than merely zero — and it must not cost a read to say so.
    const { read, asked } = reader({ bucketCount: 9, truncated: true });

    expect({
      count: await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "",
        health: WHOLE,
      }),
      asked: asked.length,
    }).toEqual({ count: { documents: 0, complete: true }, asked: 0 });
  });
});

/** A class index row, as the Direct API answers one. */
const classRow = (
  classId: string,
  entity: string | null,
  entityKey: string
) => ({
  scope: "collection",
  entity,
  entityKey,
  field: "content",
  locale: "",
  variant: "published",
  classId,
});

/**
 * A row reader answering `rows` a page of `size` at a time, recording every
 * read it was asked for.
 */
function rowReader(rows: readonly Record<string, unknown>[], size = 500) {
  const asked: Parameters<UsageRowReader>[0][] = [];
  const read: UsageRowReader = async args => {
    asked.push(args);
    const start = (args.page - 1) * size;
    return {
      items: rows.slice(start, start + size),
      hasNext: rows.length > start + size,
    };
  };
  return { read, asked };
}

describe("listDocumentsUsingEach", () => {
  const ids = Array.from({ length: 50 }, (_, n) => `c-${n}`);
  const rows = ids.flatMap(id => [
    classRow(id, "pages", "p1"),
    // The same page again, in another language: one document, not two.
    { ...classRow(id, "pages", "p1"), locale: "fr" },
    classRow(id, "components", "k1"),
  ]);

  it("reads every id asked for in the same number of queries as one", async () => {
    const one = rowReader(rows);
    const fifty = rowReader(rows);
    await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: one.read,
      referenceIds: ["c-0"],
      health: WHOLE,
    });
    await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: fifty.read,
      referenceIds: ids,
      health: WHOLE,
    });
    expect({ one: one.asked.length, fifty: fifty.asked.length }).toEqual({
      one: 1,
      fifty: 1,
    });
    expect(fifty.asked[0]?.where).toEqual({ classId: { in: ids } });
  });

  it("lists each id's distinct documents by collection", async () => {
    const { read } = rowReader(rows);
    const found = await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: read,
      referenceIds: ["c-1", "c-unused"],
      health: WHOLE,
    });
    expect(found.get("c-1")).toEqual({
      collections: [
        { collection: "pages", documents: ["p1"] },
        { collection: "components", documents: ["k1"] },
      ],
      complete: true,
    });
    expect(found.get("c-unused")).toEqual({ collections: [], complete: true });
  });

  it("is a floor for every id once the reads reach their cap", async () => {
    // Stops after a bounded number of pages, however many rows remain.
    const many = Array.from({ length: 30 }, (_, n) =>
      classRow("c-0", "pages", `p${n}`)
    );
    const { read, asked } = rowReader(many, 2);
    const found = await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: read,
      referenceIds: ["c-0"],
      health: WHOLE,
    });
    expect(asked).toHaveLength(USAGE_ROW_PAGES_MAX);
    expect(found.get("c-0")?.complete).toBe(false);
  });

  it("is a floor for an id one of whose rows names no collection", async () => {
    const { read } = rowReader([classRow("c-0", null, "p1")]);
    const found = await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: read,
      referenceIds: ["c-0"],
      health: WHOLE,
    });
    expect(found.get("c-0")).toEqual({ collections: [], complete: false });
  });

  it("agrees with the single count, which derives from the same listing", async () => {
    const { read } = rowReader(rows);
    const found = await listDocumentsUsingEach({
      index: classUsageIndex,
      rows: read,
      referenceIds: ["c-2"],
      health: WHOLE,
    });
    const counted = await countDocumentsUsing({
      index: classUsageIndex,
      read: async args =>
        args.groupBy === "entity"
          ? { buckets: ["pages", "components"], truncated: false }
          : {
              buckets: [args.where.entity?.equals === "pages" ? "p1" : "k1"],
              truncated: false,
            },
      referenceId: "c-2",
      health: WHOLE,
    });
    expect(counted.documents).toBe(
      found.get("c-2")?.collections.reduce((n, c) => n + c.documents.length, 0)
    );
  });
});
