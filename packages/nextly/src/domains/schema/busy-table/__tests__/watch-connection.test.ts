/**
 * Where a try's watch asks: the adapter's pool while it has a connection free, else a connection
 * of the watch's own beside it, read from the pool's state when the watch starts, not its size.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { openWatchConnection } from "../watch-connection";

/** A stand-in for node-postgres's pool: `open` connections, `idle` of them free. */
function pgAdapter(state: { max: number; open: number; idle: number }) {
  const ownConnections: string[] = [];
  // What the watch's own connection was asked, and the error it can be made to report.
  const own = { queries: 0, ends: 0, fail: () => undefined as void };
  const asked = { pool: 0 };
  class Client {
    connect() {
      ownConnections.push("opened");
      return Promise.resolve();
    }
    query() {
      own.queries += 1;
      return Promise.resolve({ rows: [] });
    }
    end() {
      own.ends += 1;
      return Promise.resolve();
    }
    on(_event: string, listener: (error: unknown) => void) {
      own.fail = () => listener(new Error("the connection dropped"));
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
    queryStatement: () => {
      asked.pool += 1;
      return Promise.resolve([]);
    },
  } as unknown as DrizzleAdapter;
  return { adapter, ownConnections, own, asked };
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
  // Its own PostgreSQL connection, once it reports an error, answers nothing more: the watch asks
  // through the pool from then on.
  it("asks through the PostgreSQL pool once its own connection has dropped", async () => {
    const { adapter, own, asked } = pgAdapter({ max: 1, open: 1, idle: 0 });
    const connection = await openWatchConnection(adapter, "postgresql");
    await connection.query(sql`SELECT 1`);
    expect({ own: own.queries, pool: asked.pool }).toEqual({ own: 1, pool: 0 });

    own.fail();
    await connection.query(sql`SELECT 1`);
    expect({ own: own.queries, pool: asked.pool }).toEqual({ own: 1, pool: 1 });
  });

  it("closes its own PostgreSQL connection once, however often it is closed", async () => {
    const { adapter, own } = pgAdapter({ max: 1, open: 1, idle: 0 });
    const connection = await openWatchConnection(adapter, "postgresql");
    await connection.close();
    await connection.close();
    expect(own.ends).toBe(1);
  });

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
