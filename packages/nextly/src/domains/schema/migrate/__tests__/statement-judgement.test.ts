/**
 * How `judgeStatements` reads each statement kind against a live schema, and
 * the verdict it gives, asserted on the whole judged list.
 *
 * The live schema is a fake that matches names EXACTLY against lower-cased
 * facts, so a judgement that forgets to fold a statement's names (a MySQL
 * backtick name, a quoted mixed-case name) asks for a name the fake does not
 * have and gets a different verdict. Each case is chosen so the plausible
 * broken judgements — every statement done, later statements ignored,
 * `IF [NOT] EXISTS` taken as done, a string literal copied into the label —
 * give a different list from the one asserted.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import {
  judgeStatements,
  type JudgedStatement,
  type LiveSchema,
  type UnknownReason,
} from "../statement-judgement";

/** Live facts, each `table` or `table.name`, all lower-case. */
interface Facts {
  tables?: string[];
  columns?: string[];
  indexes?: string[];
  constraints?: string[];
  /** Present objects the database cannot use, each `table.name`. */
  unusable?: string[];
}

/** A live schema answering exactly from `facts`, with no case folding. */
function fakeLive(facts: Facts): LiveSchema {
  const tables = new Set(facts.tables ?? []);
  const columns = new Set(facts.columns ?? []);
  const indexes = facts.indexes ?? [];
  const constraints = new Set(facts.constraints ?? []);
  return {
    hasTable: name => tables.has(name),
    hasColumn: (table, column) => columns.has(`${table}.${column}`),
    hasIndex: (name, table) =>
      table === undefined
        ? indexes.some(entry => entry.endsWith(`.${name}`))
        : indexes.includes(`${table}.${name}`),
    hasConstraint: (table, name) => constraints.has(`${table}.${name}`),
    usable: object =>
      !(facts.unusable ?? []).some(entry =>
        object.table === undefined
          ? entry.endsWith(`.${object.name}`)
          : entry === `${object.table}.${object.name}`
      ),
  };
}

/** One expected entry; `reason` given exactly when the verdict is unknown. */
function done(number: number, label: string): JudgedStatement {
  return { number, label, verdict: "done" };
}
function notDone(number: number, label: string): JudgedStatement {
  return { number, label, verdict: "not_done" };
}
function unknown(
  number: number,
  label: string,
  reason: UnknownReason
): JudgedStatement {
  return { number, label, verdict: "unknown", reason };
}

interface Case {
  name: string;
  dialect: SupportedDialect;
  statements: string[];
  live: Facts;
  expected: JudgedStatement[];
}

const CASES: Case[] = [
  // CREATE TABLE
  {
    name: "a created table that is there is done; the label keeps the quoted name",
    dialect: "postgresql",
    statements: ['CREATE TABLE "posts" (id int)'],
    live: { tables: ["posts"] },
    expected: [done(1, 'CREATE TABLE "posts"')],
  },
  {
    name: "a created table that is not there is not done",
    dialect: "postgresql",
    statements: ["CREATE TABLE posts (id int)"],
    live: { tables: [] },
    expected: [notDone(1, "CREATE TABLE posts")],
  },
  {
    name: "CREATE TABLE IF NOT EXISTS over a present table is conditional, over an absent one not done",
    dialect: "sqlite",
    statements: [
      "CREATE TABLE IF NOT EXISTS a (id int)",
      "CREATE TABLE IF NOT EXISTS b (id int)",
    ],
    live: { tables: ["a"] },
    expected: [
      unknown(1, "CREATE TABLE IF NOT EXISTS a", "conditional"),
      notDone(2, "CREATE TABLE IF NOT EXISTS b"),
    ],
  },
  {
    name: "a temporary table is unread; a table made from a query writes rows",
    dialect: "postgresql",
    statements: [
      "CREATE TEMP TABLE t (id int)",
      "CREATE TEMPORARY TABLE t (id int)",
      "CREATE TABLE t AS SELECT 1",
      "CREATE TABLE t (id int) WITH (fillfactor = 70)",
    ],
    live: { tables: ["t"] },
    expected: [
      unknown(1, "CREATE TEMP TABLE t", "unread"),
      unknown(2, "CREATE TEMPORARY TABLE t", "unread"),
      unknown(3, "CREATE TABLE t AS SELECT 1", "rows"),
      done(4, "CREATE TABLE t"),
    ],
  },
  {
    name: "MySQL's CREATE TABLE ... SELECT after the column list writes rows",
    dialect: "mysql",
    statements: ["CREATE TABLE `t` (id int) SELECT 1 AS id"],
    live: { tables: ["t"] },
    expected: [unknown(1, "CREATE TABLE `t`", "rows")],
  },

  // DROP TABLE
  {
    name: "DROP TABLE of several: all gone done, some gone mixed, none gone not done",
    dialect: "postgresql",
    statements: [
      "DROP TABLE a, b CASCADE",
      "DROP TABLE c, d",
      "DROP TABLE e, f RESTRICT",
    ],
    live: { tables: ["c", "e", "f"] },
    expected: [
      done(1, "DROP TABLE a, b CASCADE"),
      unknown(2, "DROP TABLE c, d", "mixed"),
      notDone(3, "DROP TABLE e, f RESTRICT"),
    ],
  },
  {
    name: "DROP TABLE IF EXISTS over an absent table is conditional",
    dialect: "mysql",
    statements: ["DROP TABLE IF EXISTS `gone`", "DROP TABLE IF EXISTS kept"],
    live: { tables: ["kept"] },
    expected: [
      unknown(1, "DROP TABLE IF EXISTS `gone`", "conditional"),
      notDone(2, "DROP TABLE IF EXISTS kept"),
    ],
  },

  // Table renames
  {
    name: "ALTER TABLE ... RENAME TO: done when only the new name is there",
    dialect: "sqlite",
    statements: [
      "ALTER TABLE old_a RENAME TO new_a",
      "ALTER TABLE old_b RENAME TO new_b",
    ],
    live: { tables: ["new_a", "old_b"] },
    expected: [
      done(1, "ALTER TABLE old_a RENAME TO new_a"),
      notDone(2, "ALTER TABLE old_b RENAME TO new_b"),
    ],
  },
  {
    name: "MySQL RENAME TABLE of two pairs, one renamed and one not, is mixed",
    dialect: "mysql",
    statements: ["RENAME TABLE `A` TO `B`, c TO d", "RENAME TABLE e TO f"],
    live: { tables: ["b", "c", "f"] },
    expected: [
      unknown(1, "RENAME TABLE `A` TO `B`, c TO d", "mixed"),
      done(2, "RENAME TABLE e TO f"),
    ],
  },
  {
    name: "RENAME TABLE is MySQL's: elsewhere it is unread",
    dialect: "postgresql",
    statements: ["RENAME TABLE e TO f"],
    live: { tables: ["f"] },
    expected: [unknown(1, "RENAME TABLE e TO f", "unread")],
  },
  {
    name: "a table rename beside another clause is unread",
    dialect: "mysql",
    statements: ["ALTER TABLE t ADD COLUMN c int, RENAME TO u"],
    live: { tables: ["u"], columns: ["u.c"] },
    expected: [
      unknown(1, "ALTER TABLE t ADD COLUMN c int, RENAME TO u", "unread"),
    ],
  },

  // ALTER TABLE column clauses
  {
    name: "a multi-clause ALTER: every clause holding is done, one not holding is mixed, none not done",
    dialect: "postgresql",
    statements: [
      "ALTER TABLE a ADD COLUMN c int NOT NULL DEFAULT 0, DROP COLUMN d",
      "ALTER TABLE b ADD COLUMN c numeric(10, 2), DROP COLUMN d CASCADE",
      "ALTER TABLE ONLY e ADD f int, DROP g",
    ],
    live: {
      tables: ["a", "b", "e"],
      columns: ["a.c", "b.c", "b.d", "e.g"],
    },
    expected: [
      done(1, "ALTER TABLE a ADD COLUMN c int NOT NULL DEFAULT 0, DROP COL…"),
      unknown(2, "ALTER TABLE b ADD COLUMN c numeric", "mixed"),
      notDone(3, "ALTER TABLE ONLY e ADD f int, DROP g"),
    ],
  },
  {
    name: "a conditional ADD undone by a later DROP is undone; DROP COLUMN IF EXISTS over a present column is not done",
    dialect: "postgresql",
    statements: [
      "ALTER TABLE t ADD COLUMN IF NOT EXISTS c int",
      "ALTER TABLE t DROP COLUMN IF EXISTS c",
      "ALTER TABLE IF EXISTS t ADD COLUMN d int",
    ],
    live: { tables: ["t"], columns: ["t.c"] },
    expected: [
      unknown(1, "ALTER TABLE t ADD COLUMN IF NOT EXISTS c int", "undone"),
      notDone(2, "ALTER TABLE t DROP COLUMN IF EXISTS c"),
      notDone(3, "ALTER TABLE IF EXISTS t ADD COLUMN d int"),
    ],
  },
  {
    name: "ADD COLUMN IF NOT EXISTS alone over a present column is conditional",
    dialect: "postgresql",
    statements: ["ALTER TABLE t ADD COLUMN IF NOT EXISTS c int"],
    live: { tables: ["t"], columns: ["t.c"] },
    expected: [
      unknown(1, "ALTER TABLE t ADD COLUMN IF NOT EXISTS c int", "conditional"),
    ],
  },
  {
    name: "MySQL backtick names are folded before they are looked up",
    dialect: "mysql",
    statements: ["ALTER TABLE `Posts` ADD COLUMN `Title` varchar(255)"],
    live: { tables: ["posts"], columns: ["posts.title"] },
    expected: [done(1, "ALTER TABLE `Posts` ADD COLUMN `Title` varchar")],
  },
  {
    name: "RENAME [COLUMN] a TO b: done when only b is there",
    dialect: "sqlite",
    statements: [
      "ALTER TABLE t RENAME COLUMN a TO b",
      "ALTER TABLE t RENAME c TO d",
    ],
    live: { tables: ["t"], columns: ["t.b", "t.c"] },
    expected: [
      done(1, "ALTER TABLE t RENAME COLUMN a TO b"),
      notDone(2, "ALTER TABLE t RENAME c TO d"),
    ],
  },
  {
    name: "MySQL CHANGE renames a column; a CHANGE that keeps the name is unread",
    dialect: "mysql",
    statements: [
      "ALTER TABLE t CHANGE COLUMN a b int NOT NULL",
      "ALTER TABLE x CHANGE c c bigint",
      "ALTER TABLE x RENAME e TO f",
    ],
    live: { tables: ["t"], columns: ["t.b", "t.c"] },
    expected: [
      done(1, "ALTER TABLE t CHANGE COLUMN a b int NOT NULL"),
      unknown(2, "ALTER TABLE x CHANGE c c bigint", "unread"),
      unknown(3, "ALTER TABLE x RENAME e TO f", "unread"),
    ],
  },

  // Constraints
  {
    name: "ADD CONSTRAINT of a named FK, UNIQUE or CHECK is judged; a primary key or a nameless constraint is unread",
    dialect: "postgresql",
    statements: [
      "ALTER TABLE t ADD CONSTRAINT t_fk FOREIGN KEY (u_id) REFERENCES u (id)",
      "ALTER TABLE t ADD CONSTRAINT t_uq UNIQUE (slug)",
      "ALTER TABLE t ADD CONSTRAINT t_ck CHECK (n > 0)",
      "ALTER TABLE x ADD CONSTRAINT t_pk PRIMARY KEY (id)",
      "ALTER TABLE x ADD UNIQUE (slug)",
      "ALTER TABLE x ADD PRIMARY KEY (id)",
    ],
    live: { tables: ["t"], constraints: ["t.t_fk", "t.t_ck"] },
    expected: [
      done(1, "ALTER TABLE t ADD CONSTRAINT t_fk FOREIGN KEY"),
      notDone(2, "ALTER TABLE t ADD CONSTRAINT t_uq UNIQUE"),
      done(3, "ALTER TABLE t ADD CONSTRAINT t_ck CHECK"),
      unknown(4, "ALTER TABLE x ADD CONSTRAINT t_pk PRIMARY KEY", "unread"),
      unknown(5, "ALTER TABLE x ADD UNIQUE", "unread"),
      unknown(6, "ALTER TABLE x ADD PRIMARY KEY", "unread"),
    ],
  },
  {
    name: "DROP CONSTRAINT [IF EXISTS], and MySQL's DROP FOREIGN KEY and DROP CHECK",
    dialect: "mysql",
    statements: [
      "ALTER TABLE t DROP CONSTRAINT IF EXISTS a",
      "ALTER TABLE t DROP FOREIGN KEY b",
      "ALTER TABLE t DROP CHECK c",
      "ALTER TABLE t DROP CONSTRAINT d",
      "ALTER TABLE x DROP PRIMARY KEY",
    ],
    live: { tables: ["t"], constraints: ["t.c", "t.d"] },
    expected: [
      unknown(1, "ALTER TABLE t DROP CONSTRAINT IF EXISTS a", "conditional"),
      done(2, "ALTER TABLE t DROP FOREIGN KEY b"),
      notDone(3, "ALTER TABLE t DROP CHECK c"),
      notDone(4, "ALTER TABLE t DROP CONSTRAINT d"),
      unknown(5, "ALTER TABLE x DROP PRIMARY KEY", "unread"),
    ],
  },

  // Indexes
  {
    name: "MySQL ADD [UNIQUE] INDEX|KEY, DROP INDEX|KEY and RENAME INDEX",
    dialect: "mysql",
    statements: [
      "ALTER TABLE t ADD UNIQUE INDEX a (c)",
      "ALTER TABLE t ADD KEY b (c)",
      "ALTER TABLE t DROP INDEX x",
      "ALTER TABLE t DROP KEY y",
      "ALTER TABLE t RENAME INDEX p TO q",
      "ALTER TABLE x ADD INDEX (c)",
    ],
    live: { tables: ["t"], indexes: ["t.a", "t.y", "t.q"] },
    expected: [
      done(1, "ALTER TABLE t ADD UNIQUE INDEX a"),
      notDone(2, "ALTER TABLE t ADD KEY b"),
      done(3, "ALTER TABLE t DROP INDEX x"),
      notDone(4, "ALTER TABLE t DROP KEY y"),
      done(5, "ALTER TABLE t RENAME INDEX p TO q"),
      unknown(6, "ALTER TABLE x ADD INDEX", "unread"),
    ],
  },
  {
    name: "CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] n ON [ONLY] t; a nameless one is unread",
    dialect: "postgresql",
    statements: [
      "CREATE INDEX ON t (c)",
      "CREATE UNIQUE INDEX CONCURRENTLY a ON ONLY t (c)",
      "CREATE INDEX IF NOT EXISTS b ON t (c)",
      "CREATE INDEX z ON t (c)",
    ],
    live: { tables: ["t"], indexes: ["t.a", "t.b"] },
    expected: [
      unknown(1, "CREATE INDEX ON t", "unread"),
      done(2, "CREATE UNIQUE INDEX CONCURRENTLY a ON ONLY t"),
      unknown(3, "CREATE INDEX IF NOT EXISTS b ON t", "conditional"),
      notDone(4, "CREATE INDEX z ON t"),
    ],
  },
  {
    name: "DROP INDEX with no table is judged by the name anywhere; MySQL's names its table",
    dialect: "postgresql",
    statements: [
      "DROP INDEX CONCURRENTLY IF EXISTS gone",
      "DROP INDEX kept CASCADE",
      'DROP INDEX "Mixed"',
    ],
    live: { tables: ["t"], indexes: ["t.kept", "t.mixed"] },
    expected: [
      unknown(1, "DROP INDEX CONCURRENTLY IF EXISTS gone", "conditional"),
      notDone(2, "DROP INDEX kept CASCADE"),
      notDone(3, 'DROP INDEX "Mixed"'),
    ],
  },
  {
    name: "MySQL DROP INDEX n ON t reads the index on that table only",
    dialect: "mysql",
    statements: ["DROP INDEX i ON b", "DROP INDEX j ON a"],
    live: { tables: ["a", "b"], indexes: ["a.i", "b.j"] },
    expected: [done(1, "DROP INDEX i ON b"), done(2, "DROP INDEX j ON a")],
  },
  {
    name: "an index is keyed by its name alone, so a later statement on a same-named index undoes an earlier one",
    dialect: "mysql",
    statements: ["DROP INDEX i ON a", "DROP INDEX i ON b"],
    live: { tables: ["a", "b"], indexes: ["a.i"] },
    expected: [
      unknown(1, "DROP INDEX i ON a", "undone"),
      done(2, "DROP INDEX i ON b"),
    ],
  },

  // Rows
  {
    name: "every statement that reads or writes rows is unknown for rows, whatever the schema",
    dialect: "postgresql",
    statements: [
      "INSERT INTO seed (id) VALUES ('x')",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "SELECT setval('s', 5)",
      "WITH x AS (SELECT 1) SELECT * FROM x",
      "TRUNCATE t",
      "COPY t FROM STDIN",
      "CALL p()",
      "DO $$ BEGIN PERFORM 1; END $$",
      "MERGE INTO t USING u ON t.id = u.id WHEN MATCHED THEN DELETE",
      "VALUES (1)",
    ],
    live: { tables: ["t", "seed"] },
    expected: [
      unknown(1, "INSERT INTO seed", "rows"),
      unknown(2, "UPDATE t SET a = 1", "rows"),
      unknown(3, "DELETE FROM t", "rows"),
      unknown(4, "SELECT setval", "rows"),
      unknown(5, "WITH x AS", "rows"),
      unknown(6, "TRUNCATE t", "rows"),
      unknown(7, "COPY t FROM STDIN", "rows"),
      unknown(8, "CALL p", "rows"),
      unknown(9, "DO", "rows"),
      unknown(
        10,
        "MERGE INTO t USING u ON t.id = u.id WHEN MATCHED THEN DELETE",
        "rows"
      ),
      unknown(11, "VALUES", "rows"),
    ],
  },
  {
    name: "MySQL's REPLACE and LOAD write rows",
    dialect: "mysql",
    statements: [
      "REPLACE INTO t (id) VALUES (1)",
      "LOAD DATA INFILE 'f' INTO TABLE t",
    ],
    live: { tables: ["t"] },
    expected: [
      unknown(1, "REPLACE INTO t", "rows"),
      unknown(2, "LOAD DATA INFILE", "rows"),
    ],
  },

  // Unread
  {
    name: "statements and clauses with no modelled reading are unread",
    dialect: "postgresql",
    statements: [
      "CREATE VIEW v AS SELECT 1",
      "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql",
      "CREATE TRIGGER tr AFTER INSERT ON t FOR EACH ROW EXECUTE FUNCTION f()",
      "ALTER TABLE t ALTER COLUMN c TYPE text",
      "ALTER TABLE t ALTER COLUMN c SET NOT NULL",
      "ALTER TABLE t ADD COLUMN d int, ALTER COLUMN c DROP DEFAULT",
      "SET search_path TO public",
      "COMMENT ON TABLE t IS 'note'",
      "GRANT SELECT ON t TO someone",
      "CREATE TABLE public.t (id int)",
      'ALTER TABLE "s"."t" ADD COLUMN c int',
      'DROP TABLE t, "s"."u"',
    ],
    live: { tables: ["t"], columns: ["t.c", "t.d"] },
    expected: [
      unknown(1, "CREATE VIEW v AS SELECT 1", "unread"),
      unknown(2, "CREATE OR REPLACE FUNCTION f", "unread"),
      unknown(
        3,
        "CREATE TRIGGER tr AFTER INSERT ON t FOR EACH ROW EXECUTE FU…",
        "unread"
      ),
      unknown(4, "ALTER TABLE t ALTER COLUMN c TYPE text", "unread"),
      unknown(5, "ALTER TABLE t ALTER COLUMN c SET NOT NULL", "unread"),
      unknown(
        6,
        "ALTER TABLE t ADD COLUMN d int, ALTER COLUMN c DROP DEFAULT",
        "unread"
      ),
      unknown(7, "SET search_path TO public", "unread"),
      unknown(8, "COMMENT ON TABLE t IS", "unread"),
      unknown(9, "GRANT SELECT ON t TO someone", "unread"),
      unknown(10, "CREATE TABLE public.t", "unread"),
      unknown(11, 'ALTER TABLE "s"."t" ADD COLUMN c int', "unread"),
      unknown(12, 'DROP TABLE t, "s"."u"', "unread"),
    ],
  },
  {
    name: "MySQL MODIFY and a backtick-qualified name are unread",
    dialect: "mysql",
    statements: [
      "ALTER TABLE t MODIFY c bigint",
      "ALTER TABLE `db`.`t` DROP COLUMN c",
    ],
    live: { tables: ["t"], columns: ["t.c"] },
    expected: [
      unknown(1, "ALTER TABLE t MODIFY c bigint", "unread"),
      unknown(2, "ALTER TABLE `db`.`t` DROP COLUMN c", "unread"),
    ],
  },
  {
    name: "SQLite PRAGMA is unread",
    dialect: "sqlite",
    statements: ["PRAGMA foreign_keys = OFF"],
    live: {},
    expected: [unknown(1, "PRAGMA foreign_keys = OFF", "unread")],
  },

  // Later statements
  {
    name: "a statement a later one changes the object of is undone; one on a different object is not",
    dialect: "postgresql",
    statements: [
      "CREATE TABLE t (id int)",
      "CREATE INDEX i ON t (id)",
      "ALTER TABLE t ADD COLUMN c int",
      "ALTER TABLE t RENAME COLUMN c TO d",
      "CREATE TABLE gone (id int)",
      "DROP TABLE gone",
    ],
    live: { tables: ["t"], columns: ["t.id", "t.d"], indexes: ["t.i"] },
    expected: [
      done(1, "CREATE TABLE t"),
      done(2, "CREATE INDEX i ON t"),
      unknown(3, "ALTER TABLE t ADD COLUMN c int", "undone"),
      done(4, "ALTER TABLE t RENAME COLUMN c TO d"),
      unknown(5, "CREATE TABLE gone", "undone"),
      done(6, "DROP TABLE gone"),
    ],
  },
  {
    name: "a later statement that writes rows does not undo an earlier one; an unread ALTER of another table does not either",
    dialect: "postgresql",
    statements: [
      "CREATE TABLE t (id int)",
      "INSERT INTO t (id) VALUES (1)",
      "ALTER TABLE x ALTER COLUMN id TYPE bigint",
    ],
    live: { tables: ["t"] },
    expected: [
      done(1, "CREATE TABLE t"),
      unknown(2, "INSERT INTO t", "rows"),
      unknown(3, "ALTER TABLE x ALTER COLUMN id TYPE bigint", "unread"),
    ],
  },
  {
    name: "a column, index or constraint on a table the database lacks is no_table",
    dialect: "mysql",
    statements: [
      "ALTER TABLE missing ADD COLUMN c int",
      "ALTER TABLE missing DROP COLUMN d",
      "CREATE INDEX i ON missing (c)",
      "ALTER TABLE missing DROP FOREIGN KEY fk",
    ],
    live: { tables: [] },
    expected: [
      unknown(1, "ALTER TABLE missing ADD COLUMN c int", "no_table"),
      unknown(2, "ALTER TABLE missing DROP COLUMN d", "no_table"),
      unknown(3, "CREATE INDEX i ON missing", "no_table"),
      unknown(4, "ALTER TABLE missing DROP FOREIGN KEY fk", "no_table"),
    ],
  },
  {
    name: "a SQLite rebuild killed after its DROP",
    dialect: "sqlite",
    statements: [
      "CREATE TABLE `__new_t` (`id` integer PRIMARY KEY, `c` text)",
      "INSERT INTO `__new_t`(`id`, `c`) SELECT `id`, `c` FROM `t`",
      "DROP TABLE `t`",
      "ALTER TABLE `__new_t` RENAME TO `t`",
      "CREATE INDEX `i` ON `t` (`c`)",
    ],
    live: { tables: ["__new_t"], columns: ["__new_t.id", "__new_t.c"] },
    expected: [
      unknown(1, "CREATE TABLE `__new_t`", "undone"),
      unknown(2, "INSERT INTO `__new_t`", "rows"),
      unknown(3, "DROP TABLE `t`", "undone"),
      notDone(4, "ALTER TABLE `__new_t` RENAME TO `t`"),
      unknown(5, "CREATE INDEX `i` ON `t`", "no_table"),
    ],
  },
  {
    name: "the same SQLite rebuild run to the end",
    dialect: "sqlite",
    statements: [
      "CREATE TABLE `__new_t` (`id` integer PRIMARY KEY, `c` text)",
      "INSERT INTO `__new_t`(`id`, `c`) SELECT `id`, `c` FROM `t`",
      "DROP TABLE `t`",
      "ALTER TABLE `__new_t` RENAME TO `t`",
      "CREATE INDEX `i` ON `t` (`c`)",
    ],
    live: { tables: ["t"], columns: ["t.id", "t.c"], indexes: ["t.i"] },
    expected: [
      unknown(1, "CREATE TABLE `__new_t`", "undone"),
      unknown(2, "INSERT INTO `__new_t`", "rows"),
      unknown(3, "DROP TABLE `t`", "undone"),
      done(4, "ALTER TABLE `__new_t` RENAME TO `t`"),
      done(5, "CREATE INDEX `i` ON `t`"),
    ],
  },
  {
    name: "a constraint clause on SQLite, which has none to add or drop, is unread",
    dialect: "sqlite",
    statements: ["ALTER TABLE t DROP CONSTRAINT c"],
    live: { tables: ["t"] },
    expected: [unknown(1, "ALTER TABLE t DROP CONSTRAINT c", "unread")],
  },
  // An object present but unusable: a failed CREATE INDEX CONCURRENTLY's
  // index, a constraint not validated.
  {
    name: "an index left invalid is neither the index a CREATE made nor gone",
    dialect: "postgresql",
    statements: ["CREATE INDEX CONCURRENTLY i ON t (c)", "DROP INDEX i"],
    live: { tables: ["t"], indexes: ["t.i"], unusable: ["t.i"] },
    expected: [
      unknown(1, "CREATE INDEX CONCURRENTLY i ON t", "undone"),
      notDone(2, "DROP INDEX i"),
    ],
  },
  {
    name: "a CREATE INDEX over an invalid index of its name is not done",
    dialect: "postgresql",
    statements: ["CREATE UNIQUE INDEX CONCURRENTLY i ON t (c)"],
    live: { tables: ["t"], indexes: ["t.i"], unusable: ["t.i"] },
    expected: [notDone(1, "CREATE UNIQUE INDEX CONCURRENTLY i ON t")],
  },
  {
    name: "a validating ADD CONSTRAINT over an unvalidated constraint is not done; NOT VALID is done; VALIDATE is unread",
    dialect: "postgresql",
    statements: [
      "ALTER TABLE t ADD CONSTRAINT a CHECK (n > 0)",
      "ALTER TABLE t ADD CONSTRAINT b CHECK (n > 0) NOT VALID",
      "ALTER TABLE x VALIDATE CONSTRAINT c",
    ],
    live: {
      tables: ["t", "x"],
      constraints: ["t.a", "t.b", "x.c"],
      unusable: ["t.a", "t.b", "x.c"],
    },
    expected: [
      notDone(1, "ALTER TABLE t ADD CONSTRAINT a CHECK"),
      done(2, "ALTER TABLE t ADD CONSTRAINT b CHECK"),
      unknown(3, "ALTER TABLE x VALIDATE CONSTRAINT c", "unread"),
    ],
  },
  // A later statement whose reach is not read: every earlier claim is unknown.
  {
    name: "an index a later ALTER INDEX renames is undone, not read as never made",
    dialect: "postgresql",
    statements: ["CREATE INDEX i ON t (c)", "ALTER INDEX i RENAME TO j"],
    live: { tables: ["t"], indexes: ["t.j"] },
    expected: [
      unknown(1, "CREATE INDEX i ON t", "undone"),
      unknown(2, "ALTER INDEX i RENAME TO j", "unread"),
    ],
  },
  {
    name: "a later DO block undoes every earlier claim; a later setting or row write does not",
    dialect: "postgresql",
    statements: [
      "CREATE TABLE a (id int)",
      "SET LOCAL lock_timeout = '5s'",
      "INSERT INTO a (id) VALUES (1)",
      "CREATE TABLE b (id int)",
      "DO $$ BEGIN EXECUTE 'DROP TABLE a'; END $$",
      "CREATE TABLE c (id int)",
    ],
    live: { tables: ["b", "c"] },
    expected: [
      unknown(1, "CREATE TABLE a", "undone"),
      unknown(2, "SET LOCAL lock_timeout =", "unread"),
      unknown(3, "INSERT INTO a", "rows"),
      unknown(4, "CREATE TABLE b", "undone"),
      unknown(5, "DO", "rows"),
      done(6, "CREATE TABLE c"),
    ],
  },
  {
    name: "a setting after a statement leaves it judged",
    dialect: "sqlite",
    statements: ["CREATE TABLE a (id int)", "PRAGMA foreign_keys=ON"],
    live: { tables: ["a"] },
    expected: [
      done(1, "CREATE TABLE a"),
      unknown(2, "PRAGMA foreign_keys=ON", "unread"),
    ],
  },
  {
    name: "a PostgreSQL U& name, which this reading does not decode, is unread",
    dialect: "postgresql",
    statements: ['CREATE TABLE U&"d\\0061t" (id int)'],
    live: { tables: ["dat"] },
    expected: [unknown(1, 'CREATE TABLE U&"d\\0061t"', "unread")],
  },
  // A later statement read as rows or unread that still names its table.
  {
    name: "a table a later CREATE TABLE ... AS makes again is undone, not read as never dropped",
    dialect: "mysql",
    statements: [
      "DROP TABLE IF EXISTS posts_backup",
      "CREATE TABLE posts_backup AS SELECT * FROM posts",
    ],
    // Both ran: the backup is there again.
    live: { tables: ["posts", "posts_backup"] },
    expected: [
      unknown(1, "DROP TABLE IF EXISTS posts_backup", "undone"),
      unknown(2, "CREATE TABLE posts_backup AS SELECT * FROM posts", "rows"),
    ],
  },
  {
    name: "a column a later ALTER with an unread clause changes is undone, not read as never added",
    dialect: "postgresql",
    statements: [
      "ALTER TABLE t ADD COLUMN c int",
      "ALTER TABLE t DROP COLUMN c, ADD PRIMARY KEY (id)",
    ],
    live: { tables: ["t"] },
    expected: [
      unknown(1, "ALTER TABLE t ADD COLUMN c int", "undone"),
      unknown(2, "ALTER TABLE t DROP COLUMN c, ADD PRIMARY KEY", "unread"),
    ],
  },
];

describe("judgeStatements", () => {
  it.each(CASES)("$name", ({ dialect, statements, live, expected }) => {
    expect(judgeStatements(statements, dialect, fakeLive(live))).toEqual(
      expected
    );
  });

  it("judges no claim when the live schema could not be read", () => {
    expect(
      judgeStatements(
        ["CREATE TABLE t (id int)", "INSERT INTO t (id) VALUES (1)"],
        "postgresql",
        undefined
      )
    ).toEqual([
      unknown(1, "CREATE TABLE t", "unread"),
      unknown(2, "INSERT INTO t", "rows"),
    ]);
  });

  it("returns nothing for no statements", () => {
    expect(judgeStatements([], "postgresql", fakeLive({}))).toEqual([]);
  });
});

describe("statement labels", () => {
  /** The labels alone, of statements whose verdicts are not the subject. */
  function labels(statements: string[], dialect: SupportedDialect): string[] {
    return judgeStatements(statements, dialect, fakeLive({})).map(
      judged => judged.label
    );
  }

  it("never carry a string literal's content, on any dialect", () => {
    const statements = [
      "UPDATE users SET password = 'hunter2' WHERE id = 1",
      "-- seed\nDELETE FROM t WHERE note = 'Dr. Who'",
      "DO $body$ BEGIN RAISE NOTICE 'secret'; END $body$",
      "INSERT INTO t VALUES (1, 'secret')",
    ];
    expect(labels(statements, "postgresql")).toEqual([
      "UPDATE users SET password =",
      "DELETE FROM t WHERE note =",
      "DO",
      "INSERT INTO t VALUES",
    ]);
    // MySQL reads "..." as a string, PostgreSQL as a name.
    expect(labels(['UPDATE t SET a = "secret"'], "mysql")).toEqual([
      "UPDATE t SET a =",
    ]);
    expect(labels(['UPDATE t SET "secret" = 1'], "postgresql")).toEqual([
      'UPDATE t SET "secret" = 1',
    ]);
  });

  it("skip comments, collapse whitespace and close up a '. '", () => {
    expect(
      labels(
        [
          "/* why */ DROP\n\t TABLE   t -- trailing",
          "SELECT 1. 5",
          "UPDATE t SET a = 1;",
        ],
        "postgresql"
      )
    ).toEqual(["DROP TABLE t", "SELECT 1.5", "UPDATE t SET a = 1"]);
  });

  it("stop at the first parenthesis and cap at 60 characters", () => {
    const long = `ALTER TABLE t ADD COLUMN ${"x".repeat(80)} int`;
    const [label] = labels([long], "postgresql");
    expect(label).toBe(`ALTER TABLE t ADD COLUMN ${"x".repeat(34)}…`);
    expect(label).toHaveLength(60);
    expect(labels(["CALL p('secret')"], "mysql")).toEqual(["CALL p"]);
  });
});
