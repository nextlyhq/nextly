/**
 * Naming a version writes to history, so it carries the same read gates a
 * restore does — a caller who may not see a version must not be able to rename
 * it either. The normalization is here rather than in the client because a REST
 * API has callers that are not the client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { setLabelSpy, getSpy, readableSpy, canReadSpy, updatableSpy } =
  vi.hoisted(() => ({
    setLabelSpy: vi.fn(),
    getSpy: vi.fn(),
    readableSpy: vi.fn(),
    canReadSpy: vi.fn(),
    updatableSpy: vi.fn(),
  }));

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({ setLabel: setLabelSpy, get: getSpy })),
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
  assertVersionDocumentUpdatable: updatableSpy,
  redactSnapshotForUser: vi.fn(),
  resolveSingleDocumentId: vi.fn(),
}));

vi.mock("../../../auth/entity-read-access", () => ({
  canReadEntity: canReadSpy,
}));

import { setVersionLabelForDocument } from "../versions-methods";

const args = (label: unknown, versionNo = 3) => ({
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  versionNo,
  body: { label },
  user: { id: "u1", roles: ["editor"] },
  params: { _authenticatedUserId: "u1" },
});

/** A request that names no label at all, as distinct from one naming null. */
const argsWithoutLabel = (body: unknown = {}) => ({
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  versionNo: 3,
  body,
  user: { id: "u1", roles: ["editor"] },
  params: { _authenticatedUserId: "u1" },
});

describe("setVersionLabelForDocument — normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    setLabelSpy.mockResolvedValue({ versionNo: 3, label: "x", snapshot: {} });
  });

  it("stores a trimmed label", async () => {
    await setVersionLabelForDocument(args("  before redesign  "));

    expect(setLabelSpy).toHaveBeenCalledWith(
      expect.anything(),
      3,
      "before redesign"
    );
  });

  it("treats an all-whitespace label as clearing it", async () => {
    // Otherwise a version ends up with an invisible name that cannot be
    // distinguished from an unnamed one in the UI.
    await setVersionLabelForDocument(args("   "));

    expect(setLabelSpy).toHaveBeenCalledWith(expect.anything(), 3, null);
  });

  it("clears on an explicit null", async () => {
    await setVersionLabelForDocument(args(null));

    expect(setLabelSpy).toHaveBeenCalledWith(expect.anything(), 3, null);
  });

  it("accepts a label at the length limit", async () => {
    const atLimit = "a".repeat(100);

    await setVersionLabelForDocument(args(atLimit));

    expect(setLabelSpy).toHaveBeenCalledWith(expect.anything(), 3, atLimit);
  });

  it("rejects a label past the limit", async () => {
    // No dialect caps the column, so this is the only bound there is.
    await expect(
      setVersionLabelForDocument(args("a".repeat(101)))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("measures the limit after trimming", async () => {
    await setVersionLabelForDocument(args(`  ${"a".repeat(100)}  `));

    expect(setLabelSpy).toHaveBeenCalled();
  });

  it("rejects a non-string label rather than reading it as a clear", async () => {
    // A malformed request must not silently wipe a name.
    await expect(setVersionLabelForDocument(args(42))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("rejects a version number that is not positive", async () => {
    await expect(
      setVersionLabelForDocument(args("name", 0))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(setLabelSpy).not.toHaveBeenCalled();
  });
});

describe("setVersionLabelForDocument — access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    setLabelSpy.mockResolvedValue({ versionNo: 3, label: "x", snapshot: {} });
  });

  it("refuses a caller who may not read the entity's history", async () => {
    canReadSpy.mockResolvedValue(false);

    await expect(
      setVersionLabelForDocument(args("name"))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("refuses a caller who may not see this document", async () => {
    readableSpy.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "NOT_FOUND" })
    );

    await expect(
      setVersionLabelForDocument(args("name"))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("validates before touching access, so a bad request is not a probe", async () => {
    // A malformed label answering differently for a readable and an unreadable
    // document would disclose which documents exist.
    await expect(
      setVersionLabelForDocument(args("a".repeat(101)))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(canReadSpy).not.toHaveBeenCalled();
  });

  it("does not return the snapshot with the renamed version", async () => {
    // Renaming is not a read of content; returning it here would bypass the
    // redaction the version-detail endpoint applies.
    setLabelSpy.mockResolvedValue({
      versionNo: 3,
      label: "named",
      snapshot: { secret: "value" },
    });

    const row = await setVersionLabelForDocument(args("named"));

    expect(row).not.toHaveProperty("snapshot");
    expect(row).toMatchObject({ versionNo: 3, label: "named" });
  });
});

describe("setVersionLabelForDocument — an omitted label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    getSpy.mockResolvedValue({ versionNo: 3, label: "kept", snapshot: {} });
    setLabelSpy.mockResolvedValue({ versionNo: 3, label: "x", snapshot: {} });
  });

  it("leaves an existing name alone rather than clearing it", async () => {
    // PATCH is a partial update. Treating an absent key as null erased names
    // nobody asked to remove.
    const row = await setVersionLabelForDocument(argsWithoutLabel());

    expect(setLabelSpy).not.toHaveBeenCalled();
    expect(row).toMatchObject({ label: "kept" });
  });

  it("treats an absent body the same way", async () => {
    await setVersionLabelForDocument(argsWithoutLabel(undefined));

    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("still clears on an explicit null", async () => {
    // The distinction this whole branch exists for.
    await setVersionLabelForDocument(argsWithoutLabel({ label: null }));

    expect(setLabelSpy).toHaveBeenCalledWith(expect.anything(), 3, null);
  });

  it("still gates a request that changes nothing", async () => {
    // Otherwise a no-op PATCH answers differently for a readable and an
    // unreadable document, which discloses which documents exist.
    canReadSpy.mockResolvedValue(false);

    await expect(
      setVersionLabelForDocument(argsWithoutLabel())
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("does not return the snapshot from a no-op either", async () => {
    const row = await setVersionLabelForDocument(argsWithoutLabel());

    expect(row).not.toHaveProperty("snapshot");
  });
});

describe("setVersionLabelForDocument — document-level update rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    updatableSpy.mockResolvedValue(undefined);
    setLabelSpy.mockResolvedValue({ versionNo: 3, snapshot: {} });
    getSpy.mockResolvedValue({ versionNo: 3, snapshot: {} });
  });

  it("refuses a caller who may read the document but not update it", async () => {
    // The coarse `update-<slug>` the route earns says the caller may update
    // documents of this kind, not this one. An owner-only rule refuses the
    // document itself, and its history has to follow.
    updatableSpy.mockRejectedValue(new Error("forbidden"));

    await expect(setVersionLabelForDocument(args("Approved"))).rejects.toThrow(
      "forbidden"
    );
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("checks the same document the read gate checked", async () => {
    await setVersionLabelForDocument(args("Approved"));

    expect(updatableSpy).toHaveBeenCalledWith(
      "collection",
      "posts",
      "e1",
      expect.objectContaining({ id: "u1" }),
      // The label gate now forwards the caller's authenticated scope so a scoped
      // API key is judged on its own grant; this request carries no scope.
      undefined
    );
  });

  it("gates a Single by the same rule", async () => {
    // Both entity kinds or neither: a gate covering one reads as complete and
    // is not.
    updatableSpy.mockRejectedValue(new Error("forbidden"));

    await expect(
      setVersionLabelForDocument({
        ...args("Approved"),
        scopeKind: "single" as const,
        slug: "settings",
      })
    ).rejects.toThrow("forbidden");
    expect(setLabelSpy).not.toHaveBeenCalled();
  });

  it("runs after the read gates, so it cannot be used to probe", async () => {
    // A caller who cannot see the document must be refused by the read gate
    // first; reaching the update check would confirm the document exists.
    readableSpy.mockRejectedValue(new Error("not found"));

    await expect(setVersionLabelForDocument(args("Approved"))).rejects.toThrow(
      "not found"
    );
    expect(updatableSpy).not.toHaveBeenCalled();
  });

  it("gates a request that writes nothing", async () => {
    // Otherwise the no-op becomes a way to discover what the caller may change.
    updatableSpy.mockRejectedValue(new Error("forbidden"));

    await expect(
      setVersionLabelForDocument(argsWithoutLabel())
    ).rejects.toThrow("forbidden");
    expect(getSpy).not.toHaveBeenCalled();
  });
});
