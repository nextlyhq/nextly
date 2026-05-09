import { describe, expect, it, vi } from "vitest";

import { introspectLiveSnapshot } from "../introspect-live";

describe("introspectLiveSnapshot - postgresql", () => {
  it("builds snapshot from information_schema.columns rows", async () => {
    // drizzle-orm/node-postgres returns pg QueryResult { rows: [...] }.
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          table_name: "dc_posts",
          column_name: "id",
          udt_name: "int4",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_name: "dc_posts",
          column_name: "title",
          udt_name: "text",
          is_nullable: "YES",
          column_default: null,
        },
        {
          table_name: "dc_posts",
          column_name: "status",
          udt_name: "varchar",
          is_nullable: "NO",
          column_default: "'draft'::character varying",
        },
      ],
    });
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "postgresql", [
      "dc_posts",
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(snapshot.tables).toHaveLength(1);
    expect(snapshot.tables[0]).toEqual({
      name: "dc_posts",
      columns: [
        { name: "id", type: "int4", nullable: false, default: undefined },
        { name: "title", type: "text", nullable: true, default: undefined },
        {
          name: "status",
          type: "varchar",
          nullable: false,
          default: "'draft'::character varying",
        },
      ],
    });
  });

  it("groups columns by table when query returns multiple tables", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          table_name: "dc_posts",
          column_name: "id",
          udt_name: "int4",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_name: "dc_users",
          column_name: "id",
          udt_name: "int4",
          is_nullable: "NO",
          column_default: null,
        },
        {
          table_name: "dc_users",
          column_name: "email",
          udt_name: "varchar",
          is_nullable: "NO",
          column_default: null,
        },
      ],
    });
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "postgresql", [
      "dc_posts",
      "dc_users",
    ]);

    expect(snapshot.tables).toHaveLength(2);
    expect(
      snapshot.tables.find(t => t.name === "dc_posts")?.columns
    ).toHaveLength(1);
    expect(
      snapshot.tables.find(t => t.name === "dc_users")?.columns
    ).toHaveLength(2);
  });

  it("returns empty snapshot when tableNames is empty (no query issued)", async () => {
    const execute = vi.fn();
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "postgresql", []);

    expect(execute).not.toHaveBeenCalled();
    expect(snapshot.tables).toEqual([]);
  });

  it("returns empty snapshot when no rows returned (table doesn't exist yet)", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "postgresql", [
      "dc_nonexistent",
    ]);

    expect(snapshot.tables).toEqual([]);
  });
});

describe("introspectLiveSnapshot - mysql", () => {
  it("handles mysql2's [rows, fields] tuple return", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          TABLE_NAME: "dc_posts",
          COLUMN_NAME: "id",
          COLUMN_TYPE: "int(11)",
          IS_NULLABLE: "NO",
          COLUMN_DEFAULT: null,
        },
        {
          TABLE_NAME: "dc_posts",
          COLUMN_NAME: "title",
          COLUMN_TYPE: "varchar(255)",
          IS_NULLABLE: "YES",
          COLUMN_DEFAULT: null,
        },
      ],
      [],
    ]);
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "mysql", ["dc_posts"]);

    expect(snapshot.tables[0].columns).toEqual([
      { name: "id", type: "int(11)", nullable: false, default: undefined },
      {
        name: "title",
        type: "varchar(255)",
        nullable: true,
        default: undefined,
      },
    ]);
  });

  it("handles flat-array MySQL return shape", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        TABLE_NAME: "dc_posts",
        COLUMN_NAME: "id",
        COLUMN_TYPE: "int(11)",
        IS_NULLABLE: "NO",
        COLUMN_DEFAULT: "0",
      },
    ]);
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "mysql", ["dc_posts"]);

    expect(snapshot.tables[0].columns[0]).toEqual({
      name: "id",
      type: "int(11)",
      nullable: false,
      default: "0",
    });
  });
});

describe("introspectLiveSnapshot - sqlite", () => {
  it("issues PRAGMA table_info per managed table", async () => {
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
          dflt_value: "'untitled'",
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

    const snapshot = await introspectLiveSnapshot(db, "sqlite", [
      "dc_posts",
      "dc_users",
    ]);

    expect(all).toHaveBeenCalledTimes(2);
    expect(snapshot.tables).toHaveLength(2);
    expect(snapshot.tables[0].columns).toEqual([
      { name: "id", type: "INTEGER", nullable: false, default: undefined },
      { name: "title", type: "TEXT", nullable: true, default: "'untitled'" },
    ]);
  });

  it("skips tables with empty PRAGMA result (table not yet created)", async () => {
    const all = vi.fn().mockReturnValue([]);
    const db = { all };

    const snapshot = await introspectLiveSnapshot(db, "sqlite", [
      "dc_nonexistent",
    ]);

    expect(snapshot.tables).toEqual([]);
  });

  it("converts non-string SQLite default values to string", async () => {
    const all = vi.fn().mockReturnValue([
      {
        cid: 0,
        name: "count",
        type: "INTEGER",
        notnull: 0,
        dflt_value: 42,
        pk: 0,
      },
    ]);
    const db = { all };

    const snapshot = await introspectLiveSnapshot(db, "sqlite", ["dc_x"]);

    expect(snapshot.tables[0].columns[0].default).toBe("42");
  });
});
