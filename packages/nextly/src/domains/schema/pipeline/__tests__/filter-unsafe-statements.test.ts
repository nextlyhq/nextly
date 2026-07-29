import { describe, it, expect, vi, afterEach } from "vitest";

import { getDialectTables } from "../../../../database/index";

import {
  drizzleTableNames,
  filterUnsafeStatements,
  stripKitDropsOfDeclaredIndexes,
} from "../filter-unsafe-statements";

afterEach(() => vi.restoreAllMocks());

describe("drizzleTableNames", () => {
  it("returns SQL table names (not JS export keys) and skips non-tables", () => {
    const names = drizzleTableNames(getDialectTables("sqlite"));
    // SQL names, derived from Symbol.for('drizzle:Name'):
    expect(names).toContain("dynamic_collections");
    expect(names).toContain("email_templates");
    expect(names).toContain("users");
    // Export keys (camelCase) must NOT appear:
    expect(names).not.toContain("dynamicCollections");
    expect(names).not.toContain("emailTemplates");
    // Relations exports are not tables and must be excluded:
    expect(names).not.toContain("dynamicCollectionsRelations");
  });
});

describe("filterUnsafeStatements — companion tables", () => {
  it("blocks a companion _locales DROP SILENTLY (migration-owned)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ['DROP TABLE "dc_pages_locales";'],
      ["dc_pages"] // companion not in desired
    );
    expect(out).toEqual([]); // blocked
    expect(warn).not.toHaveBeenCalled(); // silently, no noise
  });
});

describe("filterUnsafeStatements", () => {
  it("blocks DROP TABLE for a table NOT in the desired set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ["DROP TABLE `dc_articles`", 'CREATE TABLE "users" ("id" text)'],
      ["users"]
    );
    expect(out).toEqual(['CREATE TABLE "users" ("id" text)']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });

  it("ALLOWS DROP TABLE for a table IN the desired set (rebuild pattern)", () => {
    const out = filterUnsafeStatements(
      ["DROP TABLE `dynamic_collections`"],
      ["dynamic_collections"]
    );
    expect(out).toEqual(["DROP TABLE `dynamic_collections`"]);
  });
});

describe("filterUnsafeStatements — internal nextly_ table allowlist", () => {
  it("blocks DROP of internal nextly_ tables WITHOUT a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ['DROP TABLE "nextly_migrate_lock"', 'DROP TABLE "nextly_schema_events"'],
      []
    );
    expect(out).toEqual([]); // both blocked
    expect(warn).not.toHaveBeenCalled(); // silently
  });

  it("still warns when blocking a non-internal orphan table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(['DROP TABLE "dc_orphan"'], []);
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("stripKitDropsOfDeclaredIndexes", () => {
  const desired = {
    tables: [
      {
        name: "dc_posts",
        indexes: [
          { name: "idx_dc_posts_slug" },
          { name: "idx_dc_posts_created_at" },
        ],
      },
      { name: "dc_pages" }, // snapshot without tracked indexes
    ],
  };

  it("strips DROP INDEX for indexes the snapshot declares (any quoting)", () => {
    const out = stripKitDropsOfDeclaredIndexes(
      [
        "DROP INDEX IF EXISTS `idx_dc_posts_slug`;",
        'DROP INDEX "idx_dc_posts_created_at"',
        'ALTER TABLE "dc_posts" ADD COLUMN "views" integer',
      ],
      desired
    );
    expect(out).toEqual(['ALTER TABLE "dc_posts" ADD COLUMN "views" integer']);
  });

  it("keeps DROP INDEX for indexes the snapshot does not declare", () => {
    const out = stripKitDropsOfDeclaredIndexes(
      ['DROP INDEX "custom_manual_index"'],
      desired
    );
    expect(out).toEqual(['DROP INDEX "custom_manual_index"']);
  });

  it("passes everything through when the snapshot tracks no indexes", () => {
    const stmts = ['DROP INDEX "idx_dc_posts_slug"'];
    const out = stripKitDropsOfDeclaredIndexes(stmts, {
      tables: [{ name: "dc_posts" }],
    });
    expect(out).toEqual(stmts);
  });
});
