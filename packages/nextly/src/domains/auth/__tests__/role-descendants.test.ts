/**
 * The walk of a role's inheritance says when it stopped short.
 *
 * A decision taken from a cut short list would be taken on part of the
 * graph, so `complete` must be false exactly when the walk hit its limit.
 */
import { describe, expect, it, vi } from "vitest";

const tablesFor = vi.hoisted(() =>
  vi.fn((_dialect?: string) => ({
    roleInherits: { parentRoleId: "parentRoleId", childRoleId: "childRoleId" },
  }))
);

vi.mock("../../../database", () => ({ getDialectTables: tablesFor }));

// The condition carries the batch it names, so the reader below can answer it.
vi.mock("drizzle-orm", () => ({
  inArray: (_column: unknown, values: string[]) => ({ batch: values }),
}));

import { walkDescendantRoleIds } from "../services/role-descendants";
import { MAX_ROLE_HIERARCHY_DEPTH } from "../services/role-graph";

/**
 * A reader over `children`, a function from a role to the roles it inherits.
 * Each read answers the children of the batch its condition names.
 */
function readerOver(children: (role: string) => string[]) {
  return {
    select: () => ({
      from: () => ({
        where: ({ batch }: { batch: string[] }) =>
          Promise.resolve(
            batch.flatMap(role =>
              children(role).map(childRoleId => ({ childRoleId }))
            )
          ),
      }),
    }),
  };
}

describe("walkDescendantRoleIds", () => {
  it("says it is complete when it reached every descendant", async () => {
    const graph: Record<string, string[]> = {
      r0: ["r1", "r2"],
      r1: ["r3"],
    };
    const walk = await walkDescendantRoleIds(
      readerOver(role => graph[role] ?? []),
      "sqlite",
      "r0"
    );
    expect(walk.complete).toBe(true);
    expect(walk.ids.sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("reads the tables of the dialect it is given, not the environment's", async () => {
    tablesFor.mockClear();
    await walkDescendantRoleIds(
      readerOver(() => []),
      "postgresql",
      "r0"
    );
    expect(tablesFor).toHaveBeenCalledWith("postgresql");
  });

  it("says it is cut short once it passes its limit", async () => {
    // A tree wide enough to pass the limit: each role inherits 60 new ones.
    let next = 1;
    const wide = () => Array.from({ length: 60 }, () => `r${next++}`);
    const walk = await walkDescendantRoleIds(readerOver(wide), "sqlite", "r0");
    expect(walk.ids.length).toBeGreaterThan(MAX_ROLE_HIERARCHY_DEPTH);
    expect(walk.complete).toBe(false);
  });
});
