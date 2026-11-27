/**
 * The PostgreSQL and MySQL drivers the installer carries for the connection
 * test, the versions the adapters use. Loaded only when a test runs, so a
 * SQLite project, `--help` and every other run start without them.
 */
import type { Connect, OpenConnection } from "./types";

/** How long a connection may take before the server counts as unreachable. */
export const CONNECT_TIMEOUT_MS = 10_000;

export const connectWithDriver: Connect = async (dialect, url) => {
  if (dialect === "postgresql") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    // An error after connecting (the server going away) must not be an
    // unhandled event that ends the process.
    client.on("error", () => {});
    await client.connect();
    return {
      async rows(sql) {
        const result = await client.query(sql);
        return result.rows as Record<string, unknown>[];
      },
      async close() {
        await client.end().catch(() => {});
      },
    } satisfies OpenConnection;
  }

  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    uri: url,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  return {
    async rows(sql) {
      const [rows] = await connection.query(sql);
      return rows as Record<string, unknown>[];
    },
    async close() {
      await connection.end().catch(() => {});
    },
  } satisfies OpenConnection;
};
