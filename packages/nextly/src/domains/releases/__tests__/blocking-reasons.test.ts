/**
 * Why a release cannot proceed, worked out from its members.
 *
 * Derived rather than stored, and the tests are shaped by that choice: the
 * interesting property is that the answer CHANGES when the cause is fixed. A
 * reason recorded at block time would still name a deleted author after the
 * operator restored them, and the only way out would be to reschedule and watch
 * it block again — so "it self-heals" is the behaviour worth pinning, not an
 * implementation detail.
 *
 * @module domains/releases/__tests__/blocking-reasons.test
 */
import { describe, expect, it, vi } from "vitest";

import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

const ACTOR = { userId: "u1" };

interface M {
  id: string;
  createdBy?: string | null;
  locale?: string | null;
}

function service(members: M[], liveAuthorIds: string[]) {
  const listMembers = vi.fn(async () =>
    members.map(m => ({
      id: m.id,
      releaseId: "r1",
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId: `e-${m.id}`,
      locale: m.locale ?? null,
      action: "publish" as const,
      createdBy: m.createdBy === undefined ? "author" : m.createdBy,
      createdAt: new Date(),
    }))
  );
  const liveAuthors = vi.fn(async () => new Set(liveAuthorIds));
  const deps = {
    repository: {
      listMembers,
      liveAuthors,
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
  };
  return { svc: new ReleasesService(deps), liveAuthors };
}

describe("what stands between a release and its instant", () => {
  it("names a member whose author was never recorded", async () => {
    const { svc } = service([{ id: "m1", createdBy: null }], []);
    expect(await svc.blockingReasons("r1", ACTOR)).toEqual([
      { memberId: "m1", reason: "NO_AUTHOR" },
    ]);
  });

  it("names a member whose author is gone", async () => {
    // Deleted or deactivated. The drain performs each member AS its recorded
    // author, so there is no principal left to act as.
    const { svc } = service([{ id: "m1", createdBy: "ghost" }], []);
    expect(await svc.blockingReasons("r1", ACTOR)).toEqual([
      { memberId: "m1", reason: "AUTHOR_GONE" },
    ]);
  });

  it("names a locale-scoped member", async () => {
    const { svc } = service([{ id: "m1", locale: "de" }], ["author"]);
    expect(await svc.blockingReasons("r1", ACTOR)).toEqual([
      { memberId: "m1", reason: "LOCALE_SCOPED" },
    ]);
  });

  it("says nothing about a release that can proceed", async () => {
    // The control. Without it every case above is satisfied by an
    // implementation that reports a blocker for every member it sees.
    const { svc } = service([{ id: "m1" }, { id: "m2" }], ["author"]);
    expect(await svc.blockingReasons("r1", ACTOR)).toEqual([]);
  });

  it("names each offending member rather than the release", async () => {
    // The fix is per member — remove that document, restore that user — so a
    // release-level "something is wrong" leaves an operator opening every row.
    const { svc } = service(
      [
        { id: "ok" },
        { id: "bad", createdBy: "ghost" },
        { id: "loc", locale: "fr" },
      ],
      ["author"]
    );
    const found = await svc.blockingReasons("r1", ACTOR);
    expect(found).toEqual([
      { memberId: "bad", reason: "AUTHOR_GONE" },
      { memberId: "loc", reason: "LOCALE_SCOPED" },
    ]);
  });
});

describe("because it is DERIVED, it changes when the cause is fixed", () => {
  it("stops reporting an author who has been restored", async () => {
    // The reason this is computed rather than recorded. A stored reason would
    // still name the missing author here, and the operator's fix would appear
    // to have done nothing.
    const gone = service([{ id: "m1", createdBy: "u9" }], []);
    expect(await gone.svc.blockingReasons("r1", ACTOR)).toHaveLength(1);

    const restored = service([{ id: "m1", createdBy: "u9" }], ["u9"]);
    expect(await restored.svc.blockingReasons("r1", ACTOR)).toEqual([]);
  });

  it("stops reporting a member that was removed", async () => {
    const withBad = service(
      [{ id: "m1" }, { id: "bad", createdBy: null }],
      ["author"]
    );
    expect(await withBad.svc.blockingReasons("r1", ACTOR)).toHaveLength(1);

    const fixed = service([{ id: "m1" }], ["author"]);
    expect(await fixed.svc.blockingReasons("r1", ACTOR)).toEqual([]);
  });
});

describe("as an instrument", () => {
  it("asks for live authors ONCE, not once per member", async () => {
    // A release of fifty documents must not become fifty identity lookups.
    const { svc, liveAuthors } = service(
      Array.from({ length: 12 }, (_, n) => ({ id: `m${n}` })),
      ["author"]
    );
    await svc.blockingReasons("r1", ACTOR);
    expect(liveAuthors).toHaveBeenCalledTimes(1);
  });

  it("asks nothing at all about an empty release", async () => {
    const { svc, liveAuthors } = service([], []);
    expect(await svc.blockingReasons("r1", ACTOR)).toEqual([]);
    expect(liveAuthors).not.toHaveBeenCalled();
  });

  it("refuses a caller who may not read releases", async () => {
    const deps = {
      repository: {} as ReleasesServiceDeps["repository"],
      canManageReleases: vi.fn(async () => false),
      canActOnDocument: vi.fn(async () => true),
    };
    await expect(
      new ReleasesService(deps).blockingReasons("r1", ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
