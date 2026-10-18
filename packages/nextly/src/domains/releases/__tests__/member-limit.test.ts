/**
 * How large a release may get.
 *
 * A release is settled all together, so one that no pass of the job running
 * releases can finish holds every one of its documents back. The limit is
 * sized so a full release publishes within one pass (measured per dialect in
 * `release-member-limit.integration.test.ts`); a release made before it and
 * holding more keeps running and can shrink, but takes nothing new.
 *
 * @module domains/releases/__tests__/member-limit.test
 */
import { describe, expect, it, vi } from "vitest";

import { RELEASE_MEMBER_LIMIT } from "../../../schemas/releases/types";
import { ReleasesService } from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";
import { READY_CHECKS } from "./helpers/ready-checks";

const ACTOR = { userId: "u1" };

const INPUT = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e-new",
  locale: null,
  action: "publish" as const,
};

/**
 * A release already holding `held` documents. The repository write applies the
 * room check it is handed, as the real one does under the release lock, so a
 * refusal here is the service's rule reaching the write.
 */
function service(held: number) {
  const inserted = vi.fn();
  const addMember = vi.fn(
    async (
      _input: unknown,
      _states: unknown,
      refuseWhenHolding?: (count: number) => Error | null
    ) => {
      const refusal = refuseWhenHolding?.(held) ?? null;
      if (refusal !== null) throw refusal;
      inserted();
      return { id: "m-new" };
    }
  );
  const deps = {
    repository: {
      memberCountsOf: vi.fn(
        async (ids: readonly string[]) =>
          new Map(held > 0 ? ids.map(id => [id, held] as const) : [])
      ),
      listMembers: vi.fn(async () => []),
      addMember,
      liveAuthors: vi.fn(async () => new Set(["u1"])),
      removeMember: vi.fn(async () => true),
      findReleases: vi.fn(async () => [{ id: "r1", state: "draft" }]),
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
    // Running a release is not what these cases are about.
    runDrainNow: vi.fn(async () => undefined),
    checks: READY_CHECKS,
    // Every target is there and has a lifecycle; the checks have their own tests.
    targets: {
      readDocument: async (target: { entryId: string }) => ({
        id: target.entryId,
      }),
      declaresLifecycle: async () => true,
    },
  };
  return { svc: new ReleasesService(deps), addMember, inserted };
}

describe("a release has a size bound", () => {
  it("is 200 documents", () => {
    // The number is a decision with a measurement behind it, not a default
    // anyone should move in passing.
    expect(RELEASE_MEMBER_LIMIT).toBe(200);
  });

  it("refuses the document that would exceed it, saying none fit", async () => {
    const { svc, inserted } = service(RELEASE_MEMBER_LIMIT);
    const refusal = svc.addMember("r1", INPUT, ACTOR);
    await expect(refusal).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringMatching(/no more fit/),
    });
    // Refused under the release lock, before the insert: the member and the
    // release's revision bump are one transaction, so nothing changed.
    expect(inserted).not.toHaveBeenCalled();
  });

  it("accepts the LAST document that fits", async () => {
    // The boundary in the other direction, which an off-by-one would break
    // while leaving the case above green.
    const { svc, inserted } = service(RELEASE_MEMBER_LIMIT - 1);
    await expect(svc.addMember("r1", INPUT, ACTOR)).resolves.toBeTruthy();
    expect(inserted).toHaveBeenCalled();
  });

  it("refuses to grow a release made before the limit, and says it can still shrink", async () => {
    // A release over the limit is not an error to repair: it runs as
    // scheduled and documents can leave it. What it cannot do is grow.
    const { svc, inserted } = service(RELEASE_MEMBER_LIMIT + 50);
    await expect(svc.addMember("r1", INPUT, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringMatching(/can still be removed/),
    });
    expect(inserted).not.toHaveBeenCalled();
  });

  it("does not stand in the way of an ordinary release", async () => {
    // The control. Without it a cap that refused everything would satisfy the
    // refusals above perfectly.
    const { svc, inserted } = service(3);
    await expect(svc.addMember("r1", INPUT, ACTOR)).resolves.toBeTruthy();
    expect(inserted).toHaveBeenCalled();
  });
});
