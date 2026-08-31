/**
 * How large a release may get.
 *
 * A bound rather than a policy: nothing in the model stops a release growing
 * without limit, and the surfaces that read it all degrade together when it
 * does — an unpaged member list, a drain that performs members one at a time
 * inside a wall-clock budget, and blocker reasons derived over every member on
 * every read.
 *
 * @module domains/releases/__tests__/member-limit.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  MAX_RELEASE_MEMBERS,
  ReleasesService,
} from "../services/releases-service";
import type { ReleasesServiceDeps } from "../services/releases-service";

const ACTOR = { userId: "u1" };

const INPUT = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e-new",
  locale: null,
  action: "publish" as const,
};

/** A release already holding `held` documents. */
function service(held: number) {
  const addMember = vi.fn(async () => ({ id: "m-new" }));
  const listMembers = vi.fn(async () =>
    Array.from({ length: held }, (_, n) => ({
      id: `m${n}`,
      releaseId: "r1",
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId: `e${n}`,
      locale: null,
      action: "publish" as const,
      createdBy: "u1",
      createdAt: new Date(),
    }))
  );
  const touchIfAssemblable = vi.fn(async () => true);
  const deps = {
    repository: {
      listMembers,
      addMember,
      touchIfAssemblable,
      liveAuthors: vi.fn(async () => new Set(["u1"])),
      removeMember: vi.fn(async () => true),
      findReleases: vi.fn(async () => [{ id: "r1", state: "draft" }]),
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases: vi.fn(async () => true),
    canActOnDocument: vi.fn(async () => true),
  };
  return { svc: new ReleasesService(deps), addMember, touchIfAssemblable };
}

describe("a release has a size bound", () => {
  it("refuses the document that would exceed it", async () => {
    // The case this exists for is not a person: it is a script adding in a
    // loop, which otherwise builds a release the detail page cannot render and
    // no single drain pass can settle.
    const { svc, addMember, touchIfAssemblable } = service(MAX_RELEASE_MEMBERS);
    await expect(svc.addMember("r1", INPUT, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Refused before the MEMBER write...
    expect(addMember).not.toHaveBeenCalled();
    // ...and before the RELEASE write, which is the half the first assertion
    // cannot see. `touchIfAssemblable` updates the release's `updatedAt`, so a
    // check ordered after it leaves a refused add having changed the row — and
    // a test that watches only the insert reports that as clean.
    expect(touchIfAssemblable).not.toHaveBeenCalled();
  });

  it("accepts the LAST document that fits", async () => {
    // The boundary in the other direction, which an off-by-one would break
    // while leaving the case above green.
    const { svc, addMember } = service(MAX_RELEASE_MEMBERS - 1);
    await expect(svc.addMember("r1", INPUT, ACTOR)).resolves.toBeTruthy();
    expect(addMember).toHaveBeenCalled();
  });

  it("does not stand in the way of an ordinary release", async () => {
    // The control. Without it a cap that refused everything would satisfy the
    // first case perfectly.
    const { svc, addMember } = service(3);
    await expect(svc.addMember("r1", INPUT, ACTOR)).resolves.toBeTruthy();
    expect(addMember).toHaveBeenCalled();
  });
});
