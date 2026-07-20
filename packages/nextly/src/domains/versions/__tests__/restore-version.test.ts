/**
 * Restore orchestration. The cases worth pinning are the ones where writing
 * anyway would be worse than refusing: a snapshot whose locale is unknown, and
 * a write that reported failure without throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getVersionSpy,
  updateEntrySpy,
  updateSingleSpy,
  collectionSpy,
  singleRegistrySpy,
} = vi.hoisted(() => ({
  getVersionSpy: vi.fn(),
  updateEntrySpy: vi.fn(),
  updateSingleSpy: vi.fn(),
  collectionSpy: vi.fn(),
  singleRegistrySpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    switch (name) {
      case "versionsService":
        return { get: getVersionSpy };
      case "collectionsHandler":
        return { updateEntry: updateEntrySpy };
      case "singleEntryService":
        return { update: updateSingleSpy };
      case "collectionService":
        return { getCollection: collectionSpy };
      default:
        return { getSingleBySlug: singleRegistrySpy };
    }
  }),
}));

import { restoreVersion } from "../restore-version";

const user = { id: "u1" };
const base = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  versionNo: 3,
  user,
};

const fields = [{ name: "title", type: "text" }];

describe("restoreVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: null,
      snapshot: { title: "Old title" },
    });
    collectionSpy.mockResolvedValue({ fields, localized: false });
    updateEntrySpy.mockResolvedValue({ success: true });
    updateSingleSpy.mockResolvedValue({ success: true });
    singleRegistrySpy.mockResolvedValue({ fields, localized: false });
  });

  it("writes the snapshot through the normal update path", async () => {
    await restoreVersion(base);

    expect(updateEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        entryId: "e1",
        overrideAccess: false,
      }),
      { title: "Old title" }
    );
  });

  it("records which version the write restored", async () => {
    // Lineage cannot be recovered afterwards: the resulting document looks
    // exactly like someone retyping the old content.
    await restoreVersion(base);

    expect(updateEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersionNo: 3 }),
      expect.anything()
    );
  });

  it("writes into the locale the version was captured in", async () => {
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: "de",
      snapshot: { title: "Hallo" },
    });
    collectionSpy.mockResolvedValue({ fields, localized: true });

    await restoreVersion(base);

    expect(updateEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "de" }),
      expect.anything()
    );
  });

  it("refuses a localized version that does not say which language it holds", async () => {
    // Writing it would put one language's content into whichever locale is
    // default. Versions captured before the locale was recorded cannot say.
    collectionSpy.mockResolvedValue({ fields, localized: true });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(updateEntrySpy).not.toHaveBeenCalled();
  });

  it("allows an unlocalized document to restore a version with no locale", async () => {
    await expect(restoreVersion(base)).resolves.toMatchObject({
      restoredFrom: 3,
    });
  });

  it("reports fields the current schema can no longer accept", async () => {
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: null,
      snapshot: { title: "Old", subtitle: "Removed since" },
    });

    const result = await restoreVersion(base);

    expect(result.droppedFields).toEqual(["subtitle"]);
    expect(updateEntrySpy).toHaveBeenCalledWith(expect.anything(), {
      title: "Old",
    });
  });

  it("refuses when nothing in the version applies to the current schema", async () => {
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: null,
      snapshot: { subtitle: "Removed since" },
    });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(updateEntrySpy).not.toHaveBeenCalled();
  });

  it("does not report success when the write reported failure", async () => {
    // The update services signal failure in their result rather than throwing,
    // so a restore that ignored it would claim to have restored nothing.
    updateEntrySpy.mockResolvedValue({ success: false, statusCode: 500 });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("surfaces a denied write as not found", async () => {
    // Matching the read gate: confirming the document exists to a caller who
    // may not write it is itself disclosure.
    updateEntrySpy.mockResolvedValue({ success: false, statusCode: 403 });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("restores a Single through its own update path", async () => {
    await restoreVersion({ ...base, scopeKind: "single", slug: "settings" });

    expect(updateSingleSpy).toHaveBeenCalledWith(
      "settings",
      { title: "Old title" },
      expect.objectContaining({ sourceVersionNo: 3 })
    );
  });

  it("rejects a version number that is not positive", async () => {
    await expect(
      restoreVersion({ ...base, versionNo: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(getVersionSpy).not.toHaveBeenCalled();
  });
});
