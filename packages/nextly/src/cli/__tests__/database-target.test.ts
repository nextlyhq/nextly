/**
 * The database a command names before it uses one: the dialect and the
 * target as that dialect names it, built from the URL's named parts alone.
 * Nothing else of the URL is ever said: no user name, no password, no query
 * parameter.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { databaseTarget } from "../database-target";

const FOLDER = resolve("/srv/app");
const target = (url: string | undefined, dialect?: string) =>
  databaseTarget({ url, dialect, folder: FOLDER });

/** Every secret the URLs below carry: none may reach a line. */
const SECRETS = ["appuser", "s3cr3t", "hunter2", "sslmode", "password"];

describe("the database a command names", () => {
  it("names a PostgreSQL host, port and database, and nothing else of the URL", () => {
    const line = target(
      "postgresql://appuser:s3cr3t@db.internal:6543/shop?sslmode=require&password=hunter2"
    );
    expect(line).toBe("PostgreSQL db.internal:6543/shop");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  });

  it("names a MySQL host, port and database, and nothing else of the URL", () => {
    const line = target(
      "mysql://appuser:s3cr3t@mysql.internal:3307/shop?password=hunter2"
    );
    expect(line).toBe("MySQL mysql.internal:3307/shop");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  });

  it("adds the dialect's own port where the URL names none", () => {
    expect(target("postgres://appuser:s3cr3t@db/shop")).toBe(
      "PostgreSQL db:5432/shop"
    );
    expect(target("mysql://root:s3cr3t@db/shop")).toBe("MySQL db:3306/shop");
  });

  it("names the socket in place of the host where the URL names one", () => {
    expect(
      target("postgres://appuser:s3cr3t@/shop?host=/var/run/postgresql")
    ).toBe("PostgreSQL /var/run/postgresql/shop");
    expect(
      target("postgres://appuser:s3cr3t@%2Fvar%2Frun%2Fpostgresql/shop")
    ).toBe("PostgreSQL /var/run/postgresql/shop");
    expect(
      target("mysql://root:s3cr3t@localhost/shop?socketPath=/tmp/mysql.sock")
    ).toBe("MySQL /tmp/mysql.sock/shop");
  });

  it("names a SQLite file resolved against the project folder, or :memory:", () => {
    expect(target("file:./data/app.db")).toBe(
      `SQLite ${resolve(FOLDER, "data/app.db")}`
    );
    expect(target("data/app.sqlite")).toBe(
      `SQLite ${resolve(FOLDER, "data/app.sqlite")}`
    );
    expect(target(`file:${resolve("/var/db/app.db")}`)).toBe(
      `SQLite ${resolve("/var/db/app.db")}`
    );
    expect(target("file::memory:")).toBe("SQLite :memory:");
    expect(target(":memory:", "sqlite")).toBe("SQLite :memory:");
  });

  it("names the dialect the command connects with: the one stated, else the one the URL implies", () => {
    expect(target("./app.data", "sqlite")).toBe(
      `SQLite ${resolve(FOLDER, "app.data")}`
    );
    // Stated beside another dialect's URL, the stated one is what connects.
    expect(target("postgres://appuser:s3cr3t@db.internal/shop", "mysql")).toBe(
      "MySQL db.internal:3306/shop"
    );
  });

  it("never prints a server's URL as a SQLite path", () => {
    const line = target(
      "postgres://appuser:s3cr3t@db.internal:5432/shop?password=hunter2",
      "sqlite"
    );
    expect(line).toBe("SQLite (address not readable)");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  });

  it("does not name a SQLite file the adapter would not open: a URL with a query part is unreadable", () => {
    // The adapter opens the text after `file:` whole, the `?mode=ro` included.
    expect(target("file:./app.db?mode=ro")).toBe(
      "SQLite (address not readable)"
    );
  });

  it("fills what a PostgreSQL URL leaves out from the variables its driver reads", () => {
    const pg = { PGHOST: "pg.internal", PGPORT: "6432", PGDATABASE: "ledger" };
    const withEnv = (url: string) =>
      databaseTarget({ url, folder: FOLDER, env: pg });
    expect(withEnv("postgres://appuser:s3cr3t@db.internal/shop")).toBe(
      "PostgreSQL db.internal:6432/shop"
    );
    expect(withEnv("postgres:///shop")).toBe(
      "PostgreSQL pg.internal:6432/shop"
    );
    expect(withEnv("postgres://db.internal:5433")).toBe(
      "PostgreSQL db.internal:5433/ledger"
    );
    // MySQL's driver reads none of them.
    expect(withEnv("mysql://root:s3cr3t@db.internal")).toBe(
      "MySQL db.internal:3306"
    );
  });

  it("never prints an address parameter that is not an address", () => {
    for (const url of [
      "postgres://localhost/shop?host=postgres%3A%2F%2Fadmin%3As3cr3t%40db",
      "postgres://localhost/shop?host=db.internal&port=s3cr3t",
      "mysql://root@localhost/shop?socketPath=%2Ftmp%2Fs3cr3t%40x",
    ]) {
      const line = target(url);
      expect(line).toMatch(/ \(address not readable\)$/);
      expect(line).not.toContain("s3cr3t");
    }
  });

  it("reads a host and a port given as PostgreSQL parameters, as the driver does", () => {
    expect(
      target(
        "postgres://appuser:s3cr3t@localhost/shop?host=db.internal&port=6432"
      )
    ).toBe("PostgreSQL db.internal:6432/shop");
  });

  it("names the driver's own host where the URL names none, and no database where it names none", () => {
    expect(target("postgres:///shop")).toBe("PostgreSQL localhost:5432/shop");
    expect(target("postgres://appuser:s3cr3t@/shop")).toBe(
      "PostgreSQL localhost:5432/shop"
    );
    expect(target("mysql://root:s3cr3t@db.internal")).toBe(
      "MySQL db.internal:3306"
    );
  });

  it("calls an address it cannot be sure of unreadable, and never guesses at one", () => {
    // A stray percent sign, which cannot be decoded.
    expect(target("postgres://appuser:s3cr3t@db.internal/my%db")).toBe(
      "PostgreSQL (address not readable)"
    );
    // A password holding a slash moves the credentials into the address.
    for (const url of [
      "postgres://admin:123/s3cr3t@db.internal/shop",
      "postgres://tok/s3cr3t@db.internal/shop",
    ]) {
      const line = target(url);
      expect(line).toBe("PostgreSQL (address not readable)");
      expect(line).not.toContain("s3cr3t");
    }
  });

  it("never repeats a URL it cannot read", () => {
    const unreadable = "postgres://appuser:s3cr3t@[::bad/shop?password=hunter2";
    const line = target(unreadable);
    expect(line).toBe("PostgreSQL (address not readable)");
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    // A URL of no known dialect says only that.
    expect(target("redis://appuser:s3cr3t@cache/0")).toBe(
      "(database not recognised)"
    );
    expect(target(undefined)).toBe("none");
  });
});
