/**
 * @module domains/schema/migrate/resolve.test
 * @since v0.0.3-alpha (Plan C3)
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { getCoreSchema } from "../../../schemas";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { resolveMigration } from "./resolve";

// Real table specs so the diff engine compares well-formed snapshots.
const FULL = getCoreSchema("sqlite");
const EMPTY: NextlySchemaSnapshot = { tables: [] };
const ONE_TABLE: NextlySchemaSnapshot = { tables: FULL.tables.slice(0, 1) };

function makeDeps(
  testDb: TestDb,
  over: Partial<Parameters<typeof resolveMigration>[0]> = {}
) {
  const repo = new SchemaEventsRepository(testDb.db, "sqlite");
  return {
    repo,
    base: {
      repo,
      fileExists: () => Promise.resolve(true),
      loadTargetSnapshot: () => Promise.resolve(ONE_TABLE),
      introspectLive: () => Promise.resolve(ONE_TABLE),
      ...over,
    },
  };
}

describe("resolveMigration", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
  });

  describe("--applied", () => {
    it("records an applied file_apply row with statements=0 + note", async () => {
      const { repo, base } = makeDeps(testDb);
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("applied");
      const rows = await repo.findFileApplies("001_add_posts.sql");
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("applied");
      expect(rows[0].statementsExecuted).toBe(0);
      expect(rows[0].note).toBe("manual-resolve");
    });

    it("supersedes a prior failed row", async () => {
      const { repo, base } = makeDeps(testDb);
      const failedId = await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("applied");
      const failed = await repo.findById(failedId);
      expect(failed?.status).toBe("superseded");
      expect(failed?.supersededBy).toBe((r as { eventId: string }).eventId);
    });

    it("is idempotent when already applied (no new row)", async () => {
      const { repo, base } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "applied",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("noop");
      expect(await repo.findFileApplies("001_add_posts.sql")).toHaveLength(1);
    });

    it("throws FILE_MISSING when the .sql is absent", async () => {
      const { base } = makeDeps(testDb, {
        fileExists: () => Promise.resolve(false),
      });
      await expect(
        resolveMigration({ mode: "applied", filename: "x.sql", ...base })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_FILE_MISSING" });
    });

    it("throws SNAPSHOT_MISSING when the paired snapshot is absent", async () => {
      const { base } = makeDeps(testDb, {
        loadTargetSnapshot: () => Promise.resolve(null),
      });
      await expect(
        resolveMigration({ mode: "applied", filename: "x.sql", ...base })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING" });
    });

    it("throws RESOLVE_DRIFT when live diverges from the target snapshot", async () => {
      const { base } = makeDeps(testDb, {
        introspectLive: () => Promise.resolve(EMPTY), // live != target
      });
      await expect(
        resolveMigration({ mode: "applied", filename: "x.sql", ...base })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_RESOLVE_DRIFT" });
    });

    it("--skip-verify bypasses the drift check", async () => {
      const { repo, base } = makeDeps(testDb, {
        introspectLive: () =>
          Promise.reject(new Error("should not introspect")),
        loadTargetSnapshot: () =>
          Promise.reject(new Error("should not load snapshot")),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        skipVerify: true,
        ...base,
      });
      expect(r.kind).toBe("applied");
      expect(await repo.findFileApplies("001_add_posts.sql")).toHaveLength(1);
    });
  });

  describe("--rolled-back", () => {
    it("records a rolled_back row when a prior applied row exists", async () => {
      const { repo, base } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "applied",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "rolled-back",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("rolled-back");
      const rows = await repo.findFileApplies("001_add_posts.sql");
      expect(rows.some(x => x.status === "rolled_back")).toBe(true);
      // The prior applied row must be retired (superseded), else the partial
      // unique index blocks re-apply on the next `migrate`.
      expect(rows.some(x => x.status === "applied")).toBe(false);
    });

    it("throws PRECONDITION when no applied row exists", async () => {
      const { base } = makeDeps(testDb);
      await expect(
        resolveMigration({
          mode: "rolled-back",
          filename: "001_add_posts.sql",
          ...base,
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      });
    });
  });

  describe("--failed-cleanup", () => {
    it("flips a failed row to rolled_back (no new row)", async () => {
      const { repo, base } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "failed-cleanup",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("failed-cleanup");
      const rows = await repo.findFileApplies("001_add_posts.sql");
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("rolled_back");
    });

    it("is idempotent when already rolled_back", async () => {
      const { base } = makeDeps(testDb);
      const { repo } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "rolled_back",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "failed-cleanup",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r.kind).toBe("noop");
    });

    it("throws PRECONDITION when there is no failed row", async () => {
      const { base } = makeDeps(testDb);
      await expect(
        resolveMigration({
          mode: "failed-cleanup",
          filename: "001_add_posts.sql",
          ...base,
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      });
    });
  });
});
