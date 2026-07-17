// Unit tests for findUnexpectedDestructiveStatements — the v1-era guard
// that scans drizzle-kit's emitted SQL for destructive statements the
// pipeline did not approve. v1 INCLUDES destructive statements in
// sqlStatements with empty hints (the pre-v1 kit omitted them + warned),
// so the scan of the statement text is the load-bearing defense.

import { describe, it, expect } from "vitest";

import { findUnexpectedDestructiveStatements } from "../filter-unsafe-statements";

// Verbatim statement set captured from drizzle-kit v1 rc.4's SQLite
// table-rebuild flow (type change on a table with an FK) — the one
// legitimate, data-preserving shape that contains a DROP TABLE.
const SQLITE_REBUILD_BLOCK = [
  "ALTER TABLE `child` ADD `brand_new` text;",
  "PRAGMA foreign_keys=OFF;",
  "CREATE TABLE `__new_child` (\n\t`id` text PRIMARY KEY,\n\t`pid` text NOT NULL,\n\t`v` integer,\n\t`brand_new` text,\n\tCONSTRAINT `fk_child_pid_parent_id_fk` FOREIGN KEY (`pid`) REFERENCES `parent`(`id`) ON DELETE CASCADE\n);\n",
  "INSERT INTO `__new_child`(`id`, `pid`, `v`) SELECT `id`, `pid`, `v` FROM `child`;",
  "DROP TABLE `child`;",
  "ALTER TABLE `__new_child` RENAME TO `child`;",
  "PRAGMA foreign_keys=ON;",
];

describe("findUnexpectedDestructiveStatements", () => {
  it("flags a plain DROP TABLE", () => {
    const offenders = findUnexpectedDestructiveStatements([
      'CREATE TABLE "a" (id text);',
      'DROP TABLE "dc_posts";',
    ]);
    expect(offenders).toEqual(['DROP TABLE "dc_posts";']);
  });

  it("flags DROP TABLE IF EXISTS and backtick-quoted names", () => {
    const offenders = findUnexpectedDestructiveStatements([
      "DROP TABLE IF EXISTS `dc_posts`;",
    ]);
    expect(offenders).toHaveLength(1);
  });

  it("flags ALTER TABLE ... DROP COLUMN", () => {
    const offenders = findUnexpectedDestructiveStatements([
      'ALTER TABLE "spike_t" DROP COLUMN "extra";',
    ]);
    expect(offenders).toEqual(['ALTER TABLE "spike_t" DROP COLUMN "extra";']);
  });

  it("does NOT flag the SQLite rebuild block (data-preserving DROP)", () => {
    expect(findUnexpectedDestructiveStatements(SQLITE_REBUILD_BLOCK)).toEqual(
      []
    );
  });

  it("flags an unrelated DROP TABLE even when a rebuild block is present", () => {
    const offenders = findUnexpectedDestructiveStatements([
      ...SQLITE_REBUILD_BLOCK,
      "DROP TABLE `other_table`;",
    ]);
    expect(offenders).toEqual(["DROP TABLE `other_table`;"]);
  });

  it("does NOT flag DROP INDEX (owner-scoped by the drop-guard, not data-destructive)", () => {
    expect(
      findUnexpectedDestructiveStatements(['DROP INDEX "posts_title_idx";'])
    ).toEqual([]);
  });

  it("does NOT flag purely additive statements", () => {
    expect(
      findUnexpectedDestructiveStatements([
        'CREATE TABLE "t" (id text);',
        'ALTER TABLE "t" ADD COLUMN "x" text;',
        'CREATE INDEX "t_x_idx" ON "t" ("x");',
      ])
    ).toEqual([]);
  });
});

describe("findUnexpectedDestructiveStatements — v1 hardening", () => {
  it("parses schema-qualified and quoted DROP/RENAME identifiers", () => {
    const stmts = [
      'CREATE TABLE "main"."__new_dc_posts" (id text)',
      'INSERT INTO "main"."__new_dc_posts" SELECT id FROM "main"."dc_posts"',
      'DROP TABLE "main"."dc_posts"',
      'ALTER TABLE "main"."__new_dc_posts" RENAME TO "dc_posts"',
    ];
    // Qualified rebuild block still recognized as a rebuild (no offenders
    // without an ops allowlist).
    expect(findUnexpectedDestructiveStatements(stmts)).toEqual([]);
    // And the qualified plain DROP is still flagged.
    expect(
      findUnexpectedDestructiveStatements(['DROP TABLE "main"."orphan_tbl"'])
    ).toEqual(['DROP TABLE "main"."orphan_tbl"']);
  });

  it("only trusts rebuild blocks for tables with an approved rebuild op", () => {
    const rebuild = [
      "CREATE TABLE `__new_g1` (id text, num integer)",
      "INSERT INTO `__new_g1`(`id`, `num`) SELECT `id`, `num` FROM `g1`",
      "DROP TABLE `g1`",
      "ALTER TABLE `__new_g1` RENAME TO `g1`",
    ];
    // Approved type change on g1 → the rebuild is legitimate.
    expect(
      findUnexpectedDestructiveStatements(rebuild, new Set(["g1"]))
    ).toEqual([]);
    // No approved op for g1 → the kit is encoding a change our differ never
    // saw (e.g. a column drop expressed as a rebuild) — flag the DROP.
    expect(findUnexpectedDestructiveStatements(rebuild, new Set())).toEqual([
      "DROP TABLE `g1`",
    ]);
  });
});

describe("findUnexpectedDestructiveStatements — review hardening", () => {
  it("does NOT exempt a drop when __new_ renames to a DIFFERENT table", () => {
    const stmts = [
      "CREATE TABLE `__new_g1` (id text)",
      "DROP TABLE `g1`",
      "ALTER TABLE `__new_g1` RENAME TO `other`",
    ];
    expect(findUnexpectedDestructiveStatements(stmts)).toEqual([
      "DROP TABLE `g1`",
    ]);
  });

  it("flags the keyword-optional column drop and TRUNCATE", () => {
    expect(
      findUnexpectedDestructiveStatements(['ALTER TABLE "t" DROP "body"'])
    ).toEqual(['ALTER TABLE "t" DROP "body"']);
    expect(
      findUnexpectedDestructiveStatements(["TRUNCATE TABLE dc_posts"])
    ).toEqual(["TRUNCATE TABLE dc_posts"]);
    // Non-column ALTER drops are NOT column drops.
    expect(
      findUnexpectedDestructiveStatements([
        'ALTER TABLE "t" DROP CONSTRAINT "t_fk"',
      ])
    ).toEqual([]);
  });
});
