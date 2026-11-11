// The health check's connection read against a real PostgreSQL server, as the server is: it reads
// the session's own `pg_stat_ssl` row, the server's version and a round trip, and judges the test
// container's loopback address to be this machine. It changes nothing on the server.
//
// A connection made without TLS must read as not encrypted on any server. Where the server
// itself has TLS on, a connection that asks for it must read as encrypted; on a server with TLS
// off that case is skipped, since asking for TLS there is refused at connect.
//
// Self-skips when TEST_POSTGRES_URL is unset.

import pg from "pg";
import { describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

const TEST_DB_URL = process.env.TEST_POSTGRES_URL;

/** Whether the server answers, and whether it has TLS on: read, never set. */
const probe = async (
  url: string
): Promise<{ ssl: boolean; version: string } | undefined> => {
  // Bounded connect so an unreachable TEST_POSTGRES_URL cannot hang the suite.
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ ssl: string; version: string }>(
      "SELECT current_setting('ssl') AS ssl, current_setting('server_version') AS version"
    );
    return { ssl: rows[0].ssl === "on", version: rows[0].version };
  } catch {
    return undefined;
  } finally {
    await client.end().catch(() => {});
  }
};

describe("PostgreSQL inspectConnection", async () => {
  const server = TEST_DB_URL ? await probe(TEST_DB_URL) : undefined;

  if (!server || !TEST_DB_URL) {
    it.skip("Skipping: TEST_POSTGRES_URL not set or unreachable", () => {});
    return;
  }
  const url = TEST_DB_URL;

  it("reads a connection made without TLS as not encrypted, on this machine", async () => {
    const adapter = createPostgresAdapter({ url, pool: { max: 1 } });
    await adapter.connect();
    try {
      const inspection = await adapter.inspectConnection();
      expect(inspection).toEqual({
        encryption: "unencrypted",
        local: true,
        serverVersion: server.version.split(" ")[0],
        roundTripMs: expect.any(Number),
      });
      expect(inspection.roundTripMs).toBeGreaterThanOrEqual(0);
    } finally {
      await adapter.disconnect();
    }
  });

  it.skipIf(!server.ssl)(
    "reads a connection that asked for TLS as encrypted, where the server has TLS on",
    async () => {
      const adapter = createPostgresAdapter({
        url,
        ssl: { rejectUnauthorized: false },
        pool: { max: 1 },
      });
      await adapter.connect();
      try {
        expect((await adapter.inspectConnection()).encryption).toBe(
          "encrypted"
        );
      } finally {
        await adapter.disconnect();
      }
    }
  );
});
