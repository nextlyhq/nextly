// A JSON column written through a transaction's own methods stores the
// document, as the pooled methods do. A transaction's `insert` builds its
// statement itself and hands each value to node-postgres, which serializes an
// object as JSON but spells an array as a PostgreSQL array literal, which is
// not JSON — so a document has to be serialized before it reaches the driver,
// the way the column's own encoder serializes it on the pooled path.
//
// Every method a transaction offers for a write is covered, with an object and
// an array, and each row is read back twice: through the model, as a caller
// reads it, and raw, so a value the model would decode differently from what
// the table holds still fails.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;
const TABLE = "int_txpg_json_writes";

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "doc", type: "jsonb" },
  ],
};

const docs = pgTable(TABLE, {
  id: text("id").primaryKey(),
  doc: jsonb("doc"),
});

const OBJECT = { a: 1, nested: { b: [true, null, "c"] } };
const ARRAY = [1, "two", { three: 3 }, [4]];

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

describe.skipIf(!TEST_DB_URL)(
  "PostgreSQL transaction writes store JSON as JSON",
  () => {
    let adapter: ReturnType<typeof createPostgresAdapter>;

    /** The stored document, read through the model and raw; the two must agree. */
    const stored = async (id: string): Promise<unknown> => {
      const [modelled] = await adapter.select<{ doc: unknown }>(TABLE, {
        where: byId(id),
      });
      const [raw] = await adapter.executeQuery<{ doc: unknown }>(
        `SELECT doc FROM ${TABLE} WHERE id = $1`,
        [id]
      );
      expect(raw?.doc).toEqual(modelled?.doc);
      return modelled?.doc;
    };

    beforeAll(async () => {
      adapter = createPostgresAdapter({ url: TEST_DB_URL as string });
      await adapter.connect();
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.createTable(TABLE_DEFINITION);
      adapter.setTableResolver({
        getTable: (name: string) => (name === TABLE ? docs : null),
      });
    });

    beforeEach(async () => {
      await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    });

    afterAll(async () => {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await adapter.disconnect();
    });

    it("insert stores an object and an array", async () => {
      await adapter.transaction(async ctx => {
        await ctx.insert(TABLE, { id: "object", doc: OBJECT });
        await ctx.insert(TABLE, { id: "array", doc: ARRAY }, { returning: [] });
      });
      expect(await stored("object")).toEqual(OBJECT);
      expect(await stored("array")).toEqual(ARRAY);
    });

    it("insert stores a document that arrives serialized once, as the pooled insert does", async () => {
      await adapter.transaction(async ctx => {
        await ctx.insert(TABLE, { id: "object", doc: JSON.stringify(OBJECT) });
      });
      expect(await stored("object")).toEqual(OBJECT);
    });

    it("insertMany stores an object and an array", async () => {
      await adapter.transaction(async ctx => {
        await ctx.insertMany(TABLE, [
          { id: "object", doc: OBJECT },
          { id: "array", doc: ARRAY },
        ]);
      });
      expect(await stored("object")).toEqual(OBJECT);
      expect(await stored("array")).toEqual(ARRAY);
    });

    it("update stores an object and an array", async () => {
      await adapter.insert(TABLE, { id: "row", doc: null });
      await adapter.transaction(async ctx => {
        await ctx.update(TABLE, { doc: OBJECT }, byId("row"));
      });
      expect(await stored("row")).toEqual(OBJECT);
      await adapter.transaction(async ctx => {
        await ctx.update(TABLE, { doc: ARRAY }, byId("row"));
      });
      expect(await stored("row")).toEqual(ARRAY);
    });

    it("upsert stores an object and an array, inserting and then updating", async () => {
      await adapter.transaction(async ctx => {
        await ctx.upsert(
          TABLE,
          { id: "row", doc: OBJECT },
          { conflictColumns: ["id"] }
        );
      });
      expect(await stored("row")).toEqual(OBJECT);
      await adapter.transaction(async ctx => {
        await ctx.upsert(
          TABLE,
          { id: "row", doc: ARRAY },
          { conflictColumns: ["id"] }
        );
      });
      expect(await stored("row")).toEqual(ARRAY);
    });
  }
);
