/**
 * A dump restores the rows it was taken from, on each dialect: a column whose
 * default is an expression keeps the value the row stored, not one the
 * restore's own clock would give it. The baseline's rows are what the upgrade
 * meets, so a restore that rewrote them would test a different install.
 *
 * The dumps this file's code writes itself: MySQL's when TEST_MYSQL_URL is set,
 * and SQLite's, on a file, otherwise. PostgreSQL's is `pg_dump`'s own, run only
 * when a baseline is recorded, with a client the server's version or newer,
 * which an integration leg's runner does not promise.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { operationsBetween, type Dialect } from "./catalog";
import { dump, makeScratchDatabase, readCatalog, restore } from "./database";

function dialects(): Dialect[] {
  return process.env.TEST_MYSQL_URL ? ["mysql"] : ["sqlite"];
}

const STORED = "2001-02-03 04:05:06";

/** Runs `sql` on the database at `url` and returns the rows. */
async function query(
  dialect: Dialect,
  url: string,
  sql: string
): Promise<Record<string, unknown>[]> {
  if (dialect === "sqlite") {
    const db = new Sqlite(url.replace(/^file:/, ""));
    try {
      const statement = db.prepare(sql);
      if (!statement.reader) {
        statement.run();
        return [];
      }
      return statement.all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  }
  if (dialect === "mysql") {
    const connection = await mysql.createConnection({
      uri: url,
      dateStrings: true,
    });
    try {
      const [rows] = await connection.query(sql);
      return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    } finally {
      await connection.end();
    }
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
}

/** A table with a column whose default is an expression, per dialect. */
const TABLE: Record<Dialect, string> = {
  sqlite: `CREATE TABLE stamped (id text PRIMARY KEY, created_at text DEFAULT (datetime('now')))`,
  mysql:
    "CREATE TABLE stamped (id varchar(10) PRIMARY KEY, created_at datetime DEFAULT (now()))",
  postgresql:
    "CREATE TABLE stamped (id text PRIMARY KEY, created_at timestamp DEFAULT now())",
};

describe.each(dialects())("a dump on %s", dialect => {
  it("restores a defaulted column with the value its row stored", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-dump-"));
    const server = process.env.TEST_MYSQL_URL;
    const source = await makeScratchDatabase(
      dialect,
      { server, file: join(scratch, "source.sqlite") },
      "_gate_dump_from"
    );
    const target = await makeScratchDatabase(
      dialect,
      { server, file: join(scratch, "target.sqlite") },
      "_gate_dump_to"
    );
    try {
      await query(dialect, source.url, TABLE[dialect]);
      await query(
        dialect,
        source.url,
        `INSERT INTO stamped (id, created_at) VALUES ('a', '${STORED}')`
      );
      await restore(dialect, target.url, await dump(dialect, source.url));
      const [row] = await query(
        dialect,
        target.url,
        "SELECT created_at AS kept FROM stamped WHERE id = 'a'"
      );
      const stored =
        row?.kept instanceof Date
          ? row.kept.toISOString().replace("T", " ").slice(0, 19)
          : String(row?.kept);
      expect(stored).toBe(STORED);
    } finally {
      await source.drop();
      await target.drop();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

/**
 * MySQL's catalog states a generated column with its expression, which
 * `COLUMN_DEFAULT` and `EXTRA` do not carry, so an upgrade that changes only
 * the expression is an operation.
 */
describe.runIf(process.env.TEST_MYSQL_URL)("the MySQL catalog", () => {
  it("reads a generated column whose expression changed as a change", async () => {
    const server = process.env.TEST_MYSQL_URL;
    const read = async (suffix: string, total: string) => {
      const database = await makeScratchDatabase("mysql", { server }, suffix);
      try {
        await query(
          "mysql",
          database.url,
          `CREATE TABLE t (price int, quantity int, total int GENERATED ALWAYS AS (${total}) VIRTUAL)`
        );
        return await readCatalog("mysql", database.url);
      } finally {
        await database.drop();
      }
    };
    const operations = operationsBetween(
      await read("_gate_generated_a", "price * quantity"),
      await read("_gate_generated_b", "price + quantity")
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatch(/^change column t\.total: .*\* .* -> .*\+ /);
  });

  it("reads a CHECK no longer enforced as a change", async () => {
    const database = await makeScratchDatabase(
      "mysql",
      { server: process.env.TEST_MYSQL_URL },
      "_gate_check_enforced"
    );
    try {
      await query(
        "mysql",
        database.url,
        "CREATE TABLE t (n int, CONSTRAINT t_n_positive CHECK (n > 0))"
      );
      const before = await readCatalog("mysql", database.url);
      await query(
        "mysql",
        database.url,
        "ALTER TABLE t ALTER CHECK t_n_positive NOT ENFORCED"
      );
      const operations = operationsBetween(
        before,
        await readCatalog("mysql", database.url)
      );
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatch(
        /^change constraint t\.t_n_positive: check .* -> check .* not enforced$/
      );
    } finally {
      await database.drop();
    }
  });
});

/**
 * PostgreSQL's catalog states a column's collation where it is not its type's
 * own, so an upgrade that changes only the collation is an operation.
 */
describe.runIf(process.env.TEST_POSTGRES_URL)("the PostgreSQL catalog", () => {
  it("reads a column whose collation changed as a change", async () => {
    const database = await makeScratchDatabase(
      "postgresql",
      { server: process.env.TEST_POSTGRES_URL },
      "_gate_collation"
    );
    try {
      await query("postgresql", database.url, "CREATE TABLE t (email text)");
      const before = await readCatalog("postgresql", database.url);
      await query(
        "postgresql",
        database.url,
        'ALTER TABLE t ALTER COLUMN email TYPE text COLLATE "C"'
      );
      expect(
        operationsBetween(before, await readCatalog("postgresql", database.url))
      ).toEqual([
        'change column t.email: text null -> text null collate pg_catalog."C"',
      ]);
    } finally {
      await database.drop();
    }
  });
});
