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
  componentSpy,
} = vi.hoisted(() => ({
  getVersionSpy: vi.fn(),
  updateEntrySpy: vi.fn(),
  updateSingleSpy: vi.fn(),
  collectionSpy: vi.fn(),
  singleRegistrySpy: vi.fn(),
  componentSpy: vi.fn(),
}));

// Field-level write rules are evaluated by the update path too; stubbed here so
// these tests exercise restore's own decisions rather than access configuration.
vi.mock("../../../shared/lib/field-level-registry", () => ({
  applyFieldWriteAccess: vi.fn(),
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
      case "collectionRegistryService":
        return { getCollectionBySlug: collectionSpy };
      case "componentRegistryService":
        return { getComponentBySlug: componentSpy };
      default:
        return { getSingleBySlug: singleRegistrySpy };
    }
  }),
}));

import { applyFieldWriteAccess } from "../../../shared/lib/field-level-registry";
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
    collectionSpy.mockResolvedValue({
      fields,
      localized: false,
      versions: { enabled: true },
    });
    updateEntrySpy.mockResolvedValue({ success: true });
    updateSingleSpy.mockResolvedValue({ success: true });
    singleRegistrySpy.mockResolvedValue({
      fields,
      localized: false,
      versions: { enabled: true },
    });
    componentSpy.mockResolvedValue({ fields: [] });
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
    collectionSpy.mockResolvedValue({
      fields,
      localized: true,
      versions: { enabled: true },
    });

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

  it("resolves component schemas that are nested inside other components", async () => {
    // A component may embed another; leaving the deeper one opaque means the
    // filter can neither inspect it for credentials nor prune stale keys.
    const componentFields = [
      { name: "outer", type: "component", component: "wrapper" },
    ];
    collectionSpy.mockResolvedValue({
      fields: componentFields,
      localized: false,
      versions: { enabled: true },
    });
    componentSpy.mockImplementation((slug: string) =>
      Promise.resolve(
        slug === "wrapper"
          ? {
              fields: [{ name: "inner", type: "component", component: "leaf" }],
            }
          : { fields: [{ name: "secret", type: "password" }] }
      )
    );
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: null,
      snapshot: { outer: { inner: {} } },
    });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    // Both layers were walked: the password only becomes visible through the
    // second one.
    expect(componentSpy).toHaveBeenCalledWith("wrapper");
    expect(componentSpy).toHaveBeenCalledWith("leaf");
  });

  it("does not pass a stale locale to an entity that is no longer localized", async () => {
    // The old version's locale may not even be configured any more, and the
    // update path rejects an unknown one outright.
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: "de",
      snapshot: { title: "Hallo" },
    });
    collectionSpy.mockResolvedValue({
      fields,
      localized: false,
      versions: { enabled: true },
    });

    await restoreVersion(base);

    expect(updateEntrySpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() }),
      expect.anything()
    );
  });

  it("reports fields the caller may not write", async () => {
    // Field-level write rules strip denied keys inside the update path, after
    // it has already reported success — so without this a restore would claim
    // to have applied content it never did.
    getVersionSpy.mockResolvedValue({
      versionNo: 3,
      locale: null,
      snapshot: { title: "Old", secretNote: "denied" },
    });
    collectionSpy.mockResolvedValue({
      fields: [
        { name: "title", type: "text" },
        { name: "secretNote", type: "text" },
      ],
      localized: false,
      versions: { enabled: true },
    });
    vi.mocked(applyFieldWriteAccess).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        delete data.secretNote;
      }
    );

    const result = await restoreVersion(base);

    expect(result.droppedFields).toContain("secretNote");
    expect(updateEntrySpy).toHaveBeenCalledWith(expect.anything(), {
      title: "Old",
    });
  });

  it("refuses to restore when versioning has been turned off", async () => {
    // The write goes through the ordinary update, which captures a version only
    // while versioning is on. Restoring anyway would overwrite live content
    // without preserving what it replaced — a destructive act sold as a
    // recoverable one.
    collectionSpy.mockResolvedValue({
      fields,
      localized: false,
      versions: { enabled: false },
    });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(updateEntrySpy).not.toHaveBeenCalled();
  });

  it("keeps a rejected write's own reason instead of reporting a fault", async () => {
    // A snapshot can fail today's rules for ordinary reasons — an option since
    // removed, a slug that now collides. Those are answers an editor can act
    // on, not server faults.
    updateEntrySpy.mockResolvedValue({
      success: false,
      statusCode: 409,
      message: "That slug is already taken.",
    });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("still reports a genuine server fault as one", async () => {
    updateEntrySpy.mockResolvedValue({ success: false, statusCode: 500 });

    await expect(restoreVersion(base)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("rejects a version number that is not positive", async () => {
    await expect(
      restoreVersion({ ...base, versionNo: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(getVersionSpy).not.toHaveBeenCalled();
  });
});
