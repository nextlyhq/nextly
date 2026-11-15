// The pool's idle timeout and min against a real MySQL server: connections left idle above `min`
// close once the idle timeout has passed, not before, and `min` of them stay open however long
// they are idle. Read from both ends: the pool's own count, and the server's process list, which
// is where a connection that was only dropped from the pool's books would still show.
//
// Self-skips when TEST_MYSQL_URL is unset or the server does not answer.

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { createMySqlAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_MYSQL_URL;

const reachable = async (url: string): Promise<boolean> => {
  const attempt = (async () => {
    const conn = await mysql.createConnection(url);
    await conn.end().catch(() => {});
    return true;
  })().catch(() => false);
  const timeout = new Promise<boolean>(resolve =>
    setTimeout(() => resolve(false), 5000)
  );
  return Promise.race([attempt, timeout]);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("MySQL pool idle timeout and min", async () => {
  if (!TEST_DB_URL || !(await reachable(TEST_DB_URL))) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }
  const url = TEST_DB_URL;

  it("closes idle connections above min after the timeout, and keeps min open", async () => {
    const idleTimeoutMs = 1500;
    const adapter = createMySqlAdapter({
      url,
      pool: { min: 1, max: 3, idleTimeoutMs },
    });
    // A connection of the test's own, to read the server's process list.
    const observer = await mysql.createConnection(url);
    const open = async (ids: number[]) => {
      const [rows] = await observer.query<mysql.RowDataPacket[]>(
        "SELECT ID AS id FROM information_schema.PROCESSLIST WHERE ID IN (?)",
        [ids]
      );
      return rows.map(row => Number(row.id)).sort();
    };
    try {
      await adapter.connect();

      // Three statements at once hold three connections, then leave them idle.
      const held = await Promise.all(
        [0, 1, 2].map(() =>
          adapter.executeQuery<{ id: number }>(
            "SELECT CONNECTION_ID() AS id, SLEEP(0.3) AS slept"
          )
        )
      );
      const ids = held.map(rows => Number(rows[0]?.id));
      expect(new Set(ids).size).toBe(3);
      expect(adapter.getPoolStats()).toMatchObject({ total: 3, idle: 3 });

      // Short of the timeout every one is still open: an idle connection above
      // min is kept as long as the timeout, not closed as soon as it is idle.
      await sleep(idleTimeoutMs - 700);
      expect(adapter.getPoolStats()).toMatchObject({ total: 3 });
      expect(await open(ids)).toEqual([...ids].sort());

      // Past the timeout and the sweep's second, all but min have closed, on
      // the server as well as in the pool.
      await sleep(700 + 1000 + 1000);
      expect(adapter.getPoolStats()).toMatchObject({ total: 1, idle: 1 });
      expect(await open(ids)).toHaveLength(1);

      // min stays open however long it is idle.
      await sleep(idleTimeoutMs + 1500);
      expect(adapter.getPoolStats()).toMatchObject({ total: 1, idle: 1 });
      expect(await open(ids)).toHaveLength(1);

      // And the one kept still serves.
      const [row] = await adapter.executeQuery<{ one: number }>(
        "SELECT 1 AS one"
      );
      expect(Number(row?.one)).toBe(1);
    } finally {
      await adapter.disconnect();
      await observer.end().catch(() => {});
    }
  });
});
