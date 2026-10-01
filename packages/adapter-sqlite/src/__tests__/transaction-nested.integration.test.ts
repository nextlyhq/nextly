// A transaction() call made from INSIDE a transaction's work joins it as a
// savepoint. Queued behind the transaction that was waiting for it, it hung
// both — and every later transaction on the instance.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_txsqlite_nested";

describe("SQLite nested transaction()", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.executeQuery(`CREATE TABLE ${TABLE} (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  const insert = (id: string) =>
    adapter.executeQuery(`INSERT INTO ${TABLE} (id) VALUES (?)`, [id]);
  const ids = async () =>
    (
      await adapter.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE} ORDER BY id`
      )
    ).map(row => row.id);

  it("completes, and commits with the outer transaction", async () => {
    await adapter.transaction(async () => {
      await insert("outer");
      await adapter.transaction(async () => {
        await insert("inner");
      });
    });
    expect(await ids()).toEqual(["inner", "outer"]);
  });

  it("rolls back with the outer transaction", async () => {
    await expect(
      adapter.transaction(async () => {
        await adapter.transaction(async () => {
          await insert("inner");
        });
        throw new Error("outer failed");
      })
    ).rejects.toThrow("outer failed");
    expect(await ids()).toEqual([]);
  });

  it("undoes only its own part when it fails", async () => {
    await adapter.transaction(async () => {
      await insert("outer");
      await adapter
        .transaction(async () => {
          await insert("inner");
          throw new Error("inner failed");
        })
        .catch(() => undefined);
    });
    expect(await ids()).toEqual(["outer"]);
  });

  it("serializes sibling nested calls fanned out at once", async () => {
    await adapter.transaction(async () => {
      await Promise.all(
        ["a", "b", "c"].map(id =>
          adapter.transaction(async () => {
            await insert(id);
          })
        )
      );
    });
    expect(await ids()).toEqual(["a", "b", "c"]);
  });

  it("leaves a later, unrelated transaction its own", async () => {
    // The control: after the outer one ends, calls queue as before.
    await adapter.transaction(async () => {
      await insert("first");
    });
    await adapter.transaction(async () => {
      await insert("second");
    });
    expect(await ids()).toEqual(["first", "second"]);
  });
});
