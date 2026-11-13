/**
 * What the MySQL adapter reads for a health check, from a pooled connection:
 * the session's `Ssl_cipher` status and the connection's socket, turned into
 * the connection's encryption; the server's version and round trip; and
 * whether the configured host is this machine. No database: the connection is
 * a stand-in, so each answer the server could give is tried in turn.
 */

import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MySqlAdapter } from "../index";

const plainSocket = () => new Socket();
const tlsSocket = () => new TLSSocket(new Duplex({ read() {}, write() {} }));

/** The pooled connection: the promise wrapper over mysql2's callback connection. */
const connection = {
  query: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
  connection: { config: {}, stream: plainSocket() as Duplex },
};

const pool = {
  getConnection: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  pool: {
    _allConnections: { length: 1 },
    _freeConnections: { length: 1 },
    _connectionQueue: { length: 0 },
    config: {},
    getConnection: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
};

vi.mock("mysql2/promise", () => ({
  default: { createPool: vi.fn(() => pool), createConnection: vi.fn() },
  createPool: vi.fn(() => pool),
  createConnection: vi.fn(),
}));

/** Answers the boot's own queries, and the session status with `cipher` (none: no row). */
function serverAnswers(cipher: unknown): void {
  connection.query.mockImplementation((sql: string) => {
    if (sql.includes("Ssl_cipher")) {
      return Promise.resolve([
        cipher === undefined
          ? []
          : [{ Variable_name: "Ssl_cipher", Value: cipher }],
        [],
      ]);
    }
    if (sql.toLowerCase().includes("version()")) {
      return Promise.resolve([[{ version: "8.4.3-log" }], []]);
    }
    return Promise.resolve([[], []]);
  });
}

async function connected(url: string): Promise<MySqlAdapter> {
  const adapter = new MySqlAdapter({ url });
  await adapter.connect();
  return adapter;
}

const REMOTE = "mysql://u:p@db.example.com:3306/app";

beforeEach(() => {
  vi.clearAllMocks();
  pool.getConnection.mockResolvedValue(connection);
  pool.query.mockResolvedValue([[], []]);
  pool.end.mockResolvedValue(undefined);
  connection.connection.stream = plainSocket();
});

describe("MySqlAdapter.inspectConnection", () => {
  it("reads a session with a cipher on a TLS socket as encrypted, with the version and round trip", async () => {
    serverAnswers("TLS_AES_256_GCM_SHA384");
    const adapter = await connected(REMOTE);
    connection.connection.stream = tlsSocket();
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "encrypted",
      local: false,
      serverVersion: "8.4.3",
      roundTripMs: expect.any(Number),
    });
  });

  it("reads an empty cipher on a plain socket as not encrypted", async () => {
    serverAnswers("");
    const adapter = await connected(REMOTE);
    expect((await adapter.inspectConnection()).encryption).toBe("unencrypted");
  });

  it("reads an empty cipher behind a proxy, on this connection's TLS socket, as encrypted", async () => {
    serverAnswers("");
    const adapter = await connected(REMOTE);
    connection.connection.stream = tlsSocket();
    expect((await adapter.inspectConnection()).encryption).toBe("encrypted");
  });

  it("reads a session a proxy encrypted, on this connection's plain socket, as not encrypted", async () => {
    serverAnswers("TLS_AES_256_GCM_SHA384");
    const adapter = await connected(REMOTE);
    expect((await adapter.inspectConnection()).encryption).toBe("unencrypted");
  });

  it("answers unknown when the server would not say", async () => {
    serverAnswers(undefined);
    const adapter = await connected(REMOTE);
    connection.connection.stream = tlsSocket();
    expect((await adapter.inspectConnection()).encryption).toBe("unknown");
  });

  it("answers unknown, never encrypted, when the read is refused, and hands the connection back", async () => {
    serverAnswers("TLS_AES_256_GCM_SHA384");
    const adapter = await connected(REMOTE);
    connection.release.mockClear();
    connection.query.mockRejectedValueOnce(new Error("access denied"));
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "unknown",
      local: false,
    });
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("judges a loopback address to be this machine", async () => {
    serverAnswers("");
    for (const url of [
      "mysql://u:p@localhost/app",
      "mysql://u:p@127.0.0.1/app",
    ]) {
      const adapter = await connected(url);
      expect((await adapter.inspectConnection()).local).toBe(true);
    }
  });
});
