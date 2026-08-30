/**
 * The authorization boundary for content releases.
 *
 * The cases exercised exhaustively are the REFUSALS. A happy-path test passes
 * against a service with no checks at all, so it can only ever confirm that the
 * repository was reached — which was never in doubt. Each case below therefore
 * asserts both that the call is refused AND that the repository was not touched,
 * because a write that authorizes after the fact has already happened.
 *
 * @module domains/releases/__tests__/releases-service.test
 */
import { describe, expect, it, vi } from "vitest";

import { ReleasesService } from "../services/releases-service";
import type {
  ReleaseAuthority,
  ReleasesServiceDeps,
} from "../services/releases-service";

const ADMIN = { userId: "u1" };
const ANON = { userId: null };

/** Every repository method the service can reach, all spies. */
function repository() {
  return {
    createRelease: vi.fn(async () => ({ id: "r1" })),
    scheduleReleaseOk: true,
    findReleases: vi.fn(async () => [{ id: "r1", state: "draft" }]),
    listMembers: vi.fn(async () => []),
    addMember: vi.fn(async () => ({ id: "m1" })),
    removeMember: vi.fn(async () => undefined),
    touchIfAssemblable: vi.fn(async () => true),
    findMember: vi.fn(
      async (): Promise<{ id: string; releaseId: string } | undefined> => ({
        id: "m1",
        releaseId: "r1",
      })
    ),
    liveAuthors: vi.fn(async (ids: string[]) => new Set(ids)),
    scheduleRelease: vi.fn(async () => true),
    cancelRelease: vi.fn(async () => true),
  };
}

function service(over?: {
  holds?: ReleaseAuthority[];
  mayActOnDocument?: boolean;
}) {
  const repo = repository();
  const held = new Set(over?.holds ?? []);
  const deps = {
    repository: repo as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async (_id: string, a: ReleaseAuthority) =>
      held.has(a)
    ),
    canActOnDocument: vi.fn(
      async (_params: {
        userId: string;
        scopeSlug: string;
        action: string;
        authenticatedScope?: unknown;
      }) => over?.mayActOnDocument !== false
    ),
  };
  return { svc: new ReleasesService(deps), repo, deps };
}

const MEMBER = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
  locale: null,
  action: "publish" as const,
};

describe("ReleasesService authorization", () => {
  it("refuses to create a release without create authority, and writes nothing", async () => {
    const { svc, repo } = service({ holds: ["read", "publish"] });
    await expect(svc.create({ title: "Launch" }, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The ordering assertion. A refusal that arrives after the insert is not a
    // refusal — nothing can un-write the row.
    expect(repo.createRelease).not.toHaveBeenCalled();
  });

  it("refuses to read releases without read authority", async () => {
    const { svc, repo } = service({ holds: ["create", "publish"] });
    await expect(svc.find({}, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.findReleases).not.toHaveBeenCalled();
  });

  it("refuses to schedule with only create authority, because committing is a separate power", async () => {
    // The split the seed states: assembling a release changes nothing a reader
    // can see, and scheduling is the act that puts content live later. A service
    // that gated both on one permission would silently merge the two.
    const { svc, repo } = service({ holds: ["create", "read"] });
    await expect(
      svc.schedule("r1", new Date(), "UTC", ADMIN)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });

  it("refuses to cancel with only create authority", async () => {
    // Cancelling needs the same authority as scheduling. Someone who could
    // cancel but not schedule could still silently stop a launch.
    const { svc, repo } = service({ holds: ["create", "read"] });
    await expect(svc.cancel("r1", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.cancelRelease).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller without asking the permission store", async () => {
    const { svc, repo, deps } = service({ holds: ["read"] });
    await expect(svc.find({}, ANON)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Asking about a null user is a lookup whose only possible answer is no, and
    // a store that answered anything else would be granting authority to nobody.
    expect(deps.canManageReleases).not.toHaveBeenCalled();
    expect(repo.findReleases).not.toHaveBeenCalled();
  });

  it("lets a trusted in-process caller through without a permission store", async () => {
    // `overrideAccess` is what the Direct API is, and it must NOT be inferred
    // from a null user: anonymous and trusted are different things.
    const { svc, repo, deps } = service({ holds: [] });
    await svc.find({}, { userId: null, overrideAccess: true });
    expect(deps.canManageReleases).not.toHaveBeenCalled();
    expect(repo.findReleases).toHaveBeenCalled();
  });
});

describe("ReleasesService add-time document check", () => {
  it("refuses to add a document the caller may not publish", async () => {
    // The escalation this closes: holding `create-content-releases` says you may
    // ASSEMBLE a release, never that you may publish what you put in it. A
    // release is a deferred publish, so without this the permission becomes a
    // way to perform a write you could not perform now, with a delay on it.
    const { svc, repo } = service({
      holds: ["create"],
      mayActOnDocument: false,
    });
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("asks about the document's own scope and action, not the release", async () => {
    // A check that asked about the wrong subject would pass for a caller who may
    // publish something else entirely.
    const { svc, deps } = service({ holds: ["create"] });
    await svc.addMember("r1", { ...MEMBER, action: "unpublish" }, ADMIN);
    expect(deps.canActOnDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        scopeSlug: "posts",
        action: "unpublish",
      })
    );
  });

  it("still requires release authority even when the document is permitted", async () => {
    // Both questions, not either. A caller who may publish a post but holds no
    // release authority must not be able to create scheduled work.
    const { svc, repo } = service({ holds: [], mayActOnDocument: true });
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("records the actor as the member's author, never a caller-supplied one", async () => {
    // Materialisation performs each member as its recorded author, so an author
    // a caller could name would be an identity they could borrow at a future
    // instant.
    const { svc, repo } = service({ holds: ["create"] });
    await svc.addMember(
      "r1",
      { ...MEMBER, createdBy: "someone-else" } as never,
      ADMIN
    );
    expect(repo.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "u1", releaseId: "r1" })
    );
  });

  it("records the actor as the release's author on create", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    await svc.create(
      { title: "Launch", createdBy: "someone-else" } as never,
      ADMIN
    );
    expect(repo.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "u1" })
    );
  });
});

describe("ReleasesService refuses members the drain could never perform", () => {
  it("refuses a member with no author, rather than persisting an unrunnable one", async () => {
    // `resolveActionAuthor` returns NO_RECORDED_AUTHOR for `createdBy: null` and
    // the pass refuses to fall back to a privileged principal — correctly, or
    // scheduling would become a way to act as the system. So an authorless
    // member produces a release that can NEVER publish, and the trusted Direct
    // API default is exactly the call that would create one.
    const { svc, repo } = service({ holds: ["create"] });
    await expect(
      svc.addMember("r1", MEMBER, { userId: null, overrideAccess: true })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("refuses a locale-scoped member at add time, where applyOne says it belongs", async () => {
    // `applyOne` refuses any member carrying a locale and its comment names
    // schedule time as where that refusal belongs once a write surface exists.
    // This is that surface. Accepting one would persist a member guaranteed to
    // fail at the scheduled instant, silently.
    const { svc, repo } = service({ holds: ["create"] });
    await expect(
      svc.addMember("r1", { ...MEMBER, locale: "de" }, ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.addMember).not.toHaveBeenCalled();
  });
});

describe("ReleasesService lifecycle fences", () => {
  it("reports a conflict when the schedule fence refuses the move", async () => {
    // The fence excludes a `published` release: re-scheduling one makes the
    // drain re-apply members against documents that have changed since. A
    // caller told nothing would read the no-op as a schedule that took.
    const { svc, repo } = service({ holds: ["publish"] });
    repo.scheduleRelease.mockResolvedValueOnce(false);
    await expect(
      svc.schedule("r1", new Date(), "UTC", ADMIN)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports a conflict when the cancel fence refuses the move", async () => {
    const { svc, repo } = service({ holds: ["publish"] });
    repo.cancelRelease.mockResolvedValueOnce(false);
    await expect(svc.cancel("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("ReleasesService refuses members that would act on nothing", () => {
  it("refuses an action outside the union, which would WITHDRAW content", async () => {
    // The Drizzle `$type` annotation is compile-time only, and the applier
    // treats every effect that is not exactly "publish" as an unpublish. So a
    // typo from an untyped caller does not fail — it takes the document down at
    // the scheduled instant.
    const { svc, repo } = service({ holds: ["create"] });
    await expect(
      svc.addMember("r1", { ...MEMBER, action: "publsih" as never }, ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("refuses a member whose release does not exist", async () => {
    // No dialect declares a foreign key from a member to its release, so a
    // mistyped id would insert a row no drain can ever find: a 201 for a member
    // that belongs to nothing.
    const { svc, repo } = service({ holds: ["create"] });
    repo.touchIfAssemblable.mockResolvedValueOnce(false);
    repo.findReleases.mockResolvedValueOnce([]);
    await expect(svc.addMember("nope", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("refuses a member on a release that will never run again", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.touchIfAssemblable.mockResolvedValueOnce(false);
    repo.findReleases.mockResolvedValueOnce([{ id: "r1", state: "published" }]);
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("translates a duplicate member into the package's own error", async () => {
    // The memberKey unique index is what stops one document being scheduled
    // twice in a release. Callers should meet NextlyError, not the adapter's
    // DatabaseError.
    const { svc, repo } = service({ holds: ["create"] });
    repo.addMember.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE constraint failed"), { code: "23505" })
    );
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "DUPLICATE",
    });
  });

  it("lets an unexpected database failure through rather than calling it a duplicate", async () => {
    // The control on the case above: narrow translation only. A connection
    // fault reported as "already exists" would send an operator hunting for a
    // row that is not there.
    const { svc, repo } = service({ holds: ["create"] });
    repo.addMember.mockRejectedValueOnce(new Error("connection reset"));
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toThrow(
      "connection reset"
    );
  });
});

describe("ReleasesService protects a committed release", () => {
  it("requires publish authority to add to a SCHEDULED release", async () => {
    // The drain reads membership at the scheduled instant, not at scheduling
    // time. So `create` alone would let a caller append content to a launch a
    // publisher already committed to — the escalation the publish authority
    // exists to prevent, arriving after the decision instead of before it.
    const { svc, repo } = service({ holds: ["create"] });
    repo.touchIfAssemblable.mockResolvedValueOnce(false);
    repo.findReleases.mockResolvedValueOnce([{ id: "r1", state: "scheduled" }]);
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("lets a publisher add to a scheduled release", async () => {
    // The control on the case above: the refusal must be about the AUTHORITY,
    // not about the state. Without this, freezing membership outright would
    // pass the test above and be wrong.
    const { svc, repo } = service({ holds: ["create", "publish"] });
    repo.touchIfAssemblable.mockResolvedValueOnce(false);
    repo.findReleases.mockResolvedValueOnce([{ id: "r1", state: "scheduled" }]);
    await svc.addMember("r1", MEMBER, ADMIN);
    expect(repo.addMember).toHaveBeenCalled();
  });

  it("refuses an unusable schedule instant before touching the release", async () => {
    // A NaN date reaches timestamp encoding and fails differently per dialect,
    // so the caller's mistake arrives as an opaque driver error rather than the
    // sentence naming it.
    const { svc, repo } = service({ holds: ["publish"] });
    await expect(
      svc.schedule("r1", new Date("not a date"), "UTC", ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });

  it("applies one title limit, so the narrowest dialect defines the contract", async () => {
    // `title` is varchar(255) on MySQL and unbounded text elsewhere. Left to the
    // database, the same call succeeds on two engines and truncates on the
    // third — returning a row that disagrees with what is stored.
    const { svc, repo } = service({ holds: ["create"] });
    await expect(
      svc.create({ title: "x".repeat(256) }, ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.createRelease).not.toHaveBeenCalled();

    await svc.create({ title: "x".repeat(255) }, ADMIN);
    expect(repo.createRelease).toHaveBeenCalled();
  });
});

describe("ReleasesService closes the window around a committed release", () => {
  it("undoes the member when the release is scheduled during the insert", async () => {
    // The claim cannot cover the insert itself: a publisher can schedule
    // between the two, and the drain reads membership at the instant. Detected
    // after the write and COMPENSATED — a member that should not be there is
    // removable, while a publish that already happened is not.
    const { svc, repo } = service({ holds: ["create"] });
    repo.touchIfAssemblable
      .mockResolvedValueOnce(true) // the claim succeeds: still a draft
      .mockResolvedValueOnce(false); // scheduled while we were inserting
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.removeMember).toHaveBeenCalledWith("m1");
  });

  it("does not re-check for a caller who may publish", async () => {
    // For them adding to a scheduled release is allowed, so there is nothing to
    // undo — and a second fence call would refuse a legitimate write.
    const { svc, repo } = service({ holds: ["create", "publish"] });
    await svc.addMember("r1", MEMBER, ADMIN);
    expect(repo.touchIfAssemblable).toHaveBeenCalledTimes(1);
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("requires publish authority to remove a member from a scheduled release", async () => {
    // Removing an `unpublish` member CANCELS a committed takedown and leaves
    // content live. The earlier reasoning — that removal can only make less go
    // live — was wrong in exactly that direction.
    const { svc, repo } = service({ holds: ["create"] });
    repo.touchIfAssemblable.mockResolvedValueOnce(false);
    repo.findReleases.mockResolvedValueOnce([{ id: "r1", state: "scheduled" }]);
    await expect(svc.removeMember("m1", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("treats removing an already-gone member as done, not as an error", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.findMember.mockResolvedValueOnce(undefined);
    await expect(svc.removeMember("gone", ADMIN)).resolves.toBeUndefined();
    expect(repo.removeMember).not.toHaveBeenCalled();
  });
});

describe("ReleasesService refuses input the database would answer differently", () => {
  it("refuses an author who cannot act, rather than scheduling a pass that always fails", async () => {
    // Non-null is not enough: a deleted or deactivated author yields
    // AUTHOR_UNAVAILABLE on every drain, and the only symptom is content that
    // never appeared.
    const { svc, repo } = service({ holds: ["create"] });
    repo.liveAuthors.mockResolvedValueOnce(new Set<string>());
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("refuses a timezone longer than the narrowest dialect stores", async () => {
    const { svc, repo } = service({ holds: ["publish"] });
    await expect(
      svc.schedule("r1", new Date(), "x".repeat(65), ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });

  it("refuses a negative limit, which SQLite reads as NO limit", async () => {
    // `LIMIT -1` on SQLite means unbounded, so a query documented as "at most N"
    // would return every release.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(svc.find({ limit: -1 }, ADMIN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(repo.findReleases).not.toHaveBeenCalled();
  });
});

describe("ReleasesService honours a scoped API key over its owner", () => {
  const KEY = (permissions: string[]) => ({
    userId: "owner",
    overrideAccess: false,
    authenticatedScope: { actorType: "apiKey" as const, permissions },
  });

  it("allows a key holding the grant even when its owner does not", async () => {
    // The stamped scope is authoritative in BOTH directions. Resolving from the
    // owner instead would deny a key that was explicitly granted the authority.
    const { svc, repo, deps } = service({ holds: [] });
    await svc.find({}, KEY(["read-content-releases"]));
    expect(repo.findReleases).toHaveBeenCalled();
    // The owner's grants are never consulted for a scoped key.
    expect(deps.canManageReleases).not.toHaveBeenCalled();
  });

  it("denies a key without the grant however privileged its owner", async () => {
    // The direction that matters more: a key scoped to read content must not
    // inherit the power to schedule a publish from the person who created it.
    const { svc, repo } = service({ holds: ["read", "create", "publish"] });
    await expect(
      svc.schedule("r1", new Date(), "UTC", KEY(["read-content-releases"]))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });
});

describe("ReleasesService carries the key scope into the DOCUMENT check", () => {
  it("hands the scope to the document check, not just the release check", async () => {
    // The gap this closes: honouring the key for the release resource and then
    // resolving the DOCUMENT from the owner admits a key that holds
    // create-content-releases but not publish-posts, whose owner can publish
    // posts. The member is inserted and later materialised AS that privileged
    // owner — a narrow key scheduling a publish it was never granted.
    const scope = {
      actorType: "apiKey" as const,
      permissions: ["create-content-releases"],
    };
    const { svc, deps } = service({ holds: [] });
    await svc.addMember("r1", MEMBER, {
      userId: "owner",
      overrideAccess: false,
      authenticatedScope: scope,
      userRoles: ["editor"],
    });
    expect(deps.canActOnDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedScope: scope,
        userRoles: ["editor"],
      })
    );
  });

  it("refuses when the document check denies the key, however privileged the owner", async () => {
    const { svc, repo } = service({ holds: [], mayActOnDocument: false });
    await expect(
      svc.addMember("r1", MEMBER, {
        userId: "owner",
        overrideAccess: false,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["create-content-releases"],
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.addMember).not.toHaveBeenCalled();
  });
});
