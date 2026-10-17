/**
 * The service's readiness: what it reports, and the four doors that refuse on
 * a hard problem — scheduling, Publish now, adding to a scheduled release, and
 * switching a document's action.
 *
 * Every refusal is asserted with the write it guards NOT having happened,
 * because a refusal after the write is not a refusal; and each has a control
 * where the same call, with the problem gone, goes through.
 */
import { describe, expect, it, vi } from "vitest";

import type { ReleaseState } from "../../../schemas/releases/types";
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
} from "../../../schemas/releases/types";
import type { ReleaseMemberRow } from "../releases-repository";
import type {
  ReleaseAuthority,
  ReleaseDocumentChecks,
  ReleasesServiceDeps,
} from "../services/releases-service";
import { ReleasesService } from "../services/releases-service";

import { READY_CHECKS } from "./helpers/ready-checks";

const ACTOR = { userId: "editor" };

function memberRow(
  id: string,
  over: Partial<ReleaseMemberRow> = {}
): ReleaseMemberRow {
  return {
    id,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: `entry-${id}`,
    locale: null,
    action: "publish",
    memberKey: `key-${id}`,
    singleSlot: null,
    createdBy: "author",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    ...over,
  };
}

function service(over: {
  state?: ReleaseState;
  members?: ReleaseMemberRow[];
  checks?: Partial<ReleaseDocumentChecks>;
  holds?: ReleaseAuthority[];
  mayActOnDocument?: boolean;
  scheduledAt?: Date | null;
}) {
  const members = over.members ?? [memberRow("m1")];
  const held = new Set(over.holds ?? ["read", "create", "publish"]);
  const repo = {
    findReleases: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.includes("r1")
        ? [
            {
              id: "r1",
              state: over.state ?? "draft",
              kind: "release",
              revision: 3,
              timezone: "UTC",
              scheduledAt: over.scheduledAt ?? null,
            },
          ]
        : []
    ),
    listMembers: vi.fn(async () => members),
    findMember: vi.fn(async (id: string) => members.find(m => m.id === id)),
    liveAuthors: vi.fn(async (ids: string[]) => new Set(ids)),
    findDueMembersFor: vi.fn(async () => new Map()),
    addMember: vi.fn(async (..._args: unknown[]) => memberRow("new")),
    changeMemberAction: vi.fn(
      async (
        member: ReleaseMemberRow,
        action: string,
        ..._rest: unknown[]
      ) => ({
        ...member,
        action,
      })
    ),
    scheduleRelease: vi.fn(async (..._args: unknown[]) => true),
  };
  const checks = { ...READY_CHECKS, ...over.checks };
  const deps = {
    repository: repo as unknown as ReleasesServiceDeps["repository"],
    targets: {
      readDocument: async (target: { entryId: string }) => ({
        id: target.entryId,
      }),
      declaresLifecycle: async () => true,
    },
    canManageReleases: vi.fn(async (_id: string, a: ReleaseAuthority) =>
      held.has(a)
    ),
    canActOnDocument: vi.fn(async () => over.mayActOnDocument !== false),
    runDrainNow: vi.fn(async () => undefined),
    checks,
  };
  return { svc: new ReleasesService(deps), repo, deps, checks };
}

/** A document going live that fails validation for a missing title. */
const MISSING_TITLE: Partial<ReleaseDocumentChecks> = {
  publishProblems: async () => [
    { path: "title", code: "REQUIRED", message: "Title is required." },
  ],
};

/** An author who may publish but not unpublish. */
const MAY_NOT_UNPUBLISH: Partial<ReleaseDocumentChecks> = {
  mayPerform: async (_user, _scope, action) => action === "publish",
};

describe("readiness", () => {
  it("reports hard and soft problems for each document", async () => {
    const { svc, repo } = service({
      members: [memberRow("m1"), memberRow("m2")],
      checks: {
        publishProblems: async ref =>
          ref.entryId === "entry-m2"
            ? [{ path: "title", code: "REQUIRED", message: "Required." }]
            : [],
      },
    });
    repo.findDueMembersFor.mockResolvedValueOnce(
      new Map([
        [
          "collection:posts:entry-m1:",
          [
            {
              memberId: "x",
              releaseId: "r2",
              action: "unpublish",
              scheduledAt: new Date("2026-06-01T00:00:00Z"),
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
          ],
        ],
      ])
    );
    const found = await svc.readiness("r1", ACTOR);
    expect(found.releaseId).toBe("r1");
    expect(found.hard.map(f => [f.memberId, f.code])).toEqual([
      ["m2", "REQUIRED_FIELD_MISSING"],
    ]);
    expect(found.soft.map(f => [f.memberId, f.code])).toEqual([
      ["m1", "IN_OTHER_RELEASE"],
    ]);
  });

  it("answers not found for a release that is not there", async () => {
    const { svc } = service({});
    await expect(svc.readiness("missing", ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is refused to a caller who may not read releases", async () => {
    const { svc, repo } = service({ holds: [] });
    await expect(svc.readiness("r1", ACTOR)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.listMembers).not.toHaveBeenCalled();
  });
});

describe("scheduling and Publish now refuse on a hard problem", () => {
  const AT = new Date("2099-01-01T00:00:00Z");

  it("refuses to schedule, naming each problem, and writes nothing", async () => {
    const { svc, repo } = service({ checks: MISSING_TITLE });
    const refused = svc.schedule("r1", AT, "UTC", ACTOR);
    await expect(refused).rejects.toMatchObject({
      code: "CONFLICT",
      publicData: {
        problems: [{ memberId: "m1", code: "REQUIRED_FIELD_MISSING" }],
      },
    });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
  });

  it("schedules once the problem is gone", async () => {
    const { svc, repo } = service({});
    await svc.schedule("r1", AT, "UTC", ACTOR);
    expect(repo.scheduleRelease).toHaveBeenCalledTimes(1);
  });

  it("refuses Publish now the same way, before anything runs", async () => {
    const { svc, repo, deps } = service({
      checks: MAY_NOT_UNPUBLISH,
      members: [memberRow("m1", { action: "unpublish" })],
    });
    await expect(svc.publishNow("r1", ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      publicData: {
        problems: [{ memberId: "m1", code: "AUTHOR_MAY_NOT_ACT" }],
      },
    });
    expect(repo.scheduleRelease).not.toHaveBeenCalled();
    expect(deps.runDrainNow).not.toHaveBeenCalled();
  });

  it("ignores soft problems", async () => {
    const { svc, repo } = service({});
    repo.findDueMembersFor.mockResolvedValue(
      new Map([
        [
          "collection:posts:entry-m1:",
          [
            {
              memberId: "x",
              releaseId: "r2",
              action: "unpublish",
              scheduledAt: AT,
              createdAt: AT,
            },
          ],
        ],
      ])
    );
    await svc.schedule("r1", AT, "UTC", ACTOR);
    expect(repo.scheduleRelease).toHaveBeenCalledTimes(1);
  });
});

describe("adding a document to a scheduled release", () => {
  const ADD = {
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId: "e9",
    locale: null,
    action: "publish" as const,
  };

  it("refuses a document with a hard problem, and adds nothing", async () => {
    const { svc, repo } = service({
      state: "scheduled",
      checks: MISSING_TITLE,
    });
    await expect(svc.addMember("r1", ADD, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      // The document has no member id yet: it was never written.
      publicData: {
        problems: [{ memberId: null, code: "REQUIRED_FIELD_MISSING" }],
      },
    });
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it("checks the new document as its author, the caller", async () => {
    const publishProblems = vi.fn(async () => []);
    const { svc, repo } = service({
      state: "scheduled",
      checks: { publishProblems },
    });
    await svc.addMember("r1", ADD, ACTOR);
    expect(publishProblems).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "e9" }),
      { id: "editor", roles: [] }
    );
    expect(repo.addMember).toHaveBeenCalledTimes(1);
  });

  it("does not check a document joining a release still being assembled", async () => {
    // Scheduling it checks every member; the fence keeps this add off a
    // release scheduled since.
    const publishProblems = vi.fn(MISSING_TITLE.publishProblems);
    const { svc, repo } = service({
      state: "draft",
      checks: { publishProblems },
    });
    await svc.addMember("r1", ADD, ACTOR);
    expect(publishProblems).not.toHaveBeenCalled();
    expect(repo.addMember.mock.calls[0]?.[1]).toEqual(RELEASE_ASSEMBLABLE_FROM);
  });
});

describe("switching a document's action", () => {
  it("refuses a switch that leaves a hard problem in a scheduled release, and writes nothing", async () => {
    const { svc, repo } = service({
      state: "scheduled",
      checks: MAY_NOT_UNPUBLISH,
    });
    await expect(
      svc.changeMemberAction("m1", "unpublish", ACTOR, "r1")
    ).rejects.toMatchObject({
      code: "CONFLICT",
      publicData: {
        problems: [{ memberId: "m1", code: "AUTHOR_MAY_NOT_ACT" }],
      },
    });
    expect(repo.changeMemberAction).not.toHaveBeenCalled();
  });

  it("switches a permitted one, fenced on the states the caller may change", async () => {
    const { svc, repo } = service({ state: "scheduled" });
    const changed = await svc.changeMemberAction("m1", "unpublish", ACTOR);
    expect(changed.action).toBe("unpublish");
    expect(repo.changeMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
      "unpublish",
      [...RELEASE_ASSEMBLABLE_FROM, ...RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM]
    );
  });

  it("does not check a switch in a release still being assembled", async () => {
    const mayPerform = vi.fn(MAY_NOT_UNPUBLISH.mayPerform);
    const { svc, repo } = service({ state: "draft", checks: { mayPerform } });
    await svc.changeMemberAction("m1", "unpublish", ACTOR);
    expect(mayPerform).not.toHaveBeenCalled();
    expect(repo.changeMemberAction.mock.calls[0]?.[2]).toEqual(
      RELEASE_ASSEMBLABLE_FROM
    );
  });

  it("needs create authority on releases", async () => {
    const { svc, repo } = service({ holds: ["read", "publish"] });
    await expect(
      svc.changeMemberAction("m1", "unpublish", ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.findMember).not.toHaveBeenCalled();
  });

  it("needs the caller's own authority for the new action", async () => {
    const { svc, repo, deps } = service({ mayActOnDocument: false });
    await expect(
      svc.changeMemberAction("m1", "unpublish", ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.canActOnDocument).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unpublish", scopeSlug: "posts" })
    );
    expect(repo.changeMemberAction).not.toHaveBeenCalled();
  });

  it("needs publish authority for a scheduled release", async () => {
    const { svc, repo } = service({
      state: "scheduled",
      holds: ["read", "create"],
    });
    await expect(
      svc.changeMemberAction("m1", "unpublish", ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.changeMemberAction).not.toHaveBeenCalled();
  });

  it("refuses a member that belongs to another release", async () => {
    const { svc, repo } = service({});
    await expect(
      svc.changeMemberAction("m1", "unpublish", ACTOR, "r2")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.changeMemberAction).not.toHaveBeenCalled();
  });

  it("refuses a member that is not there", async () => {
    const { svc } = service({});
    await expect(
      svc.changeMemberAction("gone", "unpublish", ACTOR)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an action outside the two", async () => {
    const { svc, repo } = service({});
    await expect(
      svc.changeMemberAction("m1", "publsih" as "publish", ACTOR)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.findMember).not.toHaveBeenCalled();
  });

  it("leaves a request for the action the member already has to the repository's locked read", async () => {
    // The service's read can be stale: another switch may have committed since.
    // Whether anything is written is decided under the lock, as stored.
    const { svc, repo } = service({ state: "scheduled" });
    await svc.changeMemberAction("m1", "publish", ACTOR);
    expect(repo.changeMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
      "publish",
      expect.any(Array)
    );
  });
});
