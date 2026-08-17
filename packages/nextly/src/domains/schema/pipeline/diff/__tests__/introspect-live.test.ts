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
      is_primary_key: true,
    },
    {
      table_name: "dc_posts",
      column_name: "title",
      udt_name: "text",
      is_nullable: "YES",
      column_default: null,
      is_primary_key: false,
    },
    {
      table_name: "dc_posts",
      column_name: "status",
      udt_name: "varchar",
      is_nullable: "NO",
      column_default: "'draft'::character varying",
      is_primary_key: false,
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
      {
        name: "id",
        type: "int4",
        nullable: false,
        default: undefined,
        primaryKey: true,
      },
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
  // Three queries, in this order: columns, the PRIMARY key's columns, then the
  // secondary indexes. A mock short by one silently shifts every later result
  // onto the wrong query, so the count is part of what these tests pin.
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
            DATA_TYPE: "int",
            EXTRA: "",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([
        [{ TABLE_NAME: "dc_posts", COLUMN_NAME: "id" }],
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
      primaryKey: true,
      // MySQL reports the DECLARATION in `COLUMN_TYPE`, so a display width declared on the column
      // is part of what it says. Recorded as reported rather than judged here: whether a modifier
      // is meaningful for a given type is the consumer's question, and inventing an absence would
      // be the same error as inventing a width.
      typeModifier: "11",
    });
    expect(snapshot.tables[0].indexes).toEqual([
      { name: "idx_dc_posts_views", columns: ["views"], unique: false },
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("keys only the columns the PRIMARY index names", async () => {
    // `COLUMN_KEY` is not consulted, and this is why: MySQL reports `PRI` for
    // a NOT NULL UNIQUE index when the table has no primary key at all,
    // because InnoDB promotes such an index to the clustered key. The fixture
    // says `PRI` on a column the PRIMARY index does not name, so a reader that
    // trusted it would key `slug`.
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            TABLE_NAME: "dc_posts",
            COLUMN_NAME: "slug",
            COLUMN_TYPE: "varchar(40)",
            IS_NULLABLE: "NO",
            COLUMN_DEFAULT: null,
            COLUMN_KEY: "PRI",
            DATA_TYPE: "varchar",
            EXTRA: "",
          },
        ],
        [],
      ])
      // No PRIMARY index on the table.
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const snapshot = await introspectLiveSnapshot({ execute }, "mysql", [
      "dc_posts",
    ]);

    expect(
      snapshot.tables[0].columns.filter(c => c.primaryKey === true)
    ).toEqual([]);
  });

  it("quotes a literal default and leaves an expression alone", async () => {
    // MySQL reports a string default without quotes, unlike the other two
    // dialects, and `EXTRA` is what separates a literal from an expression.
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            TABLE_NAME: "dc_posts",
            COLUMN_NAME: "status",
            COLUMN_TYPE: "varchar(20)",
            IS_NULLABLE: "NO",
            COLUMN_DEFAULT: "dra'ft\\x",
            DATA_TYPE: "varchar",
            EXTRA: "",
          },
          {
            TABLE_NAME: "dc_posts",
            COLUMN_NAME: "n",
            COLUMN_TYPE: "int(11)",
            IS_NULLABLE: "YES",
            COLUMN_DEFAULT: "5",
            DATA_TYPE: "int",
            EXTRA: "",
          },
          {
            TABLE_NAME: "dc_posts",
            COLUMN_NAME: "made_at",
            COLUMN_TYPE: "datetime",
            IS_NULLABLE: "YES",
            COLUMN_DEFAULT: "CURRENT_TIMESTAMP",
            DATA_TYPE: "datetime",
            EXTRA: "DEFAULT_GENERATED",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const snapshot = await introspectLiveSnapshot({ execute }, "mysql", [
      "dc_posts",
    ]);

    expect(snapshot.tables[0].columns.map(c => c.default)).toEqual([
      // Backslash escaped first, then the quote doubled.
      "'dra''ft\\\\x'",
      "5",
      "CURRENT_TIMESTAMP",
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
          name: "slug",
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: 0,
        },
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
      {
        name: "id",
        type: "integer",
        nullable: false,
        default: undefined,
        primaryKey: true,
      },
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
