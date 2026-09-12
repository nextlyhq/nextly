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
import { backfillScopeKey } from "./usage-backfill-scope";
import { indexIsWhole, readUsageIndexHealth } from "./usage-index-health";

function reader(markers: { bucketCount: number; truncated: boolean }) {
  // `bucketCount` stands for how many marker buckets exist; the reader now
  // hands back their keys, so the fake mints that many.
  const asked: {
    where: Record<string, { equals: string }>;
    groupBy: string;
  }[] = [];
  const read: GroupedUsageReader = async args => {
    asked.push(args);
    return {
      buckets: Array.from({ length: markers.bucketCount }, (_, i) => `m-${i}`),
      truncated: markers.truncated,
    };
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

  it("says the index does NOT cover existing documents when it cannot ask", async () => {
    // A caller outside the plugin cannot assemble the scopes or the progress
    // store, so it gets the conservative answer rather than a convenience. It
    // is the honest one for a caller that genuinely cannot tell, and it is the
    // direction that does not invite a delete.
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

  it("reports the index COVERED once every scope is recorded", async () => {
    // The whole point of the backfill: a site whose scopes have all been walked
    // gets an exact count rather than a floor.
    const { read } = reader({ bucketCount: 0, truncated: false });
    const scope = {
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    } as const;

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      backfill: {
        scopes: async () => [scope],
        state: {
          completed: async () => new Set([backfillScopeKey(scope)]),
          record: async () => undefined,
        },
        unreachable: async () => false,
      },
    });

    expect({ health, whole: indexIsWhole(health) }).toEqual({
      health: { coversExistingDocuments: true, anyUndetermined: false },
      whole: true,
    });
  });

  it("is NOT covered while one scope is still outstanding", async () => {
    // The control on the case above: without it, "covered whenever a backfill
    // was supplied" would satisfy it while reporting a half-walked site whole.
    const { read } = reader({ bucketCount: 0, truncated: false });
    const walked = {
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    } as const;
    const outstanding = { ...walked, entity: "posts" } as const;

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      backfill: {
        scopes: async () => [walked, outstanding],
        state: {
          completed: async () => new Set([backfillScopeKey(walked)]),
          record: async () => undefined,
        },
        unreachable: async () => false,
      },
    });

    expect(health.coversExistingDocuments).toBe(false);
  });

  it("is NOT covered while content exists that the index cannot reach", async () => {
    // Every scope walked, no markers — and still a floor, because a Single's
    // content cannot be indexed at all. A plugin has no supported way to READ
    // one, so no scope is ever enumerated for it; a site whose homepage is a
    // blocks-backed Single would otherwise be told the index is whole while the
    // component that homepage renders reads as used by nothing.
    //
    // "Not yet walked" and "cannot be walked" are different states with
    // different remedies, and only this one never resolves on its own.
    const { read } = reader({ bucketCount: 0, truncated: false });
    const scope = {
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    } as const;

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      backfill: {
        scopes: async () => [scope],
        state: {
          completed: async () => new Set([backfillScopeKey(scope)]),
          record: async () => undefined,
        },
        unreachable: async () => true,
      },
    });

    expect({ health, whole: indexIsWhole(health) }).toEqual({
      health: { coversExistingDocuments: false, anyUndetermined: false },
      whole: false,
    });
  });

  it("reads COMPLETION before probing markers, preserving the writer's order", async () => {
    // A rebuild writes its markers and THEN records the scope. Read in
    // parallel, the marker probe can land before a document is processed while
    // the completion read lands after the row is written — and the two
    // observations combine into "backfilled, nothing unreadable", the one
    // answer that presents an incomplete index as exact.
    //
    // Asserted on the ORDER rather than on an outcome, because the outcome is a
    // race: a test that ran both and checked the answer would pass on most runs
    // with the ordering wrong.
    const order: string[] = [];
    const read: GroupedUsageReader = async () => {
      order.push("markers");
      return { buckets: [], truncated: false };
    };
    const scope = {
      entity: "pages",
      field: "content",
      locale: "",
      variant: "published",
    } as const;

    await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      backfill: {
        scopes: async () => {
          order.push("scopes");
          return [scope];
        },
        state: {
          completed: async () => {
            order.push("completed");
            return new Set([backfillScopeKey(scope)]);
          },
          record: async () => undefined,
        },
        unreachable: async () => {
          order.push("unreachable");
          return false;
        },
      },
    });

    expect(order[order.length - 1]).toBe("markers");
  });
});
