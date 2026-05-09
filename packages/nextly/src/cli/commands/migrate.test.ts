// F11 PR 1: unit tests for the new `nextly_migrations` INSERT shape and
// the retry-of-failed-migration semantics.
//
// Captures the SQL emitted by `recordMigrationForTest` against a stub
// adapter and asserts it contains the F11 spec columns (filename, sha256,
// applied_by, duration_ms, error_json, applied_at) and DOES NOT contain
// the dropped columns (name, batch, checksum, error_message, executed_at).
//
// Drives one of the most load-bearing changes in PR 1: the column rename
// touches every read/write of the table; missing one would silently break
// production migration apply. Also covers the regression caught by code
// review where a failed migration would block its own retry.

import { describe, expect, it, vi } from "vitest";

import {
  findPendingMigrationsForTest,
  recordMigrationForTest,
} from "./migrate";

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
    it("emits INSERT with F11 columns and millisecond-precision applied_at", async () => {
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
      // F11 PR 1 review fix #3: SQLite applied_at is real ms-precision via
      // julianday(). Code-review revealed that strftime('%s','now') * 1000
      // is only second-precision — the *1000 just zero-pads.
      expect(sql).toContain("julianday('now')");
      expect(sql).toContain("86400000");

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

describe("findPendingMigrationsForTest (F11 PR 1 review fix #1)", () => {
  // Minimal logger stub. We don't expect MIGRATION_TAMPERED or _MISSING
  // exits in these scenarios so error/warn shouldn't fire unless asserted.
  function makeLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      header: vi.fn(),
      newline: vi.fn(),
      divider: vi.fn(),
      keyValue: vi.fn(),
      item: vi.fn(),
      table: vi.fn(),
    };
  }

  const FILE_X = {
    name: "20260429_154500_001_add_excerpt",
    filePath: "/tmp/migrations/20260429_154500_001_add_excerpt.sql",
    upSql: "ALTER TABLE posts ADD COLUMN excerpt TEXT;",
    downSql: "",
    checksum: "x".repeat(64),
    collections: ["posts"],
    singles: [],
    components: [],
    timestamp: "20260429_154500_001",
    source: "app" as const,
  };

  it("treats a status='applied' row as already-applied (skips)", () => {
    const logger = makeLogger();
    const pending = findPendingMigrationsForTest(
      [FILE_X],
      [
        {
          id: "00000000-0000-4000-a000-000000000001",
          filename: FILE_X.name,
          sha256: FILE_X.checksum,
          status: "applied",
          appliedBy: "test",
          durationMs: 10,
          errorJson: null,
          appliedAt: new Date(),
        },
      ],
      logger as unknown as Parameters<typeof findPendingMigrationsForTest>[2]
    );
    expect(pending).toHaveLength(0);
  });

  it("treats a status='failed' row as PENDING so the retry runs", () => {
    // The whole point of fix #1: a failed row should not block its own
    // retry. Operator fixed the SQL or fixed the upstream issue and
    // re-ran `nextly migrate`; the file should still be in the pending
    // set.
    const logger = makeLogger();
    const pending = findPendingMigrationsForTest(
      [FILE_X],
      [
        {
          id: "00000000-0000-4000-a000-000000000002",
          filename: FILE_X.name,
          sha256: FILE_X.checksum,
          status: "failed",
          appliedBy: "test",
          durationMs: 5,
          errorJson: { message: "previous failure" },
          appliedAt: new Date(),
        },
      ],
      logger as unknown as Parameters<typeof findPendingMigrationsForTest>[2]
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe(FILE_X.name);
  });

  it("does not fire MIGRATION_MISSING for a failed row pointing at a deleted file", () => {
    // A failed row pointing at a now-deleted file is just stale state
    // from a prior failed run — not a missing applied migration. We
    // shouldn't process.exit(3) on this.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const logger = makeLogger();

    findPendingMigrationsForTest(
      [], // No files on disk
      [
        {
          id: "00000000-0000-4000-a000-000000000003",
          filename: "20260101_000000_000_deleted.sql",
          sha256: "y".repeat(64),
          status: "failed",
          appliedBy: "test",
          durationMs: 5,
          errorJson: null,
          appliedAt: new Date(),
        },
      ],
      logger as unknown as Parameters<typeof findPendingMigrationsForTest>[2]
    );

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("DOES fire MIGRATION_MISSING for an applied row pointing at a deleted file", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const logger = makeLogger();

    findPendingMigrationsForTest(
      [],
      [
        {
          id: "00000000-0000-4000-a000-000000000004",
          filename: "20260101_000000_000_was_applied.sql",
          sha256: "z".repeat(64),
          status: "applied",
          appliedBy: "test",
          durationMs: 5,
          errorJson: null,
          appliedAt: new Date(),
        },
      ],
      logger as unknown as Parameters<typeof findPendingMigrationsForTest>[2]
    );

    expect(exitSpy).toHaveBeenCalledWith(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("MIGRATION_MISSING")
    );
    exitSpy.mockRestore();
  });

  it("DOES fire MIGRATION_TAMPERED when an applied file's hash differs", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const logger = makeLogger();
    const tamperedFile = {
      ...FILE_X,
      checksum: "DIFFERENT".padEnd(64, "0"),
    };

    findPendingMigrationsForTest(
      [tamperedFile],
      [
        {
          id: "00000000-0000-4000-a000-000000000005",
          filename: FILE_X.name,
          sha256: FILE_X.checksum,
          status: "applied",
          appliedBy: "test",
          durationMs: 5,
          errorJson: null,
          appliedAt: new Date(),
        },
      ],
      logger as unknown as Parameters<typeof findPendingMigrationsForTest>[2]
    );

    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("MIGRATION_TAMPERED")
    );
    exitSpy.mockRestore();
  });
});
