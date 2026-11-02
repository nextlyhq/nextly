/**
 * A read that starts at an offset reports its paging from where it started, so
 * a list showing items 7 to 12 of 20 is told there are rows before and after
 * it. A read by page keeps today's answer.
 */
import { describe, expect, it } from "vitest";

import { buildPaginatedResponse } from "../pagination";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("buildPaginatedResponse with an offset", () => {
  it.each([
    // offset, docs returned, expected
    [0, 6, { pagingCounter: 1, hasPrevPage: false, hasNextPage: true }],
    [5, 6, { pagingCounter: 6, hasPrevPage: true, hasNextPage: true }],
    [7, 6, { pagingCounter: 8, hasPrevPage: true, hasNextPage: true }],
    [14, 6, { pagingCounter: 15, hasPrevPage: true, hasNextPage: false }],
  ])("at offset %s with limit 6 of 20", (offset, returned, expected) => {
    const meta = buildPaginatedResponse(rows(returned), {
      total: 20,
      page: 1,
      limit: 6,
      offset,
    });
    expect(meta).toMatchObject({ totalDocs: 20, limit: 6, ...expected });
  });

  it("counts the rows it returned, not a full page, when deciding there are more", () => {
    // 2 rows left at offset 18 of 20: nothing after them.
    const meta = buildPaginatedResponse(rows(2), {
      total: 20,
      page: 1,
      limit: 6,
      offset: 18,
    });
    expect(meta.hasNextPage).toBe(false);
    expect(meta.nextPage).toBeNull();
  });

  it("decides there are more from the window read, not from what a hook left of it", () => {
    // Offset 14 of 20 with limit 6 read the last six rows; an afterRead hook
    // dropped one, so five came back. Nothing follows the window.
    const meta = buildPaginatedResponse(rows(5), {
      total: 20,
      page: 1,
      limit: 6,
      offset: 14,
    });
    expect(meta.hasNextPage).toBe(false);
  });

  it("CONTROL: a read by page answers as before", () => {
    const meta = buildPaginatedResponse(rows(6), {
      total: 20,
      page: 2,
      limit: 6,
    });
    expect(meta).toMatchObject({
      page: 2,
      pagingCounter: 7,
      hasPrevPage: true,
      hasNextPage: true,
      prevPage: 1,
      nextPage: 3,
    });
  });
});
