/**
 * `system:recent-edits`: Recently edited's source asks the trail's walk for the
 * reader's documents, narrowed only by the filters it declares, and labels each
 * row with its document's status now, without letting a label cost the card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRecentEdits = vi.fn();
const pendingChangeLocales = vi.fn();
const readableDocumentStatuses = vi.fn();
const readableSingleStatus = vi.fn();
const resolveReadableResources = vi.fn();
const readRecentEditSubjects = vi.fn();
/** The booted config the source reads its retention window from. */
let serviceConfig: Record<string, unknown> = {};

vi.mock("../../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) =>
      name === "config"
        ? serviceConfig
        : name === "versionsService"
          ? { pendingChangeLocales }
          : { getRecentEdits },
  },
}));
vi.mock("../../lib/readable-documents", () => ({
  readableDocumentStatuses: (...args: unknown[]) =>
    readableDocumentStatuses(...args) as unknown,
  readableSingleStatus: (...args: unknown[]) =>
    readableSingleStatus(...args) as unknown,
}));
vi.mock("../resolve-readable-resources", () => ({
  resolveReadableResources: (...args: unknown[]) =>
    resolveReadableResources(...args) as unknown,
}));
vi.mock("../activity-subjects", () => ({
  readRecentEditSubjects: () => readRecentEditSubjects() as unknown,
}));

import {
  resolveAuditRetentionConfig,
  setAuditRetention,
} from "../../../domains/audit/retention-config";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import { clearSources } from "../../../domains/widgets/sources";
import { clearSystemResolvers } from "../../../domains/widgets/system-sources";
import { someResources } from "../readable-resources";
import {
  RECENT_EDITS_SOURCE_ID,
  registerRecentEditsWidgetSource,
} from "../recent-edits-widget-source";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const SCOPE = someResources(["posts", "pages"]);
const SINGLES = { labels: new Map(), keptOff: new Set(), complete: true };
const KEPT_OFF = { slugs: new Set<string>(), complete: true };

/** One document's latest save, as the walk answers it. */
function edit(collection: string, entryId: string) {
  return {
    id: `save-${entryId}`,
    actorType: "user",
    userId: "user-2",
    userName: "Ana",
    userEmail: "ana@example.test",
    action: "update",
    collection,
    entryId,
    entryTitle: `Title ${entryId}`,
    subjectKind: "collection",
    metadata: { changedFields: ["title"] },
    createdAt: "2026-10-23T12:00:00.000Z",
    count: 1,
    countAtLeast: false,
    firstCreatedAt: "2026-10-23T12:00:00.000Z",
    identityErasedAt: null,
    locale: null,
  };
}

const rows = (answer: unknown) =>
  (answer as { items: Record<string, unknown>[] }).items;

beforeEach(() => {
  vi.clearAllMocks();
  serviceConfig = {};
  setAuditRetention(undefined);
  resolveReadableResources.mockResolvedValue(SCOPE);
  readRecentEditSubjects.mockResolvedValue({
    singles: SINGLES,
    keptOffCollections: KEPT_OFF,
    collectionsWithStatus: new Set(["posts", "pages"]),
  });
  getRecentEdits.mockResolvedValue({
    edits: [edit("posts", "p1"), edit("pages", "g1")],
    hasMore: false,
  });
  readableDocumentStatuses.mockImplementation(
    async (collection: string, ids: string[]) =>
      new Map(
        ids.map(id => [id, collection === "posts" ? "published" : "draft"])
      )
  );
  pendingChangeLocales.mockImplementation(
    async (_kind: string, slug: string) =>
      slug === "posts" ? new Map([["p1", new Set([null])]]) : new Map()
  );
  clearSources();
  clearSystemResolvers();
  registerRecentEditsWidgetSource();
});

describe("what it asks the walk", () => {
  it("asks as the caller, within their scope, narrowed by the card's collection and the reader's own saves", async () => {
    await executeWidgetQuery(
      {
        source: RECENT_EDITS_SOURCE_ID,
        op: "list",
        limit: 6,
        where: { collection: "posts", onlyMine: true },
      },
      caller
    );
    expect(resolveReadableResources).toHaveBeenCalledWith(caller);
    expect(getRecentEdits).toHaveBeenCalledWith({
      limit: 6,
      scope: SCOPE,
      caller,
      singles: SINGLES,
      keptOffCollections: KEPT_OFF,
      collection: "posts",
      // The reader is the server's to name: no id travels in the query.
      savedBy: "user-1",
    });
  });

  it("asks for every collection and everybody's saves when the card narrows by neither", async () => {
    await executeWidgetQuery(
      {
        source: RECENT_EDITS_SOURCE_ID,
        op: "list",
        where: { onlyMine: false },
      },
      caller
    );
    const [options] = getRecentEdits.mock.calls[0] as [Record<string, unknown>];
    expect(options).not.toHaveProperty("collection");
    expect(options).not.toHaveProperty("savedBy");
  });

  it("refuses a filter it does not declare, rather than answering another question", async () => {
    // 🔴 Dropped, `status` would be validated and then ignored, and the card
    // would list every document while its settings said otherwise.
    await expect(
      executeWidgetQuery(
        {
          source: RECENT_EDITS_SOURCE_ID,
          op: "list",
          where: { collection: "posts", status: "draft" },
        },
        caller
      )
    ).rejects.toThrow();
    expect(getRecentEdits).not.toHaveBeenCalled();
  });

  it("answers nothing for Only mine when no person is asking", async () => {
    const answer = await executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list", where: { onlyMine: true } },
      { user: undefined } as never
    );
    expect(rows(answer)).toEqual([]);
    expect(getRecentEdits).not.toHaveBeenCalled();
  });
});

describe("each row's status now", () => {
  it("labels each row with its document's status and whether changes are not published", async () => {
    const answer = await executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list" },
      caller
    );
    expect(
      rows(answer).map(row => [row.entryId, row.status, row.pendingChanges])
    ).toEqual([
      ["p1", "published", true],
      ["g1", "draft", false],
    ]);
    // Read for the documents shown and no others, as the caller.
    expect(readableDocumentStatuses).toHaveBeenCalledWith(
      "posts",
      ["p1"],
      caller,
      null
    );
  });

  it("draws a row with no label when its collection's status could not be read, and the others as usual", async () => {
    readableDocumentStatuses.mockImplementation(
      async (collection: string, ids: string[]) => {
        if (collection === "posts") throw new Error("read failed");
        return new Map(ids.map(id => [id, "draft"]));
      }
    );
    const answer = await executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list" },
      caller
    );
    expect(rows(answer).map(row => [row.entryId, row.status])).toEqual([
      ["p1", null],
      ["g1", "draft"],
    ]);
  });

  it("says nothing of pending changes when their read failed, rather than none", async () => {
    // 🔴 `false` would tell the card there is nothing unpublished when the
    // question was never answered; a read that answered still says `false`.
    pendingChangeLocales.mockImplementation(
      async (_kind: string, slug: string) => {
        if (slug === "posts") throw new Error("read failed");
        return new Map();
      }
    );
    const answer = await executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list" },
      caller
    );
    expect(rows(answer).map(row => [row.entryId, row.pendingChanges])).toEqual([
      ["p1", null],
      ["g1", false],
    ]);
  });

  it("asks no status of a collection without one", async () => {
    readRecentEditSubjects.mockResolvedValue({
      singles: SINGLES,
      keptOffCollections: KEPT_OFF,
      collectionsWithStatus: new Set(["posts"]),
    });
    const answer = await executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list" },
      caller
    );
    expect(readableDocumentStatuses).toHaveBeenCalledTimes(1);
    expect(rows(answer)[1]).toMatchObject({ entryId: "g1", status: null });
  });

  it("selects only the fields asked, in the order asked", async () => {
    const answer = await executeWidgetQuery(
      {
        source: RECENT_EDITS_SOURCE_ID,
        op: "list",
        select: ["entryTitle", "status"],
      },
      caller
    );
    expect(rows(answer)[0]).toEqual({
      entryTitle: "Title p1",
      status: "published",
    });
  });
});

describe("the span the answer covers", () => {
  const ask = () =>
    executeWidgetQuery(
      { source: RECENT_EDITS_SOURCE_ID, op: "list", limit: 5 },
      caller
    );
  const DAY = 24 * 60 * 60 * 1000;

  it("states the trail's retention, in days, when the trail is pruned", async () => {
    serviceConfig = { auditRetention: resolveAuditRetentionConfig(undefined) };
    expect(await ask()).toMatchObject({ window: { days: 90 } });
    serviceConfig = {
      auditRetention: resolveAuditRetentionConfig({
        activityMaxAgeMs: 30 * DAY,
      }),
    };
    expect(await ask()).toMatchObject({ window: { days: 30 } });
  });

  it("states a reloaded window, the one the passes now prune by", async () => {
    serviceConfig = { auditRetention: resolveAuditRetentionConfig(undefined) };
    setAuditRetention(
      resolveAuditRetentionConfig({ activityMaxAgeMs: 7 * DAY })
    );
    expect(await ask()).toMatchObject({ window: { days: 7 } });
  });

  it("never states more than the trail holds: whole days, and none below a day", async () => {
    // 🔴 A 36-hour window is one whole day, not two, and a 12-hour one is no
    // day at all: rounding either up would claim edits the trail has pruned.
    serviceConfig = {
      auditRetention: resolveAuditRetentionConfig({
        activityMaxAgeMs: 36 * 60 * 60 * 1000,
      }),
    };
    expect(await ask()).toMatchObject({ window: { days: 1 } });
    serviceConfig = {
      auditRetention: resolveAuditRetentionConfig({
        activityMaxAgeMs: 12 * 60 * 60 * 1000,
      }),
    };
    expect(await ask()).not.toHaveProperty("window");
  });

  it("states none when nothing prunes the trail", async () => {
    // Retention off, and an install with no audit policy at all: both keep
    // every row, so the answer has no bound to state.
    serviceConfig = {
      auditRetention: resolveAuditRetentionConfig({ activityMaxAgeMs: false }),
    };
    expect(await ask()).not.toHaveProperty("window");
    serviceConfig = {};
    expect(await ask()).not.toHaveProperty("window");
  });
});
