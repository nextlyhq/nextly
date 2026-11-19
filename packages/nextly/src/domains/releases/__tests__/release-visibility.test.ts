/**
 * The seam a read path uses to ask what a due release reveals.
 *
 * @module domains/releases/__tests__/release-visibility.test
 */
import { describe, expect, it, vi } from "vitest";

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
      repository: { findDueDecisions, ...NOTHING_DUE },
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
    const scheduledMembersFor = vi.fn(
      async (target: { documents?: readonly { entryId: string }[] }) =>
        (target.documents ?? []).map(document => ({
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
    expect(scheduledMembersFor.mock.calls.length).toBeLessThan(100);
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

describe("NO_RELEASE_VISIBILITY", () => {
  it("answers nothing, so a runtime without releases needs no special case", async () => {
    expect(await NO_RELEASE_VISIBILITY.decisions(QUERY)).toEqual(NO_DECISIONS);
  });
});
