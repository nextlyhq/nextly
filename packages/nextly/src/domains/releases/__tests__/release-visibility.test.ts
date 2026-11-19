/**
 * The seam a read path uses to ask what a due release reveals.
 *
 * @module domains/releases/__tests__/release-visibility.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  COMPONENT_WALK_RELEASES,
  COMPONENT_WALK_ROUNDS,
} from "../component-hold";
import type { ReleaseRecheckTarget } from "../release-recheck";
import { NO_DECISIONS } from "../release-scope";
import {
  NO_RELEASE_VISIBILITY,
  createReleaseVisibility,
} from "../release-visibility";
import type { DrainMemberRow, ReleaseRow } from "../releases-repository";

const QUERY = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  now: new Date("2026-01-01T00:00:00.000Z"),
};
const PAST = new Date("2025-12-01T00:00:00.000Z");

/** A release due before the query's instant. */
function release(id: string): ReleaseRow {
  return {
    id,
    title: id,
    description: null,
    scheduledAt: PAST,
    timezone: "UTC",
    state: "scheduled",
    kind: "release",
    publishedAt: null,
    createdBy: "owner",
    createdAt: PAST,
    updatedAt: PAST,
    revision: 0,
  };
}

/** A member of `releaseId` acting on a post. */
function member(
  releaseId: string,
  entryId: string,
  action: "publish" | "unpublish"
): DrainMemberRow {
  return {
    id: `${releaseId}-${entryId}`,
    releaseId,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    locale: null,
    action,
    memberKey: `${releaseId}-${entryId}`,
    singleSlot: null,
    appliedRevision: null,
    createdBy: "author",
    createdAt: PAST,
  };
}

/** The documents a walk of shared documents asks about; none for any other target. */
function documentsOf(
  target: ReleaseRecheckTarget
): readonly { entryId: string }[] {
  return "documents" in target ? target.documents : [];
}

/** Nothing due to plan: what the first cases' reads never reach. */
const NOTHING_DUE = {
  scheduledMembersFor: async () => [],
  listMembersOf: async () => [],
};

/**
 * Two due releases: r1 publishes e1; r2 publishes e2 and takes e3 down. Each is a component of
 * its own, sharing no document.
 */
const TWO_RELEASES = {
  findDueDecisions: async () => ({ reveal: ["e1", "e2"], hide: ["e3"] }),
  scheduledMembersFor: async () => [
    { release: release("r1"), members: [] },
    { release: release("r2"), members: [] },
  ],
  listMembersOf: async () => [
    member("r1", "e1", "publish"),
    member("r2", "e2", "publish"),
    member("r2", "e3", "unpublish"),
  ],
};

describe("createReleaseVisibility", () => {
  it("does not query at all while nothing is due", async () => {
    // The cheap check is the entire optimisation: every read of every
    // collection on a site that has never scheduled a release must cost one
    // memo read, not a query against the members table.
    const findDueDecisions = vi.fn(async () => ({
      reveal: ["e1"],
      hide: ["e2"],
    }));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => false },
      repository: { findDueDecisions, ...NOTHING_DUE },
    });

    expect(await visibility.decisions(QUERY)).toEqual(NO_DECISIONS);
    expect(findDueDecisions).not.toHaveBeenCalled();
  });

  it("asks, and answers, once something IS due", async () => {
    // The control for the case above: a seam that never queried would satisfy
    // it while making the whole read path inert.
    const findDueDecisions = vi.fn(async () => ({
      reveal: ["e1", "e2"],
      hide: ["e3"],
    }));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions,
        // The releases those decisions come from, still due when they are planned.
        scheduledMembersFor: TWO_RELEASES.scheduledMembersFor,
        listMembersOf: TWO_RELEASES.listMembersOf,
      },
    });

    // BOTH directions reach the caller. A seam that forwarded only `reveal`
    // would satisfy every earlier case here while making a scheduled takedown
    // a no-op.
    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1", "e2"],
      hide: ["e3"],
    });
    expect(findDueDecisions).toHaveBeenCalledWith(QUERY);
  });
});

describe("createReleaseVisibility with a hold on going live", () => {
  it("leaves out every decision of a release whose publish is held, as the run refuses it whole", async () => {
    // A reader in the window between a release's moment and its run must be shown neither what
    // the run will refuse to publish nor the takedown it refuses beside it.
    const held = vi.fn(
      async (documents: readonly { id: string; entryId: string }[]) =>
        new Set(
          documents.filter(d => d.entryId === "e2").map(document => document.id)
        )
    );
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: TWO_RELEASES,
      hold: () => ({ held }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1"],
      hide: [],
    });
    // Each release's publishes asked once, a takedown never.
    expect(
      held.mock.calls.map(call => call[0].map(d => d.entryId)).sort()
    ).toEqual([["e1"], ["e2"]]);
  });

  it("projects nothing of a release whose question fails, and fails no read", async () => {
    // The run writes nothing of it and asks again; a read shows it as it stands meanwhile.
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: TWO_RELEASES,
      hold: () => ({
        held: async documents => {
          if (documents.some(d => d.entryId === "e2")) {
            throw new Error("connection reset");
          }
          return new Set<string>();
        },
      }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1"],
      hide: [],
    });
  });

  it("projects nothing of the documents it decides when their component reaches past its bound, rather than reading the whole backlog", async () => {
    // An endless chain: release n publishes e{n} and e{n+1}, so each document leads to one more
    // release. Nothing in it is held, yet a read that walked it to the end would never finish,
    // and one that stopped short and planned what it had would be guessing.
    const indexOf = (id: string) => Number(id.slice(1));
    const scheduledMembersFor = vi.fn(async (target: ReleaseRecheckTarget) =>
      documentsOf(target).map(document => ({
        release: release(`r${indexOf(document.entryId)}`),
        members: [],
      }))
    );
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({ reveal: ["e1"], hide: [] }),
        scheduledMembersFor,
        listMembersOf: async (ids: string[]) =>
          ids.flatMap(id => [
            member(id, `e${indexOf(id)}`, "publish"),
            member(id, `e${indexOf(id) + 1}`, "publish"),
          ]),
      },
      hold: () => ({ held: async () => new Set<string>() }),
    });

    expect(await visibility.decisions(QUERY)).toEqual(NO_DECISIONS);
    // One read of releases a round, and no round past the bound.
    expect(scheduledMembersFor.mock.calls.length).toBeLessThanOrEqual(
      COMPONENT_WALK_ROUNDS
    );
  });

  it("drops only the decisions of a component past its bound, however many components fit beside it", async () => {
    // More due releases than the bound in all, but each component small: one release per single
    // document, and a pair joined through a document this read does not decide. Beside them, a
    // document held by more releases than the bound, which alone is too large to plan.
    const singles = Array.from(
      { length: COMPONENT_WALK_RELEASES + 1 },
      (_, i) => `s${i}`
    );
    const crowd = Array.from(
      { length: COMPONENT_WALK_RELEASES + 1 },
      (_, i) => `rh${i}`
    );
    const holds = new Map<string, string[]>([
      ...singles.map((entryId): [string, string[]] => [
        `r-${entryId}`,
        [entryId],
      ]),
      ["rp1", ["p1", "x"]],
      ["rp2", ["p2", "x"]],
      ...crowd.map((id): [string, string[]] => [id, ["h"]]),
    ]);
    const holders = new Map<string, string[]>();
    for (const [releaseId, entryIds] of holds) {
      for (const entryId of entryIds) {
        holders.set(entryId, [...(holders.get(entryId) ?? []), releaseId]);
      }
    }
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({
          reveal: [...singles, "p1", "p2", "h"],
          hide: [],
        }),
        scheduledMembersFor: async (target: ReleaseRecheckTarget) =>
          [
            ...new Set(
              documentsOf(target).flatMap(
                document => holders.get(document.entryId) ?? []
              )
            ),
          ].map(id => ({ release: release(id), members: [] })),
        listMembersOf: async (ids: string[]) =>
          ids.flatMap(id =>
            (holds.get(id) ?? []).map(entryId => member(id, entryId, "publish"))
          ),
      },
      hold: () => ({ held: async () => new Set<string>() }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: [...singles, "p1", "p2"],
      hide: [],
    });
  });

  it("never asks while nothing would be revealed, so a takedown is never held", async () => {
    const held = vi.fn(async () => new Set(["e3"]));
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({ reveal: [], hide: ["e3"] }),
        scheduledMembersFor: async () => [
          { release: release("r2"), members: [] },
        ],
        listMembersOf: async () => [member("r2", "e3", "unpublish")],
      },
      hold: () => ({ held }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: [],
      hide: ["e3"],
    });
    expect(held).not.toHaveBeenCalled();
  });
});

describe("createReleaseVisibility over a schedule that moves between its reads", () => {
  it("projects only what the due releases it plans still decide, never a decision they no longer make", async () => {
    // Read after the decisions: e1's release is no longer due (stopped meanwhile), and e3, decided
    // a takedown, is now won by a publish due since. Only e2 is decided alike by both reads.
    const holds = new Map<string, DrainMemberRow[]>([
      ["r2", [member("r2", "e2", "publish")]],
      ["r3", [member("r3", "e3", "publish")]],
    ]);
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({ reveal: ["e1", "e2"], hide: ["e3"] }),
        scheduledMembersFor: async (target: ReleaseRecheckTarget) => {
          const asked = new Set(
            documentsOf(target).map(document => document.entryId)
          );
          return [...holds]
            .filter(([, members]) => members.some(m => asked.has(m.entryId)))
            .map(([id]) => ({ release: release(id), members: [] }));
        },
        listMembersOf: async (ids: string[]) =>
          ids.flatMap(id => holds.get(id) ?? []),
      },
      hold: () => ({ held: async () => new Set<string>() }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e2"],
      hide: [],
    });
  });

  it("keeps the decisions of every component whose question was answered when another's fails", async () => {
    // r3 takes e4 down on its own; the question about r2's component fails. The run writes none of
    // r2's component and all of r3's, so a reader keeps r3's takedown.
    const visibility = createReleaseVisibility({
      cache: { mayHaveDue: async () => true },
      repository: {
        findDueDecisions: async () => ({
          reveal: ["e1", "e2"],
          hide: ["e3", "e4"],
        }),
        scheduledMembersFor: async () => [
          { release: release("r1"), members: [] },
          { release: release("r2"), members: [] },
          { release: release("r3"), members: [] },
        ],
        listMembersOf: async () => [
          member("r1", "e1", "publish"),
          member("r2", "e2", "publish"),
          member("r2", "e3", "unpublish"),
          member("r3", "e4", "unpublish"),
        ],
      },
      hold: () => ({
        held: async documents => {
          if (documents.some(d => d.entryId === "e2")) {
            throw new Error("connection reset");
          }
          return new Set<string>();
        },
      }),
    });

    expect(await visibility.decisions(QUERY)).toEqual({
      reveal: ["e1"],
      hide: ["e4"],
    });
  });
});

describe("NO_RELEASE_VISIBILITY", () => {
  it("answers nothing, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_VISIBILITY.decisions(QUERY)).toEqual(NO_DECISIONS);
  });
});
