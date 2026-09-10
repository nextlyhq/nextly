/**
 * The two index-wide facts a screen resolves once, and what they cost.
 *
 * Both are the same answer for every component in a library, so the thing being
 * protected here is that they are asked ONCE — a per-component version issues
 * the identical query per tile, against the pool the index exists to keep free.
 *
 * @module usage-index-health.test
 */
import { describe, expect, it } from "vitest";

import { componentUsageIndex } from "./component-usage";
import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";
import type { GroupedUsageReader } from "./usage-index";
import {
  indexIsWhole,
  readUsageIndexHealth,
  UNKNOWN_INDEX_HEALTH,
} from "./usage-index-health";

const SCOPE: BackfillScope = {
  entity: "pages",
  field: "content",
  locale: "",
  variant: "published",
};

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

function state(done: string[]) {
  return {
    completed: async () => new Set(done),
    record: async () => undefined,
  };
}

describe("reading how much of the index is there", () => {
  it("reports a backfilled index with no markers as WHOLE", async () => {
    const { read } = reader({ bucketCount: 0, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      scopes: [SCOPE],
      state: state([backfillScopeKey(SCOPE)]),
    });

    expect({ health, whole: indexIsWhole(health) }).toEqual({
      health: { backfilled: true, anyUndetermined: false },
      whole: true,
    });
  });

  it("asks the marker question of the WHOLE index, naming no component", async () => {
    // A marker names no component, so "which unreadable documents reference
    // this one" has no answer — narrowing this by a reference would ask it
    // anyway and get a confident empty.
    const { read, asked } = reader({ bucketCount: 1, truncated: false });

    await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      scopes: [],
      state: state([]),
    });

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

    await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      scopes: [SCOPE],
      state: state([backfillScopeKey(SCOPE)]),
    });

    expect(asked.length).toBe(1);
  });

  it("is not whole while a scope is unwalked, even with no markers", async () => {
    const { read } = reader({ bucketCount: 0, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      scopes: [SCOPE],
      state: state([]),
    });

    expect({ health, whole: indexIsWhole(health) }).toEqual({
      health: { backfilled: false, anyUndetermined: false },
      whole: false,
    });
  });

  it("is not whole while a document is unreadable, even fully backfilled", async () => {
    const { read } = reader({ bucketCount: 2, truncated: false });

    const health = await readUsageIndexHealth({
      index: componentUsageIndex,
      read,
      scopes: [SCOPE],
      state: state([backfillScopeKey(SCOPE)]),
    });

    expect({ health, whole: indexIsWhole(health) }).toEqual({
      health: { backfilled: true, anyUndetermined: true },
      whole: false,
    });
  });
});

describe("the answer an installation with no backfill wiring assumes", () => {
  it("caveats every count rather than claiming the index is whole", async () => {
    // The safe direction, and the one a default has to pick. Claiming whole
    // would tell an author a component with no rows yet is used nowhere.
    expect(indexIsWhole(UNKNOWN_INDEX_HEALTH)).toBe(false);
  });
});
