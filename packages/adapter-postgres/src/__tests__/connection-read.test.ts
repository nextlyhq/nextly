/**
 * What the PostgreSQL adapter reads for a health check, from a pooled
 * client: the session's own `pg_stat_ssl` row and the client's socket, turned
 * into the connection's encryption; the server's version and round trip; and
 * whether the configured host is this machine. No database: the client is a
 * stand-in, so each answer the server could give is tried in turn.
 */

import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PostgresAdapter } from "../index";

const plainSocket = () => new Socket();
const tlsSocket = () => new TLSSocket(new Duplex({ read() {}, write() {} }));

/** The pooled client the adapter is handed: its row, its socket, its release. */
const client: {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  connection: { stream: Duplex };
  host?: string;
} = {
  query: vi.fn(),
  release: vi.fn(),
  connection: { stream: plainSocket() },
};

const pool = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  totalCount: 1,
  idleCount: 1,
  waitingCount: 0,
};

vi.mock("pg", () => ({
  Pool: class {
    connect = pool.connect;
    query = pool.query;
    end = pool.end;
    on = pool.on;
    totalCount = pool.totalCount;
    idleCount = pool.idleCount;
    waitingCount = pool.waitingCount;
  },
}));

/** Answers the boot's own queries, and the health read with `row`. */
function serverAnswers(row: Record<string, unknown> | undefined): void {
  client.query.mockImplementation((sql: string) => {
    if (sql.includes("pg_stat_ssl")) {
      return Promise.resolve({ rows: row === undefined ? [] : [row] });
    }
    if (sql.toLowerCase().includes("version()")) {
      return Promise.resolve({ rows: [{ version: "PostgreSQL 17.2 on x" }] });
    }
    return Promise.resolve({ rows: [{ result: 1 }] });
  });
}

async function connected(url: string): Promise<PostgresAdapter> {
  const adapter = new PostgresAdapter({ url });
  await adapter.connect();
  return adapter;
}

const REMOTE = "postgres://u:p@db.example.com:5432/app";

beforeEach(() => {
  vi.clearAllMocks();
  pool.connect.mockResolvedValue(client);
  pool.end.mockResolvedValue(undefined);
  client.connection.stream = plainSocket();
  delete client.host;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PostgresAdapter.inspectConnection", () => {
  it("reads an encrypted session on a TLS socket, the server's version and the round trip", async () => {
    serverAnswers({ version: "17.2 (Debian 17.2-1)", ssl: true });
    const adapter = await connected(REMOTE);
    client.connection.stream = tlsSocket();
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "encrypted",
      local: false,
      serverVersion: "17.2",
      roundTripMs: expect.any(Number),
    });
    // The client goes back to the pool.
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it("reads a plain session on a plain socket as not encrypted", async () => {
    serverAnswers({ version: "17.2", ssl: false });
    const adapter = await connected(REMOTE);
    expect((await adapter.inspectConnection()).encryption).toBe("unencrypted");
  });

  it("reads a plain session behind a pooler, on this client's TLS socket, as encrypted", async () => {
    serverAnswers({ version: "17.2", ssl: false });
    const adapter = await connected(REMOTE);
    client.connection.stream = tlsSocket();
    expect((await adapter.inspectConnection()).encryption).toBe("encrypted");
  });

  it("reads a session a pooler encrypted, on this client's plain socket, as not encrypted", async () => {
    serverAnswers({ version: "17.2", ssl: true });
    const adapter = await connected(REMOTE);
    expect((await adapter.inspectConnection()).encryption).toBe("unencrypted");
  });

  it("takes the session's answer when the client's socket cannot be read", async () => {
    serverAnswers({ version: "17.2", ssl: true });
    const adapter = await connected(REMOTE);
    client.connection.stream = new Duplex({ read() {}, write() {} });
    expect((await adapter.inspectConnection()).encryption).toBe("encrypted");
  });

  it("answers unknown when the session has no row to say", async () => {
    serverAnswers({ version: "17.2", ssl: null });
    const adapter = await connected(REMOTE);
    client.connection.stream = tlsSocket();
    expect((await adapter.inspectConnection()).encryption).toBe("unknown");
    serverAnswers(undefined);
    expect((await adapter.inspectConnection()).encryption).toBe("unknown");
  });

  it("answers unknown, never encrypted, when the read is refused", async () => {
    serverAnswers({ version: "17.2", ssl: true });
    const adapter = await connected(REMOTE);
    client.query.mockRejectedValueOnce(
      new Error("permission denied for view pg_stat_ssl")
    );
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "unknown",
      local: false,
    });
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it("answers unknown when no client can be had", async () => {
    serverAnswers({ version: "17.2", ssl: true });
    const adapter = await connected(REMOTE);
    pool.connect.mockRejectedValueOnce(new Error("timeout"));
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "unknown",
      local: false,
    });
  });

  it("judges a loopback or socket address to be this machine", async () => {
    serverAnswers({ version: "17.2", ssl: false });
    for (const url of [
      "postgres://u:p@localhost:5432/app",
      "postgres://u:p@127.0.0.1/app",
      "postgres://u@db.example.com/app?host=/var/run/postgresql",
    ]) {
      const adapter = await connected(url);
      expect((await adapter.inspectConnection()).local).toBe(true);
    }
  });

  it("judges by the host the client resolved, PGHOST's included, over a configuration naming none", async () => {
    serverAnswers({ version: "17.2", ssl: false });
    const adapter = await connected("postgres://u:p@/app");
    client.host = "db.example.com";
    expect((await adapter.inspectConnection()).local).toBe(false);
    client.host = "localhost";
    expect((await adapter.inspectConnection()).local).toBe(true);
  });

  it("judges a configuration naming no host, with no client had, as another machine", async () => {
    serverAnswers({ version: "17.2", ssl: false });
    const adapter = await connected("postgres://u:p@/app");
    pool.connect.mockRejectedValueOnce(new Error("timeout"));
    expect(await adapter.inspectConnection()).toEqual({
      encryption: "unknown",
      local: false,
    });
  });
});
