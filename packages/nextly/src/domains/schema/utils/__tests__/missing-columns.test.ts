// Tests for the missing-columns util — extracted from
// SchemaPushService.addMissingColumnsForFields in F8 PR 1. Behavior is
// preserved exactly: silently strip NOT NULL when adding columns to
// existing tables, idempotent skip when the column already exists, and
// per-dialect quoting + column-type rendering.
//
// The util is a pure free function over (adapter, logger, tableName,
// fields, options). Tests use a fake adapter that records SQL + returns
// scripted column lists, its rows keyed as each dialect's driver keys them.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types/index";
import type { Logger } from "../../../../shared/types/index";
import { addMissingColumnsForFields } from "../missing-columns";

interface FakeAdapter {
  getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
  executeQuery: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}

/**
 * The key the driver gives the one column of a catalogue query's rows: its alias where it has one.
 * Without one, MySQL 8 gives an `information_schema` column its upper-case name however the query
 * spells it, PostgreSQL the lower-case one, and SQLite's pragma calls it `name`.
 */
function catalogueKey(
  dialect: "postgresql" | "mysql" | "sqlite",
  sql: string
): string {
  if (dialect === "sqlite") return "name";
  const selected = /^\s*SELECT\s+(\w+)(?:\s+AS\s+(\w+))?\s+FROM/i.exec(sql);
  if (selected === null) throw new Error(`not a catalogue query: ${sql}`);
  const [, column, alias] = selected;
  if (alias !== undefined) return alias;
  return dialect === "mysql" ? column.toUpperCase() : column.toLowerCase();
}

function makeAdapter(opts: {
  dialect: "postgresql" | "mysql" | "sqlite";
  existingColumns?: string[];
  alterShouldThrow?: boolean;
}): { adapter: FakeAdapter; calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const cols = opts.existingColumns ?? [];

  const adapter: FakeAdapter = {
    getCapabilities: () => ({ dialect: opts.dialect }),
    executeQuery: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      calls.push({ sql, params });
      // Introspection query returns the existing columns.
      if (
        sql.includes("information_schema.columns") ||
        sql.startsWith("PRAGMA")
      ) {
        const key = catalogueKey(opts.dialect, sql);
        return cols.map(c => ({ [key]: c }) as Record<string, unknown>) as T[];
      }
      // ALTER TABLE statement.
      if (opts.alterShouldThrow) {
        throw new Error("simulated DDL failure");
      }
      return [] as T[];
    },
  };
  return { adapter, calls };
}

const fakeLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("addMissingColumnsForFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a missing text column on PostgreSQL with double-quoted identifiers", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id", "title"],
    });
    const fields: FieldConfig[] = [
      // existing
      { name: "title", type: "text" } as FieldConfig,
      // missing
      { name: "excerpt", type: "text" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual(["excerpt"]);
    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).toBe(`ALTER TABLE "dc_posts" ADD COLUMN "excerpt" TEXT`);
  });

  it("never adds a parent column for a component field", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id"],
    });
    const fields: FieldConfig[] = [
      { name: "hero", type: "component" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_pages",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual([]);
    expect(calls.find(c => c.sql.startsWith("ALTER TABLE"))).toBeUndefined();
  });

  it("uses backtick-quoted identifiers on MySQL", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "mysql",
      existingColumns: ["id"],
    });
    const fields: FieldConfig[] = [
      { name: "title", type: "text" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual(["title"]);
    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).toBe("ALTER TABLE `dc_posts` ADD COLUMN `title` TEXT");
  });

  it("uses PRAGMA table_info introspection on SQLite", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "sqlite",
      existingColumns: ["id", "title"],
    });
    const fields: FieldConfig[] = [
      { name: "title", type: "text" } as FieldConfig,
      { name: "body", type: "richText" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual(["body"]);
    const introspect = calls.find(c => c.sql.startsWith("PRAGMA"));
    expect(introspect?.sql).toBe(`PRAGMA table_info("dc_posts")`);
  });

  it("silently strips NOT NULL when adding to an existing table", async () => {
    // Day-one behavior: a field marked required: true would normally
    // render with NOT NULL, but adding NOT NULL to an existing table
    // with rows would fail. The util strips the constraint.
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id"],
    });
    const fields: FieldConfig[] = [
      { name: "title", type: "text", required: true } as FieldConfig,
    ];

    await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).not.toContain("NOT NULL");
    expect(alter?.sql).toBe(`ALTER TABLE "dc_posts" ADD COLUMN "title" TEXT`);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "skips columns that already exist (idempotent), on %s",
    async dialect => {
      const { adapter, calls } = makeAdapter({
        dialect,
        existingColumns: ["id", "title", "excerpt"],
      });
      const fields: FieldConfig[] = [
        { name: "title", type: "text" } as FieldConfig,
        { name: "excerpt", type: "text" } as FieldConfig,
      ];

      const added = await addMissingColumnsForFields(
        adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
        fakeLogger,
        "dc_posts",
        fields,
        { timestamps: false, builtBy: "codeFirst" }
      );

      expect(added).toEqual([]);
      expect(calls.find(c => c.sql.startsWith("ALTER TABLE"))).toBeUndefined();
    }
  );

  it("includes timestamp columns when options.timestamps is not false", async () => {
    // Timestamps don't have column defs (set to "" in the map), so they
    // show up in the requested set but are filtered out by the colDef
    // check before issuing ALTER. This confirms the request shape.
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id", "title", "created_at", "updated_at"],
    });
    const fields: FieldConfig[] = [
      { name: "title", type: "text" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      // timestamps default true; the origin is stated because a column added here has to
      // match the one a fresh table gets.
      { builtBy: "codeFirst" }
    );

    // No alter expected (everything exists, timestamps have empty defs).
    expect(added).toEqual([]);
    expect(calls.find(c => c.sql.startsWith("ALTER TABLE"))).toBeUndefined();
  });

  it("logs a warning and continues when one ALTER throws", async () => {
    const { adapter } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id"],
      alterShouldThrow: true,
    });
    const fields: FieldConfig[] = [
      { name: "title", type: "text" } as FieldConfig,
      { name: "body", type: "text" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual([]);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("converts camelCase field names to snake_case columns", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
      existingColumns: ["id"],
    });
    const fields: FieldConfig[] = [
      { name: "publishedAt", type: "date" } as FieldConfig,
    ];

    const added = await addMissingColumnsForFields(
      adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
      fakeLogger,
      "dc_posts",
      fields,
      { timestamps: false, builtBy: "codeFirst" }
    );

    expect(added).toEqual(["published_at"]);
    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).toContain(`"published_at"`);
  });

  it("renders dialect-specific column types correctly", async () => {
    // checkbox -> BOOLEAN on PG, TINYINT(1) on MySQL, INTEGER on SQLite.
    const cases: Array<{
      dialect: "postgresql" | "mysql" | "sqlite";
      expected: string;
    }> = [
      {
        dialect: "postgresql",
        expected: `"is_published" BOOLEAN DEFAULT FALSE`,
      },
      {
        dialect: "mysql",
        expected: `\`is_published\` TINYINT(1) DEFAULT FALSE`,
      },
      {
        dialect: "sqlite",
        expected: `"is_published" INTEGER DEFAULT FALSE`,
      },
    ];

    for (const { dialect, expected } of cases) {
      const { adapter, calls } = makeAdapter({
        dialect,
        existingColumns: ["id"],
      });
      await addMissingColumnsForFields(
        adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
        fakeLogger,
        "dc_posts",
        [{ name: "isPublished", type: "checkbox" } as FieldConfig],
        { timestamps: false, builtBy: "codeFirst" }
      );
      const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
      expect(alter?.sql).toContain(expected);
    }
  });
});
