// Plan C2: `nextly migrate` is now Phase 0/1/2 over `nextly_schema_events`.
// The old F11 ledger internals (recordMigration, findPendingMigrations) are
// gone; their logic is replaced by Phase 1/2 which is unit-tested in
// domains/schema/migrate/{core-reconcile,drift-reconcile}.test.ts. This file
// now pins the command registration surface.

import { Command } from "commander";
import { describe, expect, it } from "vitest";

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
  // reaches the scanner. An apostrophe there used to open a string that never
  // closed, which stopped every later semicolon from separating statements and
  // handed the driver one merged statement it rejects.
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
