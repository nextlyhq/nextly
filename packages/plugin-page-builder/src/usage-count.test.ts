/**
 * What "used on N pages" counts, and what it admits it does not know.
 *
 * Two properties decide whether the number can be shown to an author. It has to
 * count DOCUMENTS — a page using a component in two languages is one page — and
 * it has to say when it is a FLOOR, because a short answer is short in the
 * direction that reads as reassuring.
 *
 * It is a floor for two different reasons, and the second is the one a reader
 * is likely to miss. A capped read stops early and says so. A document that
 * could not be walked whole never enters the population at all: its references
 * are discarded and one marker is stored, so it is absent from every count
 * rather than wrong in one of them — and a component embedded only there reads
 * as used by nothing.
 *
 * @module usage-count.test
 */
import { describe, expect, it } from "vitest";

import { componentUsageIndex } from "./component-usage";
import {
  classUsageIndex,
  UNDETERMINED_CLASS_ID,
} from "./class-usage-reconcile";
import { countDocumentsUsing, type GroupedUsageReader } from "./usage-count";

/**
 * A grouped reader answering per QUESTION, and recording what it was asked.
 *
 * Two questions reach it — which rows reference the subject, and whether any
 * document is unreadable — and a helper answering both with one fixed result
 * cannot tell them apart. It would report markers wherever it reported
 * references, which is the state that makes every count incomplete and would
 * have let the reference cases below pass while asserting nothing about the
 * marker read.
 *
 * `undetermined` therefore defaults to ABSENT: the ordinary index, where the
 * count is whole. A case that wants the other state says so.
 */
function reader(
  answer: { bucketCount: number; truncated: boolean },
  undetermined: { bucketCount: number; truncated: boolean } = {
    bucketCount: 0,
    truncated: false,
  }
) {
  const asked: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }[] = [];
  const read: GroupedUsageReader = async args => {
    asked.push(args);
    // Discriminated by the QUESTION rather than by call order, so a change to
    // the order of the two reads cannot silently swap the answers.
    return isUndeterminedQuestion(args.where) ? undetermined : answer;
  };
  return { read, asked };
}

/** Whether a recorded question is the marker one, for either index. */
function isUndeterminedQuestion(
  where: Record<string, { equals: string }>
): boolean {
  return (
    where.kind?.equals === "unreadable" ||
    where.classId?.equals === UNDETERMINED_CLASS_ID
  );
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
    });

    // BOTH reads group by the document, and the assertion names both rather
    // than the first: the marker read exists to decide completeness, and one
    // grouped by anything else would count marker ROWS instead of the
    // documents that wrote them.
    expect({ count, groupedBy: asked.map(a => a.groupBy) }).toEqual({
      count: { documents: 2, complete: true },
      groupedBy: ["entityKey", "entityKey"],
    });
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
      })
    ).toEqual({ documents: 50, complete: false });
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
      }),
      asked: asked.length,
    }).toEqual({ count: { documents: 0, complete: true }, asked: 0 });
  });
  it("reports a floor when a document in the index could not be read whole", async () => {
    // THE case this module's completeness flag exists for, and the one a cap
    // cannot stand in for. A document that exceeded its walk bound had its
    // references DISCARDED and only a marker stored, so it is missing from the
    // reference read entirely — the count below is a genuine, uncapped 0 drawn
    // from a population that is itself short.
    //
    // Answered `{ documents: 0, complete: true }` before this, which is the
    // reading that tells an author a component embedded in that document is
    // used nowhere. That is what a delete acts on.
    const { read } = reader(
      { bucketCount: 0, truncated: false },
      { bucketCount: 1, truncated: false }
    );

    expect(
      await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "header",
      })
    ).toEqual({ documents: 0, complete: false });
  });

  it("asks about unreadable documents ANYWHERE, not ones referencing this", async () => {
    // The discrimination, and the reason the predicate takes no reference. A
    // marker names no component, so "which unreadable documents reference this"
    // has no answer — narrowing the marker question by `componentId` would ask
    // it anyway and get a confident empty, which is the original defect wearing
    // a second read.
    const { read, asked } = reader({ bucketCount: 2, truncated: false });

    await countDocumentsUsing({
      index: componentUsageIndex,
      read,
      referenceId: "header",
    });

    expect(asked[1]?.where).toEqual({
      kind: { equals: "unreadable" },
      componentId: { equals: "" },
    });
  });

  it("asks the CLASS index for ITS marker, which is a class id nothing may wear", async () => {
    // The control on the marker predicate, matching the one on the reference
    // predicate above: the two indexes make the row disjoint by different
    // means — a `kind` column here, an over-long id there — and a hardcoded
    // component clause would satisfy the component case alone.
    const { read, asked } = reader({ bucketCount: 1, truncated: false });

    await countDocumentsUsing({
      index: classUsageIndex,
      read,
      referenceId: "hero",
    });

    expect(asked[1]?.where).toEqual({
      classId: { equals: UNDETERMINED_CLASS_ID },
    });
  });

  it("does not spend the marker read when the answer is ALREADY a floor", async () => {
    // A capped answer is incomplete whatever the markers say, so the second
    // read cannot change it and is not made. Asserted because the count is
    // rendered beside every tile in the library, where an unnecessary query is
    // paid once per component per render.
    const { read, asked } = reader(
      { bucketCount: 50, truncated: true },
      { bucketCount: 3, truncated: false }
    );

    expect({
      count: await countDocumentsUsing({
        index: componentUsageIndex,
        read,
        referenceId: "header",
      }),
      reads: asked.length,
    }).toEqual({ count: { documents: 50, complete: false }, reads: 1 });
  });
});
