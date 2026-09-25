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
    expect(out.kept).toEqual([
      'ALTER TABLE "dc_posts" ADD COLUMN "views" integer',
    ]);
    expect(out.strippedCount).toBe(2);
  });

  it("keeps DROP INDEX for indexes the snapshot does not declare", () => {
    const out = stripKitDropsOfDeclaredIndexes(
      ['DROP INDEX "custom_manual_index"'],
      desired
    );
    expect(out.kept).toEqual(['DROP INDEX "custom_manual_index"']);
    expect(out.strippedCount).toBe(0);
  });

  it("passes everything through when the snapshot tracks no indexes", () => {
    const stmts = ['DROP INDEX "idx_dc_posts_slug"'];
    const out = stripKitDropsOfDeclaredIndexes(stmts, {
      tables: [{ name: "dc_posts" }],
    });
    expect(out.kept).toEqual(stmts);
    expect(out.strippedCount).toBe(0);
  });

  it("matches MySQL's ON <table> form against the declaring table only", () => {
    // MySQL scopes index names per table, so a same-named index on a table
    // that does not declare it must survive.
    const out = stripKitDropsOfDeclaredIndexes(
      [
        "DROP INDEX `idx_dc_posts_slug` ON `dc_posts`",
        "DROP INDEX `idx_dc_posts_slug` ON `dc_other`",
      ],
      desired
    );
    expect(out.kept).toEqual(["DROP INDEX `idx_dc_posts_slug` ON `dc_other`"]);
    expect(out.strippedCount).toBe(1);
  });

  it("protects a primary key's index, which lives on the column not in indexes", () => {
    // PostgreSQL materialises a PK as `<table>_pkey`, and the kit has been
    // observed dropping it after a metadata-only change. It is declared on
    // `columns[].primaryKey`, so it never reaches `indexes` and would sail
    // past a guard that only reads that list.
    const withPk = {
      tables: [
        {
          name: "dc_posts",
          columns: [{ primaryKey: true }],
          indexes: [{ name: "idx_dc_posts_slug" }],
        },
      ],
    };
    const out = stripKitDropsOfDeclaredIndexes(
      ['DROP INDEX IF EXISTS "dc_posts_pkey"'],
      withPk
    );
    expect(out.kept).toEqual([]);
    expect(out.strippedCount).toBe(1);
  });

  it("pinned-fail-safe: an unparseable drop is KEPT, never silently stripped", () => {
    // An identifier holding characters outside [A-Za-z0-9_] does not match
    // the pattern. Keeping it hands the statement to the drop-guard rather
    // than removing it here; nobody should "fix" this into a fail-open.
    const exotic = 'DROP INDEX "idx-dc.posts slug"';
    const out = stripKitDropsOfDeclaredIndexes([exotic], desired);
    expect(out.kept).toEqual([exotic]);
    expect(out.strippedCount).toBe(0);
  });
});

describe("filterUnsafeStatements: plugin-migrated tables", () => {
  const pluginSet = new Set(["auth__identities", "billing__x"]);

  it("blocks an in-desired drop of a plugin-migrated table", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = filterUnsafeStatements(
      ['DROP TABLE "auth__identities"', "CREATE TABLE t (id INT)"],
      ["auth__identities", "t"],
      pluginSet,
      "postgresql"
    );
    expect(kept).toEqual(["CREATE TABLE t (id INT)"]);
  });

  it("keeps the rebuild drop for tables no plugin stream claims", () => {
    const kept = filterUnsafeStatements(
      ["DROP TABLE dc_posts", "DROP TABLE __new_dc_posts"],
      ["dc_posts", "__new_dc_posts"],
      pluginSet,
      "sqlite"
    );
    expect(kept).toEqual(["DROP TABLE dc_posts", "DROP TABLE __new_dc_posts"]);
  });

  it("resolves a SQLite rebuild twin to the table it rebuilds", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = filterUnsafeStatements(
      ["DROP TABLE __new_billing__x"],
      ["__new_billing__x"],
      pluginSet,
      "sqlite"
    );
    expect(kept).toEqual([]);
  });

  it("gives the fast path's answer for drops its own pattern cannot see", () => {
    // The question is answered by `dropsPluginMigratedTable`, the reader the
    // fast path uses. The filter's own leading-DROP pattern read only the
    // first name, and nothing behind a comment.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = filterUnsafeStatements(
      [
        "DROP TABLE t, auth__identities",
        '/* rebuild */ DROP TABLE "billing__x"',
      ],
      ["t", "auth__identities", "billing__x"],
      pluginSet,
      "postgresql"
    );
    expect(kept).toEqual([]);
  });

  it("keeps a statement that only mentions a plugin table's drop in a string", () => {
    const insert =
      "INSERT INTO t VALUES ('how to drop table auth__identities')";
    expect(
      filterUnsafeStatements([insert], ["t"], pluginSet, "postgresql")
    ).toEqual([insert]);
  });

  it("without the set, keeps today's behaviour exactly", () => {
    const kept = filterUnsafeStatements(
      ['DROP TABLE "auth__identities"'],
      ["auth__identities"]
    );
    expect(kept).toEqual(['DROP TABLE "auth__identities"']);
  });
});
