/**
 * Which statements a later try may send again after a try ends waiting for a busy table, and which
 * stop the run with no retry: one case per row of the table, on each dialect the row names, with a
 * statement of a kind no row names counted as no retry.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { judgeStatement } from "../judge";

const DIALECTS: readonly SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** No table in these cases has a trigger, unless a case says so. */
const noTriggers = () => false;

const verdict = (statement: string, dialect: SupportedDialect) =>
  judgeStatement(statement, dialect, noTriggers);

describe("judgeStatement", () => {
  describe.each(DIALECTS)("on %s", dialect => {
    it.each([
      [
        "create a table",
        "CREATE TABLE posts (id integer PRIMARY KEY, title varchar(64))",
      ],
      [
        "add a column with a plain default",
        "ALTER TABLE posts ADD COLUMN late varchar(64) DEFAULT 'x'",
      ],
      [
        "add a column defaulting to now()",
        "ALTER TABLE posts ADD COLUMN at timestamp DEFAULT now()",
      ],
      [
        "add a numeric column",
        "ALTER TABLE posts ADD COLUMN price numeric(10, 2)",
      ],
      ["drop a column", "ALTER TABLE posts DROP COLUMN late"],
      ["create an index", "CREATE INDEX posts_title ON posts (title)"],
      [
        "create a unique index",
        "CREATE UNIQUE INDEX posts_slug ON posts (slug)",
      ],
      ["drop an index", "DROP INDEX posts_title"],
      ["drop a table", "DROP TABLE posts"],
      [
        "add a foreign key",
        "ALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (author) REFERENCES users (id)",
      ],
      ["insert a row", "INSERT INTO posts (id, title) VALUES (1, 'a')"],
      [
        "insert with built-in functions",
        "INSERT INTO posts (id, title) VALUES (1, lower(coalesce('A', 'b')))",
      ],
      [
        "update rows",
        "UPDATE posts SET title = upper(title) WHERE id IN (1, 2)",
      ],
      ["delete rows", "DELETE FROM posts WHERE id = 1"],
    ])("lets a try run again: %s", (_, statement) => {
      expect(verdict(statement, dialect)).toEqual({ kind: "may-run-again" });
    });

    it.each([
      [
        "a call of a function of the site's own",
        "INSERT INTO posts (id) VALUES (my_fn(1))",
      ],
      [
        "a default from a function of the site's own",
        "ALTER TABLE posts ADD COLUMN c integer DEFAULT site_seq()",
      ],
    ])("stops with no retry on %s", (_, statement) => {
      expect(verdict(statement, dialect)).toEqual({
        kind: "no-retry",
        reason: "unknown-code",
      });
    });

    it("stops with no retry on a row change whose table has a trigger", () => {
      expect(
        judgeStatement(
          "UPDATE posts SET title = 'a'",
          dialect,
          table => table === "posts"
        )
      ).toEqual({ kind: "no-retry", reason: "trigger" });
    });

    it.each([
      ["a view", "CREATE VIEW v AS SELECT 1"],
      ["a plain read", "SELECT 1"],
      ["a statement no row names", "GRANT SELECT ON posts TO someone"],
      ["an empty statement", ""],
    ])("counts %s as no retry", (_, statement) => {
      expect(verdict(statement, dialect)).toEqual({
        kind: "no-retry",
        reason: "unread",
      });
    });
  });

  describe("on postgresql", () => {
    it.each([
      ["a sequence's next value", "SELECT nextval('posts_id_seq')"],
      ["a setting", "SET LOCAL statement_timeout = '30s'"],
      ["a session setting", "SET search_path TO public"],
    ])("lets a try run again: %s", (_, statement) => {
      expect(verdict(statement, "postgresql")).toEqual({
        kind: "may-run-again",
      });
    });

    it("stops with no retry on setval, which a rollback keeps", () => {
      expect(
        verdict(
          "SELECT setval('posts_id_seq', (SELECT max(id) FROM posts))",
          "postgresql"
        )
      ).toEqual({ kind: "no-retry", reason: "setval" });
    });

    it.each([
      ["building an index", "CREATE INDEX CONCURRENTLY ix ON posts (title)"],
      [
        "building a unique index",
        "CREATE UNIQUE INDEX CONCURRENTLY ix ON posts (slug)",
      ],
      ["dropping an index", "DROP INDEX CONCURRENTLY ix"],
    ])("stops with no retry on %s without blocking writes", (_, statement) => {
      expect(verdict(statement, "postgresql")).toEqual({
        kind: "no-retry",
        reason: "concurrent-index",
      });
    });

    it.each([
      ["an anonymous code block", "DO $$ BEGIN PERFORM 1; END $$"],
      ["a procedure", "CALL refresh_all()"],
      ["ending another session", "SELECT pg_terminate_backend(42)"],
      [
        "a write through a link",
        "SELECT dblink_exec('other', 'DELETE FROM t')",
      ],
    ])("stops with no retry on %s", (_, statement) => {
      expect(verdict(statement, "postgresql").kind).toBe("no-retry");
    });
  });

  describe("on mysql", () => {
    it.each([
      ["a session setting", "SET SESSION sql_mode = 'STRICT_ALL_TABLES'"],
      ["a rename", "RENAME TABLE posts TO articles"],
      [
        "a keyed column list",
        "ALTER TABLE posts ADD UNIQUE KEY uk (slug), ADD INDEX ix (title)",
      ],
      ["an enum column", "ALTER TABLE posts ADD COLUMN state enum('a', 'b')"],
    ])("lets a try run again: %s", (_, statement) => {
      expect(verdict(statement, "mysql")).toEqual({ kind: "may-run-again" });
    });

    it("stops with no retry on a stored function of the site's own in the waiting statement", () => {
      expect(
        verdict("UPDATE posts SET title = site_title(id)", "mysql")
      ).toEqual({ kind: "no-retry", reason: "unknown-code" });
    });
  });

  describe("on sqlite", () => {
    it("lets a try run again after the connection's foreign-key setting", () => {
      expect(verdict("PRAGMA foreign_keys = OFF", "sqlite")).toEqual({
        kind: "may-run-again",
      });
    });

    it("counts any other PRAGMA as no retry", () => {
      expect(verdict("PRAGMA journal_mode = WAL", "sqlite")).toEqual({
        kind: "no-retry",
        reason: "unread",
      });
    });
  });
});
