// `withSession` runs statements outside any transaction. Called from inside a transaction's work,
// SQLite's one connection would put them in that transaction and undo them with it, while
// PostgreSQL and MySQL would commit them on a connection of their own; it is refused on every
// dialect instead, before any statement runs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_sqlite_session";

describe("SQLite withSession", () => {
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

  const ids = async () =>
    (
      await adapter.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE} ORDER BY id`
      )
    ).map(row => row.id);

  it("runs its statements, each committing as it runs", async () => {
    await expect(
      adapter.withSession(async session => {
        await session.execute(`INSERT INTO ${TABLE} (id) VALUES ('kept')`);
        await session.execute(
          `INSERT INTO int_sqlite_missing (id) VALUES ('x')`
        );
      })
    ).rejects.toThrow();
    expect(await ids()).toEqual(["kept"]);
  });

  it("waits for another flow's open transaction, so its statements are not undone with it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let began: () => void = () => {};
    const open = new Promise<void>(resolve => {
      began = resolve;
    });
    // Another flow's transaction, open and about to roll back.
    const other = adapter.transaction(async tx => {
      await tx.execute(`INSERT INTO ${TABLE} (id) VALUES ('rolled-back')`);
      began();
      await gate;
      throw new Error("rolled back");
    });
    await open;
    const session = adapter.withSession(async s => {
      await s.execute(`INSERT INTO ${TABLE} (id) VALUES ('session')`);
    });
    release();
    await expect(other).rejects.toThrow("rolled back");
    await session;
    expect(await ids()).toEqual(["session"]);
  });

  it("is refused inside an open transaction, running nothing", async () => {
    await expect(
      adapter.transaction(async () => {
        await adapter.withSession(async session => {
          await session.execute(`INSERT INTO ${TABLE} (id) VALUES ('inner')`);
        });
      })
    ).rejects.toMatchObject({ code: "NEXTLY_SESSION_INSIDE_TRANSACTION" });
    expect(await ids()).toEqual([]);
  });
});
