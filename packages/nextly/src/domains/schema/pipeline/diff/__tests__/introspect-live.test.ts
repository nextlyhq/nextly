import { describe, expect, it, vi } from "vitest";

import { introspectLiveSnapshot } from "../introspect-live";

const PG_COLS = {
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
};

describe("introspectLiveSnapshot - postgresql", () => {
  it("builds snapshot from columns + indexes (two queries)", async () => {
    // 1st execute = columns; 2nd execute = index rows.
    const execute = vi
      .fn()
      .mockResolvedValueOnce(PG_COLS)
      .mockResolvedValueOnce({
        rows: [
          {
            table: "dc_posts",
            index: "uq_dc_posts_slug",
            unique: true,
            column: "slug",
          },
        ],
      });
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "postgresql", [
      "dc_posts",
    ]);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(snapshot.tables[0].columns).toEqual([
      { name: "id", type: "int4", nullable: false, default: undefined },
      { name: "title", type: "text", nullable: true, default: undefined },
      {
        name: "status",
        type: "varchar",
        nullable: false,
        default: "'draft'::character varying",
      },
    ]);
    expect(snapshot.tables[0].indexes).toEqual([
      { name: "uq_dc_posts_slug", columns: ["slug"], unique: true },
    ]);
  });

  it("gives every table a defined (possibly empty) indexes array", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(PG_COLS)
      .mockResolvedValueOnce({ rows: [] });
    const db = { execute };
    const snapshot = await introspectLiveSnapshot(db, "postgresql", [
      "dc_posts",
    ]);
    expect(snapshot.tables[0].indexes).toEqual([]);
  });

  it("returns empty snapshot when tableNames is empty (no query issued)", async () => {
    const execute = vi.fn();
    const db = { execute };
    const snapshot = await introspectLiveSnapshot(db, "postgresql", []);
    expect(execute).not.toHaveBeenCalled();
    expect(snapshot.tables).toEqual([]);
  });
});

describe("introspectLiveSnapshot - mysql", () => {
  it("handles mysql2's [rows, fields] tuple + reads indexes", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            TABLE_NAME: "dc_posts",
            COLUMN_NAME: "id",
            COLUMN_TYPE: "int(11)",
            IS_NULLABLE: "NO",
            COLUMN_DEFAULT: null,
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [
          {
            TABLE_NAME: "dc_posts",
            INDEX_NAME: "idx_dc_posts_views",
            NON_UNIQUE: 1,
            COLUMN_NAME: "views",
            SEQ_IN_INDEX: 1,
          },
        ],
        [],
      ]);
    const db = { execute };

    const snapshot = await introspectLiveSnapshot(db, "mysql", ["dc_posts"]);

    expect(snapshot.tables[0].columns[0]).toEqual({
      name: "id",
      type: "int(11)",
      nullable: false,
      default: undefined,
    });
    expect(snapshot.tables[0].indexes).toEqual([
      { name: "idx_dc_posts_views", columns: ["views"], unique: false },
    ]);
  });
});

describe("introspectLiveSnapshot - sqlite", () => {
  it("reads columns + indexes, filtering pk/autoindex", async () => {
    // Call order per table: table_info, index_list, then index_info per index.
    const all = vi
      .fn()
      // table_info(dc_posts)
      .mockReturnValueOnce([
        { cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "slug", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      ])
      // index_list(dc_posts): one real unique index + one autoindex (filtered)
      .mockReturnValueOnce([
        { name: "uq_dc_posts_slug", unique: 1, origin: "c" },
        { name: "sqlite_autoindex_dc_posts_1", unique: 1, origin: "u" },
      ])
      // index_info(uq_dc_posts_slug)
      .mockReturnValueOnce([{ name: "slug" }]);
    const db = { all };

    const snapshot = await introspectLiveSnapshot(db, "sqlite", ["dc_posts"]);

    expect(snapshot.tables[0].columns).toEqual([
      { name: "id", type: "integer", nullable: false, default: undefined },
      { name: "slug", type: "text", nullable: true, default: undefined },
    ]);
    expect(snapshot.tables[0].indexes).toEqual([
      { name: "uq_dc_posts_slug", columns: ["slug"], unique: true },
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
});
