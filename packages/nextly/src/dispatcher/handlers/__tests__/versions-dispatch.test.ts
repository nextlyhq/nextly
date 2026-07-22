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
import { parseRestRoute } from "../../../route-handler/route-parser";

describe("version methods are registered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSpy.mockResolvedValue({ items: [], meta: { total: 0 } });
    getSpy.mockResolvedValue({ versionNo: 1 });
  });

  it("exposes every collection version method", () => {
    // Pinned as a set so a method cannot be added to the map without also
    // being registered for authorization, which decides whether it is
    // permitted as a read or as a write.
    expect(Object.keys(COLLECTION_VERSION_METHODS).sort()).toEqual([
      "getEntryVersion",
      "listEntryVersions",
      "restoreEntryVersion",
      "setEntryVersionLabel",
    ]);
  });

  it("exposes every single version method", () => {
    expect(Object.keys(SINGLE_VERSION_METHODS).sort()).toEqual([
      "getSingleVersion",
      "listSingleVersions",
      "restoreSingleVersion",
      "setSingleVersionLabel",
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

describe("version methods reach the router", () => {
  // The sets above pin what the dispatcher exposes. This pins the other half:
  // a method the router cannot resolve is unreachable however well registered,
  // and one resolved with the wrong operation is authorized as the wrong thing.
  it.each([
    {
      method: "listEntryVersions",
      path: ["collections", "posts", "entries", "e1", "versions"],
      verb: "GET",
    },
    {
      method: "getEntryVersion",
      path: ["collections", "posts", "entries", "e1", "versions", "2"],
      verb: "GET",
    },
    {
      method: "restoreEntryVersion",
      path: [
        "collections",
        "posts",
        "entries",
        "e1",
        "versions",
        "2",
        "restore",
      ],
      verb: "POST",
    },
    {
      method: "setEntryVersionLabel",
      path: ["collections", "posts", "entries", "e1", "versions", "2"],
      verb: "PATCH",
    },
    {
      method: "listSingleVersions",
      path: ["singles", "settings", "versions"],
      verb: "GET",
    },
    {
      method: "getSingleVersion",
      path: ["singles", "settings", "versions", "2"],
      verb: "GET",
    },
    {
      method: "restoreSingleVersion",
      path: ["singles", "settings", "versions", "2", "restore"],
      verb: "POST",
    },
    {
      method: "setSingleVersionLabel",
      path: ["singles", "settings", "versions", "2"],
      verb: "PATCH",
    },
  ])("$method is reachable at $verb $path", ({ method, path, verb }) => {
    expect(parseRestRoute(path, verb).method).toBe(method);
  });

  it("routes the writes as writes and the reads as reads", () => {
    const operationFor = (path: string[], verb: string) =>
      parseRestRoute(path, verb).operation;

    expect(
      operationFor(
        ["collections", "posts", "entries", "e1", "versions", "2"],
        "PATCH"
      )
    ).toBe("update");
    expect(
      operationFor(["singles", "settings", "versions", "2"], "PATCH")
    ).toBe("update");
    // A read of the same version must not be promoted to a write.
    expect(
      operationFor(
        ["collections", "posts", "entries", "e1", "versions", "2"],
        "GET"
      )
    ).not.toBe("update");
  });
});
