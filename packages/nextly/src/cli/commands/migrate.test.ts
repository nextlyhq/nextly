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
});
