/**
 * `system:activity`: the Recent activity card's source asks the feed exactly
 * what the activity endpoint asks it, and refuses what it cannot answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getRecentActivity = vi.fn();
const has = vi.fn();
const resolveReadableResources = vi.fn();
const readActivitySubjects = vi.fn();

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => has(name) as boolean,
    get: () => ({ getRecentActivity }),
  },
}));
vi.mock("../resolve-readable-resources", () => ({
  resolveReadableResources: (...args: unknown[]) =>
    resolveReadableResources(...args) as unknown,
}));
vi.mock("../activity-subjects", () => ({
  readActivitySubjects: () => readActivitySubjects() as unknown,
}));

import { executeWidgetQuery } from "../../../domains/widgets/execute";
import { clearSources } from "../../../domains/widgets/sources";
import { clearSystemResolvers } from "../../../domains/widgets/system-sources";
import {
  ACTIVITY_SOURCE_ID,
  registerActivityWidgetSource,
} from "../activity-widget-source";
import { someResources } from "../readable-resources";

const caller = { user: { id: "user-1", roles: ["editor"] } };
const SCOPE = someResources(["posts"]);
const SINGLES = { labels: new Map(), keptOff: new Set(), complete: true };
// A collection the dashboard hides: the feed is told it, as the endpoint tells it.
const KEPT_OFF = { slugs: new Set(["pb_patterns"]), complete: true };

const entry = {
  id: "a1",
  actorType: "user",
  userId: "user-2",
  userName: "Ana",
  userEmail: "ana@example.test",
  action: "update",
  collection: "posts",
  entryId: "p1",
  entryTitle: "Hello",
  subjectKind: "collection",
  metadata: { changedFields: ["title"] },
  createdAt: "2026-10-22T12:00:00.000Z",
  count: 3,
  countAtLeast: false,
  firstCreatedAt: "2026-10-22T11:50:00.000Z",
  identityErasedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  has.mockReturnValue(true);
  resolveReadableResources.mockResolvedValue(SCOPE);
  readActivitySubjects.mockResolvedValue({
    singles: SINGLES,
    keptOffCollections: KEPT_OFF,
  });
  getRecentActivity.mockResolvedValue({ activities: [entry], hasMore: false });
  clearSources();
  clearSystemResolvers();
  registerActivityWidgetSource();
});

describe("what it asks the feed", () => {
  it("asks as the caller, within the scope the access layer gives them, as the endpoint does", async () => {
    await executeWidgetQuery(
      { source: ACTIVITY_SOURCE_ID, op: "list", limit: 6 },
      caller
    );

    // The same things the endpoint hands the feed, read the same way: the
    // scope is asked of the access layer for THIS caller, and the registries'
    // Singles and kept-off collections are handed on whole.
    expect(resolveReadableResources).toHaveBeenCalledWith(caller);
    expect(getRecentActivity).toHaveBeenCalledWith({
      limit: 6,
      scope: SCOPE,
      caller,
      singles: SINGLES,
      keptOffCollections: KEPT_OFF,
    });
  });

  it("answers the rows, with the run count and never the trail's changed fields", async () => {
    const answer = await executeWidgetQuery(
      { source: ACTIVITY_SOURCE_ID, op: "list" },
      caller
    );

    expect(answer).toMatchObject({ op: "list" });
    const [row] = (answer as { items: Record<string, unknown>[] }).items;
    expect(row).toMatchObject({
      id: "a1",
      entryTitle: "Hello",
      count: 3,
      countAtLeast: false,
      firstCreatedAt: "2026-10-22T11:50:00.000Z",
    });
    expect(row).not.toHaveProperty("metadata");
  });

  it("answers only the fields a query selected, and heads them", async () => {
    const answer = await executeWidgetQuery(
      {
        source: ACTIVITY_SOURCE_ID,
        op: "list",
        select: ["entryTitle", "count"],
      },
      caller
    );

    const result = answer as {
      items: Record<string, unknown>[];
      fields?: { name: string }[];
    };
    expect(result.items).toEqual([{ entryTitle: "Hello", count: 3 }]);
    expect(result.fields?.map(field => field.name)).toEqual([
      "entryTitle",
      "count",
    ]);
  });
});

describe("what it refuses", () => {
  it.each([
    ["a filter", { where: { collection: { equals: "posts" } } }],
    ["a sort", { sort: "-createdAt" }],
    ["a status", { status: "draft" as const }],
  ])(
    "refuses %s rather than answering a different question",
    async (_, extra) => {
      await expect(
        executeWidgetQuery(
          { source: ACTIVITY_SOURCE_ID, op: "list", ...extra },
          caller
        )
      ).rejects.toThrow();
      expect(getRecentActivity).not.toHaveBeenCalled();
    }
  );
});
