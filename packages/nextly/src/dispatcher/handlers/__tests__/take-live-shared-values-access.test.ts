/**
 * Taking the live shared values rewrites a document's pending change, so its
 * REST door owes the same gate chain a discard does: the read gate (a refusal
 * is a 404), the per-document read, then the document's update rule (a 403),
 * all before the service runs. The service is then asked as a routed caller
 * whose field rules still apply, in the language the request names.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { collectionTake, singleTake, readableSpy, updatableSpy, canReadSpy } =
  vi.hoisted(() => ({
    collectionTake: vi.fn(),
    singleTake: vi.fn(),
    readableSpy: vi.fn(),
    updatableSpy: vi.fn(),
    canReadSpy: vi.fn(),
  }));

vi.mock("../../../di", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../di")>()),
  getService: (name: string) =>
    name === "singleEntryService"
      ? { takeLiveSharedValues: singleTake }
      : { getEntryService: () => ({ takeLiveSharedValues: collectionTake }) },
}));

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: readableSpy,
  assertDocumentUpdatable: updatableSpy,
}));

vi.mock("../../../auth/entity-read-access", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/entity-read-access")
  >()),
  canReadEntity: canReadSpy,
}));

import { takeLiveSharedValuesForDocument } from "../versions-methods";

const taken = { success: true, statusCode: 200, data: { taken: ["count"] } };

const argsFor = (scopeKind: "collection" | "single") => ({
  scopeKind,
  slug: "posts",
  entryId: "e1",
  user: { id: "u1", roles: ["editor"] },
  locale: "es",
});

describe("takeLiveSharedValuesForDocument: the gate chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadSpy.mockResolvedValue(true);
    readableSpy.mockResolvedValue(undefined);
    updatableSpy.mockResolvedValue(undefined);
    collectionTake.mockResolvedValue(taken);
    singleTake.mockResolvedValue(taken);
  });

  it("takes the live values as a routed caller whose field rules apply, in the language named", async () => {
    await expect(
      takeLiveSharedValuesForDocument(argsFor("collection"))
    ).resolves.toEqual({ taken: ["count"] });
    expect(collectionTake).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        entryId: "e1",
        locale: "es",
        overrideAccess: false,
        routeAuthorized: true,
      })
    );
    expect(singleTake).not.toHaveBeenCalled();
  });

  it("asks the Single's service for a Single", async () => {
    await takeLiveSharedValuesForDocument(argsFor("single"));
    expect(singleTake).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "posts", locale: "es" })
    );
    expect(collectionTake).not.toHaveBeenCalled();
  });

  it("refuses as not-found when the caller may not read the entity, without taking", async () => {
    canReadSpy.mockResolvedValue(false);
    await expect(
      takeLiveSharedValuesForDocument(argsFor("collection"))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(collectionTake).not.toHaveBeenCalled();
  });

  it("refuses as forbidden when the caller may read but not update, without taking", async () => {
    updatableSpy.mockRejectedValue(
      Object.assign(new Error("not updatable"), { code: "FORBIDDEN" })
    );
    await expect(
      takeLiveSharedValuesForDocument(argsFor("collection"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(collectionTake).not.toHaveBeenCalled();
  });

  it("passes a refusal from the service on, with its data", async () => {
    collectionTake.mockResolvedValue({
      success: false,
      statusCode: 404,
      message: "This language has no pending change.",
    });
    await expect(
      takeLiveSharedValuesForDocument(argsFor("collection"))
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
