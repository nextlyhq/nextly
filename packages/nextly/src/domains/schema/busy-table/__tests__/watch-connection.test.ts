/**
 * Where a try's watch asks: the adapter's pool while it has a connection free, else a connection
 * of the watch's own beside it, read from the pool's state when the watch starts, not its size.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { openWatchConnection } from "../watch-connection";

/** A stand-in for node-postgres's pool: `open` connections, `idle` of them free. */
function pgAdapter(state: { max: number; open: number; idle: number }) {
  const ownConnections: string[] = [];
  class Client {
    connect() {
      ownConnections.push("opened");
      return Promise.resolve();
    }
    query() {
      return Promise.resolve({ rows: [] });
    }
    end() {
      return Promise.resolve();
    }
    on() {
      return this;
    }
  }
  const pool = {
    options: { max: state.max },
    totalCount: state.open,
    idleCount: state.idle,
    Client,
  };
  const adapter = {
    getDrizzle: () => ({ $client: pool }),
    queryStatement: () => Promise.resolve([]),
  } as unknown as DrizzleAdapter;
  return { adapter, ownConnections };
}

/** A stand-in for mysql2's promise pool around its core pool. */
function mysqlAdapter(state: { limit: number; open: number; free: number }) {
  let sessions = 0;
  const core = {
    config: { connectionLimit: state.limit },
    _allConnections: { length: state.open },
    _freeConnections: { length: state.free },
  };
  const adapter = {
    getDrizzle: () => ({ $client: { pool: core } }),
    queryStatement: () => Promise.resolve([]),
    withSession: async (work: (session: unknown) => Promise<void>) => {
      sessions += 1;
      await work({ execute: () => Promise.resolve([]) });
    },
  } as unknown as DrizzleAdapter;
  return { adapter, sessions: () => sessions };
}

describe("openWatchConnection", () => {
  it("opens a PostgreSQL connection of its own where every pooled one is busy", async () => {
    const { adapter, ownConnections } = pgAdapter({ max: 4, open: 4, idle: 0 });
    const connection = await openWatchConnection(adapter, "postgresql");
    expect(ownConnections).toEqual(["opened"]);
    await connection.close();
  });

  it("asks through the PostgreSQL pool while it has an idle connection", async () => {
    const { adapter, ownConnections } = pgAdapter({ max: 4, open: 4, idle: 1 });
    await openWatchConnection(adapter, "postgresql");
    expect(ownConnections).toEqual([]);
  });

  it("asks through the PostgreSQL pool while it has room to open one", async () => {
    const { adapter, ownConnections } = pgAdapter({ max: 4, open: 2, idle: 0 });
    await openWatchConnection(adapter, "postgresql");
    expect(ownConnections).toEqual([]);
  });

  it("opens a MySQL session of its own where every pooled connection is busy", async () => {
    const { adapter, sessions } = mysqlAdapter({ limit: 3, open: 3, free: 0 });
    const connection = await openWatchConnection(adapter, "mysql");
    expect(sessions()).toBe(1);
    await connection.close();
  });

  it("asks through the MySQL pool while it has a free connection", async () => {
    const { adapter, sessions } = mysqlAdapter({ limit: 3, open: 3, free: 1 });
    await openWatchConnection(adapter, "mysql");
    expect(sessions()).toBe(0);
  });
});
