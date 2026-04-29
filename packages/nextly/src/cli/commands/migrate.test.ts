// F11 PR 1: unit tests for the new `nextly_migrations` INSERT shape.
//
// Captures the SQL emitted by `recordMigrationForTest` against a stub
// adapter and asserts it contains the F11 spec columns (filename, sha256,
// applied_by, duration_ms, error_json, applied_at) and DOES NOT contain
// the dropped columns (name, batch, checksum, error_message, executed_at).
//
// Drives one of the most load-bearing changes in PR 1: the column rename
// touches every read/write of the table; missing one would silently break
// production migration apply.

import { describe, expect, it, vi } from "vitest";

import { recordMigrationForTest } from "./migrate.js";

interface StubAdapter {
  executeQuery: ReturnType<typeof vi.fn>;
}

function makeAdapter(): StubAdapter {
  return {
    executeQuery: vi.fn(() => Promise.resolve([])),
  };
}

const TEST_RECORD = {
  id: "00000000-0000-4000-a000-000000000001",
  filename: "20260429_154500_123_add_excerpt.sql",
  sha256: "a".repeat(64),
  status: "applied" as const,
  appliedBy: "github-actions-12345",
  durationMs: 42,
  errorJson: null,
};

describe("recordMigrationForTest (F11)", () => {
  describe("PostgreSQL", () => {
    it("emits INSERT with F11 columns and JSONB cast for error_json", async () => {
      const adapter = makeAdapter();

      await recordMigrationForTest(
        adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
        "postgresql",
        TEST_RECORD
      );

      expect(adapter.executeQuery).toHaveBeenCalledTimes(1);
      const sql = adapter.executeQuery.mock.calls[0][0] as string;

      // F11 columns present
      expect(sql).toContain('INTO "nextly_migrations"');
      expect(sql).toContain('"filename"');
      expect(sql).toContain('"sha256"');
      expect(sql).toContain('"applied_by"');
      expect(sql).toContain('"duration_ms"');
      expect(sql).toContain('"error_json"');
      expect(sql).toContain('"applied_at"');
      expect(sql).toContain("NOW()");

      // Dropped columns must NOT appear
      expect(sql).not.toMatch(/\bbatch\b/);
      expect(sql).not.toContain('"name"');
      expect(sql).not.toContain('"checksum"');
      expect(sql).not.toContain('"error_message"');
      expect(sql).not.toContain('"executed_at"');

      // Values populated
      expect(sql).toContain(TEST_RECORD.filename);
      expect(sql).toContain(TEST_RECORD.sha256);
      expect(sql).toContain("'github-actions-12345'");
      expect(sql).toContain("42");
      expect(sql).toContain("NULL"); // errorJson null
    });

    it("encodes error_json as JSONB literal on failed status", async () => {
      const adapter = makeAdapter();

      await recordMigrationForTest(
        adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
        "postgresql",
        {
          ...TEST_RECORD,
          status: "failed",
          errorJson: {
            sqlState: "42703",
            statement: "ALTER TABLE foo ADD COLUMN bar",
            message: 'column "baz" does not exist',
          },
        }
      );

      const sql = adapter.executeQuery.mock.calls[0][0] as string;
      expect(sql).toContain("'failed'");
      expect(sql).toContain("::jsonb");
      expect(sql).toContain("42703");
      expect(sql).toContain("ALTER TABLE foo ADD COLUMN bar");
    });
  });

  describe("MySQL", () => {
    it("emits INSERT with F11 columns and backtick quoting", async () => {
      const adapter = makeAdapter();

      await recordMigrationForTest(
        adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
        "mysql",
        TEST_RECORD
      );

      const sql = adapter.executeQuery.mock.calls[0][0] as string;

      expect(sql).toContain("INTO `nextly_migrations`");
      expect(sql).toContain("`filename`");
      expect(sql).toContain("`sha256`");
      expect(sql).toContain("`applied_by`");
      expect(sql).toContain("`duration_ms`");
      expect(sql).toContain("`error_json`");
      expect(sql).toContain("`applied_at`");

      // Dropped columns must NOT appear
      expect(sql).not.toMatch(/\bbatch\b/);
      expect(sql).not.toContain("`error_message`");
      expect(sql).not.toContain("`executed_at`");
    });
  });

  describe("SQLite", () => {
    it("emits INSERT with F11 columns and epoch-ms applied_at", async () => {
      const adapter = makeAdapter();

      await recordMigrationForTest(
        adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
        "sqlite",
        TEST_RECORD
      );

      const sql = adapter.executeQuery.mock.calls[0][0] as string;

      expect(sql).toContain('INTO "nextly_migrations"');
      expect(sql).toContain('"filename"');
      expect(sql).toContain('"sha256"');
      expect(sql).toContain('"error_json"');
      // SQLite stores applied_at as INTEGER (epoch ms).
      expect(sql).toContain("strftime('%s','now')");
      expect(sql).toContain("* 1000");

      // Dropped columns must NOT appear
      expect(sql).not.toMatch(/\bbatch\b/);
    });

    it("encodes error_json as plain TEXT (no ::jsonb cast)", async () => {
      const adapter = makeAdapter();

      await recordMigrationForTest(
        adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
        "sqlite",
        {
          ...TEST_RECORD,
          status: "failed",
          errorJson: { message: "constraint failed" },
        }
      );

      const sql = adapter.executeQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain("::jsonb");
      expect(sql).toContain("constraint failed");
    });
  });

  it("writes NULL for nullable fields when not provided", async () => {
    const adapter = makeAdapter();

    await recordMigrationForTest(
      adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
      "postgresql",
      {
        id: "00000000-0000-4000-a000-000000000002",
        filename: "20260429_154500_456_no_actor.sql",
        sha256: "b".repeat(64),
        status: "applied",
        appliedBy: null,
        durationMs: null,
        errorJson: null,
      }
    );

    const sql = adapter.executeQuery.mock.calls[0][0] as string;
    // Three NULLs: applied_by, duration_ms, error_json
    expect(sql.match(/NULL/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("escapes single quotes in filename + applied_by", async () => {
    const adapter = makeAdapter();

    await recordMigrationForTest(
      adapter as unknown as Parameters<typeof recordMigrationForTest>[0],
      "postgresql",
      {
        ...TEST_RECORD,
        filename: "weird'name.sql",
        appliedBy: "actor's-name",
      }
    );

    const sql = adapter.executeQuery.mock.calls[0][0] as string;
    expect(sql).toContain("weird''name.sql");
    expect(sql).toContain("actor''s-name");
  });
});
