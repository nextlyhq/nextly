/**
 * Where a service's reads go inside and outside a read routed to a
 * transaction, against stand-ins that name the connection each handle is on.
 *
 * The property separating a correct routing from a plausible broken one is
 * WHICH handle a read is given: a routing that only swapped `this.db` would
 * leave `this.adapter.select` on the pool, and one that never checked the
 * transaction was still open would hand a finished transaction to an effect
 * that runs after the commit. Each case names the handle it expects, and the
 * pool's is the control.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { BaseService } from "../../base-service";
import { consoleLogger } from "../../types";
import {
  adapterForReads,
  connectionOf,
  lockedForRead,
  pooledAdapterOf,
  readLocksRows,
  readsOnTransaction,
  runReadsInTransaction,
} from "../read-transaction-scope";

type Dialect = "postgresql" | "mysql" | "sqlite";

// A service's `db` reads its dialect's loaded relations; the stand-ins answer
// as these dialects, and the unit setup loads only the run's own.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql"].map(dialect => loadDialectTables(dialect))
  );
});

const POOL = { on: "pool" };
const TX = { on: "transaction" };
const TX_WITH_RELATIONS = { on: "transaction", relations: true };

/** An adapter whose handles say where they run, and whether a transaction is open. */
function standInAdapter(dialect: Dialect, open = true) {
  const select = vi.fn(
    (_table: string, _options?: unknown, executor?: unknown) =>
      Promise.resolve([{ executor: executor ?? POOL }])
  );
  const adapter = {
    getCapabilities: () => ({ dialect }),
    transactionOpenInFlow: () => open,
    getDrizzle: () => POOL,
    select,
    executeQuery: vi.fn(() => Promise.resolve([{ on: "pool" }])),
  };
  return { adapter: adapter as unknown as DrizzleAdapter, select };
}

function standInTransaction(): TransactionContext {
  return {
    getDrizzle: () => TX,
    drizzleWithRelations: () => TX_WITH_RELATIONS,
    execute: () => Promise.resolve([{ on: "transaction" }]),
  } as unknown as TransactionContext;
}

/** A service, to read what `BaseService` hands its own code. */
class Reader extends BaseService {
  handle(): unknown {
    return this.db;
  }
  selectRows(): Promise<unknown[]> {
    return this.adapter.select("posts", {});
  }
  raw(): Promise<unknown[]> {
    return this.adapter.executeQuery("SELECT 1");
  }
}

describe("a read routed to a transaction", () => {
  it("reads on the pool outside the scope", async () => {
    const { adapter } = standInAdapter("postgresql");
    const reader = new Reader(adapter, consoleLogger);

    expect(adapterForReads(adapter)).toBe(adapter);
    expect(reader.handle()).toBe(POOL);
    expect(await reader.selectRows()).toEqual([{ executor: POOL }]);
  });

  it("gives a service's db, its selects and its raw reads the transaction's connection", async () => {
    const { adapter } = standInAdapter("postgresql");
    const reader = new Reader(adapter, consoleLogger);

    await runReadsInTransaction(standInTransaction(), async () => {
      expect(reader.handle()).toBe(TX_WITH_RELATIONS);
      expect(await reader.selectRows()).toEqual([{ executor: TX }]);
      expect(await reader.raw()).toEqual([{ on: "transaction" }]);
      // Everything else is the adapter's own.
      expect(adapterForReads(adapter).getCapabilities().dialect).toBe(
        "postgresql"
      );
    });
  });

  it("keeps an executor the caller named", async () => {
    const { adapter } = standInAdapter("mysql");
    const named = { on: "named" };

    await runReadsInTransaction(standInTransaction(), async () => {
      expect(await adapterForReads(adapter).select("posts", {}, named)).toEqual(
        [{ executor: named }]
      );
    });
  });

  it("reads on the pool through a view kept past its scope, and a service built from one keeps the adapter", async () => {
    const { adapter } = standInAdapter("postgresql");
    let kept: DrizzleAdapter | undefined;
    await runReadsInTransaction(standInTransaction(), async () => {
      kept = adapterForReads(adapter);
      // The control: inside the scope the view reads on the transaction.
      expect(kept.getDrizzle()).toBe(TX);
    });
    if (!kept) throw new Error("the scope's work did not run");
    const view = kept;

    expect(view).not.toBe(adapter);
    expect(view.getDrizzle()).toBe(POOL);
    expect(await view.select("posts", {})).toEqual([{ executor: POOL }]);
    // A service built from the view holds the adapter itself.
    expect(pooledAdapterOf(view)).toBe(adapter);
    expect(new Reader(view, consoleLogger).handle()).toBe(POOL);
  });

  it("reads on the pool from work that outlives the scope, even with another transaction open in its flow", async () => {
    // Open in the flow throughout, as for an effect that runs after the
    // scope's transaction commits and opens one of its own.
    const { adapter } = standInAdapter("postgresql", true);
    let release = (): void => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let seen: unknown;
    let after: Promise<void> = Promise.resolve();
    await runReadsInTransaction(standInTransaction(), async () => {
      // The control: inside the scope a service reads on the transaction.
      expect(new Reader(adapter, consoleLogger).handle()).toBe(
        TX_WITH_RELATIONS
      );
      after = gate.then(() => {
        seen = new Reader(adapter, consoleLogger).handle();
      });
    });
    release();
    await after;
    expect(seen).toBe(POOL);
  });

  it("keys a view as the connection behind it, and says it reads on a transaction", async () => {
    const { adapter } = standInAdapter("postgresql");
    await runReadsInTransaction(standInTransaction(), async () => {
      const view = adapterForReads(adapter);
      expect(connectionOf(view)).toBe(adapter);
      expect(readsOnTransaction(view)).toBe(true);
    });
    expect(connectionOf(adapter)).toBe(adapter);
    expect(readsOnTransaction(adapter)).toBe(false);
  });

  it("reads on the pool once the transaction is no longer open in the flow", async () => {
    const { adapter } = standInAdapter("postgresql", false);
    const reader = new Reader(adapter, consoleLogger);

    await runReadsInTransaction(standInTransaction(), async () => {
      expect(adapterForReads(adapter)).toBe(adapter);
      expect(reader.handle()).toBe(POOL);
      expect(readLocksRows(adapter)).toBe(false);
    });
  });
});

describe("the shared lock a routed read takes", () => {
  /** A select builder that records the locking clause it was given. */
  function lockable() {
    const calls: unknown[][] = [];
    const query = {
      for: (...args: unknown[]) => {
        calls.push(args);
        return query;
      },
    };
    return { query, calls };
  }
  const table = { name: "dc_posts" };

  it("names the main table on PostgreSQL", async () => {
    const { adapter } = standInAdapter("postgresql");
    const { query, calls } = lockable();
    await runReadsInTransaction(standInTransaction(), async () => {
      lockedForRead(query, adapter, table);
    });
    expect(calls).toEqual([["share", { of: table }]]);
  });

  it("takes the lock for update when the scope asks for it, on both dialects", async () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const { adapter } = standInAdapter(dialect);
      const { query, calls } = lockable();
      await runReadsInTransaction(
        standInTransaction(),
        async () => {
          lockedForRead(query, adapter, table);
        },
        "update"
      );
      expect(calls).toEqual([
        dialect === "postgresql" ? ["update", { of: table }] : ["update"],
      ]);
    }
  });

  it("takes no lock when the scope asks for none, and still reads on the transaction, on both dialects", async () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const { adapter } = standInAdapter(dialect);
      const reader = new Reader(adapter, consoleLogger);
      const { query, calls } = lockable();
      await runReadsInTransaction(
        standInTransaction(),
        async () => {
          // The query unchanged, as a read outside the scope is.
          expect(lockedForRead(query, adapter, table)).toBe(query);
          // The Singles read's choice between `forShare` and a plain read.
          expect(readLocksRows(adapter)).toBe(false);
          // A plain read, not a pooled one: still on the transaction's
          // connection, so it sees what the transaction wrote.
          expect(reader.handle()).toBe(TX_WITH_RELATIONS);
          expect(await reader.selectRows()).toEqual([{ executor: TX }]);
        },
        "none"
      );
      expect(calls).toEqual([]);
    }
  });

  it("takes the shared lock by default and when asked for it by name, the control for none", async () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const { adapter } = standInAdapter(dialect);
      const { query, calls } = lockable();
      await runReadsInTransaction(standInTransaction(), async () => {
        expect(readLocksRows(adapter)).toBe(true);
        lockedForRead(query, adapter, table);
      });
      await runReadsInTransaction(
        standInTransaction(),
        async () => {
          expect(readLocksRows(adapter)).toBe(true);
          lockedForRead(query, adapter, table);
        },
        "share"
      );
      const share =
        dialect === "postgresql" ? ["share", { of: table }] : ["share"];
      expect(calls).toEqual([share, share]);
    }
  });

  it("takes MySQL's clause, which names no table", async () => {
    const { adapter } = standInAdapter("mysql");
    const { query, calls } = lockable();
    await runReadsInTransaction(standInTransaction(), async () => {
      lockedForRead(query, adapter, table);
    });
    expect(calls).toEqual([["share"]]);
  });

  it("takes none on SQLite, nor outside the scope", async () => {
    const sqlite = standInAdapter("sqlite").adapter;
    const postgres = standInAdapter("postgresql").adapter;
    const { query, calls } = lockable();
    await runReadsInTransaction(standInTransaction(), async () => {
      expect(lockedForRead(query, sqlite, table)).toBe(query);
    });
    expect(lockedForRead(query, postgres, table)).toBe(query);
    expect(calls).toEqual([]);
  });
});
