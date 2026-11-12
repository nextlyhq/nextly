// The health check's connection read against a real MySQL server, with TLS on and off from the
// client's side: the server offers TLS, a connection made without `ssl` is plain and one made with
// it is encrypted, and each must read as such from the session's own `Ssl_cipher` status. It also
// reads the server's version and a round trip, and judges the test container's loopback address
// to be this machine. It changes nothing on the server.
//
// Self-skips when TEST_MYSQL_URL is unset, or when the server offers no TLS.

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { createMySqlAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_MYSQL_URL;

/** Whether the server answers, its version, and whether it offers TLS: read, never set. */
const probe = async (
  url: string
): Promise<{ tls: boolean; version: string } | undefined> => {
  const attempt = (async () => {
    const conn = await mysql.createConnection(url);
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT VERSION() AS version, @@GLOBAL.tls_version AS tls"
      );
      const tls: unknown = rows[0]?.tls;
      return {
        tls: typeof tls === "string" && tls !== "",
        version: String(rows[0]?.version),
      };
    } finally {
      await conn.end().catch(() => {});
    }
  })().catch(() => undefined);
  const timeout = new Promise<undefined>(resolve =>
    setTimeout(() => resolve(undefined), 5000)
  );
  return Promise.race([attempt, timeout]);
};

describe("MySQL inspectConnection", async () => {
  const server = TEST_DB_URL ? await probe(TEST_DB_URL) : undefined;

  if (!server || !TEST_DB_URL) {
    it.skip("Skipping: TEST_MYSQL_URL not set or unreachable", () => {});
    return;
  }
  const url = TEST_DB_URL;

  it("reads a connection made without TLS as not encrypted, on this machine", async () => {
    const adapter = createMySqlAdapter({ url, pool: { max: 1 } });
    await adapter.connect();
    try {
      expect(await adapter.inspectConnection()).toEqual({
        encryption: "unencrypted",
        local: true,
        serverVersion: server.version.split("-")[0],
        roundTripMs: expect.any(Number),
      });
    } finally {
      await adapter.disconnect();
    }
  });

  it.skipIf(!server.tls)(
    "reads a connection made with TLS as encrypted",
    async () => {
      const adapter = createMySqlAdapter({
        url,
        ssl: { rejectUnauthorized: false },
        pool: { max: 1 },
      });
      await adapter.connect();
      try {
        expect(await adapter.inspectConnection()).toEqual({
          encryption: "encrypted",
          local: true,
          serverVersion: server.version.split("-")[0],
          roundTripMs: expect.any(Number),
        });
      } finally {
        await adapter.disconnect();
      }
    }
  );
});
