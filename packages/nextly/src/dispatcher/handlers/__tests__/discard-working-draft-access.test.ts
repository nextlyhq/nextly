/**
 * Discard is authorized as an update, so like restore the read permission that
 * guards history is re-established on the way in, and then the document's own
 * update rule is enforced before the sidecar is removed. These pin that gate
 * chain and the identity it judges; the decisions themselves live in the access
 * modules' own tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { discardSpy, readableSpy, updatableSpy, canReadSpy } = vi.hoisted(
  () => ({
    discardSpy: vi.fn(),
    readableSpy: vi.fn(),
    updatableSpy: vi.fn(),
    canReadSpy: vi.fn(),
  })
);

vi.mock("../../../domains/versions/discard-working-draft", () => ({
  discardWorkingDraft: discardSpy,
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
  assertVersionDocumentUpdatable: updatableSpy,
}));

vi.mock("../../../auth/entity-read-access", () => ({
  canReadEntity: canReadSpy,
}));

import { discardWorkingDraftForDocument } from "../versions-methods";

const baseParams = {
  collectionName: "posts",
  entryId: "e1",
  _authenticatedUserId: "u1",
  _authenticatedUserRoles: JSON.stringify(["editor"]),
};

const argsFor = (params: Record<string, string>) => ({
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  user: { id: "u1", roles: ["editor"] },
  params,
});

describe("discardWorkingDraftForDocument — the gate chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    updatableSpy.mockResolvedValue(undefined);
    discardSpy.mockResolvedValue({
      id: "e1",
      title: "live",
      status: "published",
    });
  });

  it("discards and returns the live document when read and update are allowed", async () => {
    await expect(
      discardWorkingDraftForDocument(argsFor(baseParams))
    ).resolves.toMatchObject({ title: "live", status: "published" });
    expect(discardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "posts", entryId: "e1" })
    );
  });

  it("refuses as not-found when the caller may not read the entity, without discarding", async () => {
    canReadSpy.mockResolvedValue(false);

    await expect(
      discardWorkingDraftForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(discardSpy).not.toHaveBeenCalled();
  });

  it("still applies the per-document read gate after the coarse one", async () => {
    // Coarse permission is not enough on its own: an owner-only rule is decided
    // per document, and a refusal there is a 404 like the coarse gate.
    readableSpy.mockRejectedValue(
      Object.assign(new Error("not readable"), { code: "NOT_FOUND" })
    );

    await expect(
      discardWorkingDraftForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(discardSpy).not.toHaveBeenCalled();
  });

  it("refuses as forbidden when the caller may read but not update, without discarding", async () => {
    // Read is established first, so an update refusal is an honest 403 rather
    // than a 404 that would conceal a document the caller has proven they see.
    updatableSpy.mockRejectedValue(
      Object.assign(new Error("not updatable"), { code: "FORBIDDEN" })
    );

    await expect(
      discardWorkingDraftForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(discardSpy).not.toHaveBeenCalled();
  });

  it("forwards the API-key scope to the discard so the re-read is judged on its own grant", async () => {
    await discardWorkingDraftForDocument(
      argsFor({
        ...baseParams,
        _authenticatedActorType: "apiKey",
        _authenticatedPermissions: JSON.stringify([
          "read-posts",
          "update-posts",
        ]),
      })
    );

    expect(discardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedScope: {
          actorType: "apiKey",
          permissions: ["read-posts", "update-posts"],
        },
      })
    );
  });
});
