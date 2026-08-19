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

import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import type { UserContext } from "../../singles/types";
import { discardWorkingDraft } from "../discard-working-draft";

/**
 * A failure envelope as the read path actually produces one, rather than a
 * literal with the carrier attached by hand: the assertion is that what the
 * producer attaches is what the rebuild reads, so a fixture attaching it itself
 * would pass even if those two halves disagreed.
 */
function buildEntryErrorEnvelope(error: Error) {
  return { success: false, statusCode: 500, ...errorEnvelopeFields(error) };
}

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
    // A request naming no language reaches the handler as an explicit null, so
    // the one rule that resolves a language decides what that means rather than
    // the delete falling to whichever key happens to be absent.
    expect(discardSpy).toHaveBeenCalledWith({
      collectionName: "posts",
      entryId: "e1",
      locale: null,
    });
    expect(unlockedDeleteSpy).not.toHaveBeenCalled();
    // The live read precedes the deletion, so a read failure can leave the draft
    // intact (pinned by the next case).
    expect(getEntrySpy.mock.invocationCallOrder[0]).toBeLessThan(
      discardSpy.mock.invocationCallOrder[0]
    );
  });

  it("forwards the language being discarded to the read and the delete", async () => {
    // A localized document holds one pending change per language. Both halves
    // need the language: the delete to remove the right one, and the read so the
    // values handed back are the ones the editor resets to.
    getEntrySpy.mockResolvedValue({
      success: true,
      data: { id: "e1", title: "vive", status: "published" },
    });

    await discardWorkingDraft({ ...args, locale: "es" });

    expect(discardSpy).toHaveBeenCalledWith({
      collectionName: "posts",
      entryId: "e1",
      locale: "es",
    });
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" })
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

  it("propagates the failure the read was built from, not only its envelope", async () => {
    // The read attaches the thrown error to the result it returns, and the
    // rebuild reads it back off that object. Copying the envelope field by
    // field left it behind, so a driver failure under a discard reached the
    // caller as a bare internal error with nothing naming the real fault.
    const driverFailure = new Error("connection terminated unexpectedly");
    getEntrySpy.mockResolvedValue({
      ...buildEntryErrorEnvelope(driverFailure),
      data: null,
    });

    await expect(discardWorkingDraft(args)).rejects.toMatchObject({
      cause: driverFailure,
    });
    expect(discardSpy).not.toHaveBeenCalled();
  });
});
