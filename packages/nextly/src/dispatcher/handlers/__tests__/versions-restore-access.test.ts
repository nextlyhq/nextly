/**
 * Restore is authorized as an update, so the read permission that guards
 * history is not evaluated on the way in. These pin the gate that closes that,
 * and the assembly of the identity it judges — an API key must be judged on its
 * own scope, not on the account that issued it.
 *
 * The decision itself is covered in auth/__tests__/entity-read-access.test.ts;
 * this file covers the wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { restoreSpy, readableSpy, canReadSpy } = vi.hoisted(() => ({
  restoreSpy: vi.fn(),
  readableSpy: vi.fn(),
  canReadSpy: vi.fn(),
}));

vi.mock("../../../domains/versions/restore-version", () => ({
  restoreVersion: restoreSpy,
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
  resolveSingleDocumentId: vi.fn(),
}));

vi.mock("../../../auth/entity-read-access", () => ({
  canReadEntity: canReadSpy,
}));

import { restoreVersionForDocument } from "../versions-methods";

const baseParams = {
  collectionName: "posts",
  entryId: "e1",
  versionNo: "3",
  _authenticatedUserId: "u1",
  _authenticatedUserRoles: JSON.stringify(["editor"]),
};

const argsFor = (params: Record<string, unknown>) => ({
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  versionNo: 3,
  user: { id: "u1", roles: ["editor"] },
  params,
});

describe("restoreVersionForDocument — the read gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreSpy.mockResolvedValue({ restoredFrom: 3, droppedFields: [] });
    readableSpy.mockResolvedValue(undefined);
    canReadSpy.mockResolvedValue(true);
  });

  it("restores when the caller may read the entity", async () => {
    await expect(
      restoreVersionForDocument(argsFor(baseParams))
    ).resolves.toMatchObject({ restoredFrom: 3 });
    expect(restoreSpy).toHaveBeenCalled();
  });

  it("refuses when the caller may not, without writing", async () => {
    canReadSpy.mockResolvedValue(false);

    await expect(
      restoreVersionForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("reports not found rather than forbidden", async () => {
    // A distinct 403 would confirm the document exists to a caller not allowed
    // to know that. Matches the document-level gate.
    canReadSpy.mockResolvedValue(false);

    await expect(
      restoreVersionForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still applies the document gate after the read gate", async () => {
    // Coarse permission is not enough on its own: owner-only rules and draft
    // visibility are decided per document.
    readableSpy.mockRejectedValue(
      Object.assign(new Error("not readable"), { code: "NOT_FOUND" })
    );

    await expect(
      restoreVersionForDocument(argsFor(baseParams))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});

describe("restoreVersionForDocument — identity assembly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreSpy.mockResolvedValue({ restoredFrom: 3, droppedFields: [] });
    readableSpy.mockResolvedValue(undefined);
    canReadSpy.mockResolvedValue(true);
  });

  it("judges an API key on its own forwarded scope", async () => {
    await restoreVersionForDocument(
      argsFor({
        ...baseParams,
        _authenticatedActorType: "apiKey",
        _authenticatedPermissions: JSON.stringify(["read-posts"]),
      })
    );

    expect(canReadSpy).toHaveBeenCalledWith("posts", {
      userId: "u1",
      authMethod: "api-key",
      permissions: ["read-posts"],
      roles: ["editor"],
    });
  });

  it("treats a session caller as carrying no scoped permissions", async () => {
    // Their grants are resolved from the database by the decision itself;
    // forwarding an empty list keeps the two paths from being confused.
    await restoreVersionForDocument(argsFor(baseParams));

    expect(canReadSpy).toHaveBeenCalledWith("posts", {
      userId: "u1",
      authMethod: "session",
      permissions: [],
      roles: ["editor"],
    });
  });

  it("ignores permissions supplied without the API-key actor type", async () => {
    // The route handler sets both together. A permissions param arriving on its
    // own did not come from there.
    await restoreVersionForDocument(
      argsFor({
        ...baseParams,
        _authenticatedPermissions: JSON.stringify(["read-posts"]),
      })
    );

    expect(canReadSpy).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ authMethod: "session", permissions: [] })
    );
  });

  it("reads a corrupt permissions value as no permissions", async () => {
    // The safe direction: an unparseable value must not widen the scope.
    await restoreVersionForDocument(
      argsFor({
        ...baseParams,
        _authenticatedActorType: "apiKey",
        _authenticatedPermissions: "{not json",
      })
    );

    expect(canReadSpy).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ permissions: [] })
    );
  });

  it("reads a non-array permissions value as no permissions", async () => {
    await restoreVersionForDocument(
      argsFor({
        ...baseParams,
        _authenticatedActorType: "apiKey",
        _authenticatedPermissions: JSON.stringify({ read: true }),
      })
    );

    expect(canReadSpy).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({ permissions: [] })
    );
  });
});
