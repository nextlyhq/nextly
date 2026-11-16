// An insert names a table the running instance holds no model for — one a
// newer deploy added after this process started — and is refused before any
// statement runs, as every other CRUD call already is. A transaction's insert
// and the multi-row `insertMany` used to build their own SQL and so wrote the
// row regardless.
//
// Both tables exist physically; only the resolver tells them apart. Rows are
// counted with raw SQL, since the model cannot be asked about the table it
// does not hold. Refusing before the statement matters most here: a statement
// PostgreSQL rejects aborts the whole transaction.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import type { TableDefinition } from "@nextlyhq/adapter-drizzle/types";
import { TABLE_NOT_REGISTERED_CODE } from "@nextlyhq/adapter-drizzle/types";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

const KNOWN = "int_pg_insert_known";
const UNKNOWN = "int_pg_insert_unknown";

const definition = (name: string): TableDefinition => ({
  name,
  columns: [
    { name: "id", type: "text", primaryKey: true },
    { name: "title", type: "text" },
  ],
});

const known = pgTable(KNOWN, {
  id: text("id").primaryKey(),
  title: text("title"),
});

type Adapter = ReturnType<typeof createPostgresAdapter>;

/** Every insert road, each writing into `table`. */
const ROADS: Array<
  [string, (adapter: Adapter, table: string) => Promise<unknown>]
> = [
  [
    "transaction insert",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insert(table, { id: "a", title: "A" }, { returning: ["id"] })
      ),
  ],
  [
    "transaction insert without RETURNING",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insert(table, { id: "a", title: "A" }, { returning: [] })
      ),
  ],
  [
    "transaction insertMany of one row",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insertMany(table, [{ id: "a", title: "A" }], { returning: "*" })
      ),
  ],
  [
    "transaction insertMany of two rows",
    (adapter, table) =>
      adapter.transaction(tx =>
        tx.insertMany(
          table,
          [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
          ],
          { returning: "*" }
        )
      ),
  ],
  [
    "pooled insertMany of two rows",
    (adapter, table) =>
      adapter.insertMany(
        table,
        [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        { returning: "*" }
      ),
  ],
  [
    "pooled insert",
    (adapter, table) =>
      adapter.insert(table, { id: "a", title: "A" }, { returning: ["id"] }),
  ],
];

describe.skipIf(!TEST_DB_URL)(
  "PostgreSQL insert into a table the resolver does not hold",
  () => {
    let adapter: Adapter;

    const count = async (table: string): Promise<number> => {
      const rows = await adapter.executeQuery<{ n: string }>(
        `SELECT COUNT(*) AS n FROM ${table}`
      );
      return Number(rows[0]?.n);
    };

    beforeAll(async () => {
      adapter = createPostgresAdapter({ url: TEST_DB_URL as string });
      await adapter.connect();
      for (const table of [KNOWN, UNKNOWN]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
        await adapter.createTable(definition(table));
      }
      adapter.setTableResolver({
        getTable: (name: string) => (name === KNOWN ? known : null),
      });
    });

    beforeEach(async () => {
      await adapter.executeQuery(`DELETE FROM ${KNOWN}`);
      await adapter.executeQuery(`DELETE FROM ${UNKNOWN}`);
    });

    afterAll(async () => {
      for (const table of [KNOWN, UNKNOWN]) {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
      await adapter.disconnect();
    });

    it.each(ROADS)(
      "%s is refused, naming the table, and writes nothing",
      async (_road, insert) => {
        const refusal = await insert(adapter, UNKNOWN).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refusal).toMatchObject({ code: TABLE_NOT_REGISTERED_CODE });
        expect((refusal as Error).message).toContain(`"${UNKNOWN}"`);
        expect(await count(UNKNOWN)).toBe(0);
      }
    );

    it.each(ROADS)(
      "%s still writes a table the resolver holds",
      async (_road, insert) => {
        await insert(adapter, KNOWN);
        expect(await count(KNOWN)).toBeGreaterThan(0);
      }
    );

    it("refuses before any statement, so the transaction is not aborted and commits", async () => {
      await adapter.transaction(async tx => {
        const refusal = await tx.insert(UNKNOWN, { id: "a", title: "A" }).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(refusal).toMatchObject({ code: TABLE_NOT_REGISTERED_CODE });
        await tx.insert(KNOWN, { id: "b", title: "B" }, { returning: [] });
      });
      expect(await count(KNOWN)).toBe(1);
      expect(await count(UNKNOWN)).toBe(0);
    });
  }
);
