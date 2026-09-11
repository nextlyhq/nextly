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
//
// Self-skips when TEST_POSTGRES_URL is unset.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;
const TABLE = "int_txpg_update_table";

// The physical table, through the production DDL helper. `title` and
// `published_at` exist here and not on the model below.
const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "slug", type: "text", nullable: false },
    { name: "title", type: "text" },
    { name: "meta", type: "jsonb" },
    // Without a time zone, which is what every generated timestamp column is.
    { name: "published_at", type: "timestamp" },
    { name: "updated_at", type: "timestamp" },
    { name: "published", type: "boolean" },
  ],
};

// The runtime model: `title` and `published_at` are deliberately absent.
const pages = pgTable(TABLE, {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  meta: jsonb("meta"),
  updatedAt: timestamp("updated_at"),
  published: boolean("published"),
});

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

/**
 * The two timestamps come back as text spelled by the database. node-postgres
 * turns a `timestamp` into a `Date` in the runner's LOCAL zone, so a `Date`
 * read here would move with the machine; the wall clock as text does not.
 */
interface StoredRow {
  id: string;
  slug: string;
  title: string | null;
  meta: unknown;
  published_at: string | null;
  updated_at: string | null;
  published: boolean | null;
}

const WALL_CLOCK = "2026-09-11T10:00:00";
const AT = new Date(`${WALL_CLOCK}.000Z`);

describe.skipIf(!TEST_DB_URL)(
  "PostgreSQL transaction update writes the physical table",
  () => {
    let adapter: ReturnType<typeof createPostgresAdapter>;
    let previousTz: string | undefined;

    const stored = async (id: string): Promise<StoredRow | undefined> => {
      const rows = await adapter.executeQuery<StoredRow>(
        `SELECT id, slug, title, meta, to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS published_at, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at, published FROM ${TABLE} WHERE id = $1`,
        [id]
      );
      return rows[0];
    };

    beforeAll(async () => {
      // A zone with an offset, so a value the driver read as local time
      // would come back shifted and the wall-clock assertions could fail.
      previousTz = process.env.TZ;
      process.env.TZ = "Asia/Karachi";
      adapter = createPostgresAdapter({ url: TEST_DB_URL as string });
      await adapter.connect();
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.createTable(TABLE_DEFINITION);
      adapter.setTableResolver({
        getTable: (name: string) => (name === TABLE ? pages : null),
      });
    });

    beforeEach(async () => {
      await adapter.executeQuery(`DELETE FROM ${TABLE}`);
      await adapter.executeQuery(
        `INSERT INTO ${TABLE} (id, slug, title, published) VALUES ('a', 'first', 'First', false)`
      );
    });

    afterAll(async () => {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.disconnect();
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    });

    it("writes a column the model does not declare; the pooled builder update drops it", async () => {
      // The control first, and it must come out DIFFERENT: the same write
      // through the query builder stores the declared column and leaves the
      // undeclared one as it was, without a word — the silence this path
      // exists to replace. A declared column rides along in both writes
      // because that is the shape of every entry update (`updated_at` is
      // always in it).
      await adapter.update(
        TABLE,
        { slug: "pooled", title: "Dropped" },
        byId("a")
      );
      expect(await stored("a")).toMatchObject({
        slug: "pooled",
        title: "First",
      });

      await adapter.transaction(async ctx => {
        await ctx.update(TABLE, { slug: "tx", title: "Written" }, byId("a"));
      });
      expect(await stored("a")).toMatchObject({
        slug: "tx",
        title: "Written",
      });
    });

    it("binds a declared date, JSON document and boolean as the query builder would, and an undeclared date as the insert does", async () => {
      const document = { a: 1, b: [true, null] };
      await adapter.transaction(async ctx => {
        await ctx.update(
          TABLE,
          {
            updated_at: AT,
            meta: JSON.stringify(document),
            published: true,
            published_at: AT,
          },
          byId("a")
        );
      });
      const row = await stored("a");
      // The declared column stores the UTC wall clock its encoder wrote.
      expect(row?.updated_at).toBe(WALL_CLOCK);
      // Encoded once: a serialized document is stored as the document, not as
      // a JSON string containing one.
      expect(row?.meta).toEqual(document);
      expect(row?.published).toBe(true);
      // The undeclared column is bound as the transactional insert binds a
      // column the model does not know: natively, by the driver. On a UTC
      // runner that is the same wall clock; the adapter cannot encode a
      // column it cannot see, and this pins that it stores SOMETHING for it
      // rather than which zone the driver chose.
      expect(row?.published_at).not.toBeNull();
    });

    it("leaves a column alone for undefined and clears it for null", async () => {
      await adapter.transaction(async ctx => {
        await ctx.update(
          TABLE,
          { slug: "second", title: undefined },
          byId("a")
        );
      });
      expect(await stored("a")).toMatchObject({
        slug: "second",
        title: "First",
      });

      await adapter.transaction(async ctx => {
        await ctx.update(TABLE, { title: null }, byId("a"));
      });
      expect((await stored("a"))?.title).toBeNull();
    });

    it("refuses a column the table does not have, naming the operation and the table", async () => {
      await expect(
        adapter.transaction(async ctx => {
          await ctx.update(TABLE, { slug: "x", ghost: "x" }, byId("a"));
        })
      ).rejects.toMatchObject({
        message: expect.stringMatching(/update operation failed.*ghost/s),
        table: TABLE,
      });
      // The refused statement wrote nothing else either.
      expect((await stored("a"))?.slug).toBe("first");
    });

    it("returns the requested columns decoded, and nothing when nothing was requested", async () => {
      const [none, requested, everything] = await adapter.transaction(
        async ctx => [
          await ctx.update(TABLE, { slug: "n" }, byId("a")),
          await ctx.update<{ id: string }>(TABLE, { slug: "r" }, byId("a"), {
            returning: ["id"],
          }),
          await ctx.update<{ id: string; updatedAt: Date; title: string }>(
            TABLE,
            { updated_at: AT, title: "T" },
            byId("a"),
            { returning: "*" }
          ),
        ]
      );
      expect(none).toEqual([]);
      expect(requested).toEqual([{ id: "a" }]);
      // Decoded the way a read of the same row decodes it: the model's
      // property names, and the instant that was bound rather than the
      // driver's local reading of the wall clock.
      expect(everything).toHaveLength(1);
      expect(everything[0].id).toBe("a");
      expect(everything[0].updatedAt).toBeInstanceOf(Date);
      expect(everything[0].updatedAt.getTime()).toBe(AT.getTime());
      expect(everything[0].title).toBe("T");
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
  }
);
