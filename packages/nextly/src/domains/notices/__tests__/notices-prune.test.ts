/**
 * Pruning reads only what a delete by id needs: the ids, not each notice's
 * snapshot, which a backlog would otherwise transfer and parse batch by batch.
 */
import { describe, expect, it, vi } from "vitest";

import { deleteNoticesOlderThan } from "../notices-service";

describe("pruning notices", () => {
  it("selects only the ids of the oldest notices, then deletes those", async () => {
    const select = vi.fn(async () => [{ id: "n1" }, { id: "n2" }]);
    const remove = vi.fn(async () => 2);
    const removed = await deleteNoticesOlderThan(
      { select, delete: remove } as never,
      new Date("2026-01-01T00:00:00Z"),
      500
    );
    expect(removed).toBe(2);
    expect(select).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ columns: ["id"], limit: 500 })
    );
    expect(remove).toHaveBeenCalledWith(expect.any(String), {
      and: [{ column: "id", op: "IN", value: ["n1", "n2"] }],
    });
  });
});
