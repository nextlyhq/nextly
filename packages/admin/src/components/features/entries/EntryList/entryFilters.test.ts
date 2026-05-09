import { describe, expect, it } from "vitest";

import { buildEntryWhereFilter } from "./entryFilters";

describe("buildEntryWhereFilter", () => {
  it("returns undefined when no filters are active", () => {
    const where = buildEntryWhereFilter({
      whereParam: null,
      status: "all",
      createdFrom: "",
      createdTo: "",
      updatedFrom: "",
      updatedTo: "",
    });

    expect(where).toBeUndefined();
  });

  it("builds status + created/updated date filters with day boundaries", () => {
    const where = buildEntryWhereFilter({
      status: "published",
      createdFrom: "2026-04-01",
      createdTo: "2026-04-03",
      updatedFrom: "2026-04-02",
      updatedTo: "2026-04-04",
    }) as { and: Array<Record<string, unknown>> };

    expect(where.and).toEqual(
      expect.arrayContaining([
        { status: { equals: "published" } },
        {
          createdAt: {
            greater_than_equal: "2026-04-01T00:00:00.000Z",
            less_than_equal: "2026-04-03T23:59:59.999Z",
          },
        },
        {
          updatedAt: {
            greater_than_equal: "2026-04-02T00:00:00.000Z",
            less_than_equal: "2026-04-04T23:59:59.999Z",
          },
        },
      ])
    );
  });

  it("merges URL where with UI filters using and", () => {
    const where = buildEntryWhereFilter({
      whereParam: JSON.stringify({ author: { equals: "user-1" } }),
      status: "draft",
      createdFrom: "2026-04-03",
    }) as { and: Array<Record<string, unknown>> };

    expect(where.and).toEqual(
      expect.arrayContaining([
        { author: { equals: "user-1" } },
        { status: { equals: "draft" } },
        {
          createdAt: {
            greater_than_equal: "2026-04-03T00:00:00.000Z",
          },
        },
      ])
    );
  });
});
