/**
 * The four version methods must be reachable through the dispatchers the
 * catch-all handler uses, since that is the only API surface the admin calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listSpy = vi.fn();
const getSpy = vi.fn();
const resolveSingleIdSpy = vi.fn();

vi.mock("../versions-methods", async () => {
  const actual = await vi.importActual<typeof import("../versions-methods")>(
    "../versions-methods"
  );
  return {
    ...actual,
    listVersionsForDocument: (...a: unknown[]) => listSpy(...a),
    getVersionForDocument: (...a: unknown[]) => getSpy(...a),
  };
});

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: vi.fn(),
  redactSnapshotForUser: vi.fn(),
  resolveSingleDocumentId: (...a: unknown[]) => resolveSingleIdSpy(...a),
}));

import { COLLECTION_VERSION_METHODS } from "../collection-dispatcher";
import { SINGLE_VERSION_METHODS } from "../single-dispatcher";

describe("version methods are registered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSpy.mockResolvedValue({ items: [], meta: { total: 0 } });
    getSpy.mockResolvedValue({ versionNo: 1 });
  });

  it("exposes both collection version methods", () => {
    expect(Object.keys(COLLECTION_VERSION_METHODS).sort()).toEqual([
      "getEntryVersion",
      "listEntryVersions",
    ]);
  });

  it("exposes both single version methods", () => {
    expect(Object.keys(SINGLE_VERSION_METHODS).sort()).toEqual([
      "getSingleVersion",
      "listSingleVersions",
    ]);
  });

  it("passes the collection slug, entry id and caller through", async () => {
    await COLLECTION_VERSION_METHODS.listEntryVersions.execute(
      {} as never,
      {
        collectionName: "posts",
        entryId: "e1",
        limit: "10",
        _authenticatedUserId: "user-1",
        _authenticatedUserRoles: JSON.stringify(["editor"]),
      },
      undefined
    );

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        limit: 10,
        user: expect.objectContaining({ id: "user-1", roles: ["editor"] }),
      })
    );
  });

  it("resolves a Single's entry id from the live row, not from params", async () => {
    // The Single URL carries no entry id, and trusting a client-supplied one
    // would defeat the check that stops a recreated Single exposing its
    // predecessor's snapshots.
    resolveSingleIdSpy.mockResolvedValue("live-id");

    await SINGLE_VERSION_METHODS.listSingleVersions.execute(
      {} as never,
      {
        slug: "settings",
        entryId: "attacker-supplied",
        _authenticatedUserId: "u",
      },
      undefined
    );

    expect(resolveSingleIdSpy).toHaveBeenCalledWith("settings");
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKind: "single", entryId: "live-id" })
    );
  });

  it("returns not-found for a Single that has never been materialized", async () => {
    resolveSingleIdSpy.mockResolvedValue(null);

    await expect(
      SINGLE_VERSION_METHODS.listSingleVersions.execute(
        {} as never,
        { slug: "settings", _authenticatedUserId: "u" },
        undefined
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(listSpy).not.toHaveBeenCalled();
  });
});
