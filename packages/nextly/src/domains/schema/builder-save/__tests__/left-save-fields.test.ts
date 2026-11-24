/**
 * The guard over writes and reads while a Builder save stands left part-way costs nothing where it
 * can hold nothing: in production, where Builder saves never run, and on PostgreSQL and SQLite,
 * where a save's change commits whole or not at all. There it returns before any statement, so no
 * handle to the database is even asked for, nor any use made of a transaction's. On MySQL in
 * development it reads the records standing over the entity, its own and the field groups', in one
 * statement, which the control case watches it send.
 *
 * Every road's check is one of these calls: a write before its transaction, a write inside one
 * (`tx`), the comparison a road makes before opening one, a read, and the read a relationship's
 * populated target makes (`readTargetRows`).
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runWithAccessMemo } from "../../../../auth/access/request-memo";
import { loadDialectTables } from "../../../../database/dialect-tables";
import {
  compareBeforeTransaction,
  refuseReadOverLeftSave,
  refuseWriteOverLeftSave,
} from "../left-save-fields";

/** A database handle that reads no record, counting each statement sent through it. */
function countingDb(): { db: unknown; statements: () => number } {
  let sent = 0;
  // The records' read selects from `nextly_meta` by their keys; none stands.
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          sent += 1;
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return { db, statements: () => sent };
}

/**
 * An adapter of `dialect` that counts every handle a caller asks it for, and a transaction's handle
 * that counts each use made of it, both reading no record.
 */
function countingAdapter(dialect: "mysql" | "postgresql" | "sqlite"): {
  adapter: DrizzleAdapter;
  tx: unknown;
  handles: () => number;
  statements: () => number;
  txUses: () => number;
} {
  let asked = 0;
  let used = 0;
  const own = countingDb();
  const inTx = countingDb();
  const adapter = {
    getCapabilities: () => ({ dialect }),
    inTransaction: () => false,
    getDrizzle: () => {
      asked += 1;
      return own.db;
    },
  } as unknown as DrizzleAdapter;
  const tx = new Proxy(inTx.db as object, {
    get: (target, key, receiver) => {
      used += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return {
    adapter,
    tx,
    handles: () => asked,
    statements: () => own.statements() + inTx.statements(),
    txUses: () => used,
  };
}

/** Each road's check over one collection's entries, as the services make them. */
async function everyRoad(adapter: DrizzleAdapter, tx: unknown): Promise<void> {
  const target = { adapter, kind: "collection" as const, slug: "posts" };
  await refuseWriteOverLeftSave({ ...target, data: { title: "A post" } });
  await compareBeforeTransaction(target);
  await refuseWriteOverLeftSave({ ...target, data: { title: "A post" }, tx });
  await refuseReadOverLeftSave(target);
  // A relationship to `posts`, populated on a read of another collection.
  await refuseReadOverLeftSave(target);
}

beforeAll(async () => {
  // The record's table as MySQL declares it, which the one read in development builds its query on.
  await loadDialectTables("mysql");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the left-save guard's cost", () => {
  it("sends no statement in production, on any dialect", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const dialect of ["mysql", "postgresql", "sqlite"] as const) {
      const counted = countingAdapter(dialect);
      await everyRoad(counted.adapter, counted.tx);
      expect(counted.handles(), dialect).toBe(0);
      expect(counted.txUses(), dialect).toBe(0);
    }
  });

  it("sends no statement on PostgreSQL or SQLite in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const counted = countingAdapter(dialect);
      await everyRoad(counted.adapter, counted.tx);
      expect(counted.handles(), dialect).toBe(0);
      expect(counted.txUses(), dialect).toBe(0);
    }
  });

  // The control: the same counting sees the one read each check makes where it can hold a field,
  // the check inside a transaction reading on that transaction's handle.
  it("reads the records standing over the entity once per check on MySQL in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const counted = countingAdapter("mysql");
    await everyRoad(counted.adapter, counted.tx);
    expect(counted.statements()).toBe(5);
    expect(counted.handles()).toBe(4);
    expect(counted.txUses()).toBeGreaterThan(0);
  });

  // Inside a request, a write's entry reads what stands again, and the checks after it, the one in
  // its transaction included, use what it read, over any entity. A later request reads again.
  it("reads the records standing at each write's entry and nowhere else in a request on MySQL in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const counted = countingAdapter("mysql");
    await runWithAccessMemo(async () => {
      await everyRoad(counted.adapter, counted.tx);
      await refuseReadOverLeftSave({
        adapter: counted.adapter,
        kind: "single",
        slug: "settings",
      });
    });
    // Its write, and the comparison before its transaction, each an entry; the transaction's
    // check and the reads after send none.
    expect(counted.statements()).toBe(2);
    expect(counted.txUses()).toBe(0);

    await runWithAccessMemo(() => everyRoad(counted.adapter, counted.tx));
    expect(counted.statements()).toBe(4);
  });

  it("keeps no read that failed: the next check in the request reads again", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const counted = countingAdapter("mysql");
    let failed = false;
    // The first read is sent and rejected, as a connection dropped under it.
    const dropped = {
      select: () => ({
        from: () => ({
          where: () => Promise.reject(new Error("the connection dropped")),
        }),
      }),
    };
    const adapter = {
      ...counted.adapter,
      getDrizzle: () => {
        if (failed) return counted.adapter.getDrizzle();
        failed = true;
        return dropped;
      },
    } as unknown as DrizzleAdapter;
    const read = () =>
      refuseReadOverLeftSave({ adapter, kind: "collection", slug: "posts" });

    await runWithAccessMemo(async () => {
      await expect(read()).rejects.toThrow("the connection dropped");
      await expect(read()).resolves.toBeUndefined();
    });
    expect(counted.statements()).toBe(1);
  });
});
