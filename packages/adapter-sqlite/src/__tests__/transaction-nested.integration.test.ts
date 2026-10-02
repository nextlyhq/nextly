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

  // Work a failing transaction started and did not wait for still belongs to
  // it: the rollback has to discard it, not let it run after on whatever
  // encloses the transaction — or on no transaction at all. The queued work
  // pauses before it writes, as real work does: the driver's insert is
  // synchronous, and one made at once would land before the rollback anyway.
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const pause = () => new Promise(resolve => setTimeout(resolve, 5));

  it("discards a deeper call left running when a savepoint fails", async () => {
    await adapter.transaction(async () => {
      await insert("outer");
      await adapter
        .transaction(async () => {
          void adapter
            .transaction(async () => {
              await pause();
              await insert("deeper");
            })
            .catch(() => undefined);
          throw new Error("inner failed");
        })
        .catch(() => undefined);
    });
    await settle();
    expect(await ids()).toEqual(["outer"]);
  });

  it("discards a nested call left running when the transaction fails", async () => {
    await expect(
      adapter.transaction(async () => {
        void adapter
          .transaction(async () => {
            await pause();
            await insert("orphan");
          })
          .catch(() => undefined);
        throw new Error("outer failed");
      })
    ).rejects.toThrow("outer failed");
    await settle();
    expect(await ids()).toEqual([]);
  });

  // Sibling savepoints share one connection, so they form a stack and must
  // run one after another: interleaved, the failing one's rollback would undo
  // the other's write and keep its own.
  it("undoes only the failing one of sibling calls fanned out at once", async () => {
    await adapter.transaction(async () => {
      await Promise.allSettled([
        adapter.transaction(async () => {
          await insert("a");
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error("a failed");
        }),
        adapter.transaction(async () => {
          await insert("b");
          await new Promise(resolve => setTimeout(resolve, 20));
        }),
      ]);
    });
    expect(await ids()).toEqual(["b"]);
  });

  // A call made later from inside a savepoint that has since released joins
  // the innermost scope still open. Queued on the instance instead, it waits
  // behind that transaction: awaited there, neither settles and every later
  // transaction hangs; not awaited, it commits on its own after a rollback.
  // Queued on the nearest open ancestor, it waits behind a later sibling
  // savepoint that may be the one awaiting it. Each of these tests gets its
  // own adapter, so a hang cannot reach the other tests.
  const deadline = <T>(promise: Promise<T>) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), 1000)
      ),
    ]);

  it("joins the open transaction from a savepoint that has released", async () => {
    const own = createSqliteAdapter({ memory: true });
    await own.connect();
    try {
      await own.executeQuery(`CREATE TABLE ${TABLE} (id text PRIMARY KEY)`);
      let later: Promise<unknown> | undefined;
      await deadline(
        own.transaction(async () => {
          await own.transaction(async () => {
            later = (async () => {
              await pause();
              return own.transaction(async () => {
                await own.executeQuery(`INSERT INTO ${TABLE} (id) VALUES (?)`, [
                  "late",
                ]);
              });
            })();
          });
          await later;
        })
      );
      await deadline(own.transaction(async () => undefined));
      const rows = await own.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE}`
      );
      expect(rows.map(row => row.id)).toEqual(["late"]);
    } finally {
      await own.disconnect();
    }
  });

  it("runs a call from a released savepoint inside the later sibling awaiting it", async () => {
    const own = createSqliteAdapter({ memory: true });
    await own.connect();
    try {
      await own.executeQuery(`CREATE TABLE ${TABLE} (id text PRIMARY KEY)`);
      let later: Promise<unknown> | undefined;
      await deadline(
        own.transaction(async () => {
          await own.transaction(async () => {
            later = (async () => {
              await pause();
              return own.transaction(async () => {
                await own.executeQuery(`INSERT INTO ${TABLE} (id) VALUES (?)`, [
                  "late",
                ]);
              });
            })();
          });
          await own.transaction(async () => {
            await later;
          });
        })
      );
      await deadline(own.transaction(async () => undefined));
      const rows = await own.executeQuery<{ id: string }>(
        `SELECT id FROM ${TABLE}`
      );
      expect(rows.map(row => row.id)).toEqual(["late"]);
    } finally {
      await own.disconnect();
    }
  });

  it("rolls back a later call from a released savepoint with the transaction", async () => {
    await expect(
      adapter.transaction(async () => {
        await adapter.transaction(async () => {
          void (async () => {
            await pause();
            await adapter.transaction(async () => {
              await insert("late");
            });
          })().catch(() => undefined);
        });
        await settle();
        throw new Error("outer failed");
      })
    ).rejects.toThrow("outer failed");
    await settle();
    expect(await ids()).toEqual([]);
  });

  it("reports whether a call made here would join an open transaction", async () => {
    const seen: boolean[] = [];
    seen.push(adapter.inTransaction());
    await adapter.transaction(async () => {
      seen.push(adapter.inTransaction());
      await adapter.transaction(async () => {
        seen.push(adapter.inTransaction());
      });
    });
    seen.push(adapter.inTransaction());
    expect(seen).toEqual([false, true, true, false]);
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
