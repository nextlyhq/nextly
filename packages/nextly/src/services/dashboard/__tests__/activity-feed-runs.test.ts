/**
 * The feed's walk counts the rows it SHOWS: a run of saves is read whole before
 * a page ends, crosses the walk's rounds as one row, says when the walk's bound
 * cut it short, and hands the next page a position after its oldest save.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// As in activity-scope.test.ts: a unit harness has no registries, so the scope
// is given, with `notes` a collection. Every note is readable, which leaves the
// walk itself under test; the decision stays the real one.
vi.mock("../../lib/document-visibility", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/document-visibility")>()),
  resolveDocumentVisibilityScope: () =>
    Promise.resolve({
      kinds: new Map([["notes", "collection"]]),
      locales: null,
      degraded: false,
    }),
}));
vi.mock("../../lib/readable-documents", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/readable-documents")>()),
  readableDocumentIds: (_collection: string, entryIds: readonly string[]) =>
    Promise.resolve(new Set(entryIds)),
}));

import { ActivityLogService } from "../activity-log-service";
import { someResources } from "../readable-resources";

const T0 = Date.parse("2026-10-22T12:00:00Z");

/** The trail, newest first, as the walk reads it: `minutes` before T0 each. */
function trail(
  entries: Array<{
    entryId: string;
    minutes: number;
    userId?: string;
    /** Another collection than `notes`: one the registry does not hold, so no reader may see it. */
    collection?: string;
    action?: string;
  }>
): Record<string, unknown>[] {
  return entries.map((entry, index) => ({
    id: `r${String(10_000 - index).padStart(5, "0")}`,
    actorType: "user",
    userId: entry.userId ?? "ana",
    userName: "Ana",
    userEmail: "ana@example.test",
    action: entry.action ?? "update",
    collection: entry.collection ?? "notes",
    entryId: entry.entryId,
    entryTitle: entry.entryId,
    subjectKind: "collection",
    // A save that changed the title: an entry's update records what it changed.
    metadata: JSON.stringify({ changedFields: ["title", "updatedAt"] }),
    createdAt: new Date(T0 - entry.minutes * 60_000),
    identityErasedAt: null,
  }));
}

/** A service whose trail is `rows`, handed out in the walk's pages of 100, round after round. */
function serviceOver(rows: Record<string, unknown>[]) {
  let read = 0;
  const select = vi.fn(async (_table: string, options: { limit: number }) => {
    const page = rows.slice(read, read + options.limit);
    read += page.length;
    return page;
  });
  const adapter = {
    select,
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[0];
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[1];
  return { service: new ActivityLogService(adapter, logger), select };
}

const feed = (service: ActivityLogService, limit: number) =>
  service.getRecentActivity({
    limit,
    scope: someResources(["notes"]),
    caller: { user: { id: "reader", roles: [] } },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the feed's runs", () => {
  it("reads a run across the walk's rounds as one row, and counts it whole", async () => {
    // 150 saves of one note, a few seconds apart: two rounds of 100, one run.
    const rows = trail([
      ...Array.from({ length: 150 }, (_, i) => ({
        entryId: "n1",
        minutes: i * 0.05,
      })),
      { entryId: "n2", minutes: 30 },
    ]);
    const { service, select } = serviceOver(rows);

    const page = await feed(service, 1);

    expect(page.activities.map(a => [a.entryId, a.count])).toEqual([
      ["n1", 150],
    ]);
    expect(page.activities[0]?.countAtLeast).toBe(false);
    expect(page.activities[0]?.createdAt).toBe(new Date(T0).toISOString());
    expect(page.activities[0]?.firstCreatedAt).toBe(
      (rows[149]?.createdAt as Date).toISOString()
    );
    expect(page.hasMore).toBe(true);
    // It took the second round to see the run end.
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("says a run's count is a floor when the walk's bound stopped inside it", async () => {
    // Longer than the walk reads (ten rounds of 100), all one run.
    const rows = trail(
      Array.from({ length: 1_050 }, (_, i) => ({
        entryId: "n1",
        minutes: i * 0.01,
      }))
    );
    const { service } = serviceOver(rows);

    const page = await feed(service, 5);

    expect(page.activities).toHaveLength(1);
    expect(page.activities[0]?.count).toBe(1_000);
    expect(page.activities[0]?.countAtLeast).toBe(true);
    expect(page.hasMore).toBe(true);
  });

  it("is not a floor when the trail ended inside the run", async () => {
    const { service } = serviceOver(
      trail([
        { entryId: "n1", minutes: 0 },
        { entryId: "n1", minutes: 1 },
      ])
    );
    const page = await feed(service, 5);
    expect(page.activities.map(a => [a.count, a.countAtLeast])).toEqual([
      [2, false],
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.next).toBeUndefined();
  });

  it("continues the next page after the OLDEST save of the last run shown", async () => {
    const rows = trail([
      { entryId: "n1", minutes: 0 },
      { entryId: "n1", minutes: 1 },
      { entryId: "n1", minutes: 2 },
      { entryId: "n2", minutes: 30 },
    ]);
    const { service } = serviceOver(rows);

    const page = await feed(service, 1);

    expect(page.activities.map(a => [a.entryId, a.count])).toEqual([["n1", 3]]);
    expect(page.next).toEqual({
      createdAt: (rows[2]?.createdAt as Date).toISOString(),
      id: rows[2]?.id,
    });
  });
});

describe("a page the walk's bound ended", () => {
  /** `n` rows no reader may see, each a different document a minute apart, newest first. */
  const unreadable = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      entryId: `gone-${i}`,
      collection: "gone",
      minutes: i,
    }));

  it("hands a position past what it read when nothing it read could be shown", async () => {
    // The whole bound is unreadable; the readable save lies past it.
    const rows = trail([
      ...unreadable(1_000),
      { entryId: "n1", minutes: 2_000 },
    ]);
    const { service } = serviceOver(rows);

    const first = await feed(service, 5);

    expect(first.activities).toEqual([]);
    expect(first.hasMore).toBe(true);
    // After the last row the walk read, and carrying no run: nothing was shown.
    expect(first.next).toEqual({
      createdAt: (rows[999]?.createdAt as Date).toISOString(),
      id: rows[999]?.id,
    });

    const second = await serviceOver(
      rows.slice(1_000)
    ).service.getRecentActivity({
      limit: 5,
      scope: someResources(["notes"]),
      caller: { user: { id: "reader", roles: [] } },
      before: first.next,
    });
    expect(second.activities.map(a => a.entryId)).toEqual(["n1"]);
  });

  it("calls no count a floor when the last row shown could never be one of a run", async () => {
    // The bound ends on a deletion: no later read could add a save to it.
    const rows = trail([
      ...unreadable(999),
      { entryId: "n1", minutes: 1_500, action: "delete" },
      { entryId: "n1", minutes: 1_501 },
    ]);
    const { service } = serviceOver(rows);

    const page = await feed(service, 5);

    expect(
      page.activities.map(a => [a.action, a.count, a.countAtLeast])
    ).toEqual([["delete", 1, false]]);
    expect(page.hasMore).toBe(true);
    expect(page.next?.run).toBeUndefined();
  });
});

describe("a run the walk's bound cut", () => {
  /** One note saved `n` times a few seconds apart, then an older note saved once. */
  const longRunThenOther = (n: number) =>
    trail([
      ...Array.from({ length: n }, (_, i) => ({
        entryId: "n1",
        minutes: i * 0.01,
      })),
      { entryId: "n2", minutes: 120 },
    ]);

  it("is never shown again in part: the next page leaves out its tail", async () => {
    const rows = longRunThenOther(1_050);
    const { service } = serviceOver(rows);

    const first = await feed(service, 5);
    expect(
      first.activities.map(a => [a.entryId, a.count, a.countAtLeast])
    ).toEqual([["n1", 1_000, true]]);
    // The position carries the cut run, so the next page can leave out the rest of it.
    expect(first.next?.run).toBeDefined();

    // Read from where the first page stopped, as a next request would.
    const rest = rows.slice(1_000);
    const second = await serviceOver(rest).service.getRecentActivity({
      limit: 5,
      scope: someResources(["notes"]),
      caller: { user: { id: "reader", roles: [] } },
      before: first.next,
    });
    // The fifty saves left of n1's run are not a row of their own: the next row is n2.
    expect(second.activities.map(a => a.entryId)).toEqual(["n2"]);
  });

  it("passes a run longer than the bound in steps, each page moving on, until it ends", async () => {
    const rows = longRunThenOther(2_500);
    let position = (await feed(serviceOver(rows).service, 5)).next;
    let read = 1_000;
    const pages: string[][] = [];
    // Each page reads at most the bound, so this ends; the guard only stops a defect looping.
    for (let page = 0; page < 5 && position; page++) {
      const answer = await serviceOver(
        rows.slice(read)
      ).service.getRecentActivity({
        limit: 5,
        scope: someResources(["notes"]),
        caller: { user: { id: "reader", roles: [] } },
        before: position,
      });
      pages.push(answer.activities.map(a => String(a.entryId)));
      position = answer.next;
      read += 1_000;
    }
    // The rest of n1's run is left out page after page, and n2 is reached.
    expect(pages.flat()).toEqual(["n2"]);
  });

  it("refuses a position it did not write", async () => {
    const { service } = serviceOver(longRunThenOther(3));
    await expect(
      service.getRecentActivity({
        limit: 5,
        scope: someResources(["notes"]),
        caller: { user: { id: "reader", roles: [] } },
        before: {
          createdAt: new Date(T0).toISOString(),
          id: "r1",
          run: "not a run",
        },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
