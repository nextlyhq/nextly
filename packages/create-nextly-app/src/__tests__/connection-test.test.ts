/**
 * The connection test without a server: a stand-in driver answers each
 * query, or fails with the code a real server gives. What a real PostgreSQL
 * and MySQL say is in connection-test.integration.test.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classify } from "../connection-test/causes";
import {
  createDatabase,
  quoteIdentifier,
  serverUrl,
} from "../connection-test/create-database";
import {
  connectInteractively,
  type AfterFailure,
  type ConnectionPromptIO,
} from "../connection-test/prompt";
import { isLocalHost, readTarget } from "../connection-test/target";
import {
  connectedLine,
  testConnection,
} from "../connection-test/test-connection";
import type { Connect, ServerDialect } from "../connection-test/types";
import {
  MIN_VERSIONS,
  MYSQL_VARIANTS,
  judgeVersion,
} from "../connection-test/version";

/** A driver error with a code, as pg and mysql2 throw them. */
function failure(code: string, message = `failed for user "alice"`) {
  return Object.assign(new Error(message), { code });
}

interface FakeServer {
  version?: string;
  database?: string;
  tables?: string[];
  /** Fails `connect` with this, until `created` is set. */
  refuse?: Error;
  created?: string[];
  urls?: string[];
}

/** A stand-in driver for one server. */
function fakeConnect(server: FakeServer): Connect {
  server.created ??= [];
  server.urls ??= [];
  return async (_dialect, url) => {
    server.urls!.push(url);
    const toServer = /\/(postgres)?$/.test(new URL(url).pathname);
    if (server.refuse && !toServer && server.created!.length === 0) {
      throw server.refuse;
    }
    return {
      async rows(sql) {
        if (/^SELECT version\(\)|^SELECT VERSION\(\)/.test(sql)) {
          return [{ version: server.version ?? "PostgreSQL 17.2 on x86_64" }];
        }
        if (/current_database|DATABASE\(\) AS name/.test(sql)) {
          return [{ name: server.database ?? "site" }];
        }
        if (/information_schema\.tables/.test(sql)) {
          return (server.tables ?? []).map(name => ({ name }));
        }
        const create = /^CREATE DATABASE (.+)$/.exec(sql);
        if (create) {
          server.created!.push(create[1]);
          return [];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      async close() {},
    };
  };
}

const SECRET_URL =
  "postgresql://alice:s3cr3t-pw@localhost:5440/site?password=qparam-secret&sslmode=disable";
const SECRETS = ["alice", "s3cr3t-pw", "qparam-secret"];

function holdsNoSecret(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("where the server is", () => {
  it("counts localhost, loopback addresses, host.docker.internal and a socket as this machine", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.10.20.30",
      "[::1]",
      "::1",
      "host.docker.internal",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
    expect(
      readTarget("postgresql:///site?host=/var/run/postgresql", "postgresql")
        .onThisMachine
    ).toBe(true);
  });

  it("counts every other address as a live server", () => {
    for (const host of [
      "db.example.com",
      "10.0.0.5",
      "192.168.1.20",
      "localhost.example.com",
      "128.0.0.1",
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("names the server and database only, with the dialect's port when none is given", () => {
    expect(readTarget(SECRET_URL, "postgresql")).toEqual({
      server: "localhost:5440",
      database: "site",
      onThisMachine: true,
    });
    expect(readTarget("mysql://root@db.example.com/shop", "mysql")).toEqual({
      server: "db.example.com:3306",
      database: "shop",
      onThisMachine: false,
    });
  });
});

describe("the versions Nextly runs on", () => {
  it("holds the same minimums the adapters refuse below", async () => {
    const source = await readFile(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../adapter-drizzle/src/version-check.ts"
      ),
      "utf8"
    );
    for (const dialect of ["postgresql", "mysql"] as const) {
      const { major, minor } = MIN_VERSIONS[dialect];
      expect(source).toMatch(
        new RegExp(`${dialect}: \\{ major: ${major}, minor: ${minor} \\}`)
      );
    }
    for (const variant of MYSQL_VARIANTS) {
      expect(source).toContain(`"${variant}"`);
    }
  });

  it("accepts PostgreSQL 15 and later, and refuses 14", () => {
    expect(judgeVersion("postgresql", "PostgreSQL 17.2 on x86_64")).toEqual({
      supported: true,
      server: "PostgreSQL 17.2",
    });
    expect(judgeVersion("postgresql", "PostgreSQL 15.0")).toMatchObject({
      supported: true,
    });
    expect(judgeVersion("postgresql", "PostgreSQL 14.11 on aarch64")).toEqual({
      supported: false,
      server: "PostgreSQL 14.11",
      required: "PostgreSQL 15.0 or later",
    });
  });

  it("accepts MySQL 8.0 and later, refuses 5.7, and warns for a MySQL-compatible server", () => {
    expect(judgeVersion("mysql", "8.0.36")).toEqual({
      supported: true,
      server: "MySQL 8.0.36",
    });
    expect(judgeVersion("mysql", "5.7.44-log")).toMatchObject({
      supported: false,
      required: "MySQL 8.0 or later",
    });
    const maria = judgeVersion("mysql", "11.2.2-MariaDB-1:11.2.2");
    expect(maria).toMatchObject({ supported: true, server: "MariaDB 11.2.2" });
    expect(maria.supported && maria.variantWarning).toMatch(
      /tested on MySQL 8\.0/
    );
  });
});

describe("why a connection failed", () => {
  it("reads each driver code as the cause the person is told", () => {
    expect(classify(failure("ECONNREFUSED"))).toBe("unreachable");
    expect(classify(failure("ENOTFOUND"))).toBe("unreachable");
    expect(
      classify(new Error("Connection terminated due to connection timeout"))
    ).toBe("unreachable");
    expect(classify(failure("28P01"))).toBe("login-refused");
    expect(classify(failure("ER_ACCESS_DENIED_ERROR"))).toBe("login-refused");
    expect(classify(failure("3D000"))).toBe("database-missing");
    expect(classify(failure("ER_BAD_DB_ERROR"))).toBe("database-missing");
    expect(classify(failure("XX000"))).toBe("other");
  });
});

describe("testing a connection", () => {
  it("says Connected with the server, its version and the database", async () => {
    const result = await testConnection(
      "postgresql",
      SECRET_URL,
      fakeConnect({})
    );
    expect(result).toEqual({
      ok: true,
      server: "PostgreSQL 17.2",
      database: "site",
    });
    expect(result.ok && connectedLine(result)).toBe(
      'Connected to PostgreSQL 17.2, database "site" (tested)'
    );
  });

  it("says whether tables already there look like a Nextly site", async () => {
    const other = await testConnection(
      "postgresql",
      SECRET_URL,
      fakeConnect({ tables: ["orders"] })
    );
    expect(other).toMatchObject({ ok: true, existingTables: "other" });
    const nextly = await testConnection(
      "mysql",
      "mysql://root@localhost:3307/site",
      fakeConnect({
        version: "8.4.3",
        tables: ["users", "nextly_schema_events"],
      })
    );
    expect(nextly).toMatchObject({ ok: true, existingTables: "nextly" });
  });

  it("gives each cause in plain words, naming no user, password or query", async () => {
    const cases: [Error, RegExp][] = [
      [
        failure("ECONNREFUSED"),
        /^Can't reach the PostgreSQL server at localhost:5440\./,
      ],
      [
        failure("28P01"),
        /^The PostgreSQL server at localhost:5440 refused the login\./,
      ],
      [
        failure("3D000"),
        /^The database "site" doesn't exist on the PostgreSQL server at localhost:5440\./,
      ],
      [failure("XX000", "internal error for alice s3cr3t-pw"), /\(XX000\)/],
    ];
    for (const [error, words] of cases) {
      const result = await testConnection(
        "postgresql",
        SECRET_URL,
        fakeConnect({ refuse: error })
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toMatch(words);
      holdsNoSecret(result.message);
    }
    const old = await testConnection(
      "postgresql",
      SECRET_URL,
      fakeConnect({ version: "PostgreSQL 14.11" })
    );
    expect(old).toMatchObject({
      ok: false,
      cause: "version-unsupported",
      message:
        "The server runs PostgreSQL 14.11; Nextly needs PostgreSQL 15.0 or later.",
    });
  });

  it("offers to create a missing database only on this machine", async () => {
    const here = await testConnection(
      "postgresql",
      "postgresql://postgres@127.0.0.1:5435/new_site",
      fakeConnect({ refuse: failure("3D000") })
    );
    expect(here).toMatchObject({
      ok: false,
      canCreate: true,
      database: "new_site",
    });
    const live = await testConnection(
      "postgresql",
      "postgresql://postgres@db.example.com:5432/new_site",
      fakeConnect({ refuse: failure("3D000") })
    );
    expect(live).toMatchObject({ ok: false, canCreate: false });
    const refused = await testConnection(
      "postgresql",
      "postgresql://postgres@localhost:5432/new_site",
      fakeConnect({ refuse: failure("28P01") })
    );
    expect(refused).toMatchObject({ ok: false, canCreate: false });
  });

  it("refuses a MySQL string that names no database", async () => {
    const result = await testConnection(
      "mysql",
      "mysql://root@localhost:3307/",
      fakeConnect({ version: "8.0.36", database: "" })
    );
    expect(result).toMatchObject({
      ok: false,
      cause: "database-missing",
      canCreate: false,
    });
    expect(!result.ok && result.message).toMatch(/names no database/);
  });
});

describe("creating a missing database", () => {
  it("quotes the name and connects to the server's own database", () => {
    expect(quoteIdentifier("postgresql", 'a"b')).toBe('"a""b"');
    expect(quoteIdentifier("mysql", "a`b")).toBe("`a``b`");
    expect(
      serverUrl(
        "postgresql",
        "postgresql://u:p@localhost:5432/site?sslmode=disable"
      )
    ).toBe("postgresql://u:p@localhost:5432/postgres?sslmode=disable");
    expect(serverUrl("mysql", "mysql://u:p@localhost:3306/site")).toBe(
      "mysql://u:p@localhost:3306/"
    );
  });

  it("creates nothing on a server that is not on this machine", async () => {
    const server: FakeServer = {};
    const problem = await createDatabase(
      "postgresql",
      "postgresql://postgres@db.example.com:5432/site",
      fakeConnect(server)
    );
    expect(problem).toMatch(/only on a server on this machine/);
    expect(server.urls).toEqual([]);
  });
});

/** A terminal that answers from a script and records what it was shown. */
function scriptedIO(answers: (AfterFailure | string | undefined)[]) {
  const shown: string[] = [];
  const offered: AfterFailure[][] = [];
  const io: ConnectionPromptIO = {
    async choose(_message, options) {
      offered.push(options.map(option => option.value));
      return answers.shift() as AfterFailure | undefined;
    },
    async askString(message) {
      shown.push(message);
      return answers.shift();
    },
    connected: line => shown.push(`ok: ${line}`),
    warn: line => shown.push(`warn: ${line}`),
    failed: line => shown.push(`error: ${line}`),
  };
  return { io, shown, offered };
}

describe("the connection test in a terminal", () => {
  it("offers create, try again, change and back for a missing database here, and creates it", async () => {
    const server: FakeServer = { refuse: failure("3D000") };
    const { io, shown, offered } = scriptedIO(["create"]);
    const outcome = await connectInteractively(
      "postgresql",
      "postgresql://alice:s3cr3t-pw@localhost:5440/site?password=qparam-secret",
      { io, connect: fakeConnect(server) }
    );
    expect(offered).toEqual([["create", "retry", "change", "back"]]);
    expect(server.created).toEqual(['"site"']);
    expect(outcome).toMatchObject({ outcome: "connected" });
    expect(shown.at(-1)).toBe(
      'ok: Connected to PostgreSQL 17.2, database "site" (tested)'
    );
    holdsNoSecret(shown.join("\n"));
  });

  it("offers no create for a live server, and goes back when asked", async () => {
    const { io, offered } = scriptedIO(["back"]);
    const outcome = await connectInteractively(
      "postgresql",
      "postgresql://postgres@db.example.com:5432/site",
      { io, connect: fakeConnect({ refuse: failure("3D000") }) }
    );
    expect(offered).toEqual([["retry", "change", "back"]]);
    expect(outcome).toEqual({ outcome: "back" });
  });

  it("tests a changed string, asking for it masked, and stops on cancel", async () => {
    const urls: string[] = [];
    const connect: Connect = async (dialect: ServerDialect, url: string) => {
      urls.push(url);
      if (url.includes("wrong")) throw failure("28P01");
      return fakeConnect({})(dialect, url);
    };
    const { io, shown } = scriptedIO([
      "change",
      "postgresql://alice:right@localhost:5440/site",
    ]);
    const outcome = await connectInteractively(
      "postgresql",
      "postgresql://alice:wrong@localhost:5440/site",
      { io, connect }
    );
    expect(urls).toEqual([
      "postgresql://alice:wrong@localhost:5440/site",
      "postgresql://alice:right@localhost:5440/site",
    ]);
    expect(outcome).toMatchObject({
      outcome: "connected",
      url: "postgresql://alice:right@localhost:5440/site",
    });
    expect(shown).toContain("PostgreSQL connection string (hidden)");
    expect(shown.join("\n")).not.toMatch(/wrong|right/);

    const cancelled = await connectInteractively(
      "postgresql",
      "postgresql://alice:wrong@localhost:5440/site",
      { io: scriptedIO([undefined]).io, connect }
    );
    expect(cancelled).toEqual({ outcome: "cancel" });
  });

  it("tries again with the same string", async () => {
    let calls = 0;
    const connect: Connect = async (dialect, url) => {
      calls += 1;
      if (calls === 1) throw failure("ECONNREFUSED");
      return fakeConnect({})(dialect, url);
    };
    const { io } = scriptedIO(["retry"]);
    const outcome = await connectInteractively("postgresql", SECRET_URL, {
      io,
      connect,
    });
    expect(calls).toBe(2);
    expect(outcome).toMatchObject({ outcome: "connected", url: SECRET_URL });
  });
});
