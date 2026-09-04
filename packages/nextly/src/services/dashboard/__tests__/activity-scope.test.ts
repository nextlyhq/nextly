import { describe, expect, it, vi } from "vitest";

import { ActivityLogService } from "../activity-log-service";
import { someResources } from "../readable-resources";

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
