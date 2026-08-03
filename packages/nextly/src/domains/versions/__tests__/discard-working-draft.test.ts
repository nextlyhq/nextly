/**
 * Discarding a working draft removes the sidecar and then re-reads the live
 * published row to hand back to the editor. These pin two things:
 *
 * - the removal goes through the collections handler's LOCKED discard (which
 *   serializes with concurrent draft saves), never the lock-less
 *   versions-service delete;
 * - the live row is read BEFORE the sidecar is deleted, so a read failure (a
 *   concurrent delete, or an after-read hook or database error) surfaces with
 *   NOTHING removed — the draft survives for a retry, and the discard is never
 *   reported as a failure after its deletion already happened; and
 * - a failed read is propagated as the error it carries rather than reported as
 *   a successful discard of an empty document.
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

  it("reads the live row, then removes the sidecar through the locked handler, not the lock-less versions-service delete", async () => {
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
    // The live read precedes the deletion, so a read failure can leave the draft
    // intact (pinned by the next case).
    expect(getEntrySpy.mock.invocationCallOrder[0]).toBeLessThan(
      discardSpy.mock.invocationCallOrder[0]
    );
  });

  it("throws the read failure BEFORE deleting, leaving the pending draft intact", async () => {
    // The live-row read runs first; when it fails (a concurrent delete, or a
    // failing after-read hook), nothing has been removed yet, so the discard has
    // no side effect and is not reported as a failure after the deletion already
    // happened. Returning the failure envelope's null `data` would instead answer
    // HTTP 200 with an empty item and reset the editor to blank fields.
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
    // Nothing was deleted — the read failed first.
    expect(discardSpy).not.toHaveBeenCalled();
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
