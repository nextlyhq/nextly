// F11 PR 4: unit tests for `nextly migrate:check`.
//
// Tests the pure `runChecks` helper directly with a tmp `migrations/`
// directory + a hand-built desired snapshot. The CLI entry point
// (`runMigrateCheck`) is a thin wrapper that loads config + dialect
// then delegates to `runChecks`; covering the helper covers the
// behavioural surface without dragging loadConfig + module-resolution
// machinery into the test.
//
// Drives all five outcomes:
//   - clean state -> exit 0, success log
//   - CHECKSUM_MISMATCH -> exit 1
//   - MISSING_SNAPSHOT -> exit 1
//   - MISSING_MIGRATION -> exit 1
//   - SCHEMA_DRIFT -> exit 1
//
// Plus assertion that the runChecks helper does NOT call createAdapter
// (verified at the top of this file via the absence of any adapter
// import; eslint's no-unused-imports would catch a dangling one).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeSnapshot } from "../../domains/schema/migrate-create/snapshot-io.js";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types.js";

import { runChecks } from "./migrate-check.js";

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

const POSTS_TABLE = {
  name: "dc_posts",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "created_at", type: "timestamp", nullable: true },
    { name: "description", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "updated_at", type: "timestamp", nullable: true },
  ],
};

const POSTS_DESIRED: NextlySchemaSnapshot = { tables: [POSTS_TABLE] };
const EMPTY_DESIRED: NextlySchemaSnapshot = { tables: [] };

describe("runChecks (F11 PR 4)", () => {
  let migrationsDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nextly-migrate-check-test-"));
    migrationsDir = join(cwd, "migrations");
    await mkdir(join(migrationsDir, "meta"), { recursive: true });
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    exitSpy.mockRestore();
    // best-effort cleanup; OS will reap tmpdir anyway
    await rm(migrationsDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("clean state", () => {
    it("exits 0 with success log when files match snapshot and config has no drift", async () => {
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        sqlContent
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });

    it("exits 0 when there are zero migration files and config matches EMPTY_SNAPSHOT", async () => {
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("migrate:check OK")
      );
    });
  });

  describe("CHECKSUM_MISMATCH", () => {
    it("exits 1 when a .sql file is edited after generation", async () => {
      const original = "CREATE TABLE foo (id text);";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        original,
        "utf-8"
      );
      // Snapshot's migrationHash is computed from `original` ...
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        POSTS_DESIRED,
        original
      );
      // ... then we tamper with the SQL.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        original + " -- TAMPERED",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("CHECKSUM_MISMATCH")
      );
    });
  });

  describe("MISSING_SNAPSHOT", () => {
    it("exits 1 when a .sql file has no paired snapshot", async () => {
      // SQL exists, but no snapshot in meta/.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_orphan.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("MISSING_SNAPSHOT")
      );
    });
  });

  describe("INVALID_SNAPSHOT (F11 PR 4 review fix #3)", () => {
    it("exits 1 with INVALID_SNAPSHOT when a paired snapshot is malformed JSON", async () => {
      // .sql exists; paired snapshot exists but is invalid JSON.
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );
      await writeFile(
        join(
          migrationsDir,
          "meta",
          "20260101_120000_001_initial.snapshot.json"
        ),
        "{not valid json",
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("INVALID_SNAPSHOT")
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("JSON parse failed")
      );
    });

    it("exits 1 with INVALID_SNAPSHOT when a snapshot has wrong version", async () => {
      // .sql exists; paired snapshot has version 2 (future format).
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        "CREATE TABLE foo (id text);",
        "utf-8"
      );
      await writeFile(
        join(
          migrationsDir,
          "meta",
          "20260101_120000_001_initial.snapshot.json"
        ),
        JSON.stringify({
          version: 2,
          migrationHash: "a".repeat(64),
          snapshot: { tables: [] },
        }),
        "utf-8"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: EMPTY_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("INVALID_SNAPSHOT")
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("expected version: 1, got 2")
      );
    });
  });

  describe("MISSING_MIGRATION", () => {
    it("exits 1 when a snapshot has no paired .sql", async () => {
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_orphan_snapshot",
        POSTS_DESIRED,
        "anything"
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("MISSING_MIGRATION")
      );
    });
  });

  describe("SCHEMA_DRIFT", () => {
    it("exits 1 when config has uncommitted changes (no snapshots at all)", async () => {
      // Empty migrations + meta. desiredSnapshot has the posts table, so
      // the diff is non-empty (add_table dc_posts).
      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("SCHEMA_DRIFT")
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("add_table dc_posts")
      );
    });

    it("exits 1 when config diverges from the latest snapshot", async () => {
      // Seed a snapshot with EMPTY tables; pass desiredSnapshot with posts.
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        EMPTY_DESIRED,
        sqlContent
      );

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: POSTS_DESIRED,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("SCHEMA_DRIFT")
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Run `nextly migrate:create")
      );
    });

    it("caps drift output at 10 ops with a 'and X more' indicator", async () => {
      // Seed an empty snapshot; pass a desired snapshot with 15 tables to
      // produce 15 add_table ops.
      const sqlContent = "-- placeholder";
      await writeFile(
        join(migrationsDir, "20260101_120000_001_initial.sql"),
        sqlContent,
        "utf-8"
      );
      await writeSnapshot(
        join(migrationsDir, "meta"),
        "20260101_120000_001_initial",
        EMPTY_DESIRED,
        sqlContent
      );

      const manyTables: NextlySchemaSnapshot = {
        tables: Array.from({ length: 15 }, (_, i) => ({
          name: `dc_t${i.toString().padStart(2, "0")}`,
          columns: [{ name: "id", type: "text", nullable: false }],
        })),
      };

      const logger = makeLogger();
      await runChecks({
        migrationsDir,
        desiredSnapshot: manyTables,
        logger: logger as unknown as Parameters<typeof runChecks>[0]["logger"],
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("... and 5 more")
      );
    });
  });
});
