/**
 * Restore is authorized as an update, so the read permission that guards
 * history is not evaluated on the way in. Without the gate these pin, a caller
 * holding update but not read could recover a snapshot they were never allowed
 * to look at — reading history by writing it back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { restoreSpy, readableSpy, superAdminSpy, permissionsSpy } = vi.hoisted(
  () => ({
    restoreSpy: vi.fn(),
    readableSpy: vi.fn(),
    superAdminSpy: vi.fn(),
    permissionsSpy: vi.fn(),
  })
);

vi.mock("../../../domains/versions/restore-version", () => ({
  restoreVersion: restoreSpy,
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
  resolveSingleDocumentId: vi.fn(),
}));

vi.mock("../../../services/lib/permissions", () => ({
  isSuperAdmin: superAdminSpy,
  listEffectivePermissions: permissionsSpy,
}));

import { restoreVersionForDocument } from "../versions-methods";

const args = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  versionNo: 3,
  user: { id: "u1", roles: ["editor"] },
};

describe("restoreVersionForDocument — access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreSpy.mockResolvedValue({ restoredFrom: 3, droppedFields: [] });
    readableSpy.mockResolvedValue(undefined);
    superAdminSpy.mockResolvedValue(false);
    permissionsSpy.mockResolvedValue(["posts:read", "posts:update"]);
  });

  it("restores for a caller holding read permission", async () => {
    await expect(restoreVersionForDocument(args)).resolves.toMatchObject({
      restoredFrom: 3,
    });
    expect(restoreSpy).toHaveBeenCalled();
  });

  it("refuses a caller holding update but not read", async () => {
    // The dispatcher authorized this route as `update-posts`, so without this
    // gate the write would go ahead and hand back content from a version the
    // caller may not read.
    permissionsSpy.mockResolvedValue(["posts:update"]);

    await expect(restoreVersionForDocument(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("reports not found rather than forbidden", async () => {
    // A distinct 403 would confirm the document exists to a caller who is not
    // allowed to know that. Matches the document-level gate.
    permissionsSpy.mockResolvedValue([]);

    await expect(restoreVersionForDocument(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not accept another entity's read permission", async () => {
    permissionsSpy.mockResolvedValue(["pages:read", "posts:update"]);

    await expect(restoreVersionForDocument(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("allows a super admin without an explicit grant", async () => {
    superAdminSpy.mockResolvedValue(true);
    permissionsSpy.mockResolvedValue([]);

    await expect(restoreVersionForDocument(args)).resolves.toMatchObject({
      restoredFrom: 3,
    });
  });

  it("refuses a caller with no id at all", async () => {
    await expect(
      restoreVersionForDocument({ ...args, user: { id: "" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("still applies the document gate after the permission gate", async () => {
    // Coarse permission is not enough on its own: owner-only rules and
    // draft visibility are decided per document.
    readableSpy.mockRejectedValue(
      Object.assign(new Error("not readable"), { code: "NOT_FOUND" })
    );

    await expect(restoreVersionForDocument(args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});
