/**
 * What "used on N pages" counts, and what it admits it does not know.
 *
 * Two properties decide whether the number can be shown to an author. It has to
 * count DOCUMENTS — a page using a component in two languages is one page — and
 * it has to say when it stopped early, because a capped answer is short in the
 * direction that reads as reassuring.
 *
 * @module usage-count.test
 */
import { describe, expect, it } from "vitest";

import { componentUsageIndex } from "./component-usage";
import { classUsageIndex } from "./class-usage-reconcile";
import { countDocumentsUsing, type GroupedUsageReader } from "./usage-count";

/** A grouped reader answering a fixed result, and recording what it was asked. */
function reader(answer: { bucketCount: number; truncated: boolean }) {
  const asked: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }[] = [];
  const read: GroupedUsageReader = async args => {
    asked.push(args);
    return answer;
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
    });

    expect({ count, groupedBy: asked.map(a => a.groupBy) }).toEqual({
      count: { documents: 2, complete: true },
      groupedBy: ["entityKey"],
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
});
