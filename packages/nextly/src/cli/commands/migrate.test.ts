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
    // 🔴 Under MySQL's default SQL mode a double quote also delimits a string, and the
    // scanner this replaced applied its backslash check to whichever quote had
    // opened the region. Gating on the single quote alone split this valid
    // statement at the semicolon INSIDE the value.
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
