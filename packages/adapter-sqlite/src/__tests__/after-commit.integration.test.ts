// `afterCommit` holds an effect registered inside an open transaction until
// the outermost one commits, and drops it when the change it describes is
// rolled back: a subscriber must never hear about a write that was undone.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSqliteAdapter } from "../index";

const TABLE = "int_txsqlite_after_commit";

describe("SQLite afterCommit()", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let seen: string[];

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    await adapter.executeQuery(`CREATE TABLE ${TABLE} (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  beforeEach(async () => {
    seen = [];
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
  });

  const insert = (id: string) =>
    adapter.executeQuery(`INSERT INTO ${TABLE} (id) VALUES (?)`, [id]);
  const count = async () =>
    (await adapter.executeQuery<{ id: string }>(`SELECT id FROM ${TABLE}`))
      .length;
  // What a core service does: write in its own transaction, which nests as a
  // savepoint here, then register the effect of that write.
  const serviceWrite = async (id: string) => {
    await adapter.transaction(async () => {
      await insert(id);
    });
    await adapter.afterCommit(() => {
      seen.push(id);
    });
  };

  // The same, with more work between its write and the registration, which
  // then happens after the enclosing transaction has already ended.
  const slowServiceWrite = async (id: string) => {
    await adapter.transaction(async () => {
      await insert(id);
    });
    await new Promise(resolve => setTimeout(resolve, 5));
    await adapter.afterCommit(() => {
      seen.push(id);
    });
  };

  it("runs the effect now outside any transaction", async () => {
    await serviceWrite("alone");
    expect(seen).toEqual(["alone"]);
  });

  it("holds the effect until the outer transaction commits", async () => {
    let seenBeforeCommit: string[] = [];
    await adapter.transaction(async () => {
      await serviceWrite("a");
      await serviceWrite("b");
      seenBeforeCommit = [...seen];
    });
    expect(seenBeforeCommit).toEqual([]);
    expect(seen).toEqual(["a", "b"]);
    expect(await count()).toBe(2);
  });

  it("drops the effect when the outer transaction rolls back", async () => {
    await expect(
      adapter.transaction(async () => {
        await serviceWrite("rolled-back");
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    expect(seen).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("drops only a rolled-back savepoint's effects", async () => {
    await adapter.transaction(async () => {
      await serviceWrite("kept-before");
      await adapter
        .transaction(async () => {
          await serviceWrite("undone");
          throw new Error("savepoint failed");
        })
        .catch(() => undefined);
      await serviceWrite("kept-after");
    });
    expect(seen).toEqual(["kept-before", "kept-after"]);
    expect(await count()).toBe(2);
  });

  it("holds a nested savepoint's effect for the outermost commit", async () => {
    await adapter.transaction(async () => {
      await adapter.transaction(async () => {
        await serviceWrite("nested");
      });
    });
    expect(seen).toEqual(["nested"]);
    expect(await count()).toBe(1);
  });

  it("drops a concurrent write's effect when its transaction rolls back", async () => {
    await insert("taken");
    let second: Promise<void> | undefined;
    await expect(
      adapter.transaction(async () => {
        second = slowServiceWrite("b");
        await Promise.all([serviceWrite("taken"), second]);
      })
    ).rejects.toThrow();
    await second;
    expect(seen).toEqual([]);
    expect(await count()).toBe(1);
  });

  it("drops a concurrent write's effect when its savepoint rolls back", async () => {
    await insert("taken");
    let second: Promise<void> | undefined;
    await adapter.transaction(async () => {
      await adapter
        .transaction(async () => {
          second = slowServiceWrite("b");
          await Promise.all([serviceWrite("taken"), second]);
        })
        .catch(() => undefined);
      await serviceWrite("kept");
    });
    await second;
    expect(seen).toEqual(["kept"]);
    expect(await count()).toBe(2);
  });

  it("announces a write made after its transaction rolled back", async () => {
    let release = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let later: Promise<void> | undefined;
    await expect(
      adapter.transaction(async () => {
        later = (async () => {
          await gate;
          await serviceWrite("after");
        })();
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");
    release();
    await later;
    expect(seen).toEqual(["after"]);
    expect(await count()).toBe(1);
  });

  it("keeps a rolled-back savepoint's effect dropped after a later write from its context", async () => {
    let later: Promise<void> | undefined;
    await adapter.transaction(async () => {
      await adapter
        .transaction(async () => {
          await serviceWrite("undone");
          later = (async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            await adapter.transaction(async () => {
              await insert("later");
            });
          })();
          throw new Error("rolled back");
        })
        .catch(() => undefined);
      await later;
    });
    // The later write is real, but the effect registered before it describes
    // the write the savepoint's rollback undid.
    expect(seen).toEqual([]);
    expect(await count()).toBe(1);
  });

  it("reports a failing effect without failing the committed transaction", async () => {
    const failures: unknown[] = [];
    const result = await adapter.transaction(async () => {
      await insert("durable");
      await adapter.afterCommit(
        () => {
          throw new Error("subscriber broke");
        },
        error => failures.push(error)
      );
      await adapter.afterCommit(() => {
        seen.push("next");
      });
      return "done";
    });
    expect(result).toBe("done");
    expect(seen).toEqual(["next"]);
    expect(failures).toHaveLength(1);
    expect(await count()).toBe(1);
  });

  it("lets an effect open a transaction of its own", async () => {
    await adapter.transaction(async () => {
      await adapter.afterCommit(() => serviceWrite("from-effect"));
    });
    expect(seen).toEqual(["from-effect"]);
    expect(await count()).toBe(1);
  });
});
