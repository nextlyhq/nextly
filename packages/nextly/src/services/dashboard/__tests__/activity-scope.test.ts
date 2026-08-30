import { describe, expect, it, vi } from "vitest";

import { ActivityLogService } from "../activity-log-service";
import { someResources } from "../readable-resources";

function makeService() {
  const adapter = {
    select: vi.fn().mockResolvedValue([]),
    executeQuery: vi.fn().mockResolvedValue([{ count: 0 }]),
    getDialect: () => "sqlite",
  } as unknown as ConstructorParameters<typeof ActivityLogService>[0];
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as ConstructorParameters<typeof ActivityLogService>[1];
  return { service: new ActivityLogService(adapter, logger), adapter };
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

  it("queries with an IN filter when the caller may read some resources", async () => {
    const { service, adapter } = makeService();

    await service.getRecentActivity({
      limit: 5,
      scope: someResources(["posts", "email-providers"]),
    });

    const call = (adapter.select as ReturnType<typeof vi.fn>).mock.calls[0];
    const where = (
      call[1] as { where: { and: Array<Record<string, unknown>> } }
    ).where;
    expect(where.and).toContainEqual(
      expect.objectContaining({ op: "IN", column: "collection" })
    );
  });
});
