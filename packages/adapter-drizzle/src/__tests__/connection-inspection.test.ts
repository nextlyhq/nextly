/**
 * The base adapter's rules for a health check's connection read: whether the
 * connection is encrypted, from the session's own answer and this process's
 * socket; whether a socket negotiated TLS; and whether a host is this machine.
 *
 * The dialect adapters read the facts; these rules turn them into the answer,
 * so every branch is pinned here once, both pooler cases included.
 */

import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";

import { describe, expect, it } from "vitest";

import { DrizzleAdapter } from "../adapter";
import type {
  ConnectionEncryption,
  DatabaseCapabilities,
  SupportedDialect,
  TransactionContext,
} from "../types";

/** The rules under test, reached through a subclass, with nothing else working. */
class RulesAdapter extends DrizzleAdapter {
  readonly dialect: SupportedDialect = "postgresql";
  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  executeQuery<T = unknown>(): Promise<T[]> {
    return Promise.resolve([]);
  }
  transaction<T>(_fn: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return Promise.reject(new Error("not used"));
  }
  getCapabilities(): DatabaseCapabilities {
    throw new Error("not used");
  }
  getDrizzle<T = unknown>(): T {
    throw new Error("not used");
  }
  encryption(read: {
    session: boolean | undefined;
    ownSocketTls: boolean | undefined;
  }): ConnectionEncryption {
    return this.encryptionOf(read);
  }
  tls(handle: unknown): boolean | undefined {
    return this.ownSocketIsTls(handle);
  }
  local(host: string | undefined): boolean {
    return this.isLocalHost(host);
  }
  hostOf(url: string): string | undefined {
    return this.hostOfUrl(url);
  }
}

const rules = new RulesAdapter();

/** A socket that negotiated TLS, as a driver holds it after the upgrade. */
const tlsSocket = () => new TLSSocket(new Duplex({ read() {}, write() {} }));

describe("encryptionOf", () => {
  it("follows this process's own socket once the session has answered", () => {
    expect(rules.encryption({ session: true, ownSocketTls: true })).toBe(
      "encrypted"
    );
    expect(rules.encryption({ session: false, ownSocketTls: false })).toBe(
      "unencrypted"
    );
  });

  it("is encrypted behind a pooler: the session says not, but this socket negotiated TLS", () => {
    expect(rules.encryption({ session: false, ownSocketTls: true })).toBe(
      "encrypted"
    );
  });

  it("is not encrypted when this socket is plain, though a pooler's session to the database is TLS", () => {
    expect(rules.encryption({ session: true, ownSocketTls: false })).toBe(
      "unencrypted"
    );
  });

  it("takes the session's answer when the socket could not be read", () => {
    expect(rules.encryption({ session: true, ownSocketTls: undefined })).toBe(
      "encrypted"
    );
    expect(rules.encryption({ session: false, ownSocketTls: undefined })).toBe(
      "unencrypted"
    );
  });

  it("is unknown when the session gave no answer, even over TLS", () => {
    for (const ownSocketTls of [true, false, undefined]) {
      expect(rules.encryption({ session: undefined, ownSocketTls })).toBe(
        "unknown"
      );
    }
  });

  it("answers unknown from the base inspection, which reads nothing", async () => {
    expect(await rules.inspectConnection()).toEqual({
      encryption: "unknown",
      local: false,
    });
  });
});

describe("ownSocketIsTls", () => {
  it("reads a TLS socket at connection.stream as TLS, and a plain socket as not", () => {
    expect(rules.tls({ connection: { stream: tlsSocket() } })).toBe(true);
    expect(rules.tls({ connection: { stream: new Socket() } })).toBe(false);
  });

  it("cannot say for a handle shaped otherwise, or a stream that is not a socket", () => {
    const duplex = new Duplex({ read() {}, write() {} });
    expect(rules.tls({ connection: { stream: duplex } })).toBeUndefined();
    expect(rules.tls({ connection: {} })).toBeUndefined();
    expect(rules.tls({ connection: null })).toBeUndefined();
    expect(rules.tls({ stream: tlsSocket() })).toBeUndefined();
    expect(rules.tls(undefined)).toBeUndefined();
    // A look-alike is not a socket that negotiated anything.
    expect(
      rules.tls({ connection: { stream: { encrypted: true } } })
    ).toBeUndefined();
  });
});

describe("isLocalHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "db.localhost",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "/var/run/postgresql",
    "%2Fvar%2Frun%2Fpostgresql",
  ])("judges %s to be this machine", host => {
    expect(rules.local(host)).toBe(true);
  });

  it.each([
    "db.example.com",
    "10.0.0.5",
    "128.0.0.1",
    "127.0.0.1.example.com",
    "localhost.example.com",
    "",
    "%E0%A4%A",
  ])("judges %s to be another machine", host => {
    expect(rules.local(host)).toBe(false);
  });

  it("judges an address it could not read to be another machine", () => {
    expect(rules.local(undefined)).toBe(false);
  });
});

describe("hostOfUrl", () => {
  it("reads a connection string's host", () => {
    expect(rules.hostOf("postgres://u:p@db.example.com:5432/app")).toBe(
      "db.example.com"
    );
    expect(rules.hostOf("mysql://u:p@127.0.0.1/app")).toBe("127.0.0.1");
  });

  it("prefers a socket directory named by its host parameter", () => {
    expect(
      rules.hostOf("postgres://u@db.example.com/app?host=/var/run/postgresql")
    ).toBe("/var/run/postgresql");
  });

  it("answers empty for a string naming no host, and undefined for one it cannot read", () => {
    expect(rules.hostOf("postgres:///app")).toBe("");
    expect(rules.hostOf("not a url")).toBeUndefined();
  });
});
