/**
 * Dispatcher-side version reads. The document gate and the pagination contract
 * must behave exactly as they do on the standalone routes, since both are
 * public surfaces onto the same data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const assertReadableSpy = vi.fn();
// Redaction answers what it withheld; nothing, unless a case says otherwise.
const redactSpy = vi.fn((..._args: unknown[]) =>
  Promise.resolve(new Set<string>())
);
const resolveSingleIdSpy = vi.fn();
const listSpy = vi.fn();
const getSpy = vi.fn();

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: (...a: unknown[]) => assertReadableSpy(...a),
  // Every language readable: no language is refused, and a listing reads the
  // one it names, or the versions in none when it names none.
  assertHistoryLocalesReadable: () => Promise.resolve(),
  historyListLanguages: (...a: unknown[]) =>
    Promise.resolve(a[5] ? { locale: a[5] } : { locales: [] }),
  redactSnapshotForUser: (...a: unknown[]) => redactSpy(...a),
  resolveSingleDocumentId: (...a: unknown[]) => resolveSingleIdSpy(...a),
  // A factory mock replaces the whole module, so anything the handler imports
  // and this object omits is undefined at the call site rather than falling
  // through to the real export. The real one returns `Promise<void>` and
  // mutates the snapshot in place, so a mock that RETURNED one would describe a
  // contract the module does not have.
  hydrateVersionSnapshot: () => Promise.resolve(),
  // The page as read: these cases judge paging and the gate, not the
  // "last looked at" marking, which has its own tests.
  withLastViewedMarks: (rows: unknown) => Promise.resolve(rows),
}));

const getAutosaveSpy = vi.fn();

vi.mock("../../../di", () => ({
  getService: vi.fn(() => ({
    list: listSpy,
    get: getSpy,
    getAutosave: getAutosaveSpy,
  })),
}));

// The entity gate the autosave read passes first; this file judges what
// happens after it.
vi.mock("../../../auth/entity-read-access", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/entity-read-access")
  >()),
  canReadEntity: () => Promise.resolve(true),
}));

vi.mock("../../../domains/versions/author-hydration", () => ({
  attachVersionAuthors: (rows: unknown[]) => Promise.resolve(rows),
}));

import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import {
  getAutosaveForDocument,
  getVersionForDocument,
  listVersionsForDocument,
  respondVersionPage,
} from "../versions-methods";

const user = { id: "user-1" };

describe("respondVersionPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the caller from the request and paging from the params, and answers privately", async () => {
    listSpy.mockResolvedValue([]);

    const response = await asCaller(
      sessionCaller({ userId: "user-1", roles: ["editor"] }),
      () =>
        respondVersionPage(
          { scopeKind: "collection", slug: "posts", entryId: "e1" },
          { limit: "10" }
        )
    );

    // A session caller is judged with an empty scope of its own actor type,
    // so the document gate resolves the account's grants.
    expect(assertReadableSpy).toHaveBeenCalledWith(
      "collection",
      "posts",
      "e1",
      expect.objectContaining({ id: "user-1", roles: ["editor"] }),
      { actorType: "user", permissions: [] }
    );
    expect(listSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 11 })
    );
    // The page marks where this person last looked, so no shared cache may
    // keep it.
    expect(response.headers.get("cache-control")).toMatch(/private/);
  });

  it("judges the document as the whole caller the route authenticated", async () => {
    listSpy.mockResolvedValue([]);

    await asCaller(
      sessionCaller({
        userId: "user-9",
        name: "Ada",
        email: "ada@example.com",
        roles: ["editor", "author"],
      }),
      () =>
        respondVersionPage(
          { scopeKind: "collection", slug: "posts", entryId: "e1" },
          {}
        )
    );

    expect(assertReadableSpy.mock.calls[0][3]).toMatchObject({
      id: "user-9",
      name: "Ada",
      email: "ada@example.com",
      roles: ["editor", "author"],
      // A representative singular role, so a callback reading `user.role`
      // sees an authorized value rather than stripping fields.
      role: "editor",
    });
  });

  it("tolerates a caller with no roles", async () => {
    listSpy.mockResolvedValue([]);

    await asCaller(sessionCaller({ userId: "user-9" }), () =>
      respondVersionPage(
        { scopeKind: "collection", slug: "posts", entryId: "e1" },
        {}
      )
    );

    const judged = assertReadableSpy.mock.calls[0][3];
    expect(judged.id).toBe("user-9");
    expect(judged.roles).toBeUndefined();
  });

  it("refuses a request with no caller rather than reading as an empty id", async () => {
    // Version history is only routed for an authenticated caller; reaching it
    // without one is refused before the document gate or the history read.
    await expect(
      asCaller(undefined, () =>
        respondVersionPage(
          { scopeKind: "collection", slug: "posts", entryId: "e1" },
          {}
        )
      )
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(assertReadableSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
  });
});

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

    // The fifth argument is the caller's authenticated scope, forwarded even
    // when absent. Asserted explicitly because it is a security parameter:
    // version history is a read of the LIVE document, and the scope is what
    // makes a scoped API key be judged on its own read grant rather than on
    // the grants of the account that owns it.
    expect(assertReadableSpy).toHaveBeenCalledWith(
      "collection",
      "posts",
      "e1",
      user,
      undefined
    );
  });

  it("forwards the caller's authenticated scope to the document gate", async () => {
    // The half that matters, and that nothing covered: a DROPPED scope does
    // not fail loudly. It silently promotes a scoped key to the permissions of
    // the account behind it, so a super-admin-owned key would read history for
    // documents its own grant forbids. The test above passes either way,
    // because an absent scope forwards as `undefined` whether or not the
    // argument is threaded at all.
    listSpy.mockResolvedValue([]);
    const authenticatedScope = { kind: "apiKey", grants: ["posts:read"] };

    await listVersionsForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
      authenticatedScope,
    } as unknown as Parameters<typeof listVersionsForDocument>[0]);

    expect(assertReadableSpy).toHaveBeenCalledWith(
      "collection",
      "posts",
      "e1",
      user,
      authenticatedScope
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

  it("rejects a negative limit rather than clamping it", async () => {
    // Math.min(-2, MAX_LIMIT) is still -2, and the repository would receive
    // limit + 1 === -1, which SQLite treats as unbounded — defeating MAX_LIMIT.
    await expect(
      listVersionsForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        user,
        limit: -2,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(listSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric limit", async () => {
    await expect(
      listVersionsForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        user,
        limit: Number("abc"),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a malformed cursor instead of querying versionNo < NaN", async () => {
    await expect(
      listVersionsForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: "e1",
        user,
        cursor: Number("abc"),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(listSpy).not.toHaveBeenCalled();
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

    const scope = { actorType: "apiKey" as const, permissions: ["read-posts"] };
    await getVersionForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: "e1",
      user,
      authenticatedScope: scope,
      versionNo: 1,
    });

    // A stored snapshot must never reveal a field the live read would hide,
    // judged for a key on the key's own grants.
    expect(redactSpy).toHaveBeenCalledWith(
      { title: "x" },
      "collection",
      "posts",
      user,
      scope
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

describe("getAutosaveForDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts with the key scope the request carries", async () => {
    getAutosaveSpy.mockResolvedValue({ snapshot: { title: "x" } });

    // The key's scope is not an argument: the route handler pins it for the
    // request, and the read takes it from there.
    await asCaller(
      keyCaller("key-1", { userId: "user-1" }),
      () =>
        getAutosaveForDocument({
          scopeKind: "collection",
          slug: "posts",
          entryId: "e1",
          user,
          params: {},
        }),
      { actorType: "apiKey", permissions: ["read-posts"] }
    );

    expect(redactSpy).toHaveBeenCalledWith(
      { title: "x" },
      "collection",
      "posts",
      user,
      { actorType: "apiKey", permissions: ["read-posts"] }
    );
  });
});
