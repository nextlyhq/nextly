// Tests for the missing-columns util — extracted from
// SchemaPushService.addMissingColumnsForFields in F8 PR 1. Behavior is
// preserved exactly: silently strip NOT NULL when adding columns to
// existing tables, idempotent skip when the column already exists, and
// per-dialect quoting + column-type rendering.
//
// The util is a pure free function over (adapter, logger, tableName,
// fields, options). Tests use a fake adapter that records SQL + returns
// scripted column lists.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types/index.js";
import type { Logger } from "../../../../shared/types/index.js";
import { addMissingColumnsForFields } from "../missing-columns.js";

interface FakeAdapter {
  getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
  executeQuery: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}

function makeAdapter(opts: {
  dialect: "postgresql" | "mysql" | "sqlite";
  existingColumns?: string[];
  introspectShape?: "column_name" | "name";
  alterShouldThrow?: boolean;
}): { adapter: FakeAdapter; calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const introspectKey = opts.introspectShape ?? "column_name";
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
        return cols.map(
          c => ({ [introspectKey]: c }) as Record<string, unknown>
        ) as T[];
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
      { timestamps: false }
    );

    expect(added).toEqual(["excerpt"]);
    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).toBe(`ALTER TABLE "dc_posts" ADD COLUMN "excerpt" TEXT`);
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
      { timestamps: false }
    );

    expect(added).toEqual(["title"]);
    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).toBe("ALTER TABLE `dc_posts` ADD COLUMN `title` TEXT");
  });

  it("uses PRAGMA table_info introspection on SQLite", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "sqlite",
      existingColumns: ["id", "title"],
      introspectShape: "name",
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
      { timestamps: false }
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
      { timestamps: false }
    );

    const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
    expect(alter?.sql).not.toContain("NOT NULL");
    expect(alter?.sql).toBe(`ALTER TABLE "dc_posts" ADD COLUMN "title" TEXT`);
  });

  it("skips columns that already exist (idempotent)", async () => {
    const { adapter, calls } = makeAdapter({
      dialect: "postgresql",
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
      { timestamps: false }
    );

    expect(added).toEqual([]);
    expect(calls.find(c => c.sql.startsWith("ALTER TABLE"))).toBeUndefined();
  });

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
      fields
      // options omitted -> timestamps default true
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
      { timestamps: false }
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
      { timestamps: false }
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
        introspectShape: dialect === "sqlite" ? "name" : "column_name",
      });
      await addMissingColumnsForFields(
        adapter as unknown as Parameters<typeof addMissingColumnsForFields>[0],
        fakeLogger,
        "dc_posts",
        [{ name: "isPublished", type: "checkbox" } as FieldConfig],
        { timestamps: false }
      );
      const alter = calls.find(c => c.sql.startsWith("ALTER TABLE"));
      expect(alter?.sql).toContain(expected);
    }
  });
});
