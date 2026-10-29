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

import { NextlyError } from "../../../errors";
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_MEMBER_LIMIT,
} from "../../../schemas/releases/types";
import { releaseMemberKey } from "../release-member-key";
import { RELEASE_LIST_ORDERS } from "../releases-repository";
import { ReleasesService } from "../services/releases-service";
import type {
  ReleaseAuthority,
  ReleasesServiceDeps,
} from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const ADMIN = { userId: "u1" };
const ANON = { userId: null };

/** Every repository method the service can reach, all spies. */
function repository() {
  return {
    createRelease: vi.fn(async () => ({ id: "r1" })),
    scheduleReleaseOk: true,
    findReleases: vi.fn(
      async (): Promise<
        Array<{
          id: string;
          state: string;
          title?: string;
          description?: string | null;
          kind?: string;
          timezone?: string;
          revision?: number;
          scheduledAt?: Date | null;
        }>
      > => [{ id: "r1", state: "draft", revision: 0 }]
    ),
    // The list's paged read, which `find` routes every non-document query to.
    findReleasePage: vi.fn(async () => ({ rows: [], total: 0 })),
    countReleases: vi.fn(async () => 0),
    anyRelease: vi.fn(async () => false),
    // The calendar's read. Answers nothing; a case asserts what it was ASKED.
    findReleaseCalendar: vi.fn(async (_query: unknown) => []),
    listMembers: vi.fn(
      async (): Promise<Array<{ id: string; memberKey?: string }>> => []
    ),
    // What a release holds, for the member limit; empty unless a case sets it.
    memberCountsOf: vi.fn(
      async (_ids: readonly string[]) => new Map<string, number>()
    ),
    // Each write takes the states the service judged it may land on as its
    // last argument, which the cases below read back from the call.
    addMember: vi.fn(async (..._args: unknown[]) => ({ id: "m1" })),
    removeMember: vi.fn(async (..._args: unknown[]) => undefined),
    findMember: vi.fn(
      async (): Promise<{ id: string; releaseId: string } | undefined> => ({
        id: "m1",
        releaseId: "r1",
      })
    ),
    liveAuthors: vi.fn(async (ids: string[]) => new Set(ids)),
    scheduleRelease: vi.fn(async (..._args: unknown[]) => true),
    // Publish now on a release already due: its event, with no move.
    recordPublishNow: vi.fn(async (..._args: unknown[]) => true),
    cancelRelease: vi.fn(async () => true),
    updateReleaseDetails: vi.fn(
      async (
        ..._args: unknown[]
      ): Promise<{
        row: Record<string, unknown>;
        changed: Array<"title" | "description">;
      } | null> => null
    ),
    // Each release's run history, for the delete rule; none recorded unless a
    // case sets it.
    runHistoriesOf: vi.fn(
      async (_ids: readonly string[]) =>
        new Map<string, { recorded: boolean; ran: boolean }>()
    ),
    // Answers the row its delete found under the lock, or null.
    deleteRelease: vi.fn(
      async (..._args: unknown[]): Promise<Record<string, unknown> | null> =>
        null
    ),
    // The `containing` listing's own read. Present so a test can drive that
    // branch to completion rather than dying on a missing collaborator, which
    // would fail for a reason unrelated to the property under test.
    findDueMembersFor: vi.fn(async () => new Map<string, unknown[]>()),
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
    // Every target is there and has a lifecycle; the checks have their own
    // tests (`release-targets.test.ts`).
    targets: {
      readDocument: async (target: { entryId: string }) => ({
        id: target.entryId,
      }),
      declaresLifecycle: async () => true,
    },
    canActOnDocument: vi.fn(
      async (_params: {
        userId: string;
        scopeSlug: string;
        action: string;
        authenticatedScope?: unknown;
      }) => over?.mayActOnDocument !== false
    ),
    runDrainNow: vi.fn(
      async (_options: { maxDurationMs: number }) => undefined
    ),
    // Every reader may read every member: these tests are not about which
    // documents a reader sees.
    readableMembers: async (members: readonly { id: string }[]) =>
      new Set(members.map(member => member.id)),
    logger: {
      warn: vi.fn((_message: string, _meta?: Record<string, unknown>) => {}),
    },
    checks: READY_CHECKS,
    recordActivity: vi.fn(async (_entry: unknown) => undefined),
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

  it("refuses to read releases to a caller holding none of the three", async () => {
    const { svc, repo } = service({ holds: [] });
    await expect(svc.find({}, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("lets an assembler read, because creating implies seeing what you made", async () => {
    // The three grants are seeded independently, so a role holding only
    // `create` could otherwise create a release through the API and then find
    // nothing in the admin — not the list, and not the release it just made.
    // The implication is one-directional; the control for that is below.
    const { svc, repo } = service({ holds: ["create"] });
    await expect(svc.find({}, ADMIN)).resolves.toBeDefined();
    expect(repo.findReleasePage).toHaveBeenCalled();
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
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("lets a trusted in-process caller through without a permission store", async () => {
    // `overrideAccess` is what the Direct API is, and it must NOT be inferred
    // from a null user: anonymous and trusted are different things.
    const { svc, repo, deps } = service({ holds: [] });
    await svc.find({}, { userId: null, overrideAccess: true });
    expect(deps.canManageReleases).not.toHaveBeenCalled();
    expect(repo.findReleasePage).toHaveBeenCalled();
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
      expect.objectContaining({ createdBy: "u1", releaseId: "r1" }),
      expect.anything(),
      expect.any(Function),
      // And the release's history names the same person as adding it.
      { kind: "person", userId: "u1" }
    );
  });

  it("records the actor as the release's author on create", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    await svc.create(
      { title: "Launch", createdBy: "someone-else" } as never,
      ADMIN
    );
    expect(repo.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "u1" }),
      { kind: "person", userId: "u1" }
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
    repo.findReleases.mockResolvedValue([]);
    await expect(svc.addMember("nope", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("refuses a member on a release that will never run again", async () => {
    const { svc, repo } = service({ holds: ["create"] });
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

describe("ReleasesService keeps a single-document release to one document", () => {
  it("calls the same Single again a duplicate, whatever id the caller sent", async () => {
    // A Single is recorded by its own row, so a stale id names the same
    // document: the member key is built from the resolved id.
    const { svc, repo, deps } = service({ holds: ["create"] });
    deps.targets.readDocument = async () => ({ id: "row-1" });
    const single = {
      ...MEMBER,
      scopeKind: "single" as const,
      scopeSlug: "home",
    };
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", kind: "single" },
    ]);
    repo.listMembers.mockResolvedValue([
      {
        id: "m0",
        memberKey: releaseMemberKey("r1", { ...single, entryId: "row-1" }),
      },
    ]);
    repo.addMember.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE constraint failed"), { code: "23505" })
    );
    await expect(
      svc.addMember("r1", { ...single, entryId: "stale" }, ADMIN)
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("asks for publish authority on a committed release before saying what it holds", async () => {
    // Without that authority the caller learns nothing of the release's kind
    // or occupancy: the refusal is the access decision, not the conflict.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "scheduled", kind: "single" },
    ]);
    repo.listMembers.mockResolvedValue([{ id: "m0", memberKey: "another" }]);
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("refuses to schedule a single release that has no document yet", async () => {
    const { svc, repo } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", kind: "single" },
    ]);
    repo.listMembers.mockResolvedValue([]);
    await expect(
      svc.schedule("r1", new Date(Date.now() + 86_400_000), "UTC", ADMIN)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });

  it("cancels a single release that has not run when its document is taken out", async () => {
    // Through `cancel` itself: the same permission, the same fenced
    // transition, and the document is not removed from the record.
    for (const state of ["draft", "scheduled", "blocked"]) {
      const { svc, repo } = service({ holds: ["create", "publish"] });
      repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
      repo.findReleases.mockResolvedValue([
        { id: "r1", state, kind: "single" },
      ]);
      await expect(svc.removeMember("m0", ADMIN), state).resolves.toEqual({
        releaseCancelled: true,
      });
      expect(repo.cancelRelease, state).toHaveBeenCalledTimes(1);
      expect(repo.removeMember, state).not.toHaveBeenCalled();
    }
  });

  it("answers a retry on a single release its removal already cancelled as done, writing nothing", async () => {
    // The first removal cancelled the release and kept its document, so a
    // retry after a lost answer finds both. That is the outcome already
    // reached, answered as the first removal answered it, not as a removal
    // from a finished release.
    const { svc, repo } = service({ holds: ["create", "publish"] });
    repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "cancelled", kind: "single" },
    ]);
    await expect(svc.removeMember("m0", ADMIN, "r1")).resolves.toEqual({
      releaseCancelled: true,
    });
    expect(repo.cancelRelease).not.toHaveBeenCalled();
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("asks a retry on a cancelled single release the permission the cancel asked", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "cancelled", kind: "single" },
    ]);
    await expect(svc.removeMember("m0", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage:
        "Removing the last document cancels this release, which needs permission to schedule or cancel releases.",
    });
    expect(repo.cancelRelease).not.toHaveBeenCalled();
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("refuses taking it out to whoever may not cancel, and changes nothing", async () => {
    // In every unrun state. `capabilities` does not offer this caller the
    // removal, and the write holds the cancel permission whatever a client
    // offers.
    for (const state of ["draft", "scheduled", "blocked"]) {
      const { svc, repo, deps } = service({ holds: ["create"] });
      repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
      repo.findReleases.mockResolvedValue([
        { id: "r1", state, kind: "single" },
      ]);
      await expect(svc.removeMember("m0", ADMIN), state).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicMessage:
          "Removing the last document cancels this release, which needs permission to schedule or cancel releases.",
      });
      // Refused on the permission `cancel` asks for, and nothing written.
      expect(deps.canManageReleases, state).toHaveBeenCalledWith(
        "u1",
        "publish"
      );
      expect(repo.cancelRelease, state).not.toHaveBeenCalled();
      expect(repo.removeMember, state).not.toHaveBeenCalled();
    }
  });

  it("tells whoever may not remove documents at all only what any refusal says", async () => {
    // The control on the sentence above: it is the cancel's refusal that is
    // reworded, not every refusal of a removal.
    const { svc, repo } = service({ holds: [] });
    repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", kind: "single" },
    ]);
    await expect(svc.removeMember("m0", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "You don't have permission to perform this action.",
    });
    expect(repo.cancelRelease).not.toHaveBeenCalled();
  });

  it("refuses taking the document out of a single release that was published", async () => {
    // A cancelled one is the retry answered as done, above.
    const { svc, repo } = service({ holds: ["create", "publish"] });
    repo.findMember.mockResolvedValue({ id: "m0", releaseId: "r1" });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "published", kind: "single" },
    ]);
    await expect(svc.removeMember("m0", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.cancelRelease).not.toHaveBeenCalled();
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  const SINGLE = { id: "r1", state: "draft", kind: "single" };
  const HELD = { id: "m0", memberKey: "another-document" };

  it("refuses a second document before writing anything, saying what to do", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([SINGLE]);
    repo.listMembers.mockResolvedValue([HELD]);
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/ordinary release/),
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("lets an ordinary release holding a document take another", async () => {
    // The control: the rule is the kind's, not the member count's.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([{ ...SINGLE, kind: "release" }]);
    repo.listMembers.mockResolvedValue([HELD]);
    await svc.addMember("r1", MEMBER, ADMIN);
    expect(repo.addMember).toHaveBeenCalledTimes(1);
  });

  it("reports the index refusing a racing second document as the same conflict", async () => {
    // The early check saw an empty release; by the insert, another add had
    // landed, and the single-slot index refused this one.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([SINGLE]);
    repo.listMembers.mockResolvedValueOnce([]).mockResolvedValue([HELD]);
    repo.addMember.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE constraint failed"), { code: "23505" })
    );
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("still calls the same document twice a duplicate", async () => {
    // A single release already holding THIS document: the member key, not the
    // slot, is what refused it, and the caller is told so.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([SINGLE]);
    repo.listMembers.mockResolvedValue([
      { id: "m0", memberKey: releaseMemberKey("r1", MEMBER) },
    ]);
    repo.addMember.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE constraint failed"), { code: "23505" })
    );
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "DUPLICATE",
    });
  });

  it("refuses an unknown kind when a release is made", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    await expect(
      svc.create(
        { title: "Launch", kind: "singles" } as unknown as Parameters<
          typeof svc.create
        >[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.createRelease).not.toHaveBeenCalled();
  });
});

describe("ReleasesService protects a committed release", () => {
  it("requires publish authority to add to a SCHEDULED release", async () => {
    // The drain reads membership at the scheduled instant, not at scheduling
    // time. So `create` alone would let a caller append content to a launch a
    // publisher already committed to — the escalation the publish authority
    // exists to prevent, arriving after the decision instead of before it.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([{ id: "r1", state: "scheduled" }]);
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
    repo.findReleases.mockResolvedValue([{ id: "r1", state: "scheduled" }]);
    await svc.addMember("r1", MEMBER, ADMIN);
    // And the write is fenced on states that admit the scheduled release, or
    // it would refuse the add the judgement allowed.
    expect(repo.addMember.mock.calls[0]?.[1]).toContain("scheduled");
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

describe("ReleasesService fences a membership change on its judgement", () => {
  /** The states the last write of this kind was fenced on. */
  function fencedOn(write: { mock: { calls: unknown[][] } }): unknown {
    return write.mock.calls.at(-1)?.[1];
  }

  it("hands the write the member limit, judged under its lock", async () => {
    // The early count can be raced; the check the write asks under the
    // release lock is the one that holds, so it must be the limit's own rule.
    const { svc, repo } = service({ holds: ["create"] });
    await svc.addMember("r1", MEMBER, ADMIN);
    const check = repo.addMember.mock.calls.at(-1)?.[2] as (
      held: number
    ) => unknown;
    expect(check(RELEASE_MEMBER_LIMIT - 1)).toBeNull();
    expect(check(RELEASE_MEMBER_LIMIT)).toMatchObject({ code: "CONFLICT" });
  });

  it("fences an add judged against a draft on the assembling states alone", async () => {
    // A publisher can schedule between the judgement and the write, and the
    // drain reads membership at the instant. The write's fence is what refuses
    // the member then; a fence that admitted `scheduled` would let a caller who
    // never passed the publish gate add to a committed launch.
    const { svc, repo } = service({ holds: ["create"] });
    await svc.addMember("r1", MEMBER, ADMIN);
    expect(fencedOn(repo.addMember)).toEqual(RELEASE_ASSEMBLABLE_FROM);
  });

  it("fences it there even for a caller who may publish", async () => {
    // The judgement was formed on a draft, so the publish authority was never
    // asked: what may land is what was judged, not what the caller could have
    // been allowed.
    const { svc, repo, deps } = service({ holds: ["create", "publish"] });
    await svc.addMember("r1", MEMBER, ADMIN);
    expect(fencedOn(repo.addMember)).toEqual(RELEASE_ASSEMBLABLE_FROM);
    expect(deps.canManageReleases).not.toHaveBeenCalledWith("u1", "publish");
  });

  it("answers a release that moved after the judgement as a conflict, undoing nothing", async () => {
    // The repository refuses inside the transaction, before anything is
    // written, so there is no member to take back out.
    const { svc, repo } = service({ holds: ["create"] });
    repo.addMember.mockRejectedValueOnce(
      NextlyError.conflict({
        logContext: { reason: "release-moved-since-judged" },
      })
    );
    await expect(svc.addMember("r1", MEMBER, ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("requires publish authority to remove a member from a scheduled release", async () => {
    // Removing an `unpublish` member CANCELS a committed takedown and leaves
    // content live. The earlier reasoning — that removal can only make less go
    // live — was wrong in exactly that direction.
    const { svc, repo } = service({ holds: ["create"] });
    repo.findReleases.mockResolvedValue([{ id: "r1", state: "scheduled" }]);
    await expect(svc.removeMember("m1", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.removeMember).not.toHaveBeenCalled();
  });

  it("treats removing an already-gone member as done, not as an error", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.findMember.mockResolvedValueOnce(undefined);
    // Done, and nothing cancelled: the member was already gone.
    await expect(svc.removeMember("gone", ADMIN)).resolves.toEqual({
      releaseCancelled: false,
    });
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

  it("refuses an order it does not recognise, rather than defaulting", async () => {
    // 🔴 An unrecognised `order` fails more quietly than an unrecognised
    // `state`. `state` reaches a WHERE clause, so a typo answers with an empty
    // list -- wrong, but visibly so. `order` reaches a ternary, so `"soonestt"`
    // selects the DEFAULT end and answers with real releases in the exact
    // reverse of what was asked, with nothing in the result to say so.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(
        { order: "soonestt" } as unknown as Parameters<typeof svc.find>[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("accepts both orders the vocabulary declares", async () => {
    // The control, driven FROM the vocabulary rather than from a literal pair:
    // a validator checking against a hand-copied list would pass this while
    // rejecting a value the type admits, and adding a third order later would
    // not widen this test.
    for (const order of RELEASE_LIST_ORDERS) {
      const { svc, repo } = service({ holds: ["read"] });
      await svc.find({ order }, ADMIN);
      expect(repo.findReleasePage).toHaveBeenCalledWith(
        expect.objectContaining({ order })
      );
    }
  });

  it("refuses `order` alongside `containing`, rather than ignoring it", async () => {
    // 🔴 `containing` routes to a different query whose soonest-first order is
    // its CONTRACT: `resolveReleaseEffect` reads the last row as the final
    // state, so applying a caller's order there hands the winner's place to the
    // loser. Accepting the field and dropping it would answer a different
    // question than the one asked, with rows that look right.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(
        {
          containing: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e1",
            locale: null,
          },
          order: "latest",
          // Through `unknown`, because the type REFUSES the direct cast -- the
          // compiler saying the two shapes do not overlap is the type-level
          // exclusion working, and this test exists for the callers a type
          // cannot bind: JavaScript, and a cast exactly like this one.
        } as unknown as Parameters<typeof svc.find>[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findDueMembersFor).not.toHaveBeenCalled();
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("forwards `order` to the repository when nothing narrows by document", async () => {
    // 🔴 The other half of the guard above, and it had NO coverage: refusing
    // every query carrying `order` broke nothing, because the widget resolver's
    // test mocks `find` and the ordering integration test calls the repository
    // directly. Nothing exercised this routing.
    //
    // Asserting the forwarded query rather than the rows is right at THIS seam:
    // the service's job here is to route, and what the ordering actually does to
    // real rows is covered against a database in
    // `releases-repository.integration.test.ts`.
    const { svc, repo } = service({ holds: ["read"] });
    await svc.find({ order: "soonest", limit: 3 }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenCalledWith(
      expect.objectContaining({ order: "soonest", limit: 3 })
    );
  });

  it("still answers `containing` on its own", async () => {
    // The control. A guard keyed on `containing` alone would satisfy the case
    // above and break every document-releases banner.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(
        {
          containing: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e1",
            locale: null,
          },
        },
        ADMIN
      )
    ).resolves.toMatchObject({ rows: [], total: 0 });
    expect(repo.findDueMembersFor).toHaveBeenCalled();
  });

  it("refuses a limit of zero, which pages nothing", async () => {
    // A page of nothing has no next page and no meaningful count of pages, so
    // it is a caller's mistake rather than a smaller page.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(svc.find({ limit: 0 }, ADMIN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("refuses a negative limit, which SQLite reads as NO limit", async () => {
    // `LIMIT -1` on SQLite means unbounded, so a query documented as "at most N"
    // would return every release.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(svc.find({ limit: -1 }, ADMIN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.find pages the list", () => {
  it("asks the repository for the page the caller named, as an offset", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    repo.findReleasePage.mockResolvedValueOnce({ rows: [], total: 41 });
    const page = await svc.find({ tab: "drafts", page: 3, limit: 20 }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "drafts", offset: 40, limit: 20 })
    );
    expect(page).toMatchObject({ total: 41, page: 3, limit: 20 });
  });

  it("defaults to the first page of 50", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    await svc.find({}, ADMIN);
    expect(repo.findReleasePage).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 50 })
    );
  });

  it("orders the upcoming tab and scheduled releases soonest first by default, and the rest latest first", async () => {
    // Three questions, one rule: which end of the timeline a caller who named
    // no order is asking about.
    for (const [query, order] of [
      [{ tab: "upcoming" }, "soonest"],
      [{ state: "scheduled" }, "soonest"],
      [{}, "latest"],
      [{ state: "published" }, "latest"],
    ] as const) {
      const { svc, repo } = service({ holds: ["read"] });
      await svc.find(query, ADMIN);
      expect(repo.findReleasePage).toHaveBeenCalledWith(
        expect.objectContaining({ order })
      );
    }
  });

  it("trims the search, and treats an empty one as none", async () => {
    // A stray space typed into the box would otherwise narrow the list to
    // releases whose text contains a space.
    const { svc, repo } = service({ holds: ["read"] });
    await svc.find({ search: "  spring " }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "spring" })
    );
    await svc.find({ search: "   " }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined })
    );
  });

  it.each([
    ["an unknown tab", { tab: "soon" }],
    ["a tab with a state", { tab: "drafts", state: "draft" }],
    ["an order on a tab with its own", { tab: "done", order: "soonest" }],
    ["a reason without the attention tab", { reason: "overdue" }],
    ["a reason on another tab", { tab: "upcoming", reason: "overdue" }],
    ["an unknown reason", { tab: "attention", reason: "late" }],
    ["an unknown state", { state: "schedule" }],
    ["an unknown kind", { kind: "singles" }],
    ["a search past the limit", { search: "x".repeat(201) }],
    ["page 0", { page: 0 }],
    ["a null page", { page: null }],
    ["a null limit", { limit: null }],
    ["a fractional page", { page: 1.5 }],
    ["a page larger than the maximum", { limit: 201 }],
    ["a page past the safe integers", { page: 1e308 }],
    [
      "a page whose offset is past the safe integers",
      { page: 2 ** 52, limit: 200 },
    ],
    ["a search that is not text", { search: 42 }],
    ["a window bound that is not a Date", { scheduledAfter: "tomorrow" }],
    [
      "a window bound that is an invalid Date",
      { scheduledBefore: new Date("nope") },
    ],
  ])("refuses %s, naming it, before reading anything", async (_, query) => {
    // Each would otherwise answer with rows that look right: an unknown tab or
    // state matches nothing and reads as "no releases", and an order a tab
    // cannot honour would be silently dropped.
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(query as unknown as Parameters<typeof svc.find>[0], ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("checks the window bounds of a document's releases too", async () => {
    // The document listing filters in memory; a bound that is not a Date
    // would fail there as a TypeError, or as NaN would silently not filter.
    const { svc, repo } = service({ holds: ["read"] });
    for (const bound of [
      { scheduledAfter: "tomorrow" },
      { scheduledBefore: new Date("nope") },
    ]) {
      await expect(
        svc.find(
          {
            containing: {
              scopeKind: "collection",
              scopeSlug: "posts",
              entryId: "e1",
              locale: null,
            },
            ...bound,
          } as unknown as Parameters<typeof svc.find>[0],
          ADMIN
        )
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(repo.findDueMembersFor).not.toHaveBeenCalled();
  });

  it("names the fix when `reason` comes without the attention tab", async () => {
    const { svc } = service({ holds: ["read"] });
    await expect(svc.find({ reason: "overdue" }, ADMIN)).rejects.toMatchObject({
      publicMessage: expect.stringContaining(
        '`reason` needs `tab: "attention"`'
      ),
    });
  });

  it("passes the reason through with the attention tab", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    await svc.find({ tab: "attention", reason: "overdue" }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "attention", reason: "overdue" })
    );
  });

  it.each([
    ["tab", "upcoming"],
    ["search", "spring"],
    ["reason", "overdue"],
  ])("refuses `%s` alongside `containing`", async (key, value) => {
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(
        {
          containing: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e1",
            locale: null,
          },
          [key]: value,
        } as unknown as Parameters<typeof svc.find>[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findDueMembersFor).not.toHaveBeenCalled();
  });
});

describe("ReleasesService narrows the list to one day in a zone", () => {
  const BERLIN_SPRING = { date: "2026-03-29", timezone: "Europe/Berlin" };

  it("asks the database for that day's instants in that zone, soonest first", async () => {
    // The day the clocks go forward in Berlin, so a span of 24 hours from
    // midnight, or midnight in UTC, both name instants a calendar in Berlin
    // puts on another day.
    const { svc, repo } = service({ holds: ["read"] });
    await svc.find({ day: BERLIN_SPRING }, ADMIN);
    expect(repo.findReleasePage).toHaveBeenCalledWith(
      expect.objectContaining({
        placedWithin: {
          start: new Date("2026-03-28T23:00:00Z"),
          end: new Date("2026-03-29T22:00:00Z"),
        },
        // In the day's own order, so the releases a calendar shows on the day
        // are the first rows here.
        order: "soonest",
      })
    );
  });

  it("counts a day with the same span", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    await svc.count({ day: BERLIN_SPRING }, ADMIN);
    expect(repo.countReleases).toHaveBeenCalledWith(
      expect.objectContaining({
        placedWithin: {
          start: new Date("2026-03-28T23:00:00Z"),
          end: new Date("2026-03-29T22:00:00Z"),
        },
      })
    );
  });

  it.each([
    ["a day that is not an object", { day: "2026-03-29" }],
    ["a day with no zone", { day: { date: "2026-03-29" } }],
    [
      "a day in an unknown zone",
      { day: { date: "2026-03-29", timezone: "Mars/Olympus" } },
    ],
    [
      "a day that does not exist",
      { day: { date: "2026-02-30", timezone: "UTC" } },
    ],
  ])("refuses %s before reading anything", async (_, query) => {
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(query as unknown as Parameters<typeof svc.find>[0], ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findReleasePage).not.toHaveBeenCalled();
  });

  it("refuses a day alongside `containing`", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.find(
        {
          containing: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e1",
            locale: null,
          },
          day: BERLIN_SPRING,
        } as unknown as Parameters<typeof svc.find>[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findDueMembersFor).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.calendar", () => {
  const WINDOW = {
    from: "2026-03-01",
    to: "2026-04-11",
    timezone: "Europe/Berlin",
  };

  it("reads each day of the window in the zone, with three releases a day", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    const calendar = await svc.calendar({ ...WINDOW, kind: "release" }, ADMIN);
    expect(calendar).toMatchObject({ ...WINDOW, days: [] });

    const asked = repo.findReleaseCalendar.mock.calls[0]?.[0] as {
      days: { date: string; start: Date; end: Date }[];
      kind?: string;
      perDay: number;
    };
    expect(asked.kind).toBe("release");
    expect(asked.perDay).toBe(3);
    expect(asked.days).toHaveLength(42);
    expect(asked.days[0]).toEqual({
      date: "2026-03-01",
      start: new Date("2026-02-28T23:00:00Z"),
      end: new Date("2026-03-01T23:00:00Z"),
    });
    // After the clocks went forward, a Berlin day starts at 22:00 UTC.
    expect(asked.days[41]).toEqual({
      date: "2026-04-11",
      start: new Date("2026-04-10T22:00:00Z"),
      end: new Date("2026-04-11T22:00:00Z"),
    });
  });

  it.each([
    ["a window longer than six weeks", { ...WINDOW, to: "2026-04-12" }],
    ["a window that ends before it starts", { ...WINDOW, to: "2026-02-28" }],
    ["an unknown zone", { ...WINDOW, timezone: "Europe/Berln" }],
    ["an unknown kind", { ...WINDOW, kind: "singles" }],
  ])("refuses %s without reading", async (_, query) => {
    const { svc, repo } = service({ holds: ["read"] });
    await expect(
      svc.calendar(
        query as unknown as Parameters<typeof svc.calendar>[0],
        ADMIN
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findReleaseCalendar).not.toHaveBeenCalled();
  });

  it("refuses a caller who may not read releases, before judging the window", async () => {
    const { svc, repo } = service({ holds: [] });
    await expect(
      svc.calendar({ ...WINDOW, to: "2027-01-01" }, ADMIN)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.findReleaseCalendar).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.count", () => {
  it("counts with the list's own filters, checked the same way", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    repo.countReleases.mockResolvedValueOnce(4);
    await expect(
      svc.count({ tab: "attention", search: " late " }, ADMIN)
    ).resolves.toBe(4);
    expect(repo.countReleases).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "attention", search: "late" })
    );
    await expect(
      svc.count({ tab: "drafts", state: "draft" }, ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a caller who may not read releases", async () => {
    const { svc, repo } = service({ holds: [] });
    await expect(svc.count({ tab: "attention" }, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.countReleases).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.mayRead", () => {
  it("answers by the decision every read makes, implication included", async () => {
    expect(await service({ holds: ["read"] }).svc.mayRead(ADMIN)).toBe(true);
    // Creating or publishing a release implies reading one, as for `count`.
    expect(await service({ holds: ["create"] }).svc.mayRead(ADMIN)).toBe(true);
    expect(await service({ holds: [] }).svc.mayRead(ADMIN)).toBe(false);
    expect(
      await service({ holds: ["read"] }).svc.mayRead({ userId: null })
    ).toBe(false);
  });

  it("throws a failure that is not a refusal, rather than answering no", async () => {
    const { svc, deps } = service({ holds: ["read"] });
    deps.canManageReleases.mockRejectedValueOnce(new Error("store down"));
    await expect(svc.mayRead(ADMIN)).rejects.toThrow("store down");
  });
});

describe("ReleasesService.anyReadable", () => {
  it("refuses whoever the list refuses, and reads nothing for them", async () => {
    // The same decision as `find`, so it never says "yes" where the list
    // would refuse to show a release.
    const { svc, repo } = service({ holds: [] });
    await expect(svc.anyReadable(ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(svc.find({}, ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.anyRelease).not.toHaveBeenCalled();
  });

  it("asks through the filters an unfiltered list reads, and answers what the repository finds", async () => {
    const { svc, repo } = service({ holds: ["read"] });
    repo.anyRelease.mockResolvedValueOnce(true);
    // Each request takes its own clock reading (`now`), so the two calls are
    // made at different instants on purpose: the comparison must not depend
    // on both landing in the same millisecond.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
      expect(await svc.anyReadable(ADMIN)).toBe(true);
      vi.setSystemTime(new Date("2026-06-15T10:00:00.005Z"));
      await svc.find({}, ADMIN);
    } finally {
      vi.useRealTimers();
    }
    // The list's own filters for an unfiltered list: the order, the page and
    // the request's own instant aside.
    const {
      order: _order,
      offset: _offset,
      limit: _limit,
      now: listedNow,
      ...listed
    } = (
      repo.findReleasePage.mock.calls[0] as unknown[] | undefined
    )?.[0] as Record<string, unknown>;
    expect(repo.anyRelease).toHaveBeenCalledWith({
      ...listed,
      now: new Date("2026-06-15T10:00:00.000Z"),
    });
    // Each request's own reading, not one shared or remembered: the list's
    // instant is the clock as it stood when the list was asked.
    expect(listedNow).toEqual(new Date("2026-06-15T10:00:00.005Z"));
  });
});

describe("ReleasesService.publishNow", () => {
  it("schedules the release for this moment, then runs the drain within the budget", async () => {
    // Scheduled for later, so it is moved first, fenced on the state and the
    // revision it was read at: the run is the drain's ordinary run of a due
    // release rather than a second way to publish. Then the runner's drain
    // job, bounded by the request's budget; the answer is the release as the
    // drain left it.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases
      .mockResolvedValueOnce([
        {
          id: "r1",
          state: "scheduled",
          timezone: "Asia/Karachi",
          revision: 4,
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      ])
      .mockResolvedValueOnce([
        { id: "r1", state: "published", timezone: "Asia/Karachi", revision: 6 },
      ]);
    const before = Date.now();
    const answer = await svc.publishNow("r1", ADMIN);

    const [id, at, zone, from, revision] = repo.scheduleRelease.mock
      .calls[0] as unknown as [string, Date, string, string[], number];
    expect(id).toBe("r1");
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(zone).toBe("Asia/Karachi");
    expect(from).toEqual(["scheduled"]);
    expect(revision).toBe(4);
    expect(deps.runDrainNow).toHaveBeenCalledTimes(1);
    expect(deps.runDrainNow).toHaveBeenCalledWith({ maxDurationMs: 15_000 });
    // After the move, never before it: a drain run first would find the
    // release not yet due and send nothing.
    expect(repo.scheduleRelease.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runDrainNow.mock.invocationCallOrder[0]
    );
    expect(answer.state).toBe("published");
  });

  it("runs the drain for a release already due without moving it", async () => {
    // Its instant has come, so it is due as it stands. Moving it again would
    // change the instant a drain already running it checks before marking it
    // published, and that drain would leave it for the next pass.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      {
        id: "r1",
        state: "scheduled",
        revision: 2,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    ]);
    await svc.publishNow("r1", ADMIN);
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
    // Not moved, but the history still says who asked.
    expect(repo.recordPublishNow).toHaveBeenCalledWith(
      "r1",
      { kind: "person", userId: "u1" },
      2
    );
    expect(deps.runDrainNow).toHaveBeenCalledWith({ maxDurationMs: 15_000 });
  });

  it("refuses Publish now on a release already due that moved since it was read, and runs nothing", async () => {
    // Rescheduled or cancelled between the read and the event's lock: the
    // repository's fence misses, and the caller is told rather than handed a
    // release it did not run.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      {
        id: "r1",
        state: "scheduled",
        revision: 2,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    ]);
    repo.recordPublishNow.mockResolvedValueOnce(false);
    await expect(svc.publishNow("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repo.recordPublishNow).toHaveBeenCalledWith(
      "r1",
      { kind: "person", userId: "u1" },
      2
    );
    expect(deps.runDrainNow).not.toHaveBeenCalled();
  });

  it("still moves a draft to now before running the drain", async () => {
    // The control for the case above: only a release already due is left
    // where it is.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", revision: 0, scheduledAt: null },
    ]);
    await svc.publishNow("r1", ADMIN);
    expect(repo.scheduleRelease).toHaveBeenCalledTimes(1);
    expect(deps.runDrainNow).toHaveBeenCalledTimes(1);
  });

  it("answers the release as it stands when the drain could not be started, and logs it", async () => {
    // The move has happened and the release is due, so the runner sends it
    // whatever happened here. Failing the request would report a release that
    // is going out as one that is not.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases
      .mockResolvedValueOnce([{ id: "r1", state: "draft", revision: 0 }])
      .mockResolvedValueOnce([{ id: "r1", state: "scheduled", revision: 1 }]);
    deps.runDrainNow.mockRejectedValueOnce(new Error("jobs table is gone"));

    const answer = await svc.publishNow("r1", ADMIN);

    expect(answer).toMatchObject({ id: "r1", state: "scheduled", revision: 1 });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        releaseId: "r1",
        error: "jobs table is gone",
      })
    );
  });

  it("answers scheduled when the drain sent nothing, rather than published", async () => {
    // Another runner held the drain, or the budget ran out: the release is
    // due and going out, and saying it is published would be untrue.
    const { svc, repo } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "scheduled", revision: 1 },
    ]);
    const answer = await svc.publishNow("r1", ADMIN);
    expect(answer.state).toBe("scheduled");
  });

  it.each([
    ["published", "Create a new release"],
    ["cancelled", "create a new release"],
    ["blocked", "schedule it again"],
  ])(
    "refuses a %s release, saying what to do instead, before writing anything",
    async (state, advice) => {
      const { svc, repo, deps } = service({ holds: ["publish"] });
      repo.findReleases.mockResolvedValue([{ id: "r1", state }]);
      await expect(svc.publishNow("r1", ADMIN)).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(advice),
      });
      expect(repo.scheduleRelease).not.toHaveBeenCalled();
      expect(deps.runDrainNow).not.toHaveBeenCalled();
    }
  );

  it("refuses a caller who may assemble releases but not publish them", async () => {
    // Running a release is the act that puts content live, the same power
    // scheduling needs.
    const { svc, repo, deps } = service({ holds: ["create", "read"] });
    await expect(svc.publishNow("r1", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
    expect(deps.runDrainNow).not.toHaveBeenCalled();
  });

  it("does not run a release that moved between the read and the write", async () => {
    // Cancelled by someone else in that window, or moved by a second request
    // that read the same revision: the fenced write matches nothing, and the
    // request is refused with nothing run on its behalf.
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([{ id: "r1", state: "draft" }]);
    repo.scheduleRelease.mockResolvedValueOnce(false);
    await expect(svc.publishNow("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(deps.runDrainNow).not.toHaveBeenCalled();
  });

  it.each(["draft", "scheduled"])(
    "refuses a %s single-document release with no document, as scheduling does",
    async state => {
      // Run now, it would publish nothing and read as done: final, with
      // nothing in it. The same refusal scheduling makes, before any write.
      const { svc, repo, deps } = service({ holds: ["publish"] });
      repo.findReleases.mockResolvedValue([
        { id: "r1", state, kind: "single", revision: 0 },
      ]);
      repo.listMembers.mockResolvedValue([]);
      await expect(svc.publishNow("r1", ADMIN)).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(
          "A single-document release needs its document"
        ),
      });
      expect(repo.scheduleRelease).not.toHaveBeenCalled();
      expect(deps.runDrainNow).not.toHaveBeenCalled();
    }
  );

  it("answers not found for a release that does not exist", async () => {
    const { svc, repo, deps } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([]);
    await expect(svc.publishNow("nope", ADMIN)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(deps.runDrainNow).not.toHaveBeenCalled();
  });
});

describe("a finished release offers nothing to change", () => {
  it.each(["published", "cancelled"])(
    "offers no schedule, membership change or publish now on a %s release",
    async state => {
      // The admin draws its controls from these, so a finished release that
      // still offered one would show a button the server then refuses.
      const { svc } = service({ holds: ["publish", "create", "read"] });
      const can = await svc.capabilities([{ id: "r1", state } as never], ADMIN);
      expect(can.get("r1")).toEqual({
        schedule: false,
        cancel: false,
        addMember: false,
        removeMember: false,
        publishNow: false,
        update: false,
        delete: false,
      });
    }
  );

  it("still lets a stopped release be fixed and rescheduled, but not run as it is", async () => {
    const { svc } = service({ holds: ["publish", "create", "read"] });
    const can = await svc.capabilities(
      [{ id: "r1", state: "blocked" } as never],
      ADMIN
    );
    expect(can.get("r1")).toMatchObject({
      schedule: true,
      removeMember: true,
      publishNow: false,
    });
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
    expect(repo.findReleasePage).toHaveBeenCalled();
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
      apiKeyId: "k1",
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

describe("ReleasesService fences a REMOVAL on its judgement too", () => {
  /** The states the last removal was fenced on. */
  /** The states a removal was fenced on: its second argument. */
  function fencedOn(write: { mock: { calls: unknown[][] } }): unknown {
    return write.mock.calls.at(-1)?.[1];
  }

  it("fences a removal judged against a draft on the assembling states alone", async () => {
    // Removing an `unpublish` member cancels a committed takedown, so a
    // publisher scheduling between the judgement and the delete would have
    // their decision undone by a caller who never passed the publish gate.
    const { svc, repo } = service({ holds: ["create"] });
    await svc.removeMember("m1", ADMIN);
    expect(repo.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", releaseId: "r1" }),
      RELEASE_ASSEMBLABLE_FROM,
      { kind: "person", userId: "u1" }
    );
  });

  it("lets a publisher's removal land on a scheduled ordinary release", async () => {
    // The control: the fence follows the authority the judgement asked for.
    const { svc, repo } = service({ holds: ["create", "publish"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "scheduled", kind: "release" },
    ]);
    await svc.removeMember("m1", ADMIN);
    expect(fencedOn(repo.removeMember)).toContain("scheduled");
  });

  it("answers a release that moved after the judgement as a conflict", async () => {
    const { svc, repo } = service({ holds: ["create"] });
    repo.removeMember.mockRejectedValueOnce(
      NextlyError.conflict({
        logContext: { reason: "release-moved-since-judged" },
      })
    );
    await expect(svc.removeMember("m1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("ReleasesService fences a schedule on the revision it read", () => {
  it("hands the write the revision the read carried", async () => {
    // A membership change landing after the read bumps the revision, so the
    // write misses rather than scheduling contents nobody checked.
    const { svc, repo } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", revision: 7 },
    ]);
    await svc.schedule("r1", new Date(Date.now() + 86_400_000), "UTC", ADMIN);
    expect(repo.scheduleRelease.mock.calls[0]?.[4]).toBe(7);
  });

  it("refuses a release that is not there as unschedulable, writing nothing", async () => {
    const { svc, repo } = service({ holds: ["publish"] });
    repo.findReleases.mockResolvedValue([]);
    await expect(
      svc.schedule("r1", new Date(Date.now() + 86_400_000), "UTC", ADMIN)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.update renames a release under its own permission", () => {
  const NAMED = {
    id: "r1",
    state: "published",
    title: "Spring launch",
    description: "Old notes",
    revision: 3,
  };

  /** The repository's answer for a rename that changed `changed`. */
  function wrote(
    changed: Array<"title" | "description">,
    row: Record<string, unknown> = NAMED
  ) {
    return { row, changed };
  }

  it("refuses a caller without update, whatever else it holds, and writes nothing", async () => {
    // Renaming used to go with assembling. It is its own permission now, so a
    // role holding every other release authority but this one is refused.
    const { svc, repo, deps } = service({
      holds: ["read", "create", "publish", "delete"],
    });
    await expect(
      svc.update("r1", { title: "Renamed" }, ADMIN)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.updateReleaseDetails).not.toHaveBeenCalled();
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    const { svc, repo } = service({ holds: ["update"] });
    await expect(
      svc.update("r1", { title: "Renamed" }, ANON)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.updateReleaseDetails).not.toHaveBeenCalled();
  });

  it("hands the repository only the fields the change names", async () => {
    // The repository decides, under the release's lock, which of them differ.
    const { svc, repo } = service({ holds: ["update"] });
    repo.updateReleaseDetails.mockResolvedValueOnce(wrote(["title"]));
    await svc.update("r1", { title: "Summer launch" }, ADMIN);
    expect(repo.updateReleaseDetails).toHaveBeenCalledWith(
      "r1",
      { title: "Summer launch" },
      { kind: "person", userId: "u1" }
    );
  });

  it("answers and records the row the repository wrote, with the fields it changed, as the user", async () => {
    const { svc, repo, deps } = service({ holds: ["update"] });
    const row = { ...NAMED, title: "Summer launch", description: null };
    repo.updateReleaseDetails.mockResolvedValueOnce(
      wrote(["title", "description"], row)
    );
    const renamed = await svc.update(
      "r1",
      { title: "Summer launch", description: null },
      ADMIN
    );
    expect(renamed).toBe(row);
    // No read after the write: a later one could answer another request's
    // change as this one's.
    expect(repo.findReleases).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith({
      action: "update",
      release: row,
      changedFields: ["title", "description"],
      actor: { type: "user", id: "u1" },
    });
  });

  it("records nothing for a change the repository found already made", async () => {
    const { svc, repo, deps } = service({ holds: ["update"] });
    repo.updateReleaseDetails.mockResolvedValueOnce(wrote([]));
    const answered = await svc.update("r1", { title: "Spring launch" }, ADMIN);
    expect(answered).toBe(NAMED);
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["no field at all", {}],
    ["an empty title", { title: "" }],
    ["a title that is not text", { title: 42 }],
    ["a title too long for every dialect", { title: "x".repeat(256) }],
    ["a description that is not text", { description: 7 }],
  ])("refuses %s before anything is written", async (_name, change) => {
    const { svc, repo } = service({ holds: ["update"] });
    await expect(
      svc.update("r1", change as never, ADMIN)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.updateReleaseDetails).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for a release that is not there", async () => {
    const { svc, repo, deps } = service({ holds: ["update"] });
    repo.updateReleaseDetails.mockResolvedValueOnce(null);
    await expect(
      svc.update("nope", { title: "Renamed" }, ADMIN)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });

  it("records a key's rename as a key, never as the key's owner", async () => {
    // The actor carries the owner's id so the key can be authorized; naming
    // the owner in the trail would put a person against a change they did
    // not make.
    const { svc, repo, deps } = service();
    repo.updateReleaseDetails.mockResolvedValueOnce(wrote(["title"]));
    await svc.update(
      "r1",
      { title: "Renamed" },
      {
        userId: "owner",
        overrideAccess: false,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["update-content-releases"],
        },
        apiKeyId: "k1",
      }
    );
    expect(deps.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { type: "apiKey" } })
    );
    // The release's history names the key by its own id.
    expect(repo.updateReleaseDetails).toHaveBeenCalledWith(
      "r1",
      { title: "Renamed" },
      { kind: "apiKey", keyId: "k1" }
    );
  });

  it("refuses a key's change that does not say which key, before writing it", async () => {
    // A history entry must name the key; recording the owner, or nobody,
    // would put the change against someone who did not make it.
    const { svc, repo } = service();
    await expect(
      svc.update(
        "r1",
        { title: "Renamed" },
        {
          userId: "owner",
          overrideAccess: false,
          authenticatedScope: {
            actorType: "apiKey",
            permissions: ["update-content-releases"],
          },
        }
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.updateReleaseDetails).not.toHaveBeenCalled();
  });

  it("still answers the rename when the activity log cannot be written", async () => {
    // The rename has committed. Failing the request now would report a change
    // that happened as one that did not.
    const { svc, repo, deps } = service({ holds: ["update"] });
    repo.updateReleaseDetails.mockResolvedValueOnce(wrote(["title"]));
    deps.recordActivity.mockRejectedValueOnce(new Error("log is down"));
    await expect(
      svc.update("r1", { title: "Renamed" }, ADMIN)
    ).resolves.toBeDefined();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "A release change could not be recorded",
      expect.objectContaining({ releaseId: "r1", action: "update" })
    );
  });
});

describe("ReleasesService.historyVisibleTo lists only documents the reader may read", () => {
  const about = (entryId: string) => ({
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId,
    locale: null,
    action: "publish",
  });
  const events = [
    { id: "e1", kind: "release-created", payload: null },
    { id: "e2", kind: "release-document-added", payload: about("readable") },
    { id: "e3", kind: "release-document-added", payload: about("unreadable") },
    // A document event whose payload does not say which document.
    {
      id: "e4",
      kind: "release-document-removed",
      payload: { scopeKind: "collection" },
    },
  ];

  /** A service whose reader may read only the document `readable`. */
  function judging() {
    const made = service();
    made.deps.readableMembers = async (
      members: readonly { id: string; entryId?: string }[],
      actor?: { userId: string | null }
    ) =>
      new Set(
        actor?.userId === null
          ? []
          : members
              .filter(member => member.entryId === "readable")
              .map(member => member.id)
      );
    return made;
  }

  it("keeps an event about no document and one about a document the reader may read", async () => {
    const { svc } = judging();
    expect(
      (await svc.historyVisibleTo(events, ADMIN)).map(event => event.id)
    ).toEqual(["e1", "e2"]);
  });

  it("shows a trusted caller every event", async () => {
    const { svc } = judging();
    expect(
      (
        await svc.historyVisibleTo(events, {
          userId: null,
          overrideAccess: true,
        })
      ).map(event => event.id)
    ).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("shows a caller with no user no document", async () => {
    const { svc } = judging();
    expect(
      (await svc.historyVisibleTo(events, ANON)).map(event => event.id)
    ).toEqual(["e1"]);
  });
});

describe("ReleasesService.delete deletes only a release that never ran", () => {
  it("refuses a caller without delete, whatever else it holds, and deletes nothing", async () => {
    const { svc, repo, deps } = service({
      holds: ["read", "create", "publish", "update"],
    });
    await expect(svc.delete("r1", ADMIN)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.findReleases).not.toHaveBeenCalled();
    expect(repo.deleteRelease).not.toHaveBeenCalled();
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });

  it.each(["draft", "cancelled"])(
    "deletes a %s release, and records it",
    async state => {
      const { svc, repo, deps } = service({ holds: ["delete"] });
      repo.findReleases.mockResolvedValue([
        { id: "r1", state, title: "Launch", revision: 1 },
      ]);
      // The repository's row is the answer and the record, not the read
      // before it: here a rename landed in between.
      repo.deleteRelease.mockResolvedValueOnce({
        id: "r1",
        state,
        title: "Relaunch",
        revision: 2,
      });
      expect(await svc.delete("r1", ADMIN)).toMatchObject({
        id: "r1",
        title: "Relaunch",
        state,
      });
      // With who deleted it, for the release's history.
      expect(repo.deleteRelease).toHaveBeenCalledWith("r1", {
        kind: "person",
        userId: "u1",
      });
      expect(deps.recordActivity).toHaveBeenCalledWith({
        action: "delete",
        release: expect.objectContaining({
          id: "r1",
          title: "Relaunch",
          state,
        }),
        actor: { type: "user", id: "u1" },
      });
    }
  );

  it.each([
    ["scheduled", "Cancel it first to call it off"],
    ["blocked", "Cancel it first to call it off"],
    ["published", "record of what went live"],
  ])(
    "refuses a %s release with a CONFLICT saying what to do, and deletes nothing",
    async (state, says) => {
      const { svc, repo, deps } = service({ holds: ["delete"] });
      repo.findReleases.mockResolvedValue([
        { id: "r1", state, title: "Launch", revision: 1 },
      ]);
      await expect(svc.delete("r1", ADMIN)).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(says),
      });
      expect(repo.deleteRelease).not.toHaveBeenCalled();
      expect(deps.recordActivity).not.toHaveBeenCalled();
    }
  );

  /** A cancelled release that was scheduled, and its history as given. */
  function scheduledThenCancelled(
    history: { recorded: boolean; ran: boolean } | undefined
  ) {
    const made = service({ holds: ["delete"] });
    made.repo.findReleases.mockResolvedValue([
      {
        id: "r1",
        state: "cancelled",
        title: "Launch",
        revision: 4,
        scheduledAt: new Date("2026-09-01T09:00:00Z"),
      },
    ]);
    made.repo.runHistoriesOf.mockResolvedValue(
      new Map(history === undefined ? [] : [["r1", history]])
    );
    made.repo.deleteRelease.mockResolvedValueOnce({
      id: "r1",
      state: "cancelled",
      title: "Launch",
      revision: 5,
    });
    return made;
  }

  it("keeps a cancelled release whose history shows it started publishing, naming why in the refusal's data", async () => {
    const { svc, repo, deps } = scheduledThenCancelled({
      recorded: true,
      ran: true,
    });
    await expect(svc.delete("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "This release began publishing before it was cancelled, so it's kept as the record of what went live.",
      publicData: { reason: "was-scheduled" },
    });
    expect(repo.runHistoriesOf).toHaveBeenCalledWith(["r1"]);
    expect(repo.deleteRelease).not.toHaveBeenCalled();
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });

  it("keeps a scheduled-then-cancelled release whose history was never recorded", async () => {
    const { svc, repo } = scheduledThenCancelled(undefined);
    await expect(svc.delete("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "This release was scheduled before its history was recorded, so whether it began publishing is unknown and it's kept as a record.",
      publicData: { reason: "was-scheduled" },
    });
    expect(repo.deleteRelease).not.toHaveBeenCalled();
  });

  it("deletes a scheduled-then-cancelled release whose recorded history shows no run", async () => {
    const { svc, repo } = scheduledThenCancelled({
      recorded: true,
      ran: false,
    });
    await expect(svc.delete("r1", ADMIN)).resolves.toMatchObject({ id: "r1" });
    expect(repo.deleteRelease).toHaveBeenCalled();
  });

  it("answers NOT_FOUND for a release that is not there", async () => {
    const { svc, repo } = service({ holds: ["delete"] });
    repo.findReleases.mockResolvedValue([]);
    await expect(svc.delete("nope", ADMIN)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(repo.deleteRelease).not.toHaveBeenCalled();
  });

  it("refuses with a CONFLICT, and records nothing, when the release moved before the delete", async () => {
    // Read as a draft, scheduled before the fenced delete: the repository
    // refuses, and nothing was deleted to record.
    const { svc, repo, deps } = service({ holds: ["delete"] });
    repo.findReleases.mockResolvedValue([
      { id: "r1", state: "draft", title: "Launch", revision: 1 },
    ]);
    repo.deleteRelease.mockResolvedValueOnce(null);
    await expect(svc.delete("r1", ADMIN)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(deps.recordActivity).not.toHaveBeenCalled();
  });
});
