// A JSON column written through a transaction's own methods stores the
// document, as the pooled methods do. SQLite's transaction `insert` builds its
// statement itself and binds a structured value as JSON text; this pins that
// it keeps doing so, alike with the other two dialects, for every method a
// transaction offers for a write, with an object and an array.
//
// Each row is read back twice: through the model, as a caller reads it, and
// raw, so a value the model would decode differently from what the table holds
// still fails.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_txsqlite_json_writes";

const TABLE_DEFINITION: TableDefinition = {
  name: TABLE,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "doc", type: "text" },
  ],
};

const docs = sqliteTable(TABLE, {
  id: text("id").primaryKey(),
  doc: text("doc", { mode: "json" }),
});

const OBJECT = { a: 1, nested: { b: [true, null, "c"] } };
const ARRAY = [1, "two", { three: 3 }, [4]];

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

describe("SQLite transaction writes store JSON as JSON", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  /** The stored document, read through the model and raw; the two must agree. */
  const stored = async (id: string): Promise<unknown> => {
    const [modelled] = await adapter.select<{ doc: unknown }>(TABLE, {
      where: byId(id),
    });
    const [raw] = await adapter.executeQuery<{ doc: string | null }>(
      `SELECT doc FROM ${TABLE} WHERE id = ?`,
      [id]
    );
    expect(raw?.doc == null ? raw?.doc : JSON.parse(raw.doc)).toEqual(
      modelled?.doc
    );
    return modelled?.doc;
  };

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.createTable(TABLE_DEFINITION);
    adapter.setTableResolver({
      getTable: (name: string) => (name === TABLE ? docs : null),
    });
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  afterAll(async () => {
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
});
