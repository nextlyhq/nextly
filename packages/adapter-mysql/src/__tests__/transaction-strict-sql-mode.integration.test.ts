// A transaction opened with `strictSqlMode` runs in MySQL strict mode whatever the session's own
// mode is, and hands its connection back to the pool with that mode put back. Without strict mode
// MySQL cuts an overlong string to the column's length with only a warning; a migration runs with
// nobody there to read it.
//
// A pool of one connection makes "the session" observable: the mode set before the transaction,
// the one inside it and the one after it are all read from the same connection, which stands for a
// server configured without strict mode.
//
// Self-skips when TEST_MYSQL_URL is unset.

import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMySqlAdapter, type MySqlAdapter } from "../index";

const TABLE = "int_txmysql_strict";
const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const canConnect = async (url: string): Promise<boolean> => {
  const connPromise = mysql.createConnection(url).catch(() => undefined);
  const attempt = (async () => {
    const conn = await connPromise;
    if (!conn) return false;
    try {
      await conn.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  })();
  const timeout = new Promise<boolean>(resolve =>
    setTimeout(() => resolve(false), 5000)
  );
  const ok = await Promise.race([attempt, timeout]);
  void connPromise.then(conn => conn?.end().catch(() => {}));
  return ok;
};

describe("MySQL transaction strictSqlMode", async () => {
  const available = TEST_DB_URL ? await canConnect(TEST_DB_URL) : false;

  if (!available) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }

  let adapter: MySqlAdapter;

  const sessionMode = async (): Promise<string> => {
    const [row] = await adapter.executeQuery<{ mode: string }>(
      "SELECT @@SESSION.sql_mode AS mode"
    );
    return row.mode;
  };

  const connectionId = async (): Promise<number> => {
    const [row] = await adapter.executeQuery<{ id: number }>(
      "SELECT CONNECTION_ID() AS id"
    );
    return Number(row.id);
  };

  // Runs `run` with each connection the adapter opens of its own starting as a server configured
  // by `setup` would start it: the statements run on it as it opens. The server's own settings are
  // left alone, since other suites share it while this one runs.
  const withNewSessions = async <T>(
    setup: string[],
    run: () => Promise<T>
  ): Promise<T> => {
    const open = mysql.createConnection.bind(mysql);
    const opened = vi
      .spyOn(mysql, "createConnection")
      .mockImplementation((async (config: unknown) => {
        const connection = await open(config as never);
        for (const statement of setup) await connection.query(statement);
        return connection;
      }) as never);
    try {
      const result = await run();
      // The case ran on a connection set up this way, not on the server's own defaults.
      expect(opened).toHaveBeenCalled();
      return result;
    } finally {
      opened.mockRestore();
    }
  };

  // Whether the server has dropped connection `id`; a closed socket can take a moment to reach it.
  const closed = async (id: number): Promise<boolean> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await adapter.executeQuery<{ id: number }>(
        "SELECT ID AS id FROM information_schema.PROCESSLIST WHERE ID = ?",
        [id]
      );
      if (rows.length === 0) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  };

  const stored = async (): Promise<string[]> =>
    (
      await adapter.executeQuery<{ v: string }>(
        `SELECT v FROM ${TABLE} ORDER BY v`
      )
    ).map(r => r.v);

  beforeAll(async () => {
    adapter = createMySqlAdapter({ url: TEST_DB_URL, pool: { max: 1 } });
    await adapter.connect();
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.executeQuery(`CREATE TABLE ${TABLE} (v TEXT)`);
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await adapter.disconnect();
  });

  it("refuses a narrowing that would cut a value short, and restores the session's mode", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('abcdefgh')`);
    await adapter.executeQuery("SET SESSION sql_mode = ''");

    await expect(
      adapter.transaction(
        async ctx => {
          await ctx.execute(`ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(5)`);
        },
        { strictSqlMode: true }
      )
    ).rejects.toThrow(/Data too long/);

    expect(await stored()).toEqual(["abcdefgh"]);
    expect(await sessionMode()).toBe("");
  });

  it("keeps every flag the session had, and puts the mode back after a commit", async () => {
    await adapter.executeQuery("SET SESSION sql_mode = 'NO_ZERO_DATE'");
    let inside = "";
    await adapter.transaction(
      async ctx => {
        const [row] = await ctx.execute<{ mode: string }>(
          "SELECT @@SESSION.sql_mode AS mode"
        );
        inside = row.mode;
      },
      { strictSqlMode: true }
    );
    expect(inside.split(",").sort()).toEqual(
      ["NO_ZERO_DATE", "STRICT_ALL_TABLES"].sort()
    );
    expect(await sessionMode()).toBe("NO_ZERO_DATE");
  });

  it("leaves the session's mode alone without the option", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('abcdefgh')`);
    await adapter.executeQuery("SET SESSION sql_mode = ''");

    await adapter.transaction(async ctx => {
      await ctx.execute(`ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(5)`);
    });

    // The control: the same narrowing, unguarded, cuts the value — so the refusal above is the
    // option's doing, not the server's.
    expect(await stored()).toEqual(["abcde"]);
  });

  // A migration file marked to run outside a transaction runs statement by statement, each
  // committing as it runs; `withSession` keeps them on one connection of its own so its session's
  // mode can be set for all of them. That connection is new, so it starts with the server's mode,
  // which these cases stand in for (`withNewSessions`).
  it("runs a session outside a transaction in strict mode, refusing a narrowing that would cut a value, on a connection of its own", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('abcdefgh')`);

    let inside = "";
    let sessionId = 0;
    await withNewSessions(["SET SESSION sql_mode = ''"], async () => {
      await expect(
        adapter.withSession(
          async session => {
            const [row] = await session.execute<{ mode: string; id: number }>(
              "SELECT @@SESSION.sql_mode AS mode, CONNECTION_ID() AS id"
            );
            inside = row.mode;
            sessionId = Number(row.id);
            await session.execute(
              `ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(5)`
            );
          },
          { strictSqlMode: true }
        )
      ).rejects.toThrow(/Data too long/);
    });

    // mysql2's client flags add IGNORE_SPACE to every connection's mode.
    expect(inside.split(",")).toContain("STRICT_ALL_TABLES");
    // The session started without the server's default strict flag, as a lax server's would.
    expect(inside.split(",")).not.toContain("STRICT_TRANS_TABLES");
    expect(await stored()).toEqual(["abcdefgh"]);
    // Not the pool's connection, and closed once the session ended.
    expect(sessionId).not.toBe(await connectionId());
    expect(await closed(sessionId)).toBe(true);
  });

  it("keeps every flag the server's mode has in a session outside a transaction", async () => {
    let inside = "";
    await withNewSessions(["SET SESSION sql_mode = 'PIPES_AS_CONCAT'"], () =>
      adapter.withSession(
        async session => {
          const [row] = await session.execute<{ mode: string }>(
            "SELECT @@SESSION.sql_mode AS mode"
          );
          inside = row.mode;
        },
        { strictSqlMode: true }
      )
    );
    expect(inside.split(",")).toEqual(
      expect.arrayContaining(["PIPES_AS_CONCAT", "STRICT_ALL_TABLES"])
    );
  });

  it("leaves a write another caller left uncommitted on a pooled connection uncommitted", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    // The pool's only connection as a server whose sessions start with autocommit off leaves it
    // after an ordinary write: inside a transaction nobody has committed. A session that took
    // that connection and turned autocommit on would commit the write.
    await adapter.executeQuery("SET SESSION autocommit = 0");
    await adapter.executeQuery(`INSERT INTO ${TABLE} (v) VALUES ('pending')`);
    try {
      await adapter.withSession(async session => {
        await session.execute(`INSERT INTO ${TABLE} (v) VALUES ('session')`);
      });
      // Read from a connection of its own: an uncommitted row is invisible there.
      const other = await mysql.createConnection(TEST_DB_URL as string);
      try {
        const [rows] = await other.query<mysql.RowDataPacket[]>(
          `SELECT v FROM ${TABLE}`
        );
        expect(rows.map(r => r.v as string)).toEqual(["session"]);
      } finally {
        await other.end();
      }
    } finally {
      await adapter.executeQuery("ROLLBACK");
      await adapter.executeQuery("SET SESSION autocommit = 1");
    }
  });

  it("commits a session's statements on a server whose sessions start with autocommit off", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await withNewSessions(["SET SESSION autocommit = 0"], () =>
      adapter.withSession(async session => {
        await session.execute(`INSERT INTO ${TABLE} (v) VALUES ('committed')`);
      })
    );
    // Read from a connection of its own: a row left in the session's open transaction is
    // invisible there.
    const other = await mysql.createConnection(TEST_DB_URL as string);
    try {
      const [rows] = await other.query<mysql.RowDataPacket[]>(
        `SELECT v FROM ${TABLE}`
      );
      expect(rows.map(r => r.v as string)).toEqual(["committed"]);
    } finally {
      await other.end();
    }
  });

  it("commits each statement of a session outside a transaction as it runs", async () => {
    await adapter.executeQuery(`DELETE FROM ${TABLE}`);
    await adapter.executeQuery(`ALTER TABLE ${TABLE} MODIFY COLUMN v TEXT`);
    await expect(
      adapter.withSession(async session => {
        await session.execute(`INSERT INTO ${TABLE} (v) VALUES ('kept')`);
        await session.execute(
          "INSERT INTO int_txmysql_missing (v) VALUES ('x')"
        );
      })
    ).rejects.toThrow();
    // No transaction to roll back: the first statement stayed.
    expect(await stored()).toEqual(["kept"]);
  });
});
