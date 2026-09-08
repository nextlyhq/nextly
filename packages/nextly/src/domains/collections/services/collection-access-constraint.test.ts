/**
 * A stored read rule that cannot be EVALUATED must not read as a rule that
 * permits everything.
 *
 * `getAccessQueryConstraint` answers `null` for "allowed, and nothing to
 * narrow", and every caller folds that into the read as the absence of a
 * predicate. Answering `null` for a failure therefore removes the narrowing and
 * returns every row -- the opposite of what the rule asked for.
 *
 * The composed paths do not show this: `checkCollectionAccess` evaluates the
 * same rules, fails closed first, and masks it. These tests exercise the
 * function on its own, because the guarantee that hides the defect belongs to a
 * caller rather than to this function, and nothing in its name says so.
 */
import { describe, it, expect, vi } from "vitest";

import {
  createMockDb,
  createMockAdapter,
  silentLogger,
  createMockCollectionService,
  createMockAccessControlService,
} from "../__tests__/collection-test-helpers";

import { CollectionAccessService } from "./collection-access-service";

function buildAccessService() {
  const accessControlService = createMockAccessControlService();
  const collectionService = createMockCollectionService();
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    collectionService as never,
    accessControlService as never,
    {
      checkAccess: vi.fn().mockResolvedValue(true),
      getRegisteredAccess: vi.fn().mockReturnValue(undefined),
    } as never
  );
  return { service, accessControlService };
}

const user = { id: "user-1" } as never;

describe("a read rule that cannot be evaluated", () => {
  it("REFUSES rather than answering 'nothing to narrow'", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockRejectedValue(
      new Error("access module failed to load")
    );

    await expect(
      service.getAccessQueryConstraint("posts", user)
    ).rejects.toThrow(/failed to load/);
  });

  it("still passes a MISSING COLLECTION through, as the deny gate does", async () => {
    // The read paths turn this into a 404. Answering it as an authorization
    // decision would report a typo as a permission problem.
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockRejectedValue(
      new Error("Collection 'posts' not found")
    );

    await expect(
      service.getAccessQueryConstraint("posts", user)
    ).resolves.toBeNull();
  });

  it("CONTROL: a rule that narrows still returns its constraint", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: true,
      query: { created_by: "user-1" },
    });

    await expect(
      service.getAccessQueryConstraint("posts", user)
    ).resolves.toEqual({ created_by: "user-1" });
  });

  it("CONTROL: a rule that allows without narrowing still answers null", async () => {
    // The meaning `null` is reserved for, and the reason a failure must not
    // borrow it.
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    await expect(
      service.getAccessQueryConstraint("posts", user)
    ).resolves.toBeNull();
  });
});
