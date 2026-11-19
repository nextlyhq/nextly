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

  it("takes the dialect stated over the one the URL implies", () => {
    expect(target("./app.data", "sqlite")).toBe(
      `SQLite ${resolve(FOLDER, "app.data")}`
    );
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
