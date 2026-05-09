import { describe, expect, it, vi } from "vitest";

import { queryLiveColumnTypes } from "../live-column-types";

describe("queryLiveColumnTypes - postgresql", () => {
  it("queries information_schema.columns and builds the map", async () => {
    // drizzle-orm/node-postgres returns pg QueryResult { rows: [...], ... }
    // - mock the production shape so test honesty matches real DB behavior.
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { table_name: "dc_posts", column_name: "id", udt_name: "int4" },
        { table_name: "dc_posts", column_name: "title", udt_name: "text" },
        { table_name: "dc_users", column_name: "id", udt_name: "int4" },
      ],
    });
    const db = { execute };

    const result = await queryLiveColumnTypes(db, "postgresql", [
      "dc_posts",
      "dc_users",
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.get("dc_posts")?.get("title")).toBe("text");
    expect(result.get("dc_posts")?.get("id")).toBe("int4");
    expect(result.get("dc_users")?.get("id")).toBe("int4");
  });

  it("returns empty map when tableNames is empty (no query issued)", async () => {
    const execute = vi.fn();
    const db = { execute };

    const result = await queryLiveColumnTypes(db, "postgresql", []);

    expect(execute).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("returns empty map when no rows returned", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute };

    const result = await queryLiveColumnTypes(db, "postgresql", [
      "dc_nonexistent",
    ]);

    expect(result.size).toBe(0);
  });
});

describe("queryLiveColumnTypes - mysql", () => {
  it("queries information_schema.columns scoped to current database", async () => {
    // mysql2's execute() returns [rows, fieldPackets] tuple
    const execute = vi.fn().mockResolvedValue([
      [
        { TABLE_NAME: "dc_posts", COLUMN_NAME: "title", COLUMN_TYPE: "text" },
        { TABLE_NAME: "dc_posts", COLUMN_NAME: "id", COLUMN_TYPE: "int(11)" },
      ],
      [],
    ]);
    const db = { execute };

    const result = await queryLiveColumnTypes(db, "mysql", ["dc_posts"]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.get("dc_posts")?.get("title")).toBe("text");
    expect(result.get("dc_posts")?.get("id")).toBe("int(11)");
  });

  it("handles flat-array MySQL execute return shape", async () => {
    // Some drivers return a flat row array
    const execute = vi
      .fn()
      .mockResolvedValue([
        { TABLE_NAME: "dc_posts", COLUMN_NAME: "title", COLUMN_TYPE: "text" },
      ]);
    const db = { execute };

    const result = await queryLiveColumnTypes(db, "mysql", ["dc_posts"]);

    expect(result.get("dc_posts")?.get("title")).toBe("text");
  });
});

describe("queryLiveColumnTypes - sqlite", () => {
  it("issues PRAGMA table_info per table", async () => {
    const all = vi
      .fn()
      .mockReturnValueOnce([
        {
          cid: 0,
          name: "id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
        {
          cid: 1,
          name: "title",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
      ])
      .mockReturnValueOnce([
        {
          cid: 0,
          name: "id",
          type: "INTEGER",
          notnull: 1,
          dflt_value: null,
          pk: 1,
        },
      ]);
    const db = { all };

    const result = await queryLiveColumnTypes(db, "sqlite", [
      "dc_posts",
      "dc_users",
    ]);

    expect(all).toHaveBeenCalledTimes(2);
    expect(result.get("dc_posts")?.get("title")).toBe("TEXT");
    expect(result.get("dc_posts")?.get("id")).toBe("INTEGER");
    expect(result.get("dc_users")?.get("id")).toBe("INTEGER");
  });

  it("skips tables with empty PRAGMA result (table doesn't exist)", async () => {
    const all = vi.fn().mockReturnValue([]);
    const db = { all };

    const result = await queryLiveColumnTypes(db, "sqlite", ["dc_nonexistent"]);

    expect(result.size).toBe(0);
  });
});
