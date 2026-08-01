/**
 * Discarding a working draft removes the sidecar and then re-reads the live
 * published row to hand back to the editor. These pin two things:
 *
 * - the removal goes through the collections handler's LOCKED discard (which
 *   serializes with concurrent draft saves), never the lock-less
 *   versions-service delete; and
 * - a failed re-read is propagated as the error it carries rather than reported
 *   as a successful discard of an empty document (the live row may be deleted
 *   concurrently, or an after-read hook or database call may throw).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { discardSpy, getEntrySpy, unlockedDeleteSpy } = vi.hoisted(() => ({
  discardSpy: vi.fn(),
  getEntrySpy: vi.fn(),
  unlockedDeleteSpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "collectionsHandler") {
      return { discardWorkingDraft: discardSpy, getEntry: getEntrySpy };
    }
    // The lock-less path the discard must no longer take; wired so the test can
    // assert it is never called.
    if (name === "versionsService") {
      return { deleteWorkingDraft: unlockedDeleteSpy };
    }
    return {};
  }),
}));

import type { UserContext } from "../../singles/types";
import { discardWorkingDraft } from "../discard-working-draft";

const user = { id: "u1", roles: ["editor"] } as unknown as UserContext;

const args = {
  slug: "posts",
  entryId: "e1",
  user,
};

describe("discardWorkingDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discardSpy.mockResolvedValue(undefined);
  });

  it("removes the sidecar through the locked handler, not the lock-less versions-service delete", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { id: "e1", title: "live", status: "published" },
    });

    await expect(discardWorkingDraft(args)).resolves.toMatchObject({
      title: "live",
      status: "published",
    });
    expect(discardSpy).toHaveBeenCalledWith({
      collectionName: "posts",
      entryId: "e1",
    });
    expect(unlockedDeleteSpy).not.toHaveBeenCalled();
  });

  it("throws the envelope's error when the re-read fails, so the discard is not reported as a success", async () => {
    // The sidecar delete succeeds, but the live row was deleted concurrently, so
    // the re-read is a 404 failure envelope. Returning its null `data` would
    // answer HTTP 200 with an empty item and reset the editor to blank fields.
    getEntrySpy.mockResolvedValue({
      success: false,
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Entry not found.",
      data: null,
    });

    await expect(discardWorkingDraft(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The removal still happened — the failure is only in reading back.
    expect(discardSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the error from the status when the failure envelope carries no code", async () => {
    getEntrySpy.mockResolvedValue({
      success: false,
      statusCode: 404,
      message: "Entry not found.",
      data: null,
    });

    await expect(discardWorkingDraft(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
