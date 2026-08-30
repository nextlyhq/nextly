import { describe, expect, it, vi } from "vitest";

import { ActivityLogService } from "../activity-log-service";
import { someResources } from "../readable-resources";

/**
 * `dialect` defaults to sqlite. The earlier version of this mock exposed a
 * `getDialect` method that nothing in `ActivityLogService` calls -- the real
 * getter reads `this.adapter.getCapabilities().dialect` -- so every access to
 * `this.dialect` threw, was swallowed by `countActivities`' own `catch`, and
 * silently returned 0. That masked exactly the SQL-emission defect this file
 * now tests for directly: `getCapabilities` is what has to be mocked for
 * `filterClause`'s dialect branches to run at all.
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

    expect(result).toEqual({ activities: [], total: 0, hasMore: false });
    // An empty IN list is a syntax error on some dialects, so the short-circuit
    // must happen BEFORE the query is built, not inside it.
    expect(adapter.select).not.toHaveBeenCalled();
  });

  it("queries with an IN filter over exactly the scope's resources", async () => {
    const { service, adapter } = makeService();

    await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts", "email-providers"]),
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

describe("countActivities SQL emission", () => {
  // `countActivities` is private; its emitted SQL and params are observable
  // only through what it hands `adapter.executeQuery`. Nothing previously
  // inspected either -- the mock's `executeQuery` return value was read, but
  // its call arguments never were -- so a placeholder/params mismatch here
  // (I-1) would produce a wrong `total`, or a silent 0 through the blanket
  // catch, with a green suite either way.
  //
  // One case per dialect, and one filter of each kind (`=` then `IN`) so the
  // placeholder numbering is proven across a boundary: if it were derived from
  // the filter's array index rather than from `params.length` as each value is
  // pushed, the `IN` filter's own placeholders would be right but everything
  // would still line up here, because index 1 and `params.length` after one
  // push agree. What catches the regression is that a WRONG numbering scheme
  // also has to survive the exact params array asserted below, in the exact
  // order `filterClause` pushes them.
  it.each([
    {
      dialect: "postgresql" as const,
      expectedSql:
        'SELECT COUNT(*) as count FROM activity_log WHERE "user_id" = $1 AND "collection" IN ($2, $3)',
    },
    {
      dialect: "sqlite" as const,
      expectedSql:
        "SELECT COUNT(*) as count FROM activity_log WHERE `user_id` = ? AND `collection` IN (?, ?)",
    },
  ])(
    "emits the full parameterised SQL and params, on $dialect",
    async ({ dialect, expectedSql }) => {
      const { service, adapter } = makeService(dialect);

      await service.getRecentActivity({
        userId: "u1",
        scope: someResources(["posts", "email-providers"]),
      });

      // Full string and full array, not a substring or a `toContain`: either
      // of those would pass a query missing a clause, carrying an extra one,
      // or binding its params out of order.
      expect(adapter.executeQuery).toHaveBeenCalledWith(expectedSql, [
        "u1",
        "posts",
        "email-providers",
      ]);
    }
  );

  it("logs and returns 0, rather than throwing or reporting silently, when the count query fails", async () => {
    const { service, adapter, logger } = makeService();
    (adapter.executeQuery as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection reset")
    );

    const result = await service.getRecentActivity({
      userId: "u1",
      scope: someResources(["posts"]),
    });

    // The rows still come back (a different adapter call, `select`, which
    // this rejection does not touch) -- only `total` degrades.
    expect(result.total).toBe(0);
    // The property M-3 fixes: a bare `catch { return 0 }` here made a
    // placeholder/params mismatch indistinguishable from a legitimate empty
    // count, with nothing in the logs to tell them apart.
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to count activities",
      expect.objectContaining({ error: "connection reset" })
    );
  });
});
