/**
 * The index-wide facts a screen resolves once, and what they cost.
 *
 * Both are the same answer for every component in a library, so the thing being
 * protected here is that they are asked ONCE — a per-component version issues
 * the identical query per tile, against the pool the index exists to keep free.
 *
 * @module usage-index-health.test
 */
import { describe, expect, it } from "vitest";

import { componentUsageIndex } from "./component-usage";
import type { GroupedUsageReader } from "./usage-index";
import { indexIsWhole, readUsageIndexHealth } from "./usage-index-health";

function reader(markers: { bucketCount: number; truncated: boolean }) {
  const asked: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }[] = [];
  const read: GroupedUsageReader = async args => {
    asked.push(args);
    return markers;
  };
  return { read, asked };
}

describe("reading how much of the index is there", () => {
  it("asks the marker question of the WHOLE index, naming no component", async () => {
    // A marker names no component, so "which unreadable documents reference
    // this one" has no answer — narrowing this by a reference would ask it
    // anyway and get a confident empty.
    const { read, asked } = reader({ bucketCount: 1, truncated: false });

    await readUsageIndexHealth({ index: componentUsageIndex, read });

    expect(asked).toEqual([
      {
        where: {
          kind: { equals: "unreadable" },
          componentId: { equals: "" },
        },
        groupBy: "entityKey",
      },
    ]);
  });

  it("spends ONE query however many components a screen holds", async () => {
    // The property the whole module exists for: this is read once and handed
    // to every tile, rather than re-derived inside each count.
    const { read, asked } = reader({ bucketCount: 0, truncated: false });

    await readUsageIndexHealth({ index: componentUsageIndex, read });

    expect(asked.length).toBe(1);
  });

  it("reports an unreadable document, so every count becomes a floor", async () => {
    const { read } = reader({ bucketCount: 2, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
    });

    expect(health.anyUndetermined).toBe(true);
  });

  it("says the index does NOT cover existing documents, because nothing fills it", async () => {
    // Not a reading of any database: no mechanism backfills the index yet, so
    // there is no site on which this could honestly be true. A site that
    // installed the plugin before creating content IS fully covered and still
    // answers false — the plugin cannot tell the two apart, and the
    // conservative reading is the one that does not invite a delete.
    const { read } = reader({ bucketCount: 0, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
    });

    expect(health.coversExistingDocuments).toBe(false);
  });

  it("is therefore never WHOLE today, even with no markers at all", async () => {
    // The consequence, asserted so it cannot be read as an oversight. Until a
    // backfill exists, every count is a floor — which is the honest answer and
    // the one this flag was added to be able to give.
    const { read } = reader({ bucketCount: 0, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
    });

    expect(indexIsWhole(health)).toBe(false);
  });

  it("would be whole once both halves are true", async () => {
    // The control on the rule itself, stated against values rather than a
    // read: without it, `indexIsWhole` returning false for every input would
    // satisfy every case above.
    expect(
      indexIsWhole({ coversExistingDocuments: true, anyUndetermined: false })
    ).toBe(true);
    expect(
      indexIsWhole({ coversExistingDocuments: true, anyUndetermined: true })
    ).toBe(false);
  });
});
