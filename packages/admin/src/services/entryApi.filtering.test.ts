import { describe, expect, it } from "vitest";

import { buildFindQuery } from "./entryApi";

describe("entryApi filtering serialization", () => {
  it("serializes where date/status filters into API query params", () => {
    const where = {
      and: [
        { status: { equals: "published" } },
        {
          createdAt: {
            greater_than_equal: "2026-04-01T00:00:00.000Z",
            less_than_equal: "2026-04-03T23:59:59.999Z",
          },
        },
      ],
    };

    const query = buildFindQuery({
      page: 2,
      limit: 25,
      sort: "-updatedAt",
      where,
      search: "release",
    });

    const params = new URLSearchParams(query);
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("25");
    expect(params.get("sortBy")).toBe("updatedAt");
    expect(params.get("sortOrder")).toBe("desc");
    expect(params.get("search")).toBe("release");

    const parsedWhere = JSON.parse(params.get("where") || "{}");
    expect(parsedWhere).toEqual(where);
  });
});
