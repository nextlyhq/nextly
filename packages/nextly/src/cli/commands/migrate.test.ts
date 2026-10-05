// Plan C2: `nextly migrate` is now Phase 0/1/2 over `nextly_schema_events`.
// The old F11 ledger internals (recordMigration, findPendingMigrations) are
// gone; their logic is replaced by Phase 1/2 which is unit-tested in
// domains/schema/migrate/{core-reconcile,drift-reconcile}.test.ts. This file
// now pins the command registration surface.

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { executeTransaction } from "../../domains/schema/migrate/migration-transaction";
import {
  assertRunnableStatements,
  statementRefusals,
} from "../../domains/schema/migrate/split-sql";

import { registerMigrateCommand, splitSqlStatements } from "./migrate";

describe("registerMigrateCommand", () => {
  it("registers the migrate command with --dry-run and --step", () => {
    const program = new Command();
    registerMigrateCommand(program);

    const migrate = program.commands.find(c => c.name() === "migrate");
    expect(migrate).toBeDefined();

    const longFlags = migrate!.options.map(o => o.long);
    expect(longFlags).toContain("--dry-run");
    expect(longFlags).toContain("--step");
  });
});

describe("splitSqlStatements", () => {
  // A comment mentioning a DDL keyword survives the line filter, so its prose
  // reaches the scanner. An apostrophe there is prose, not an opening quote:
  // counted as one it opens a string that never closes, which stops every later
  // semicolon from separating statements and hands the driver one merged
  // statement it rejects.
  it("does not let an apostrophe in a comment merge the statements after it", () => {
    const sql = [
      `CREATE TABLE "a" ("id" TEXT);`,
      `-- SQLite doesn't support FK constraints inline; add via ALTER TABLE`,
      `CREATE TABLE "b" ("id" TEXT);`,
      `CREATE INDEX "i" ON "b" ("id");`,
    ].join("\n");

    const statements = splitSqlStatements(sql);

    // Each DDL statement lands in its own chunk. Asserted by which statement is
    // where rather than by count alone, since three chunks split at the wrong
    // points would also be three.
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('CREATE TABLE "a"');
    expect(statements[1]).toContain('CREATE TABLE "b"');
    expect(statements[2]).toContain('CREATE INDEX "i"');
    // The merge this guards against puts two DDL statements in one chunk.
    for (const statement of statements) {
      expect(statement.match(/\bCREATE\b/g)).toHaveLength(1);
    }
  });

  it("still treats an apostrophe in a string literal as a string", () => {
    const sql = `INSERT INTO "t" ("v") VALUES ('a;b');\nCREATE TABLE "u" ("id" TEXT);`;

    const statements = splitSqlStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
  });

  it("does not split on a semicolon inside a block comment", () => {
    const sql = `/* first; second */\nCREATE TABLE "a" ("id" TEXT);`;

    expect(splitSqlStatements(sql)).toHaveLength(1);
  });
  // MySQL starts a `--` comment only when the next character is whitespace or a
  // control character, so `n--1` is arithmetic. Treating it as a comment would
  // swallow the line's semicolon and merge the next statement into this one,
  // which the driver rejects as a multi-statement query.
  it("does not treat `--` as a comment on mysql when no whitespace follows", () => {
    const sql = [
      `UPDATE "t" SET "n" = 5--1;`,
      `CREATE TABLE "a" ("id" TEXT);`,
    ].join("\n");

    const statements = splitSqlStatements(sql, "mysql");

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("5--1");
    expect(statements[1]).toContain('CREATE TABLE "a"');
  });

  // The same text on postgres IS a comment, so the two dialects must disagree
  // here. Asserted in both directions, because a predicate that always returned
  // one answer would satisfy either test on its own.
  it("treats the same `--` as a comment on postgres", () => {
    const sql = [
      `UPDATE "t" SET "n" = 5--1;`,
      `CREATE TABLE "a" ("id" TEXT);`,
    ].join("\n");

    // The comment runs to end of line and takes the semicolon with it, so the
    // UPDATE and the CREATE arrive as one chunk.
    expect(splitSqlStatements(sql, "postgresql")).toHaveLength(1);
  });

  it("still comments on mysql when whitespace follows the dashes", () => {
    const sql = [
      `CREATE TABLE "a" ("id" TEXT);`,
      `-- MySQL doesn't mind an apostrophe here; it is still a comment`,
      `CREATE TABLE "b" ("id" TEXT);`,
    ].join("\n");

    const statements = splitSqlStatements(sql, "mysql");

    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('CREATE TABLE "b"');
  });
  // SQLite reads `[a--b]` as a quoted identifier, so the dashes inside it are
  // not a comment opener. Missing that swallowed the statement's semicolon and
  // merged the next statement into the same chunk.
  it("does not read a comment inside a sqlite bracket-quoted identifier", () => {
    const sql = [
      `CREATE TABLE [a--b] ("id" TEXT);`,
      `CREATE TABLE "c" ("id" TEXT);`,
    ].join("\n");

    const statements = splitSqlStatements(sql, "sqlite");

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("[a--b]");
    expect(statements[1]).toContain('CREATE TABLE "c"');
  });

  it("does not read a comment inside a mysql backtick-quoted identifier", () => {
    const sql = [
      "CREATE TABLE `a--b` (`id` TEXT);",
      "CREATE TABLE `c` (`id` TEXT);",
    ].join("\n");

    const statements = splitSqlStatements(sql, "mysql");

    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("`c`");
  });

  // `[` is an array subscript in Postgres rather than a quote, so treating it as
  // one there would swallow ordinary SQL. This pins the dialects apart.
  it("treats a bracket as ordinary SQL on postgres", () => {
    const sql = [
      `CREATE TABLE "a" ("tags" text[]);`,
      `CREATE TABLE "b" ("id" TEXT);`,
    ].join("\n");

    expect(splitSqlStatements(sql, "postgresql")).toHaveLength(2);
  });
});

describe("splitting a statement whose value ends in a backslash", () => {
  it("closes the quote when the backslash run is EVEN", () => {
    // 🔴 A doubled backslash is ONE literal backslash — how MySQL escaping
    // writes a value ending in one — so it sits immediately before the closing
    // quote. Reading only that last character calls the quote escaped, leaves
    // the splitter inside a string it has left, swallows the semicolon and
    // concatenates the next statement. A driver with multi-statements disabled
    // then rejects the pair, after earlier statements in the file have run.
    const sql = [
      `INSERT INTO t (d) VALUES ('ends with a backslash \\\\');`,
      `INSERT INTO u (d) VALUES ('second');`,
    ].join("\n");
    expect(splitSqlStatements(sql, "mysql")).toHaveLength(2);
  });

  it("does NOT treat a backslash as an escape on PostgreSQL or SQLite", () => {
    // 🔴 Only MySQL reads a backslash as an escape inside a string literal;
    // SQLite has no C-style escapes at all. `quoteSqlLiteral` therefore leaves
    // a trailing backslash SINGLE on those dialects, so a parity rule applied
    // unconditionally calls the closing quote escaped and swallows the
    // semicolon — the very defect the parity check was added to remove, moved
    // to the other two dialects.
    const sql = [
      `INSERT INTO t (d) VALUES ('ends with a backslash \\');`,
      `INSERT INTO u (d) VALUES ('second');`,
    ].join("\n");
    for (const dialect of ["postgresql", "sqlite"] as const) {
      expect(splitSqlStatements(sql, dialect)).toHaveLength(2);
    }
  });

  it("still treats an ODD run as escaping the quote", () => {
    // The control: a rule that stopped honouring backslash escapes entirely
    // would satisfy the case above and split this one in the wrong place.
    const sql = `INSERT INTO t (d) VALUES ('not \\' the end; still inside');`;
    expect(splitSqlStatements(sql, "mysql")).toHaveLength(1);
  });
});

describe("PostgreSQL escape strings honour backslashes; ordinary literals do not", () => {
  it("keeps an E'...' literal WHOLE when a backslash escapes its quote", () => {
    // 🔴 PostgreSQL DOES read a backslash as an escape inside an `E'…'` string.
    // Disabling backslash handling for the whole dialect split this valid
    // statement at the semicolon INSIDE the literal.
    //
    // Asserted on CONTENT, not on the count: `splitSqlStatements` discards a
    // fragment carrying no SQL keyword, so the tail `right';` vanishes either
    // way and a length check passes on the broken implementation too.
    const sql = `SELECT E'left \\'; right' AS v;`;
    const out = splitSqlStatements(sql, "postgresql");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("right");
  });

  it("still splits an ORDINARY PostgreSQL literal ending in a backslash", () => {
    // The control, and why this is a property of the LITERAL rather than the
    // dialect: outside `E'…'` PostgreSQL stores a backslash verbatim, so the
    // quote after it closes the string and the semicolon separates.
    const sql = [
      `INSERT INTO t (d) VALUES ('ends with a backslash \\\\');`,
      `INSERT INTO u (d) VALUES ('second');`,
    ].join("\n");
    expect(splitSqlStatements(sql, "postgresql")).toHaveLength(2);
  });
});

describe("MySQL escapes inside BOTH literal quotes", () => {
  it("keeps a double-quoted MySQL value whole when a backslash escapes its quote", () => {
    // 🔴 Under MySQL's default SQL mode a double quote also delimits a string,
    // so the backslash check has to apply to whichever quote opened the region.
    // Gating on the single quote alone splits this valid statement at the
    // semicolon INSIDE the value.
    //
    // Asserted on CONTENT: a fragment carrying no SQL keyword is discarded, so
    // a length check passes on the broken implementation too.
    const sql = `SELECT "left \\"; right" AS v;`;
    const out = splitSqlStatements(sql, "mysql");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("right");
  });

  it("does NOT treat a backtick-quoted identifier as escaping", () => {
    // The control: a backtick delimits a NAME, not a literal, so a backslash
    // inside one escapes nothing and the following semicolon still separates.
    const sql =
      "INSERT INTO `t` (d) VALUES (1); INSERT INTO `u` (d) VALUES (2);";
    expect(splitSqlStatements(sql, "mysql")).toHaveLength(2);
  });
});

describe("a line inside a string literal is data, not SQL", () => {
  it("KEEPS a continuation line that begins with a comment marker", () => {
    // 🔴 A multiline description whose second line starts with `--` puts
    // comment-looking text at the start of a line. Read as a standalone SQL
    // comment it is dropped, the migration still succeeds, and the replayed
    // database stores a SILENTLY TRUNCATED description — no error anywhere.
    const sql = `INSERT INTO "t" ("d") VALUES ('Summary\n-- internal note');`;
    const out = splitSqlStatements(sql, "sqlite").join(";");
    expect(out).toContain("internal note");
  });

  it("KEEPS a literal that contains the breakpoint marker text", () => {
    // The same rule for the rewrite half of the cleanup: stripping the marker
    // out of prose corrupts the stored value exactly as dropping the line does.
    const sql = `INSERT INTO "t" ("d") VALUES ('note\n--> statement-breakpoint here');`;
    const out = splitSqlStatements(sql, "sqlite").join(";");
    expect(out).toContain("--> statement-breakpoint here");
  });

  it("still DROPS a standalone comment line outside any literal", () => {
    // 🔴 The control. Both cases above pass on an implementation that simply
    // stopped cleaning up, which would put marker text and comments back into
    // the SQL the driver receives — so the cleanup must be shown to still run.
    const sql = `-- a leading note\nCREATE TABLE "t" ("a" text);`;
    const out = splitSqlStatements(sql, "sqlite").join(";");
    expect(out).not.toContain("a leading note");
    expect(out).toContain("CREATE TABLE");
  });

  it("still STRIPS an inline breakpoint marker outside any literal", () => {
    // The rewrite half of the same control: unstripped, the marker text
    // pollutes the next accumulated statement and MySQL rejects it.
    const sql = `CREATE TABLE "t" ("a" text);--> statement-breakpoint\nCREATE INDEX "i" ON "t" ("a");`;
    const out = splitSqlStatements(sql, "sqlite");
    expect(out.join(";")).not.toContain("statement-breakpoint");
    expect(out).toHaveLength(2);
  });

  it("KEEPS marker text in a literal that opens LATER on the line", () => {
    // 🔴 A per-line answer is not enough. This line begins as ordinary SQL, so
    // any rule keyed on where the LINE starts treats the whole line as SQL and
    // rewrites the value inside it — storing a truncated description while the
    // migration reports success.
    const sql = `INSERT INTO "t" ("d") VALUES ('note --> statement-breakpoint here');`;
    const out = splitSqlStatements(sql, "sqlite").join(";");
    expect(out).toContain("--> statement-breakpoint here");
  });

  it("does not let an apostrophe inside a BLOCK comment open a literal", () => {
    // 🔴 `it's` here is prose, not an opening quote. Counted as one, everything
    // after it reads as being inside a literal, so the real breakpoint line
    // below is treated as data and survives — and on MySQL, where `-->` is not
    // a comment, that text reaches the driver as invalid SQL.
    const sql = `/* it's a note\n   spanning lines */\nCREATE TABLE "t" ("a" text);\n--> statement-breakpoint\nCREATE INDEX "i" ON "t" ("a");`;
    const out = splitSqlStatements(sql, "mysql");
    expect(out.join(";")).not.toContain("statement-breakpoint");
    expect(out).toHaveLength(2);
  });
});

describe("a doubled delimiter escapes the delimiter, it does not end the literal", () => {
  it("keeps a Postgres escape string whole across a doubled quote", () => {
    // 🔴 Closing on the first quote of `''` and reopening on the second looks
    // harmless — the state toggles twice and comes back correct — but the
    // reopened literal is a DIFFERENT one. `escapesWithBackslash` is read from
    // the prefix at the opening quote, and the second quote of a pair is no
    // longer adjacent to the `E`. The mode is lost, the later `\'` reads as the
    // closing quote, and the statement is cut at the semicolon INSIDE the
    // value.
    //
    // Asserted on CONTENT, not on the number of statements: the splitter drops
    // fragments carrying no SQL keyword, so the tail of a mis-split statement
    // disappears and a count assertion passes on the broken implementation.
    const sql = `SELECT E'it''s left \\'; right' AS v;`;
    expect(splitSqlStatements(sql, "postgresql").join(" | ")).toBe(
      `SELECT E'it''s left \\'; right' AS v`
    );
  });

  it("keeps an ordinary literal whole across a doubled quote", () => {
    // The control. This case is correct even when the pair is treated as a
    // close followed by an open, because both literals carry the same escape
    // mode — so it passes on the broken implementation and shows that the fix
    // is about the MODE rather than about doubled quotes in general.
    const sql = `INSERT INTO "t" ("d") VALUES ('it''s fine; really');`;
    expect(splitSqlStatements(sql, "postgresql").join(" | ")).toBe(
      `INSERT INTO "t" ("d") VALUES ('it''s fine; really')`
    );
  });

  it("still CLOSES on a single delimiter, so a doubled one is not assumed", () => {
    // 🔴 The other direction: an implementation that never closed on a quote
    // adjacent to another would swallow the boundary between two statements.
    const sql = `INSERT INTO "t" ("d") VALUES ('a');INSERT INTO "t" ("d") VALUES ('b');`;
    expect(splitSqlStatements(sql, "postgresql")).toHaveLength(2);
  });

  it("keeps every statement with text outside its comments, whatever its keyword", () => {
    const sql = [
      `CALL cleanup_plugin_data();`,
      `COMMENT ON TABLE "t" IS 'drop; me';`,
      `DO 'noop';`,
      `-- a trailing note, not a statement`,
    ].join("\n");
    const statements = splitSqlStatements(sql, "postgresql");
    expect(statements).toEqual([
      "CALL cleanup_plugin_data()",
      `COMMENT ON TABLE "t" IS 'drop; me'`,
      "DO 'noop'",
    ]);
  });

  it("drops a fragment that is only comments", () => {
    const sql = `CREATE TABLE "a" ("id" TEXT);\n/* closing note */\n-- and another`;
    expect(splitSqlStatements(sql, "postgresql")).toEqual([
      `CREATE TABLE "a" ("id" TEXT)`,
    ]);
  });

  it("leaves a file's own transaction brackets to the runner's transaction", () => {
    const sql = [
      `BEGIN;`,
      `ALTER TABLE "t" ADD COLUMN "a" TEXT;`,
      `COMMIT;`,
      `START TRANSACTION;`,
      `ALTER TABLE "t" ADD COLUMN "b" TEXT;`,
      `END TRANSACTION;`,
    ].join("\n");
    expect(splitSqlStatements(sql, "postgresql")).toEqual([
      `ALTER TABLE "t" ADD COLUMN "a" TEXT`,
      `ALTER TABLE "t" ADD COLUMN "b" TEXT`,
    ]);
  });

  it("keeps a statement that would undo or split the runner's transaction, for the runner to refuse", () => {
    // Splitting never refuses: a dry run splits to preview, and must not
    // throw. The refusal is `statementRefusals`', below.
    expect(
      splitSqlStatements(
        `ALTER TABLE "t" ADD COLUMN "a" TEXT;\nROLLBACK;\nSAVEPOINT s1;`
      )
    ).toEqual([
      `ALTER TABLE "t" ADD COLUMN "a" TEXT`,
      "ROLLBACK",
      "SAVEPOINT s1",
    ]);
  });

  it.each([
    ["sqlite", "BEGIN IMMEDIATE TRANSACTION"],
    ["sqlite", "BEGIN EXCLUSIVE"],
    ["sqlite", "BEGIN DEFERRED"],
    ["postgresql", "BEGIN ISOLATION LEVEL SERIALIZABLE"],
    ["postgresql", "BEGIN WORK READ WRITE"],
    ["postgresql", "START TRANSACTION ISOLATION LEVEL REPEATABLE READ"],
    ["mysql", "START TRANSACTION READ WRITE"],
    ["mysql", "START TRANSACTION WITH CONSISTENT SNAPSHOT"],
    ["mysql", "COMMIT WORK AND NO CHAIN"],
    ["postgresql", "/* opens */ BEGIN"],
  ] as const)(
    "leaves out %s's transaction bracket `%s`",
    (dialect, bracket) => {
      expect(
        splitSqlStatements(
          `${bracket};\nALTER TABLE t ADD COLUMN a TEXT;\nCOMMIT;`,
          dialect
        )
      ).toEqual(["ALTER TABLE t ADD COLUMN a TEXT"]);
    }
  );

  it("keeps a PostgreSQL dollar-quoted body whole, whatever it holds", () => {
    const body = `DO $$\nBEGIN\n  UPDATE "t" SET "a" = 'x;y';\n  IF true THEN RAISE NOTICE 'done'; END IF;\nEND\n$$`;
    const fn = `CREATE FUNCTION f() RETURNS trigger AS $fn$ BEGIN NEW.a := 1; RETURN NEW; END $fn$ LANGUAGE plpgsql`;
    expect(
      splitSqlStatements(`${body};\n${fn};\nSELECT 1;`, "postgresql")
    ).toEqual([body, fn, "SELECT 1"]);
  });

  it("does not read a dollar sign inside a name as a body", () => {
    // `a$b$` continues a word, and `$1` is a parameter: neither opens a body.
    expect(
      splitSqlStatements(`SELECT a$b$c FROM t;SELECT $1;`, "postgresql")
    ).toEqual(["SELECT a$b$c FROM t", "SELECT $1"]);
  });
  it("keeps a line beginning -- that closes a block comment", () => {
    // The `--` is inside the block comment; the `*/` after it ends that
    // comment, and the statement after it is SQL. (No DDL keyword on the
    // line, which would keep it for another reason.)
    const sql = `/* a note\n-- */ SELECT 1;\nSELECT 2;`;
    expect(splitSqlStatements(sql, "postgresql")).toEqual([
      `/* a note\n-- */ SELECT 1`,
      "SELECT 2",
    ]);
  });

  it("does not strip a breakpoint marker inside a block comment", () => {
    const sql = `/* x;--> statement-breakpoint */ SELECT 1;`;
    expect(splitSqlStatements(sql, "postgresql")).toEqual([
      "/* x;--> statement-breakpoint */ SELECT 1",
    ]);
  });

  it("reads MySQL's # comments and keeps its versioned comments", () => {
    const sql = [
      "/*!40000 ALTER TABLE `t` DISABLE KEYS */;",
      "ALTER TABLE `t` ADD COLUMN `a` TEXT; # adds a; not a statement",
      "# a closing note",
    ].join("\n");
    expect(splitSqlStatements(sql, "mysql")).toEqual([
      "/*!40000 ALTER TABLE `t` DISABLE KEYS */",
      "ALTER TABLE `t` ADD COLUMN `a` TEXT",
    ]);
  });
});

describe("routine and trigger bodies", () => {
  const sqliteTrigger = [
    "CREATE TRIGGER fx_touch AFTER UPDATE ON fx__notes FOR EACH ROW",
    "BEGIN",
    "  UPDATE fx__notes SET updated = CASE WHEN NEW.a > 0 THEN 1 ELSE 0 END WHERE id = NEW.id;",
    "  INSERT INTO fx__log (id) VALUES (NEW.id);",
    "END",
  ].join("\n");
  const mysqlProcedure = [
    "CREATE DEFINER = `root`@`%` PROCEDURE fx_cleanup(IN n INT)",
    "BEGIN",
    "  DECLARE done INT DEFAULT 0;",
    "  IF n > 0 THEN",
    "    DELETE FROM fx__notes WHERE id < n;",
    "  END IF;",
    "  lbl: LOOP",
    "    SET done = done + 1;",
    "    IF done > 3 THEN LEAVE lbl; END IF;",
    "  END LOOP lbl;",
    "  CASE n WHEN 1 THEN SET done = 0; ELSE SET done = 1; END CASE;",
    "  BEGIN",
    "    SELECT 1;",
    "  END;",
    "END",
  ].join("\n");
  const postgresAtomic = [
    "CREATE FUNCTION fx_count() RETURNS bigint LANGUAGE sql",
    "BEGIN ATOMIC",
    "  SELECT count(*) FROM fx__notes;",
    "END",
  ].join("\n");

  it.each([
    ["sqlite", sqliteTrigger],
    ["mysql", mysqlProcedure],
    ["postgresql", postgresAtomic],
  ] as const)(
    "keeps a %s body whole, END included, and splits after it",
    (dialect, routine) => {
      expect(
        splitSqlStatements(`SELECT 0;\n${routine};\nSELECT 1;`, dialect)
      ).toEqual(["SELECT 0", routine, "SELECT 1"]);
    }
  );

  it("reads a column called begin or end as a name, not a block keyword", () => {
    const trigger = [
      "CREATE TRIGGER fx_span AFTER UPDATE ON fx__spans FOR EACH ROW",
      "BEGIN",
      "  UPDATE fx__log SET begin = NEW.begin, finish = NEW.end WHERE id = OLD.id;",
      "  INSERT INTO fx__log (id, begin) SELECT NEW.id, NEW.begin;",
      "END",
    ].join("\n");
    expect(splitSqlStatements(`${trigger};\nSELECT 1;`, "sqlite")).toEqual([
      trigger,
      "SELECT 1",
    ]);
  });

  it("still splits a MySQL trigger whose body is one statement, with no BEGIN", () => {
    const trigger =
      "CREATE TRIGGER fx_bi BEFORE INSERT ON fx__notes FOR EACH ROW SET NEW.a = 1";
    expect(splitSqlStatements(`${trigger};\nSELECT 1;`, "mysql")).toEqual([
      trigger,
      "SELECT 1",
    ]);
  });

  it("reads BEGIN and END as nesting only in a routine or trigger definition", () => {
    // Anywhere else a leading BEGIN/END is a transaction bracket and a `;`
    // ends the statement.
    expect(
      splitSqlStatements(
        "BEGIN;\nUPDATE t SET a = CASE WHEN b THEN 1 END;\nEND;",
        "sqlite"
      )
    ).toEqual(["UPDATE t SET a = CASE WHEN b THEN 1 END"]);
  });
});

describe("statementRefusals", () => {
  it.each([
    ["postgresql", "ROLLBACK", "TRANSACTION_CONTROL_IN_MIGRATION"],
    ["postgresql", "ABORT", "TRANSACTION_CONTROL_IN_MIGRATION"],
    ["postgresql", "SAVEPOINT s1", "TRANSACTION_CONTROL_IN_MIGRATION"],
    ["mysql", "RELEASE SAVEPOINT s1", "TRANSACTION_CONTROL_IN_MIGRATION"],
    ["postgresql", "COMMIT PREPARED 'x'", "TRANSACTION_CONTROL_IN_MIGRATION"],
    [
      "postgresql",
      "PREPARE TRANSACTION 'x'",
      "TRANSACTION_CONTROL_IN_MIGRATION",
    ],
    ["mysql", "XA START 'x'", "TRANSACTION_CONTROL_IN_MIGRATION"],
    ["mysql", "SET FOREIGN_KEY_CHECKS = 0", "SESSION_SETTING_IN_MIGRATION"],
    [
      "mysql",
      "/*!40014 SET FOREIGN_KEY_CHECKS=0 */",
      "SESSION_SETTING_IN_MIGRATION",
    ],
    ["mysql", "SET SESSION sql_mode = ''", "SESSION_SETTING_IN_MIGRATION"],
    [
      "mysql",
      "SET @@session.time_zone = '+00:00'",
      "SESSION_SETTING_IN_MIGRATION",
    ],
    ["postgresql", "SET search_path TO other", "SESSION_SETTING_IN_MIGRATION"],
    [
      "postgresql",
      "SET SESSION statement_timeout = 0",
      "SESSION_SETTING_IN_MIGRATION",
    ],
    ["postgresql", "RESET ALL", "SESSION_SETTING_IN_MIGRATION"],
    ["postgresql", "VACUUM ANALYZE t", "NOT_TRANSACTIONAL_IN_MIGRATION"],
    [
      "postgresql",
      "CREATE INDEX CONCURRENTLY i ON t (a)",
      "NOT_TRANSACTIONAL_IN_MIGRATION",
    ],
    [
      "postgresql",
      "CREATE UNIQUE INDEX CONCURRENTLY i ON t (a)",
      "NOT_TRANSACTIONAL_IN_MIGRATION",
    ],
    [
      "postgresql",
      "DROP INDEX CONCURRENTLY i",
      "NOT_TRANSACTIONAL_IN_MIGRATION",
    ],
    [
      "postgresql",
      "REINDEX (CONCURRENTLY) TABLE t",
      "NOT_TRANSACTIONAL_IN_MIGRATION",
    ],
    ["postgresql", "CREATE DATABASE other", "NOT_TRANSACTIONAL_IN_MIGRATION"],
    [
      "postgresql",
      "ALTER SYSTEM SET work_mem = '64MB'",
      "NOT_TRANSACTIONAL_IN_MIGRATION",
    ],
    ["sqlite", "VACUUM", "NOT_TRANSACTIONAL_IN_MIGRATION"],
    ["sqlite", "ATTACH DATABASE 'x.db' AS x", "NOT_TRANSACTIONAL_IN_MIGRATION"],
    ["mysql", "LOCK TABLES t WRITE", "NOT_TRANSACTIONAL_IN_MIGRATION"],
    ["mysql", "UNLOCK TABLES", "NOT_TRANSACTIONAL_IN_MIGRATION"],
  ] as const)("refuses on %s: %s", (dialect, statement, code) => {
    expect(statementRefusals([statement], dialect).map(r => r.code)).toEqual([
      code,
    ]);
    expect(() =>
      assertRunnableStatements([statement], dialect, "0001_x.sql")
    ).toThrow(/0001_x\.sql was refused/);
  });

  it("names the statement and what to write instead", () => {
    const [fk] = statementRefusals(
      ["/*!40014 SET FOREIGN_KEY_CHECKS=0 */"],
      "mysql"
    );
    expect(fk?.message).toContain('"/*!40014 SET FOREIGN_KEY_CHECKS=0 */"');
    expect(fk?.message).toContain("(FOREIGN_KEY_CHECKS)");
    expect(fk?.message).toMatch(/drop the foreign key and add it back/);

    const [path] = statementRefusals(
      ["SET SESSION search_path TO other"],
      "postgresql"
    );
    expect(path?.message).toContain('"SET SESSION search_path TO other"');
    expect(path?.message).toContain("SET LOCAL search_path");

    const [rollback] = statementRefusals(["ROLLBACK TO s1"], "postgresql");
    expect(rollback?.message).toContain('"ROLLBACK TO s1"');
  });

  it.each([
    ["postgresql", "SET LOCAL search_path TO other"],
    ["postgresql", "SET CONSTRAINTS ALL DEFERRED"],
    ["postgresql", "CREATE INDEX i ON t (a)"],
    ["postgresql", "ALTER TYPE mood ADD VALUE 'meh'"],
    ["postgresql", "COMMENT ON TABLE t IS 'VACUUM me'"],
    ["postgresql", "DO $$ BEGIN ROLLBACK; END $$"],
    ["postgresql", `ALTER TABLE "t" ADD COLUMN "a" TEXT`],
    ["mysql", "SET @renamed = 1"],
    ["mysql", "/*!40000 ALTER TABLE `t` DISABLE KEYS */"],
    ["sqlite", "PRAGMA foreign_keys = OFF"],
    ["sqlite", "UPDATE t SET a = 1"],
  ] as const)("allows on %s: %s", (dialect, statement) => {
    // The control: statements a migration may hold, through the same check.
    expect(statementRefusals([statement], dialect)).toEqual([]);
  });
});

describe("executeTransaction", () => {
  /**
   * A pooled adapter in miniature: `executeQuery` takes whichever pooled
   * connection is free, `transaction` reserves one for its callback.
   */
  function pooledAdapter() {
    const calls: string[] = [];
    const adapter = {
      getCapabilities: () => ({ dialect: "postgresql" }),
      executeQuery: vi.fn(async (statement: string) => {
        calls.push(`pool: ${statement}`);
        return [];
      }),
      transaction: async <T>(
        work: (ctx: {
          execute: (statement: string) => Promise<unknown[]>;
          drizzle: () => unknown;
        }) => Promise<T>
      ): Promise<T> => {
        calls.push("reserved: BEGIN");
        try {
          const result = await work({
            execute: async statement => {
              calls.push(`reserved: ${statement}`);
              return [];
            },
            drizzle: () => "reserved-handle",
          });
          calls.push("reserved: COMMIT");
          return result;
        } catch (error) {
          calls.push("reserved: ROLLBACK");
          throw error;
        }
      },
    };
    return { adapter, calls };
  }

  it("runs every statement, and hands out the handle, on the reserved connection", async () => {
    // Sent through `executeQuery`, BEGIN, the statements and COMMIT could each
    // land on a different pooled connection, and nothing would be atomic.
    const { adapter, calls } = pooledAdapter();
    let handle: unknown;
    await executeTransaction(adapter as never, async tx => {
      await tx.execute("CREATE TABLE a (id int)");
      await tx.execute("CREATE TABLE b (id int)");
      handle = tx.db;
    });
    expect(calls).toEqual([
      "reserved: BEGIN",
      "reserved: CREATE TABLE a (id int)",
      "reserved: CREATE TABLE b (id int)",
      "reserved: COMMIT",
    ]);
    expect(handle).toBe("reserved-handle");
    expect(adapter.executeQuery).not.toHaveBeenCalled();
  });

  it("rolls back on the same connection when a statement fails", async () => {
    const { adapter, calls } = pooledAdapter();
    await expect(
      executeTransaction(adapter as never, async tx => {
        await tx.execute("CREATE TABLE a (id int)");
        throw new Error("second statement failed");
      })
    ).rejects.toThrow("second statement failed");
    expect(calls).toEqual([
      "reserved: BEGIN",
      "reserved: CREATE TABLE a (id int)",
      "reserved: ROLLBACK",
    ]);
  });
});
