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
  /** The state the SECOND read reports — the release's actual state. */
  state?: string;
  /**
   * The state at the FIRST read, when it differs from `state`.
   *
   * Only a release the drain settled between the two reads has two states, and
   * making that explicit is what keeps the re-check honest: the first read has
   * to hand the row over for the second read to have anything to drop.
   */
  stateAtFirstRead?: string;
  /** A new instant the SECOND read sees, as if somebody rescheduled it. */
  movedTo?: string;
}

function service(rows: Row[]) {
  const memberOf = (r: Row) => ({
    memberId: r.memberId ?? `m-${r.id}`,
    releaseId: r.id,
    action: r.action ?? ("publish" as const),
    // What the FIRST read saw. `movedTo` makes the second read disagree, which
    // is what happens when somebody reschedules between the two.
    scheduledAt: new Date(r.at),
    createdAt: new Date(r.created ?? r.at),
  });
  const repository = {
    // HONOURS `states`, because the real query does and a mock that does not
    // hands the service rows the database would never have returned. That is
    // not hypothetical: this returned every member regardless, so the case
    // below asserting a blocked release survives passed while the production
    // query dropped it one layer down and the banner showed nothing.
    findDueMembersFor: vi.fn(
      async (
        _refs: unknown,
        _now: Date,
        // The repository's own default, so a caller that names no states gets
        // the read path's narrow list here too.
        states: readonly string[] = ["scheduled"]
      ) =>
        new Map([
          [
            "collection:posts:e1:",
            rows
              .filter(r =>
                states.includes(r.stateAtFirstRead ?? r.state ?? "scheduled")
              )
              .map(memberOf),
          ],
        ])
    ),
    findReleases: vi.fn(async () =>
      rows.map(r => ({
        id: r.id,
        title: r.id,
        description: null,
        // What the SECOND read sees.
        scheduledAt: new Date(r.movedTo ?? r.at),
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

describe("a release RESCHEDULED between the two reads", () => {
  it("is ordered by the instant it now carries, not the one first seen", async () => {
    // Two reads again. The row that is displayed carries the NEW instant, so
    // sorting by the old one renders the dates out of chronological order —
    // and under a limit keeps rows that are no longer the earliest.
    const svc = service([
      {
        id: "was-first",
        at: "2026-09-01T00:00:00.000Z",
        movedTo: "2026-10-01T00:00:00.000Z",
      },
      { id: "now-first", at: "2026-09-05T00:00:00.000Z" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "now-first",
      "was-first",
    ]);
  });

  it("orders by the first-read instant when nothing moved", async () => {
    // The control: without it a comparator reading neither field would pass.
    const svc = service([
      { id: "later", at: "2026-10-01T00:00:00.000Z" },
      { id: "sooner", at: "2026-09-05T00:00:00.000Z" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "sooner",
      "later",
    ]);
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
        // Still scheduled when the members were read, published by the time
        // the releases were. Without the first-read state the query would
        // never have returned it and the re-check would have nothing to do.
        stateAtFirstRead: "scheduled",
        state: "published",
      },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "still-coming",
    ]);
  });

  it("KEEPS a release that stopped, because the document is still in it", async () => {
    // The opposite of the published case, and the reason the filter is a LIST
    // rather than an equality. A blocked release still holds this document and
    // is still going nowhere; dropping it makes the document's banner vanish,
    // and a banner disappearing reads as resolved.
    const svc = service([
      { id: "coming", at: "2026-09-01T00:00:00.000Z" },
      { id: "stopped", at: "2026-09-02T00:00:00.000Z", state: "blocked" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual([
      "coming",
      "stopped",
    ]);
  });

  it("still drops a CANCELLED one, which somebody called off on purpose", async () => {
    // The discrimination: "not published" is not the rule. A cancelled release
    // is a decision, and reporting it would be telling an editor about history.
    const svc = service([
      { id: "coming", at: "2026-09-01T00:00:00.000Z" },
      { id: "called-off", at: "2026-09-02T00:00:00.000Z", state: "cancelled" },
    ]);
    expect(ids(await svc.find({ containing: REF }, ACTOR))).toEqual(["coming"]);
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
