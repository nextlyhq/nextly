/**
 * Naming a version writes to history, so it carries the same read gates a
 * restore does — a caller who may not see a version must not be able to rename
 * it either. The normalization is here rather than in the client because a REST
 * API has callers that are not the client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { setLabelSpy, getSpy, readableSpy, canReadSpy } = vi.hoisted(() => ({
  setLabelSpy: vi.fn(),
  getSpy: vi.fn(),
  readableSpy: vi.fn(),
  canReadSpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({ setLabel: setLabelSpy, get: getSpy })),
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
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
  label,
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
