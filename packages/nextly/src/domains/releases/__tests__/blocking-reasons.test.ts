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

import {
  RELEASE_SCHEDULABLE_FROM,
  type ReleaseState,
} from "../../../schemas/releases/types";
import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

const ACTOR = { userId: "u1" };

interface M {
  id: string;
  createdBy?: string | null;
  locale?: string | null;
}

function service(members: M[], liveAuthorIds: string[], state = "blocked") {
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
  const scheduleRelease = vi.fn(async () => true);
  const deps = {
    repository: {
      listMembers,
      liveAuthors,
      findReleases: vi.fn(async () => [{ id: "r1", state }]),
      scheduleRelease,
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
  };
  return { svc: new ReleasesService(deps), liveAuthors, scheduleRelease };
}

describe("what stands between a release and its instant", () => {
  it("names a member whose author was never recorded", async () => {
    const { svc } = service([{ id: "m1", createdBy: null }], []);
    expect(await svc.blockingReasons("r1", ACTOR)).toMatchObject([
      { memberId: "m1", reason: "NO_AUTHOR" },
    ]);
  });

  it("names a member whose author is gone", async () => {
    // Deleted or deactivated. The drain performs each member AS its recorded
    // author, so there is no principal left to act as.
    const { svc } = service([{ id: "m1", createdBy: "ghost" }], []);
    expect(await svc.blockingReasons("r1", ACTOR)).toMatchObject([
      { memberId: "m1", reason: "AUTHOR_GONE" },
    ]);
  });

  it("names a locale-scoped member", async () => {
    const { svc } = service([{ id: "m1", locale: "de" }], ["author"]);
    expect(await svc.blockingReasons("r1", ACTOR)).toMatchObject([
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
    expect(found).toMatchObject([
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

describe("scheduling a blocked release", () => {
  const AT = new Date("2026-09-01T00:00:00.000Z");

  it("is REFUSED while what stopped it is still true", async () => {
    // Scheduling again would reach the instant, hit the same member and stop
    // again — and the operator would learn that only by waiting for a launch
    // that does not happen.
    const { svc, scheduleRelease } = service(
      [{ id: "m1", createdBy: "ghost" }],
      []
    );
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // And nothing was written: a refusal that arrives after the update is not
    // a refusal.
    expect(scheduleRelease).not.toHaveBeenCalled();
  });

  it("is allowed once the cause is fixed", async () => {
    // The control, and the whole point of deriving the blockers: restoring the
    // author makes the release schedulable with nothing else changing.
    const { svc, scheduleRelease } = service(
      [{ id: "m1", createdBy: "u9" }],
      ["u9"]
    );
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).resolves.toBeUndefined();
    expect(scheduleRelease).toHaveBeenCalled();
  });

  it("is refused from ANY schedulable state, not only from `blocked`", async () => {
    // Replaces a case that asserted the opposite — that a release which was not
    // already `blocked` skipped the check to save a read. That made the rule
    // depend on whether the drain had run yet: the same release with the same
    // deleted author was refused once labelled and accepted before, which is
    // not a distinction the person scheduling can see.
    //
    // A DRAFT here, the state furthest from `blocked`.
    const { svc, scheduleRelease } = service(
      [{ id: "m1", createdBy: "ghost" }],
      [],
      "draft"
    );
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Refused BEFORE the write, not after it: a precondition that runs late is
    // not a precondition.
    expect(scheduleRelease).not.toHaveBeenCalled();
  });

  it("still schedules a release whose members are all runnable", async () => {
    // The control for the case above. Without it, a precondition that refused
    // every schedule would satisfy it perfectly.
    const { svc, scheduleRelease } = service(
      [{ id: "m1", createdBy: "u9" }],
      ["u9"],
      "draft"
    );
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).resolves.toBeUndefined();
    expect(scheduleRelease).toHaveBeenCalled();
  });
});

describe("the blocker verdict and the write share a fence", () => {
  const AT = new Date("2026-09-01T00:00:00.000Z");

  /**
   * A release the DRAIN moves between the service's read and its write.
   *
   * The service reads the state, derives blockers from it, and only then
   * writes — and the drain runs in that window. `scheduleRelease` here models
   * the repository's conditional UPDATE rather than recording the call: it
   * answers whether the row's state AT WRITE TIME satisfies the fence the
   * service passed. Asserting on the argument instead would pass for any list
   * that merely looked plausible.
   *
   * The `from` default is the repository's own, so a service that passes no
   * fence at all behaves here exactly as it did before this was fixed — which
   * is what makes the two racing cases below fail on that version.
   */
  function racing(
    atRead: string,
    atWrite: ReleaseState,
    // CLEAN by default, so the only thing that can refuse these cases is the
    // fence. A fixture whose author is missing would be refused by the blocker
    // precondition instead, and every case below would pass without the fence
    // existing at all.
    live: string[] = ["author"]
  ) {
    const liveAuthors = vi.fn(async () => new Set(live));
    const scheduleRelease = vi.fn(
      async (
        _id: string,
        _at: Date,
        _tz: string,
        from: readonly ReleaseState[] = RELEASE_SCHEDULABLE_FROM
      ) => from.includes(atWrite)
    );
    const deps = {
      repository: {
        listMembers: vi.fn(async () => [
          {
            id: "m1",
            releaseId: "r1",
            scopeKind: "collection" as const,
            scopeSlug: "posts",
            entryId: "e1",
            locale: null,
            action: "publish" as const,
            createdBy: "author",
            createdAt: new Date(),
          },
        ]),
        liveAuthors,
        findReleases: vi.fn(async () => [{ id: "r1", state: atRead }]),
        scheduleRelease,
      } as unknown as ReleasesServiceDeps["repository"],
      canManageReleases: vi.fn(async () => true),
      canActOnDocument: vi.fn(async () => true),
    };
    return { svc: new ReleasesService(deps), scheduleRelease, liveAuthors };
  }

  it("REFUSES a release the drain blocked after the state was read", async () => {
    // The interleaving that made the precondition bypassable. The service saw
    // `scheduled`, so it examined no blockers; the drain then stopped the
    // release. A fence spanning every schedulable state accepts `blocked` here
    // and reschedules a release nobody checked — which reaches its new instant
    // and stops again, for the same permanent reason.
    const { svc, scheduleRelease } = racing("scheduled", "blocked");
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // And it was refused by the FENCE rather than by the blocker precondition:
    // this release has a live author, so there is nothing for that precondition
    // to object to. The write was attempted and the fence turned it away.
    expect(scheduleRelease).toHaveBeenCalled();
  });

  it("REFUSES a blocked release that somebody else moved after it was cleared", async () => {
    // The opposite interleaving. The verdict said "nothing blocks it", and by
    // the time of the write that release had been cancelled — a decision made
    // AFTER the verdict, which the write must not silently overwrite.
    const { svc } = racing("blocked", "cancelled", ["author"]);
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("allows a cleared blocked release that nothing moved", async () => {
    // The control for the recovery path: without it, a fence that refused
    // everything would satisfy both cases above.
    const { svc, scheduleRelease } = racing("blocked", "blocked", ["author"]);
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).resolves.toBeUndefined();
    expect(scheduleRelease).toHaveBeenCalled();
  });

  it("allows an ordinary reschedule that nothing moved", async () => {
    // The control for the common path, which must stay free of all this.
    const { svc, scheduleRelease } = racing("scheduled", "scheduled");
    await expect(svc.schedule("r1", AT, "UTC", ACTOR)).resolves.toBeUndefined();
    expect(scheduleRelease).toHaveBeenCalled();
  });
});

describe("what authority rescheduling actually costs", () => {
  const AT = new Date("2026-09-01T00:00:00.000Z");

  /** A scoped API key holding exactly the grants it is given, and no others. */
  function keyHolding(...permissions: string[]) {
    return {
      userId: "u1",
      authenticatedScope: {
        actorType: "apiKey",
        permissions,
      },
    } as unknown as Parameters<ReleasesService["schedule"]>[3];
  }

  it("does not demand a READ grant to reschedule a repaired release", async () => {
    // A key stamped `publish-content-releases` may schedule every release on
    // the site. Deriving the blockers through the public `blockingReasons`
    // asked for `read` as well — and for an API key the stamped scope is
    // authoritative, so the missing grant is refused outright rather than
    // falling back to publish-implies-read. Such a key could schedule anything
    // EXCEPT a repaired blocked release, the one case the check exists for.
    const { svc } = service([{ id: "m1", createdBy: "u9" }], ["u9"]);
    await expect(
      svc.schedule("r1", AT, "UTC", keyHolding("publish-content-releases"))
    ).resolves.toBeUndefined();
  });

  it("still refuses a key that cannot publish", async () => {
    // The control. Without it the case above is satisfied by a service that
    // stopped authorizing scheduling at all.
    const { svc } = service([{ id: "m1", createdBy: "u9" }], ["u9"]);
    await expect(
      svc.schedule("r1", AT, "UTC", keyHolding("read-content-releases"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("still refuses to READ the blockers without a read grant", async () => {
    // The authority did not move, it was only taken off the derivation. The
    // public surface must still demand `read`, or this fix would have widened
    // who can enumerate a release's members.
    const { svc } = service([{ id: "m1", createdBy: "u9" }], ["u9"]);
    await expect(
      svc.blockingReasons("r1", keyHolding("publish-content-releases"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
