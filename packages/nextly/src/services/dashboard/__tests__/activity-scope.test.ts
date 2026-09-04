import { beforeEach, describe, expect, it, vi } from "vitest";

const scopeDegraded = vi.fn();
const registeredKinds = vi.fn();

// 🔴 The scope is container-backed, and a unit harness has no registries — so
// the REAL resolver reports `degraded`, which the service now refuses on. Left
// unmocked, every case in this file would exercise that refusal instead of what
// it is named for. `visibleDocuments` stays REAL: these tests are about which
// rows reach the decision, and substituting the decision as well would let the
// service hand it anything and still satisfy them.
const existingIds = vi.fn();

vi.mock("../../lib/readable-documents", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/readable-documents")>()),
  readableDocumentIds: () => Promise.resolve(new Set<string>()),
  existingDocumentIds: (...args: unknown[]) => existingIds(...args) as unknown,
}));
vi.mock("../../lib/document-visibility", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/document-visibility")>()),
  resolveDocumentVisibilityScope: () =>
    Promise.resolve({
      kinds: registeredKinds() as Map<string, "collection" | "single">,
      locales: null,
      degraded: scopeDegraded() as boolean,
    }),
}));

import { ActivityLogService } from "../activity-log-service";
import { someResources } from "../readable-resources";

beforeEach(() => {
  scopeDegraded.mockReturnValue(false);
  registeredKinds.mockReturnValue(new Map());
  existingIds.mockResolvedValue(new Set<string>());
});

/**
 * `dialect` defaults to sqlite, and `getCapabilities` is what has to be mocked
 * for it: the real getter reads `this.adapter.getCapabilities().dialect`, so a
 * mock exposing a `getDialect` method nothing calls makes every access to
 * `this.dialect` throw. The count that used to branch on dialect is gone, but
 * the write path still reads it.
 */
function makeService(dialect: "postgresql" | "sqlite" = "sqlite") {
  const adapter = {
    select: vi.fn().mockResolvedValue([]),
    executeQuery: vi.fn().mockResolvedValue([{ count: 0 }]),
    getCapabilities: () => ({ dialect }),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[0];
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[1];
  return { service: new ActivityLogService(adapter, logger), adapter, logger };
}

describe("activity feed scope", () => {
  it("returns nothing WITHOUT querying when the caller may read nothing", async () => {
    const { service, adapter } = makeService();

    const result = await service.getRecentActivity({
      limit: 5,
      scope: someResources([]),
    });

    expect(result).toEqual({ activities: [], hasMore: false });
    // An empty IN list is a syntax error on some dialects, so the short-circuit
    // must happen BEFORE the query is built, not inside it.
    expect(adapter.select).not.toHaveBeenCalled();
  });

  it("answers NOTHING when no caller is given, whatever the scope admits", async () => {
    // 🔴 Fail-closed on the second axis, the same direction an omitted scope
    // takes on the first. This feed carries entry titles, and without a caller
    // no row's document can be authorized -- so a caller that forgets to pass
    // one must get nothing rather than everything its collection scope admits.
    const { service, adapter } = makeService();
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a", collection: "posts", entryId: "e1", entryTitle: "Secret" },
    ]);

    const result = await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
    });

    expect(result.activities).toEqual([]);
  });

  it("queries with an IN filter over exactly the scope's resources", async () => {
    const { service, adapter } = makeService();

    await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts", "email-providers"]),
      // Without one the read never happens at all, so there would be no call to
      // inspect -- which is the fail-closed behaviour the test above pins.
      caller: { user: { id: "reader", roles: [] } },
    });

    const call = (adapter.select as ReturnType<typeof vi.fn>).mock.calls[0];
    const where = (
      call[1] as { where: { and: Array<Record<string, unknown>> } }
    ).where;
    // Asserting the exact filter object, not `objectContaining({ op, column })`:
    // a shape-only match passes an implementation that pushes the wrong
    // `value` (an unrelated array, or the wrong scope entirely) as long as
    // `op` and `column` are right. `value` is the only field that actually
    // carries the security property -- which resources the caller may read.
    expect(where.and).toContainEqual({
      column: "collection",
      op: "IN",
      value: ["posts", "email-providers"],
    });
  });
});

/**
 * The `countActivities` SQL-emission suite that stood here is GONE, and so is
 * the code it observed.
 *
 * It watched a hand-written `SELECT COUNT(*)` for a placeholder/params mismatch
 * across dialects — a real hazard while the feed published a `total`. That
 * count was removed rather than corrected: it counted rows the COLLECTION scope
 * admitted, so it reported edits to documents the reader may not open, and an
 * authorized total would mean authorizing every matching row, which is
 * unbounded over an audit table. With no count there is no emitted SQL to
 * observe, and no behaviour left for those tests to describe.
 */

describe("a registry that could not be enumerated", () => {
  it("REFUSES rather than answering with unauthorized rows", async () => {
    // 🔴 The failure inverts the safety it is built on. A slug missing from
    // `kinds` is read as an install-level event and KEPT without asking the
    // read path -- correct when the map is whole, because settings namespaces
    // are neither a collection nor a single. When the registry could not be
    // enumerated, the very same rule admits every document row unauthorized,
    // so a transient dependency failure turns the feed back into the disclosure
    // this service was repaired for, and does it silently.
    const { service, adapter } = makeService();
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a", collection: "posts", entryId: "e1", entryTitle: "Secret" },
    ]);
    scopeDegraded.mockReturnValue(true);

    await expect(
      service.getRecentActivity({
        limit: 5,
        scope: someResources(["posts"]),
        caller: { user: { id: "u1", roles: ["editor"] } },
      })
    ).rejects.toThrow();
  });

  it("still answers for an install that has registered NOTHING", async () => {
    // The control that keeps `degraded` meaning what it says: an empty registry
    // and an unreachable one produce the same empty map, and folding them
    // together would break every fresh install while reading as the same fix.
    const { service } = makeService();

    await expect(
      service.getRecentActivity({
        limit: 5,
        scope: someResources(["posts"]),
        caller: { user: { id: "u1", roles: ["editor"] } },
      })
    ).resolves.toMatchObject({ hasMore: false });
  });
});

describe("refilling a page whose rows are mostly unreadable", () => {
  /** Rows the scope admits but no document rule will, forcing another round. */
  const unreadable = (n: number, from: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `a${from + i}`,
      collection: "posts",
      entryId: `e${from + i}`,
      entryTitle: "hidden",
      createdAt: new Date(2026, 0, 1, 0, 0, from + i),
    }));

  it("anchors each round to the LAST ROW READ, never to a running offset", async () => {
    // 🔴 `activity_log` grows while the feed is being built -- every create,
    // update and delete appends to it -- so under OFFSET a row inserted between
    // two rounds shifts every later position by one: the next round repeats a
    // row already seen and SKIPS one that was never read. The skipped row is
    // lost silently, because de-duplicating what arrived cannot reveal what did
    // not, and the feed reports the wrong `hasMore` about it too.
    const { service, adapter } = makeService();
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">([["posts", "collection"]])
    );
    // The documents still EXIST, so a refused row is genuinely dropped rather
    // than kept as redacted deletion history -- otherwise the page fills in one
    // round and the second round this asserts about never happens.
    existingIds.mockImplementation((_slug: string, ids: string[]) =>
      Promise.resolve(new Set(ids))
    );
    const select = adapter.select as ReturnType<typeof vi.fn>;
    // A FULL page (ACTIVITY_PAGE_SIZE), or the loop reads the short page as the
    // end of the table and never performs the second round this asserts about.
    select.mockResolvedValueOnce(unreadable(100, 0)).mockResolvedValue([]);

    await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    expect(select.mock.calls.length).toBeGreaterThan(1);
    const second = select.mock.calls[1]?.[1] as {
      offset?: number;
      where?: unknown;
    };
    // No offset at all on a later round, and a cursor in its place.
    expect(second.offset).toBeUndefined();
    expect(JSON.stringify(second.where)).toContain("createdAt");
  });

  it("orders by a UNIQUE key as well as the instant", async () => {
    // `createdAt` alone is not total -- MySQL stores these at second precision,
    // so a burst of writes ties -- and a cursor over a non-unique key cannot say
    // which of the tied rows a page ended on.
    const { service, adapter } = makeService();
    await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    const first = (adapter.select as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as { orderBy?: { column: string; direction: string }[] };
    expect(first.orderBy).toEqual([
      { column: "createdAt", direction: "desc" },
      { column: "id", direction: "desc" },
    ]);
  });
});

describe("history of a document that no longer exists", () => {
  const deletionRow = {
    id: "a1",
    action: "delete",
    collection: "posts",
    entryId: "gone-1",
    entryTitle: "Q4 revenue plan",
    metadata: '{"changed":["title"]}',
    userName: "Dana",
    createdAt: new Date(2026, 0, 1),
  };

  const feed = async () => {
    const { service, adapter } = makeService();
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">([["posts", "collection"]])
    );
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      deletionRow,
    ]);
    return service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });
  };

  it("KEEPS the event when the document is gone, without its title", async () => {
    // 🔴 A collection delete removes the row and only then appends
    // `entry.deleted`, so the document the event names can never be found
    // again. Judged by readability alone the deletion -- and every earlier
    // event for that document -- vanishes from the feed for everyone, a super
    // admin included, which loses precisely the events the trail exists for.
    existingIds.mockResolvedValue(new Set<string>());

    const result = await feed();

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.entryTitle).toBeNull();
    // The event survives; what it was called does not. The rule that decided
    // who could read this title died with the document, so nothing can
    // evaluate it now.
    expect(result.activities[0]?.userName).toBe("Dana");
  });

  it("DROPS the event when the document exists and was refused", async () => {
    // The control, and the one that keeps the clause above from becoming a way
    // in: a document that is merely denied must stay denied. Without it,
    // "keep what the read path refused" would republish every hidden row.
    existingIds.mockResolvedValue(new Set(["gone-1"]));

    const result = await feed();

    expect(result.activities).toEqual([]);
  });

  it("DROPS the event when the probe cannot answer", async () => {
    // A probe that failed has told us nothing, and nothing must not read as
    // "deleted" -- that direction publishes a refused row on a dependency
    // failure, which is the inversion this whole pass removes.
    existingIds.mockRejectedValue(new Error("probe unavailable"));

    const result = await feed();

    expect(result.activities).toEqual([]);
  });
});
