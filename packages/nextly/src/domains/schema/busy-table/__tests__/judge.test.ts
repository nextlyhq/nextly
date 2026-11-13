/**
 * Which statements a later try may send again after a try ends waiting for a busy table, and which
 * stop the run with no retry: one case per row of the table, on each dialect the row names, with a
 * statement of a kind no row names counted as no retry.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { firstNoRetry, judgeStatement, targetTable } from "../judge";

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

describe("judgeStatement on the calls a plain word reading would miss", () => {
  it.each([
    [
      "a schema-qualified function of the site's own",
      "UPDATE posts SET slug = public.make_slug(title)",
    ],
    ["a quoted function name", 'INSERT INTO posts (id) VALUES ("audit_fn"())'],
  ])("stops with no retry on %s", (_, statement) => {
    expect(judgeStatement(statement, "postgresql", () => false)).toEqual({
      kind: "no-retry",
      reason: "unknown-code",
    });
  });

  it("reads setval named through PostgreSQL's catalog as setval", () => {
    expect(
      judgeStatement(
        "UPDATE posts SET n = pg_catalog.setval('s', 1)",
        "postgresql",
        () => false
      )
    ).toEqual({ kind: "no-retry", reason: "setval" });
  });

  it("lets a built-in named through PostgreSQL's catalog run again", () => {
    expect(
      judgeStatement(
        "UPDATE posts SET title = pg_catalog.lower(title)",
        "postgresql",
        () => false
      )
    ).toEqual({ kind: "may-run-again" });
  });

  it.each([
    ["an index method", 'CREATE INDEX "posts_c" ON "posts" USING btree ("c")'],
    ["a gin index", 'CREATE INDEX "posts_d" ON "posts" USING gin ("d")'],
    [
      "an identity column",
      'CREATE TABLE "posts" ("id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "posts_id_seq" INCREMENT BY 1))',
    ],
    [
      "a storage parameter list",
      'CREATE INDEX "posts_e" ON "posts" ("e") WITH (fillfactor = 70)',
    ],
  ])("lets drizzle-kit's DDL run again: %s", (_, statement) => {
    expect(judgeStatement(statement, "postgresql", () => false)).toEqual({
      kind: "may-run-again",
    });
  });

  it.each([
    ["UPDATE ONLY posts SET x = 1"],
    ["DELETE FROM ONLY posts WHERE id = 1"],
  ])("checks the trigger of the table behind ONLY: %s", statement => {
    expect(
      judgeStatement(statement, "postgresql", table => table === "posts")
    ).toEqual({ kind: "no-retry", reason: "trigger" });
  });
});

describe("targetTable", () => {
  it.each([
    ["ALTER TABLE posts ADD COLUMN late integer", "posts"],
    ['ALTER TABLE IF EXISTS ONLY "Posts" ADD COLUMN c integer', "posts"],
    [
      "CREATE TABLE IF NOT EXISTS posts (author int REFERENCES users (id) ON DELETE CASCADE)",
      "posts",
    ],
    ["DROP TABLE IF EXISTS posts", "posts"],
    [
      "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ix ON ONLY posts (slug)",
      "posts",
    ],
    ["INSERT INTO posts (id) VALUES (1)", "posts"],
    ["UPDATE ONLY posts SET x = 1", "posts"],
    ["DELETE FROM posts WHERE id = 1", "posts"],
    ["SELECT 1", null],
  ])("reads %j as %j", (statement, table) => {
    expect(targetTable(statement, "postgresql")).toBe(table);
  });
});

describe("firstNoRetry", () => {
  const triggers = new Set(["audited"]);

  it("follows a table with a trigger through a rename earlier in the same change", () => {
    expect(
      firstNoRetry(
        [
          "ALTER TABLE audited RENAME TO audited_v2",
          "INSERT INTO audited_v2 (id) VALUES (1)",
          "ALTER TABLE busy ADD COLUMN late integer",
        ],
        "postgresql",
        triggers
      )
    ).toEqual({
      statementNumber: 2,
      judgement: { kind: "no-retry", reason: "trigger" },
    });
  });

  it("follows MySQL's RENAME TABLE, pair by pair", () => {
    expect(
      firstNoRetry(
        [
          "RENAME TABLE other TO other_v2, audited TO audited_v2",
          "UPDATE audited_v2 SET x = 1",
        ],
        "mysql",
        triggers
      )?.judgement
    ).toEqual({ kind: "no-retry", reason: "trigger" });
  });

  it("counts every table as having a trigger after a rename it cannot follow", () => {
    expect(
      firstNoRetry(
        [
          'ALTER TABLE audit.log RENAME TO "log_v2"',
          "INSERT INTO plain (id) VALUES (1)",
        ],
        "postgresql",
        triggers
      )?.statementNumber
    ).toBe(2);
  });

  it("counts every row change as firing a trigger where the triggers could not all be seen, and says so", () => {
    expect(
      firstNoRetry(
        ["ALTER TABLE plain ADD COLUMN late integer", "UPDATE plain SET x = 1"],
        "mysql",
        "unseen"
      )
    ).toEqual({
      statementNumber: 2,
      judgement: { kind: "no-retry", reason: "hidden-trigger" },
    });
  });

  it.each([
    "CREATE TABLE posts (id integer)",
    "ALTER TABLE posts ADD COLUMN late integer",
    "DROP INDEX posts_idx",
    "ALTER INDEX posts_idx RENAME TO posts_idx_v2",
  ])(
    "stops at a schema statement where PostgreSQL has a DDL event trigger: %s",
    statement => {
      expect(
        firstNoRetry(
          ["INSERT INTO plain (id) VALUES (1)", statement],
          "postgresql",
          triggers,
          { ddlEventTriggers: true }
        )
      ).toEqual({
        statementNumber: 2,
        judgement: { kind: "no-retry", reason: "event-trigger" },
      });
    }
  );

  it("does not stop at a kept rename read only to follow its table, where a DDL event trigger exists", () => {
    expect(
      firstNoRetry(
        ["ALTER TABLE plain RENAME TO plain_v2", "UPDATE plain_v2 SET x = 1"],
        "postgresql",
        triggers,
        { ddlEventTriggers: true, ddlEventTriggersFrom: 1 }
      )
    ).toBeUndefined();
  });

  it("lets a row change run again where only a DDL event trigger exists", () => {
    expect(
      firstNoRetry(
        ["INSERT INTO plain (id) VALUES (1)"],
        "postgresql",
        triggers,
        {
          ddlEventTriggers: true,
        }
      )
    ).toBeUndefined();
  });

  it("lets a change with no rename or trigger run again", () => {
    expect(
      firstNoRetry(
        [
          "ALTER TABLE plain RENAME COLUMN a TO b",
          "INSERT INTO plain (id) VALUES (1)",
          "ALTER TABLE busy ADD COLUMN late integer",
        ],
        "postgresql",
        triggers
      )
    ).toBeUndefined();
  });
});

describe("judgeStatement on what drizzle-kit and the migration generator write", () => {
  it.each([
    [
      "postgresql",
      'ALTER TABLE "posts" ADD CONSTRAINT "fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade',
    ],
    [
      "postgresql",
      'CREATE TABLE IF NOT EXISTS "public"."posts" ("id" integer)',
    ],
    [
      "postgresql",
      "ALTER TABLE posts ADD COLUMN at timestamp DEFAULT timezone('utc', now())",
    ],
    ["mysql", "CREATE INDEX idx ON posts (title(191))"],
    [
      "sqlite",
      "INSERT INTO guard (n) SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type = 'view' AND instr(sql, 'posts') > 0)",
    ],
    [
      "sqlite",
      "INSERT INTO fks (n) SELECT COUNT(*) FROM pragma_foreign_key_list('posts')",
    ],
  ] as const)("lets %s run again: %s", (dialect, statement) => {
    expect(judgeStatement(statement, dialect, () => false)).toEqual({
      kind: "may-run-again",
    });
  });

  it.each([
    ["mysql", "ALTER TABLE posts ADD INDEX idx (slug, title(191))"],
    ["mysql", "CREATE TABLE posts (title varchar(255), KEY k (title(191)))"],
    ["mysql", "ALTER TABLE posts ADD PRIMARY KEY (slug(100))"],
    ["mysql", "CREATE UNIQUE INDEX idx ON `posts` (`title`(191))"],
    ["mysql", "CREATE INDEX idx ON shop.posts (title(191))"],
    ["postgresql", "ALTER TABLE docs ADD COLUMN embedding vector(1536)"],
    ["postgresql", "CREATE TABLE docs (id integer, embedding vector(1536))"],
    ["postgresql", "ALTER TABLE docs ALTER COLUMN embedding TYPE vector(768)"],
  ] as const)(
    "reads an index prefix length as no call on %s: %s",
    (dialect, statement) => {
      expect(judgeStatement(statement, dialect, () => false)).toEqual({
        kind: "may-run-again",
      });
    }
  );

  it.each([
    [
      "postgresql",
      "ALTER TABLE posts ADD COLUMN marker integer DEFAULT site_fn(1)",
    ],
    [
      "mysql",
      "ALTER TABLE posts ADD COLUMN marker integer DEFAULT (site_fn(1))",
    ],
    [
      "sqlite",
      "ALTER TABLE posts ADD COLUMN marker integer DEFAULT site_fn(1)",
    ],
    ["postgresql", "CREATE INDEX idx ON posts (site_fn(1))"],
    ["postgresql", "CREATE TABLE posts (id integer CHECK (site_fn(1) > 0))"],
  ] as const)(
    "reads a function called with numbers in a schema statement as a call on %s: %s",
    (dialect, statement) => {
      expect(judgeStatement(statement, dialect, () => false)).toEqual({
        kind: "no-retry",
        reason: "unknown-code",
      });
    }
  );

  it("still reads a schema-qualified quoted call as a call", () => {
    expect(
      judgeStatement(
        'UPDATE posts SET slug = "audit"."make_slug"(title)',
        "postgresql",
        () => false
      )
    ).toEqual({ kind: "no-retry", reason: "unknown-code" });
  });

  it("names the table of a MySQL CREATE TABLE with an inline index and ON DELETE", () => {
    expect(
      targetTable(
        "CREATE TABLE posts (id int, a int, INDEX idx (a), FOREIGN KEY (a) REFERENCES users (id) ON DELETE CASCADE)",
        "mysql"
      )
    ).toBe("posts");
  });
});

describe("judgeStatement on a connection setting that runs code", () => {
  it.each(["mysql", "postgresql"] as const)(
    "stops with no retry on %s, since the next try would send it again first",
    dialect => {
      expect(
        judgeStatement("SET @x = site_function()", dialect, () => false)
      ).toEqual({ kind: "no-retry", reason: "unknown-code" });
    }
  );
});
