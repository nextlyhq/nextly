/**
 * Discarding a working draft removes the sidecar and then re-reads the live
 * published row to hand back to the editor. That re-read runs the full pipeline
 * and can fail — the row may be deleted concurrently, or an after-read hook or
 * database call may throw — in which case the service answers a failure envelope
 * with `data: null`. These pin that the failure is propagated as the error it
 * carries rather than reported as a successful discard of an empty document.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { deleteWorkingDraftSpy, getEntrySpy } = vi.hoisted(() => ({
  deleteWorkingDraftSpy: vi.fn(),
  getEntrySpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "versionsService") {
      return { deleteWorkingDraft: deleteWorkingDraftSpy };
    }
    if (name === "collectionsHandler") return { getEntry: getEntrySpy };
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

describe("discardWorkingDraft — propagating a failed post-discard read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteWorkingDraftSpy.mockResolvedValue(undefined);
  });

  it("removes the null-locale sidecar then returns the live document on a successful re-read", async () => {
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { id: "e1", title: "live", status: "published" },
    });

    await expect(discardWorkingDraft(args)).resolves.toMatchObject({
      title: "live",
      status: "published",
    });
    expect(deleteWorkingDraftSpy).toHaveBeenCalledWith(
      { scopeKind: "collection", scopeSlug: "posts", entryId: "e1" },
      null
    );
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
    expect(deleteWorkingDraftSpy).toHaveBeenCalledTimes(1);
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
