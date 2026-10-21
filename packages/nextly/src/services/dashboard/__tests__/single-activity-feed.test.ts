/**
 * The activity feed and the rows that are a Single's: which of them the query
 * leaves out as kept off the dashboard, and the one a read check could never
 * be asked about.
 *
 * The read itself stands in for the database here, so these pin the filter the
 * feed hands it and what it does with what comes back; the integration tests
 * run the same filter on each dialect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registeredKinds = vi.fn();

// The scope is container-backed and a unit harness has no registries, so the
// real resolver would report `degraded` and the feed would refuse on that
// instead of on what each case is named for.
vi.mock("../../lib/document-visibility", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/document-visibility")>()),
  resolveDocumentVisibilityScope: () =>
    Promise.resolve({
      kinds: registeredKinds() as Map<string, "collection" | "single">,
      locales: null,
      degraded: false,
    }),
}));

import {
  ActivityLogService,
  type ActivitySingles,
} from "../activity-log-service";
import { someResources } from "../readable-resources";

beforeEach(() => {
  vi.clearAllMocks();
  registeredKinds.mockReturnValue(
    new Map<string, "collection" | "single">([["home", "single"]])
  );
});

function makeService() {
  const adapter = {
    select: vi.fn().mockResolvedValue([]),
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[0];
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[1];
  return { service: new ActivityLogService(adapter, logger), adapter };
}

/** The `and` list of the where clause the feed handed its first read. */
async function whereFor(singles: ActivitySingles | undefined) {
  const { service, adapter } = makeService();
  await service.getRecentActivity({
    limit: 5,
    scope: someResources(["posts", "home"]),
    caller: { user: { id: "reader", roles: [] } },
    ...(singles === undefined ? {} : { singles }),
  });
  const call = (adapter.select as ReturnType<typeof vi.fn>).mock.calls[0];
  return (call?.[1] as { where: { and: unknown[] } }).where.and;
}

const notASingle = [
  { column: "subjectKind", op: "IS NULL" },
  { column: "subjectKind", op: "!=", value: "single" },
];

describe("the rows of Singles kept off the dashboard", () => {
  it("are left out by the row's stated kind, so a row stating none still passes", async () => {
    const and = await whereFor({
      labels: new Map(),
      keptOff: new Set(["home"]),
      complete: true,
    });
    // `IS NULL` first: a row from before the kind was recorded is a
    // collection's, and a filter written as NOT (kind = single AND ...) would
    // drop it on its NULL.
    expect(and).toContainEqual({
      or: [
        ...notASingle,
        { column: "collection", op: "NOT IN", value: ["home"] },
      ],
    });
  });

  it("leaves out every Single's row when the Singles could not be read", async () => {
    // Which Singles are hidden is unknown, so none is shown rather than a
    // hidden one.
    for (const singles of [
      undefined,
      { labels: new Map(), keptOff: new Set<string>(), complete: false },
    ]) {
      expect(await whereFor(singles)).toContainEqual({ or: notASingle });
    }
  });

  it("adds no condition when the read completed and no Single is kept off", async () => {
    const and = await whereFor({
      labels: new Map(),
      keptOff: new Set(),
      complete: true,
    });
    expect(and).not.toContainEqual(
      expect.objectContaining({ or: expect.anything() })
    );
  });
});

describe("a row stating a Single with no document id", () => {
  const drawFeed = async (row: Record<string, unknown>) => {
    const { service, adapter } = makeService();
    (adapter.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
    return service.getRecentActivity({
      limit: 5,
      scope: someResources(["home"]),
      caller: { user: { id: "reader", roles: ["editor"] } },
      singles: { labels: new Map(), keptOff: new Set(), complete: true },
    });
  };
  const row = {
    id: "r1",
    action: "update",
    collection: "home",
    entryId: null,
    entryTitle: "Home",
    createdAt: new Date(2026, 0, 1),
  };

  it("is dropped, since no read check can be asked about it", async () => {
    const result = await drawFeed({ ...row, subjectKind: "single" });
    expect(result.activities).toEqual([]);
  });

  it("while a settings row with no id is still shown, as an install-level event", async () => {
    // The control: the harness does return id-less rows, so the drop above is
    // the Single rule's doing.
    const result = await drawFeed({ ...row, subjectKind: "settings" });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]?.subjectKind).toBe("settings");
  });
});
