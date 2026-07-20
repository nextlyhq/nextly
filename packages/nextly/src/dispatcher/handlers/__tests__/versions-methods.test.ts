/**
 * Dispatcher-side version reads. The document gate and the pagination contract
 * must behave exactly as they do on the standalone routes, since both are
 * public surfaces onto the same data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const assertReadableSpy = vi.fn();
const redactSpy = vi.fn();
const resolveSingleIdSpy = vi.fn();
const listSpy = vi.fn();
const getSpy = vi.fn();

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: (...a: unknown[]) => assertReadableSpy(...a),
  redactSnapshotForUser: (...a: unknown[]) => redactSpy(...a),
  resolveSingleDocumentId: (...a: unknown[]) => resolveSingleIdSpy(...a),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({ list: listSpy, get: getSpy })),
}));

import {
  getVersionForDocument,
  listVersionsForDocument,
  userFromParams,
} from "../versions-methods";

const user = { id: "user-1" };

describe("listVersionsForDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates on the live document before reading history", async () => {
    listSpy.mockResolvedValue([]);

    await listVersionsForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
    });

    expect(assertReadableSpy).toHaveBeenCalledWith(
      "collection",
      "posts",
      "e1",
      user
    );
  });

  it("reports hasNext from a probe row and never returns it", async () => {
    // Asking for limit+1 is what distinguishes "a full page" from "more exist".
    listSpy.mockResolvedValue([
      { versionNo: 3 },
      { versionNo: 2 },
      { versionNo: 1 },
    ]);

    const result = await listVersionsForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
      limit: 2,
    });

    expect(listSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 3 })
    );
    expect(result.items).toHaveLength(2);
    expect(result.meta.hasNext).toBe(true);
  });

  it("clamps an oversized limit", async () => {
    listSpy.mockResolvedValue([]);

    await listVersionsForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
      limit: 5000,
    });

    expect(listSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 101 })
    );
  });
});

describe("getVersionForDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts the snapshot before returning it", async () => {
    getSpy.mockResolvedValue({ versionNo: 1, snapshot: { title: "x" } });

    await getVersionForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
      versionNo: 1,
    });

    // A stored snapshot must never reveal a field the live read would hide.
    expect(redactSpy).toHaveBeenCalledWith(
      { title: "x" },
      "collection",
      "posts",
      user
    );
  });

  it("rejects a non-positive version number before querying", async () => {
    await expect(
      getVersionForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        user,
        versionNo: 0,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("userFromParams", () => {
  it("rebuilds the caller the route handler stamped onto params", () => {
    const result = userFromParams({
      _authenticatedUserId: "user-9",
      _authenticatedUserName: "Ada",
      _authenticatedUserEmail: "ada@example.com",
      _authenticatedUserRoles: JSON.stringify(["editor", "author"]),
    });

    expect(result).toMatchObject({
      id: "user-9",
      name: "Ada",
      email: "ada@example.com",
      roles: ["editor", "author"],
      // A representative singular role, so a callback reading `user.role`
      // sees an authorized value rather than stripping fields.
      role: "editor",
    });
  });

  it("tolerates a caller with no roles stamped on", () => {
    const result = userFromParams({ _authenticatedUserId: "user-9" });

    expect(result.id).toBe("user-9");
    expect(result.roles).toBeUndefined();
  });

  it("does not throw on a malformed roles value", () => {
    // Defensive: a corrupt value must not turn a read into a 500.
    const result = userFromParams({
      _authenticatedUserId: "user-9",
      _authenticatedUserRoles: "not-json",
    });

    expect(result.roles).toBeUndefined();
  });
});
