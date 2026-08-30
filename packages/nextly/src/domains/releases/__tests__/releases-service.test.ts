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
    findReleases: vi.fn(async () => []),
    listMembers: vi.fn(async () => []),
    addMember: vi.fn(async () => ({ id: "m1" })),
    removeMember: vi.fn(async () => undefined),
    scheduleRelease: vi.fn(async () => undefined),
    cancelRelease: vi.fn(async () => undefined),
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
    canActOnDocument: vi.fn(async () => over?.mayActOnDocument !== false),
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
      "u1",
      "posts",
      "unpublish"
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
