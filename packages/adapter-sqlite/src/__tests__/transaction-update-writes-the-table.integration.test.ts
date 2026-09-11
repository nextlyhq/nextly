// A transaction's `update` is built by the adapter, as its `insert` is, so it
// reaches the columns the PHYSICAL table has. The pooled `update` goes through
// the Drizzle query builder, which writes only the columns the runtime MODEL
// declares and drops the rest without a word. The localization transition
// window depends on the difference: `localized` has been flipped, the model has
// moved a translatable column to a companion table that does not exist yet,
// and the default locale must keep writing the column the main table still
// has. The table here has `title` and `published_at` and the model declares
// neither, which is that window in miniature.
//
// Every stored value is read back with a raw SELECT rather than through the
// model, since the model cannot see the column whose write is in question.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_txsqlite_update_table";

// The physical table, through the production DDL helper. `title` and
// `published_at` exist here and not on the model below.
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "slug", type: "text", nullable: false },
    { name: "title", type: "text" },
    { name: "published_at", type: "integer" },
    { name: "updated_at", type: "integer" },
    { name: "published", type: "integer" },
    { name: "cover", type: "blob" },
  ],
};

// The runtime model: `title` and `published_at` are deliberately absent.
const pages = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  published: integer("published", { mode: "boolean" }),
});

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

interface StoredRow {
  id: string;
  slug: string;
  title: string | null;
  published_at: number | null;
  updated_at: number | null;
  published: number | null;
}

describe("SQLite transaction update writes the physical table", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  const stored = async (id: string): Promise<StoredRow | undefined> => {
    const rows = await adapter.executeQuery<StoredRow>(
      `SELECT id, slug, title, published_at, updated_at, published FROM ${TABLE} WHERE id = ?`,
      [id]
    );
    return rows[0];
  };

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? pages : null),
    });
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(
      `INSERT INTO ${TABLE} (id, slug, title, updated_at, published) VALUES ('a', 'first', 'First', 0, 0)`
    );
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it("writes a column the model does not declare; the pooled builder update drops it", async () => {
    // The control first, and it must come out DIFFERENT: the same write
    // through the query builder stores the declared column and leaves the
    // undeclared one as it was, without a word — the silence this path
    // exists to replace. A declared column rides along in both writes
    // because that is the shape of every entry update (`updated_at` is
    // always in it); with nothing declared at all the builder emits an empty
    // SET and the database refuses the syntax, which is a different failure.
    await adapter.update(
      TABLE,
      { slug: "pooled", title: "Dropped" },
      byId("a")
    );
    expect(await stored("a")).toMatchObject({ slug: "pooled", title: "First" });

    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { slug: "tx", title: "Written" }, byId("a"));
    });
    expect(await stored("a")).toMatchObject({ slug: "tx", title: "Written" });
  });

  it("binds a declared date and boolean as the query builder would, and an undeclared date as the insert would", async () => {
    const at = new Date("2026-09-11T10:00:00.000Z");
    await adapter.transaction(async ctx => {
      await ctx.update(
        TABLE,
        { updated_at: at, published: true, published_at: at },
        byId("a")
      );
    });
    const row = await stored("a");
    // The declared timestamp column stores unix seconds, its boolean 0/1 —
    // the encodings `integer({ mode })` reads back — and the undeclared
    // integer column takes the same seconds `sanitizeSqliteValue` gives every
    // value the transactional insert binds, so a translatable date written
    // during the window reads back through the companion's own column mode.
    expect(row?.updated_at).toBe(Math.floor(at.getTime() / 1000));
    expect(row?.published).toBe(1);
    expect(row?.published_at).toBe(Math.floor(at.getTime() / 1000));
  });

  it("leaves a column alone for undefined and clears it for null", async () => {
    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { slug: "second", title: undefined }, byId("a"));
    });
    expect(await stored("a")).toMatchObject({ slug: "second", title: "First" });

    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { title: null }, byId("a"));
    });
    expect((await stored("a"))?.title).toBeNull();
  });

  it("refuses a column the table does not have, naming the operation and the table", async () => {
    await expect(
      adapter.transaction(async ctx => {
        await ctx.update(TABLE, { ghost: "x" }, byId("a"));
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/update operation failed.*ghost/s),
      table: TABLE,
    });
    // The refused statement wrote nothing else either.
    expect((await stored("a"))?.title).toBe("First");
  });

  it("refuses an update that names nothing to write", async () => {
    await expect(
      adapter.transaction(async ctx => {
        await ctx.update(TABLE, { title: undefined }, byId("a"));
      })
    ).rejects.toThrow(/No values to set/);
  });

  it("reads the rows back decoded when asked, and returns nothing when not", async () => {
    const at = new Date("2026-09-11T10:00:00.000Z");
    const [none, requested, everything] = await adapter.transaction(
      async ctx => [
        await ctx.update(TABLE, { slug: "n" }, byId("a")),
        await ctx.update<{ id: string }>(TABLE, { slug: "r" }, byId("a"), {
          returning: ["id"],
        }),
        await ctx.update<Record<string, unknown>>(
          TABLE,
          { updated_at: at, published: true, title: "T" },
          byId("a"),
          { returning: "*" }
        ),
      ]
    );
    expect(none).toEqual([]);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({ id: "a" });
    // The rows are a read of the same WHERE on this transaction, decoded as
    // every read is: the model's property names, a `Date` for the timestamp
    // rather than the integer, a boolean for the flag rather than 0/1 — and
    // only the model's columns, so the physical-only `title` is not among
    // them even though the write above stored it (the raw read proves that).
    expect(everything).toHaveLength(1);
    expect(everything[0]).toMatchObject({ id: "a", published: true });
    expect(everything[0].updatedAt).toBeInstanceOf(Date);
    expect((everything[0].updatedAt as Date).getTime()).toBe(at.getTime());
    expect(Object.hasOwn(everything[0], "title")).toBe(false);
    expect((await stored("a"))?.title).toBe("T");
  });

  it("reads back exactly the rows it changed, even when its own write falsifies its predicate", async () => {
    // Read back by the identity RETURNING reported, not by re-running the
    // predicate: `slug = 'first'` is false of the row once the write lands,
    // and a read by predicate would answer nothing.
    const rows = await adapter.transaction(ctx =>
      ctx.update<{ id: string; slug: string }>(
        TABLE,
        { slug: "renamed" },
        { and: [{ column: "slug", op: "=", value: "first" }] },
        { returning: "*" }
      )
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "a", slug: "renamed" });
  });

  it("binds a Buffer as binary on an undeclared BLOB column", async () => {
    // The sanitizer's object branch would spell a Buffer out as JSON text;
    // better-sqlite3 takes the bytes as they are.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await adapter.transaction(async ctx => {
      await ctx.update(TABLE, { cover: bytes }, byId("a"));
    });
    const stored = await adapter.executeQuery<{ cover: Buffer }>(
      `SELECT cover FROM ${TABLE} WHERE id = ?`,
      ["a"]
    );
    expect(Buffer.isBuffer(stored[0]?.cover)).toBe(true);
    expect(Buffer.compare(stored[0]!.cover, bytes)).toBe(0);
  });

  describe("the identity read-back", () => {
    // A key whose property name differs from its SQL name, and a key made of
    // two columns declared at the table level (each column's own flag stays
    // false): both identify their rows through the same read-back.
    const SESSIONS = "int_txsqlite_update_sessions";
    const sessions = sqliteTable(SESSIONS, {
      sessionToken: text("session_token").primaryKey(),
      label: text("label"),
    });
    const LINKS = "int_txsqlite_update_links";
    const links = sqliteTable(
      LINKS,
      {
        postId: text("post_id").notNull(),
        tagId: text("tag_id").notNull(),
        weight: integer("weight"),
      },
      t => [primaryKey({ columns: [t.postId, t.tagId] })]
    );

    beforeEach(async () => {
      adapter.setTableResolver({
        getTable: (name: string) =>
          name === TABLE
            ? pages
            : name === SESSIONS
              ? sessions
              : name === LINKS
                ? links
                : null,
      });
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${SESSIONS}`);
      await adapter.createTable({
        name: SESSIONS,
        columns: [
          { name: "session_token", type: "text", primaryKey: true },
          { name: "label", type: "text" },
        ],
      });
      await adapter.executeQuery(
        `INSERT INTO ${SESSIONS} (session_token, label) VALUES ('s1', 'one')`
      );
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${LINKS}`);
      await adapter.executeQuery(
        `CREATE TABLE ${LINKS} (post_id text NOT NULL, tag_id text NOT NULL, weight integer, PRIMARY KEY (post_id, tag_id))`
      );
      await adapter.executeQuery(
        `INSERT INTO ${LINKS} (post_id, tag_id, weight) VALUES ('p1', 't1', 1), ('p2', 't2', 1), ('p1', 't2', 5)`
      );
    });

    it("addresses a key by its property name when that differs from its SQL name", async () => {
      const rows = await adapter.transaction(ctx =>
        ctx.update<{ sessionToken: string; label: string }>(
          SESSIONS,
          { label: "renamed" },
          { and: [{ column: "label", op: "=", value: "one" }] },
          { returning: "*" }
        )
      );
      expect(rows).toEqual([{ sessionToken: "s1", label: "renamed" }]);
    });

    it("reads a table-level composite key back as a whole", async () => {
      // `weight = 1` is false of both touched rows once the write lands, so a
      // read by predicate would answer nothing; and matching the key column
      // by column — post in (p1, p2), tag in (t1, t2) — would admit the
      // untouched ('p1','t2'). The whole-key predicate returns exactly the two.
      const rows = await adapter.transaction(ctx =>
        ctx.update<{ postId: string; tagId: string; weight: number }>(
          LINKS,
          { weight: 2 },
          { and: [{ column: "weight", op: "=", value: 1 }] },
          { returning: "*" }
        )
      );
      expect(
        rows.map(r => `${r.postId}/${r.tagId}/${r.weight}`).sort()
      ).toEqual(["p1/t1/2", "p2/t2/2"]);
    });

    it("reads back more rows than one statement may name", async () => {
      // SQLite refuses an expression a thousand branches deep and caps bound
      // variables; the read-back is issued in bounded pieces.
      const values = Array.from(
        { length: 1200 },
        (_, i) => `('s-${i}', 'bulk')`
      ).join(", ");
      await adapter.executeQuery(
        `INSERT INTO ${SESSIONS} (session_token, label) VALUES ${values}`
      );
      const rows = await adapter.transaction(ctx =>
        ctx.update<{ sessionToken: string }>(
          SESSIONS,
          { label: "done" },
          { and: [{ column: "label", op: "=", value: "bulk" }] },
          { returning: ["session_token"] }
        )
      );
      expect(rows).toHaveLength(1200);
      expect(new Set(rows.map(r => r.sessionToken)).size).toBe(1200);
    });
  });

  it("runs inside the transaction: a rolled-back update leaves the row untouched", async () => {
    await expect(
      adapter.transaction(async ctx => {
        await ctx.update(TABLE, { title: "Uncommitted" }, byId("a"));
        throw new Error("roll it back");
      })
    ).rejects.toThrow("roll it back");
    expect((await stored("a"))?.title).toBe("First");
  });
});
