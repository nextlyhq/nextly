/**
 * Reading a submission's send history whole: a result left on a later page
 * would be taken as never having happened.
 */
import { describe, expect, it, vi } from "vitest";

import { everyPage } from "./send-views";

describe("reading the history whole", () => {
  it("reads page after page until one comes back short", async () => {
    const rows = Array.from({ length: 1003 }, (_, index) => index);
    const read = vi.fn(async (page: number, limit: number) => ({
      data: rows.slice((page - 1) * limit, page * limit),
    }));

    expect(await everyPage(read)).toEqual(rows);
    expect(read.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("reads once when the first page holds everything", async () => {
    const read = vi.fn(async () => ({ data: [1, 2] }));
    expect(await everyPage(read)).toEqual([1, 2]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
