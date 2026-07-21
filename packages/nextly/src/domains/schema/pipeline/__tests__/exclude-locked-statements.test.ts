// Guards the second half of the locked-table protection. Filtering the
// pipeline's own operations is not enough: drizzle-kit is handed the full
// desired schema and re-derives drift itself, and its scope reduction is
// PostgreSQL-only, so on SQLite and MySQL it can emit DDL for a locked table
// regardless of which ops survived. These cases pin the statement-level guard
// that closes that gap on every dialect.

import { describe, it, expect } from "vitest";

import { excludeLockedTableStatements } from "../filter-unsafe-statements";

const locked = new Set(["dc_posts"]);

describe("excludeLockedTableStatements", () => {
  it("returns the input untouched when nothing is locked", () => {
    const statements = ['ALTER TABLE "dc_posts" ADD COLUMN "x" TEXT;'];
    const { kept, skipped } = excludeLockedTableStatements(
      statements,
      new Set()
    );
    expect(kept).toEqual(statements);
    expect(skipped).toEqual([]);
  });

  it("drops statements that alter a locked table but keeps the rest", () => {
    const { kept, skipped } = excludeLockedTableStatements(
      [
        'ALTER TABLE "dc_posts" ADD COLUMN "subtitle" TEXT;',
        'ALTER TABLE "dc_widget" ADD COLUMN "label" TEXT;',
      ],
      locked
    );
    expect(kept).toEqual(['ALTER TABLE "dc_widget" ADD COLUMN "label" TEXT;']);
    expect(skipped).toHaveLength(1);
  });

  // Each dialect quotes identifiers differently and may schema-qualify them;
  // the guard has to recognise the table either way or it silently stops
  // protecting whichever dialect it fails to parse.
  it("recognises the locked table across quoting and qualification styles", () => {
    const { kept } = excludeLockedTableStatements(
      [
        "ALTER TABLE `dc_posts` ADD COLUMN `a` TEXT;",
        'ALTER TABLE "public"."dc_posts" ADD COLUMN "b" TEXT;',
        "ALTER TABLE dc_posts ADD COLUMN c TEXT;",
        'ALTER TABLE "DC_POSTS" ADD COLUMN "d" TEXT;',
      ],
      locked
    );
    expect(kept).toEqual([]);
  });

  // A collection with dbName: "my-table" is stored as dc_my-table verbatim.
  // Capturing the identifier only up to the hyphen would compare "dc_my"
  // against the lock set, match nothing, and let the statement through — the
  // one case where this guard failing open alters a code-first table.
  it("recognises a locked table whose name contains a hyphen", () => {
    const { kept, skipped } = excludeLockedTableStatements(
      [
        'ALTER TABLE "dc_my-table" ADD COLUMN "x" TEXT;',
        'CREATE INDEX "i" ON "dc_my-table" ("x");',
        'ALTER TABLE "dc_widget" ADD COLUMN "y" TEXT;',
      ],
      new Set(["dc_my-table"])
    );
    expect(kept).toEqual(['ALTER TABLE "dc_widget" ADD COLUMN "y" TEXT;']);
    expect(skipped).toHaveLength(2);
  });

  it("drops an index created on a locked table", () => {
    const { kept } = excludeLockedTableStatements(
      [
        'CREATE UNIQUE INDEX "dc_posts_slug_idx" ON "dc_posts" ("slug");',
        'CREATE INDEX "dc_widget_label_idx" ON "dc_widget" ("label");',
      ],
      locked
    );
    expect(kept).toEqual([
      'CREATE INDEX "dc_widget_label_idx" ON "dc_widget" ("label");',
    ]);
  });

  // SQLite cannot ALTER a column type, so drizzle-kit rebuilds the table via a
  // `__new_` twin. Every step has to be attributed to the original table —
  // keeping any one of them would leave a stray table or a failed rename.
  it("drops a whole SQLite rebuild block for a locked table", () => {
    const { kept, skipped } = excludeLockedTableStatements(
      [
        'CREATE TABLE "__new_dc_posts" ("id" integer PRIMARY KEY);',
        'INSERT INTO "__new_dc_posts"("id") SELECT "id" FROM "dc_posts";',
        'DROP TABLE "dc_posts";',
        'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";',
      ],
      locked
    );
    expect(kept).toEqual([]);
    expect(skipped).toHaveLength(4);
  });

  // Statements with no identifiable table are usually schema-wide (enums,
  // sequences). Blocking them would break otherwise valid applies, and the
  // unsafe-statement filter still covers anything destructive.
  it("passes through statements whose table cannot be identified", () => {
    const statements = ["CREATE TYPE status AS ENUM ('draft', 'published');"];
    const { kept } = excludeLockedTableStatements(statements, locked);
    expect(kept).toEqual(statements);
  });
});
