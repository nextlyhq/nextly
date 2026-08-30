/**
 * The releases holding one document, in the order the engine will apply them.
 *
 * Two properties, and both were wrong in the first version. The ORDER has to be
 * the engine's total order rather than a comparator that agrees with it most of
 * the time: two releases naming one instant is not an edge case, and a reader
 * takes the last row as the document's final state. And the document filter has
 * to NARROW the list rather than replace it — a caller combining it with a
 * window asked for both.
 *
 * @module domains/releases/__tests__/find-containing.test
 */
import { describe, expect, it, vi } from "vitest";

import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

const ACTOR = { userId: "u1" };
const REF = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
  locale: null,
};

interface Row {
  id: string;
  at: string;
  action?: "publish" | "unpublish";
  /** The MEMBER's creation time, which breaks a tied instant. */
  created?: string;
  memberId?: string;
  state?: string;
}

function service(rows: Row[]) {
  const members = rows.map(r => ({
    memberId: r.memberId ?? `m-${r.id}`,
    releaseId: r.id,
    action: r.action ?? ("publish" as const),
    scheduledAt: new Date(r.at),
    createdAt: new Date(r.created ?? r.at),
  }));
  const repository = {
    findDueMembersFor: vi.fn(
      async () => new Map([["collection:posts:e1:", members]])
    ),
    findReleases: vi.fn(async () =>
      rows.map(r => ({
        id: r.id,
        title: r.id,
        description: null,
        scheduledAt: new Date(r.at),
        timezone: "UTC",
        state: r.state ?? "scheduled",
        publishedAt: null,
        createdBy: "u1",
        createdAt: new Date(r.at),
        updatedAt: new Date(r.at),
      }))
    ),
  };
  const deps = {
    repository: repository as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
  };
  return new ReleasesService(deps);
}

const ids = (rows: { id: string }[]) => rows.map(r => r.id);

describe("the order the releases are returned in", () => {
  it("is soonest first", async () => {
    const svc = service([
      { id: "later", at: "2026-09-20T00:00:00.000Z" },
      { id: "sooner", at: "2026-09-01T00:00:00.000Z" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("breaks a TIED instant on the member's creation time", async () => {
    // The case a comparator on the instant alone cannot decide. It leaves these
    // in whatever order the driver returned, which differs by dialect — and the
    // last row is read as the document's final state.
    const svc = service([
      {
        id: "second",
        at: "2026-09-01T00:00:00.000Z",
        created: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "first",
        at: "2026-09-01T00:00:00.000Z",
        created: "2026-08-01T00:00:00.000Z",
      },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "first",
      "second",
    ]);
  });

  it("breaks a tie on the member ID when even the creation times match", async () => {
    // The engine's last tiebreak. Without it two members written in the same
    // transaction order arbitrarily, and the winner is whichever the query plan
    // felt like.
    const svc = service([
      {
        id: "b",
        at: "2026-09-01T00:00:00.000Z",
        created: "2026-08-01T00:00:00.000Z",
        memberId: "m-zz",
      },
      {
        id: "a",
        at: "2026-09-01T00:00:00.000Z",
        created: "2026-08-01T00:00:00.000Z",
        memberId: "m-aa",
      },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual(["a", "b"]);
  });
});

describe("a release the drain settled between the two reads", () => {
  it("is dropped rather than reported as still coming", async () => {
    // Two reads, and the drain runs between them: `findDueMembersFor` selects
    // members of SCHEDULED releases, and by the time the second read fetches
    // those releases one may already be published. Emitting it reports an
    // action that has ALREADY HAPPENED as upcoming — and a reader polling until
    // nothing is pending stops on that row and keeps the claim forever.
    const svc = service([
      { id: "still-coming", at: "2026-09-01T00:00:00.000Z" },
      {
        id: "already-ran",
        at: "2026-09-02T00:00:00.000Z",
        state: "published",
      },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "still-coming",
    ]);
  });

  it("keeps the scheduled ones, so the filter is not simply emptying the list", async () => {
    // The control. Without it a branch that dropped everything would pass.
    const svc = service([
      { id: "a", at: "2026-09-01T00:00:00.000Z" },
      { id: "b", at: "2026-09-02T00:00:00.000Z" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual(["a", "b"]);
  });
});

describe("the document filter NARROWS the list rather than replacing it", () => {
  const WINDOWED = [
    { id: "before", at: "2026-08-01T00:00:00.000Z" },
    { id: "inside", at: "2026-09-10T00:00:00.000Z" },
    { id: "after", at: "2026-10-01T00:00:00.000Z" },
  ];

  it("honours a lower bound", async () => {
    const svc = service(WINDOWED);
    const rows = await svc.find(
      { containing: REF, scheduledAfter: new Date("2026-09-01T00:00:00.000Z") },
      ACTOR
    );
    expect(ids(rows)).toEqual(["inside", "after"]);
  });

  it("honours an upper bound", async () => {
    const svc = service(WINDOWED);
    const rows = await svc.find(
      {
        containing: REF,
        scheduledBefore: new Date("2026-09-15T00:00:00.000Z"),
      },
      ACTOR
    );
    expect(ids(rows)).toEqual(["before", "inside"]);
  });

  it("honours a limit, applied AFTER the ordering", async () => {
    // Order first, then trim. Trimming an unordered set returns an arbitrary
    // subset and calls it the soonest.
    const svc = service(WINDOWED);
    expect(ids(await svc.find({ containing: REF, limit: 2 }, ACTOR))).toEqual([
      "before",
      "inside",
    ]);
  });

  it("returns everything matching when no qualifier is given", async () => {
    // The control: without it every case above is satisfied by a filter that
    // drops rows for some unrelated reason.
    const svc = service(WINDOWED);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "before",
      "inside",
      "after",
    ]);
  });
});
