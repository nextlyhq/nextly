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
  // 🔴 Call history does not reset itself between cases in one file. Without
  // this, any assertion on how many times a collaborator was CALLED counts
  // every earlier test's calls too -- and reads as a real defect in whichever
  // case happens to assert first.
  vi.clearAllMocks();
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

describe("a settings row under a slug a collection also owns", () => {
  /**
   * 🔴 `assertGlobalResourceSlugAvailable` lets a resource that already held a
   * now-reserved name keep it, so an upgraded install can have a real
   * collection called `email-providers`. Registry membership then classifies
   * the settings namespace of the same name as a collection document — its id
   * is not in that collection, the read path refuses it, and the row is treated
   * as history for a deleted document: stripped of the changed-field detail a
   * credential rotation exists to record.
   */
  const settingsRow = {
    id: "s1",
    action: "update",
    collection: "email-providers",
    entryId: "provider-1",
    entryTitle: "SMTP (primary)",
    metadata: '{"changed":["host","port"]}',
    subjectKind: "settings",
    createdAt: new Date(2026, 0, 1),
  };

  const drawFeed = async (row: Record<string, unknown>) => {
    const { service, adapter } = makeService();
    // The collision: a real collection owns the settings namespace.
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">([
        ["email-providers", "collection"],
      ])
    );
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
    return service.getRecentActivity({
      limit: 5,
      scope: someResources(["email-providers"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });
  };

  it("keeps the settings row WHOLE, because the row says what it is about", async () => {
    const result = await drawFeed(settingsRow);

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.entryTitle).toBe("SMTP (primary)");
    expect(result.activities[0]?.metadata).toEqual({
      changed: ["host", "port"],
    });
  });

  it("still authorizes a real DOCUMENT under that same slug", async () => {
    // The control, and the one that stops the clause above becoming a way in:
    // a row that does not claim to be settings is judged as a document, so a
    // colliding collection cannot be read by filing activity under its name.
    //
    // The document EXISTS here, so the refusal is a refusal rather than the
    // deleted-history case -- which would keep the row, redacted, and is a
    // different behaviour with its own tests above.
    existingIds.mockResolvedValue(new Set(["doc-1"]));
    const { subjectKind: _dropped, ...documentRow } = settingsRow;

    const result = await drawFeed({ ...documentRow, entryId: "doc-1" });

    expect(result.activities).toEqual([]);
  });
});

describe("a row naming a document nothing can currently decide", () => {
  /**
   * 🔴 A registry reload between the scope query and the visibility pass makes
   * this ordinary: the collection is still in the SQL scope and already gone
   * from `kinds`. Folding "cannot decide" into "install-level" returned the
   * row's raw title and metadata with no document rule applied at all.
   */
  const statedRow = {
    id: "d1",
    action: "update",
    collection: "vanished",
    entryId: "e1",
    entryTitle: "SECRET draft",
    subjectKind: "collection",
    createdAt: new Date(2026, 0, 1),
  };

  const drawFeed = async (row: Record<string, unknown>) => {
    const { service, adapter } = makeService();
    // The registry does not know this slug.
    registeredKinds.mockReturnValue(new Map());
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
    return service.getRecentActivity({
      limit: 5,
      scope: someResources(["vanished"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });
  };

  it("DROPS a row that states a document kind", async () => {
    const result = await drawFeed(statedRow);

    expect(result.activities).toEqual([]);
  });

  it("still keeps an install-level row under an unknown namespace", async () => {
    // The control. Settings mutations are filed under namespaces that are in
    // neither registry, and dropping those would remove credential rotations
    // from the feed entirely -- so "unknown slug" alone must not mean "drop".
    const { subjectKind: _k, ...unstated } = statedRow;

    const result = await drawFeed({ ...unstated, subjectKind: "settings" });

    expect(result.activities).toHaveLength(1);
  });
});

describe("a refill that runs out of ROUNDS", () => {
  it("does not report the feed as ended", async () => {
    // 🔴 Reaching the round limit and reaching the end of the table produce the
    // same short page, and they are opposite answers to "is there more?". Only
    // one of them is a fact about the data; reporting it when the scan simply
    // stopped tells the reader there is no further activity to see.
    const { service, adapter } = makeService();
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">([["posts", "collection"]])
    );
    existingIds.mockImplementation((_s: string, ids: string[]) =>
      Promise.resolve(new Set(ids))
    );
    // Every round returns a FULL page of rows no document rule admits, so the
    // loop keeps going until the round cap stops it.
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        id: `a${i}`,
        collection: "posts",
        entryId: `e${i}`,
        entryTitle: "hidden",
        subjectKind: "collection",
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }))
    );

    const result = await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    expect(result.activities).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it("DOES report the end when the table actually runs out", async () => {
    // The control: without it, `hasMore: true` unconditionally would satisfy
    // the case above, and the feed would promise another page forever.
    const { service, adapter } = makeService();
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    expect(result.hasMore).toBe(false);
  });
});

describe("existence probes for refused rows", () => {
  it("issues them CONCURRENTLY, within a bound", async () => {
    // 🔴 Each probe is a full collection read, and a page can hold refused rows
    // across as many collection/language pairs as it has rows -- so awaiting
    // them one after another put a hundred serial reads after an authorization
    // pass that is already bounded, and ten refill rounds could make that a
    // thousand for one dashboard request. Bounded, not unbounded: the first
    // group is deliberately one, so a cold per-user permission cache is filled
    // once rather than missed by everything in the fan-out.
    const { service, adapter } = makeService();
    const slugs = Array.from({ length: 8 }, (_, i) => `c${i}`);
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">(
        slugs.map(s => [s, "collection"] as const)
      )
    );
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      slugs.map((slug, i) => ({
        id: `a${i}`,
        collection: slug,
        entryId: `e${i}`,
        entryTitle: "hidden",
        subjectKind: "collection",
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }))
    );

    let inFlight = 0;
    let peak = 0;
    existingIds.mockImplementation(async (_slug: string, ids: string[]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight--;
      return new Set(ids);
    });

    await service.getRecentActivity({
      limit: 5,
      scope: someResources(slugs),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    expect(existingIds.mock.calls.length).toBe(8);
    // More than one at a time proves it is not serial; the bound proves it is
    // not an unbounded fan-out.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe("rows written before the subject-kind column", () => {
  /**
   * 🔴 The column is nullable and NOT backfilled, so every upgraded install
   * keeps these indefinitely — this classification is the only one they ever
   * get. Reading "slug not in the registry" as install-level returned a
   * document's raw title, metadata and actor with no rule applied, which an
   * HMR removal between the scope query and this pass makes ordinary.
   */
  const legacyRow = (collection: string) => ({
    id: "l1",
    action: "update",
    collection,
    entryId: "e1",
    entryTitle: "SECRET",
    metadata: '{"changed":["host"]}',
    createdAt: new Date(2026, 0, 1),
  });

  const drawFeed = async (
    row: Record<string, unknown>,
    registry: [string, "collection" | "single"][]
  ) => {
    const { service, adapter } = makeService();
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">(registry)
    );
    existingIds.mockImplementation((_s: string, ids: string[]) =>
      Promise.resolve(new Set(ids))
    );
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
    return service.getRecentActivity({
      limit: 5,
      scope: someResources([String(row.collection)]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });
  };

  it("KEEPS one under a known settings namespace", async () => {
    // Named explicitly rather than inferred from a registry miss. These rows
    // are credential rotations and their kin, and dropping them would empty
    // that half of the trail on every upgraded install.
    const result = await drawFeed(legacyRow("email-providers"), []);

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.entryTitle).toBe("SECRET");
  });

  it("DROPS one under a slug the registry does not know", async () => {
    // The case the old rule got wrong: unknown stops meaning safe.
    const result = await drawFeed(legacyRow("vanished"), []);

    expect(result.activities).toEqual([]);
  });

  it("DROPS one when the slug is BOTH a namespace and a collection", async () => {
    // Irreducibly ambiguous: a legacy row carries nothing saying which it was,
    // and guessing "settings" would return a real document's row unauthorized.
    // Fail closed. Rows written from here on state their kind.
    const result = await drawFeed(legacyRow("email-providers"), [
      ["email-providers", "collection"],
    ]);

    expect(result.activities).toEqual([]);
  });

  it("still authorizes one under an ordinary registered collection", async () => {
    // The control: legacy rows naming a live collection are documents, and go
    // through the read path exactly as before.
    const result = await drawFeed(legacyRow("posts"), [
      ["posts", "collection"],
    ]);

    expect(result.activities).toEqual([]);
    expect(existingIds).toHaveBeenCalled();
  });
});

describe("what a redacted deletion still carries", () => {
  it("drops the document's IDENTIFIER along with its title", async () => {
    // 🔴 Keeping `entryId` returns the denied document's id to every caller
    // with collection access — the same thing the authorization pass exists to
    // withhold, minus the words. The event survives; which document it happened
    // to does not.
    const { service, adapter } = makeService();
    registeredKinds.mockReturnValue(
      new Map<string, "collection" | "single">([["posts", "collection"]])
    );
    existingIds.mockResolvedValue(new Set<string>());
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "a1",
        action: "delete",
        collection: "posts",
        entryId: "denied-doc",
        entryTitle: "Q4 plan",
        subjectKind: "collection",
        userName: "Dana",
        userEmail: "dana@example.com",
        createdAt: new Date(2026, 0, 1),
      },
    ]);

    const result = await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts"]),
      caller: { user: { id: "u1", roles: ["editor"] } },
    });

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.entryId).toBeNull();
    expect(result.activities[0]?.entryTitle).toBeNull();
    // The actor STAYS, deliberately: an audit trail that cannot say who
    // deleted something is not one, and that is the trade this redaction was
    // chosen to make.
    expect(result.activities[0]?.userName).toBe("Dana");
  });
});
