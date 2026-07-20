/**
 * Version-history access gate.
 *
 * The gate decides whether a caller may see a document's history, so its side
 * effects and failure modes matter as much as its verdict. The init/DI/auth
 * boundary is mocked so the gate itself is what is under test — an
 * unauthenticated request would be rejected before reaching it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getEntrySpy = vi.fn();
const singleGetSpy = vi.fn();
const selectOneSpy = vi.fn();
const getSingleBySlugSpy = vi.fn();
const requireRouteCollectionAccessSpy = vi.fn();

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../di", () => ({
  getService: vi.fn((name: string) => {
    switch (name) {
      case "collectionsHandler":
        return { getEntry: getEntrySpy };
      case "singleEntryService":
        return { get: singleGetSpy };
      case "singleRegistryService":
        return { getSingleBySlug: getSingleBySlugSpy };
      case "adapter":
        return { selectOne: selectOneSpy };
      case "collectionService":
        return { getCollection: vi.fn().mockResolvedValue({ fields: [] }) };
      case "versionsService":
        return { list: vi.fn().mockResolvedValue([]), get: vi.fn() };
      default:
        return {};
    }
  }),
}));

vi.mock("../route-auth", () => ({
  requireRouteCollectionAccess: (...args: unknown[]) =>
    requireRouteCollectionAccessSpy(...args),
}));

vi.mock("../../services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn().mockResolvedValue(["editor"]),
}));

import {
  assertVersionDocumentReadable,
  requireVersionReadAccess,
} from "../versions-access";
import { GET as listVersions } from "../versions";

describe("requireVersionReadAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRouteCollectionAccessSpy.mockResolvedValue({
      userId: "user-1",
      userName: "Ed",
      userEmail: "ed@example.com",
      permissions: [],
      roles: ["editor"],
      authMethod: "session",
    });
  });

  it("reads a collection entry with status:all so drafts still have history", async () => {
    getEntrySpy.mockResolvedValue({ success: true, statusCode: 200 });

    await requireVersionReadAccess(
      new Request("http://localhost/x"),
      "collection",
      "posts",
      "entry-1"
    );

    // Without status:"all" a draft reads as absent and history 404s — exactly
    // when an author needs it. routeAuthorized keeps a scoped API key from
    // being re-checked against its creator's stored roles.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        entryId: "entry-1",
        status: "all",
        routeAuthorized: true,
        overrideAccess: false,
      })
    );
  });

  it("surfaces a server-side read failure instead of reporting not-found", async () => {
    // A throwing afterRead hook or a component load error yields success:false
    // with a 5xx. Collapsing that into 404 would disguise an outage as missing
    // content.
    getEntrySpy.mockResolvedValue({ success: false, statusCode: 500 });

    await expect(
      requireVersionReadAccess(
        new Request("http://localhost/x"),
        "collection",
        "posts",
        "entry-1"
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("treats a denial as not-found so existence is not disclosed", async () => {
    getEntrySpy.mockResolvedValue({ success: false, statusCode: 403 });

    await expect(
      requireVersionReadAccess(
        new Request("http://localhost/x"),
        "collection",
        "posts",
        "entry-1"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never materializes a Single while checking access", async () => {
    // SingleEntryService.get auto-creates a missing Single (and captures v1 for
    // a versioned one). A version request is a read, so the gate must check the
    // backing row directly and stop before that write can happen.
    getSingleBySlugSpy.mockResolvedValue({ tableName: "single_settings" });
    selectOneSpy.mockResolvedValue(null);

    await expect(
      requireVersionReadAccess(
        new Request("http://localhost/x"),
        "single",
        "settings",
        "single-1"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(singleGetSpy).not.toHaveBeenCalled();
  });

  it("refuses history for a Single recreated under a different id", async () => {
    // Version rows outlive the document they came from, so a stale entryId
    // must not expose the previous document's snapshots.
    getSingleBySlugSpy.mockResolvedValue({ tableName: "single_settings" });
    selectOneSpy.mockResolvedValue({ id: "current-id" });

    await expect(
      requireVersionReadAccess(
        new Request("http://localhost/x"),
        "single",
        "settings",
        "stale-id"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(singleGetSpy).not.toHaveBeenCalled();
  });

  it("allows a Single whose live id matches the requested history", async () => {
    getSingleBySlugSpy.mockResolvedValue({ tableName: "single_settings" });
    selectOneSpy.mockResolvedValue({ id: "single-1" });
    singleGetSpy.mockResolvedValue({ success: true, statusCode: 200 });

    const user = await requireVersionReadAccess(
      new Request("http://localhost/x"),
      "single",
      "settings",
      "single-1"
    );

    expect(user.id).toBe("user-1");
    expect(singleGetSpy).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ routeAuthorized: true, status: "all" })
    );
  });
});

describe("version list pagination meta", () => {
  const listSpy = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    requireRouteCollectionAccessSpy.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      roles: ["editor"],
      authMethod: "session",
    });
    getEntrySpy.mockResolvedValue({ success: true, statusCode: 200 });
    const di = await import("../../di");
    vi.mocked(di.getService).mockImplementation(((name: string) =>
      name === "versionsService"
        ? { list: listSpy, get: vi.fn() }
        : name === "collectionsHandler"
          ? { getEntry: getEntrySpy }
          : {}) as typeof di.getService);
  });

  function ctx() {
    return {
      params: Promise.resolve({ kind: "collection", slug: "posts", id: "e1" }),
    };
  }

  function rows(n: number) {
    return Array.from({ length: n }, (_, i) => ({ versionNo: n - i }));
  }

  it("reports hasNext=false when the history exactly fills one page", async () => {
    // The off-by-one that matters: 2 rows with limit=2 previously claimed a
    // next page, sending the client to an empty one. The route asks for
    // limit+1 and only a returned extra row proves more exist.
    listSpy.mockResolvedValue(rows(2));

    const res = await listVersions(
      new Request("http://localhost/api/versions/collection/posts/e1?limit=2"),
      ctx()
    );
    const body: {
      items: unknown[];
      meta: { hasNext: boolean; limit: number };
    } = await res.json();

    expect(listSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 3 })
    );
    expect(body.items).toHaveLength(2);
    expect(body.meta.hasNext).toBe(false);
    expect(body.meta.limit).toBe(2);
  });

  it("reports hasNext=true and trims the probe row when more exist", async () => {
    listSpy.mockResolvedValue(rows(3));

    const res = await listVersions(
      new Request("http://localhost/api/versions/collection/posts/e1?limit=2"),
      ctx()
    );
    const body: {
      items: unknown[];
      meta: { hasNext: boolean };
    } = await res.json();

    // The extra row is a probe, never part of the page.
    expect(body.items).toHaveLength(2);
    expect(body.meta.hasNext).toBe(true);
  });
});

describe("assertVersionDocumentReadable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves when the caller may read the live document", async () => {
    getEntrySpy.mockResolvedValue({ success: true, statusCode: 200 });

    await expect(
      assertVersionDocumentReadable("collection", "posts", "e1", {
        id: "user-1",
      })
    ).resolves.toBeUndefined();

    // Same document rules as the standalone route: drafts visible, RBAC not
    // re-checked, because the caller was already authorized upstream.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all", routeAuthorized: true })
    );
  });

  it("rejects with not-found when the document is not readable", async () => {
    getEntrySpy.mockResolvedValue({ success: false, statusCode: 403 });

    await expect(
      assertVersionDocumentReadable("collection", "posts", "e1", {
        id: "user-1",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not authenticate — the dispatcher already did", async () => {
    getEntrySpy.mockResolvedValue({ success: true, statusCode: 200 });

    await assertVersionDocumentReadable("collection", "posts", "e1", {
      id: "user-1",
    });

    expect(requireRouteCollectionAccessSpy).not.toHaveBeenCalled();
  });
});
