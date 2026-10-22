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
  entries: Array<{ entryId: string; minutes: number; userId?: string }>
): Record<string, unknown>[] {
  return entries.map((entry, index) => ({
    id: `r${String(10_000 - index).padStart(5, "0")}`,
    actorType: "user",
    userId: entry.userId ?? "ana",
    userName: "Ana",
    userEmail: "ana@example.test",
    action: "update",
    collection: "notes",
    entryId: entry.entryId,
    entryTitle: entry.entryId,
    subjectKind: "collection",
    metadata: null,
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

describe("the feed's row limit", () => {
  it("holds every door to one clamp: at most 50 rows, and 5 when none is asked", async () => {
    // Sixty different notes, so each is a row of its own.
    const rows = trail(
      Array.from({ length: 60 }, (_, i) => ({ entryId: `n${i}`, minutes: i }))
    );

    const many = await feed(serviceOver(rows).service, 500);
    expect(many.activities).toHaveLength(50);

    const unasked = await serviceOver(rows).service.getRecentActivity({
      scope: someResources(["notes"]),
      caller: { user: { id: "reader", roles: [] } },
    });
    expect(unasked.activities).toHaveLength(5);
  });
});
