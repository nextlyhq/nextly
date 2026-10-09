/**
 * @module domains/schema/migrate/resolve.test
 * @since v0.0.3-alpha
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
      dialect: "sqlite" as const,
      repo,
      fileExists: () => Promise.resolve(true),
      loadTargetSnapshot: () => Promise.resolve(ONE_TABLE),
      introspectLive: () => Promise.resolve(ONE_TABLE),
      marksNoTransaction: () => Promise.resolve(false),
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

    it("refuses a plugin module, naming the recovery that records it", async () => {
      // A module recorded here would leave the tables it owns without an
      // owner row; `nextly migrate` records both.
      const { repo, base } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: "plugin:@acme/fx/001_init",
        startedAt: new Date(1),
      });
      await expect(
        resolveMigration({
          mode: "applied",
          filename: "plugin:@acme/fx/001_init",
          ...base,
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
        publicMessage: expect.stringContaining(
          "Run `nextly migrate:resolve --failed-cleanup plugin:@acme/fx/001_init` and then `nextly migrate`"
        ) as unknown,
      });
      const rows = await repo.findFileApplies("plugin:@acme/fx/001_init");
      expect(rows.map(row => row.status)).toEqual(["failed"]);
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

    it("supersedes every failed attempt since the file's last other event", async () => {
      const { repo, base } = makeDeps(testDb);
      const ids: string[] = [];
      for (const t of [1, 2]) {
        ids.push(
          await repo.insertEvent({
            eventType: "file_apply",
            status: "failed",
            source: "cli-migrate",
            filename: "001_add_posts.sql",
            startedAt: new Date(t),
          })
        );
      }
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r).toMatchObject({ kind: "applied", supersededFailedId: ids[1] });
      for (const id of ids) {
        expect((await repo.findById(id))?.status).toBe("superseded");
      }
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

    it("records a no-transaction file that has no snapshot, without --skip-verify", async () => {
      // The file a partial failure tells the operator to mark applied. It is
      // written by `migrate:create --blank --no-transaction`, which pairs no
      // snapshot with it, so there is nothing to compare and refusing it
      // made the advised recovery fail.
      const { repo, base } = makeDeps(testDb, {
        loadTargetSnapshot: () => Promise.resolve(null),
        marksNoTransaction: () => Promise.resolve(true),
        introspectLive: () =>
          Promise.reject(new Error("nothing to compare it with")),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "002_backfill.sql",
        ...base,
      });
      expect(r).toMatchObject({ kind: "applied", verified: false });
      const rows = await repo.findFileApplies("002_backfill.sql");
      expect(rows.map(row => row.status)).toEqual(["applied"]);
    });

    it("supersedes an attempt that recorded no outcome with the failures before it", async () => {
      // A process killed mid-attempt leaves its row `in_progress`; it is as
      // unaccounted for as a failure, so recording the file retires it too.
      const { repo, base } = makeDeps(testDb);
      const ids = [
        await repo.insertEvent({
          eventType: "file_apply",
          status: "failed",
          source: "cli-migrate",
          filename: "001_add_posts.sql",
          startedAt: new Date(1),
        }),
        await repo.insertEvent({
          eventType: "file_apply",
          status: "in_progress",
          source: "cli-migrate",
          filename: "001_add_posts.sql",
          startedAt: new Date(2),
        }),
      ];
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r).toMatchObject({ kind: "applied", supersededFailedId: ids[1] });
      for (const id of ids) {
        expect((await repo.findById(id))?.status).toBe("superseded");
      }
    });

    it("records on MySQL an unmarked file with no snapshot whose newest attempt recorded no outcome", async () => {
      const { repo, base } = makeDeps(testDb, {
        dialect: "mysql",
        loadTargetSnapshot: () => Promise.resolve(null),
        introspectLive: () =>
          Promise.reject(new Error("nothing to compare it with")),
      });
      await repo.insertEvent({
        eventType: "file_apply",
        status: "in_progress",
        source: "cli-migrate",
        filename: "003_seed.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "003_seed.sql",
        ...base,
      });
      expect(r).toMatchObject({ kind: "applied", verified: false });
    });

    it("records on MySQL an unmarked file with no snapshot whose newest attempt failed, without --skip-verify", async () => {
      // On MySQL a partial-failure refusal tells the operator to mark such a
      // file applied once it is finished by hand, and an unmarked
      // `migrate:create --blank` file has no snapshot to compare against.
      const { repo, base } = makeDeps(testDb, {
        dialect: "mysql",
        loadTargetSnapshot: () => Promise.resolve(null),
        introspectLive: () =>
          Promise.reject(new Error("nothing to compare it with")),
      });
      const failedId = await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: "003_seed.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "applied",
        filename: "003_seed.sql",
        ...base,
      });
      expect(r).toMatchObject({
        kind: "applied",
        verified: false,
        supersededFailedId: failedId,
      });
    });

    it.each(["postgresql", "sqlite"] as const)(
      "still refuses on %s an unmarked file with no snapshot whose newest attempt failed",
      async dialect => {
        // That attempt ran in a transaction this database undid whole, so
        // none of the file ran, and recording it unchecked would record a
        // file that never ran.
        const { repo, base } = makeDeps(testDb, {
          dialect,
          loadTargetSnapshot: () => Promise.resolve(null),
        });
        await repo.insertEvent({
          eventType: "file_apply",
          status: "failed",
          source: "cli-migrate",
          filename: "003_seed.sql",
          startedAt: new Date(1),
        });
        await expect(
          resolveMigration({
            mode: "applied",
            filename: "003_seed.sql",
            ...base,
          })
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING" });
        const rows = await repo.findFileApplies("003_seed.sql");
        expect(rows.map(row => row.status)).toEqual(["failed"]);
      }
    );

    it("still refuses an unmarked file with no snapshot whose newest attempt did not fail", async () => {
      // A failed attempt that was cleared is no longer the newest, so the
      // file is back to an ordinary file whose snapshot is missing.
      const { repo, base } = makeDeps(testDb, {
        loadTargetSnapshot: () => Promise.resolve(null),
      });
      await repo.insertEvent({
        eventType: "file_apply",
        status: "failed",
        source: "cli-migrate",
        filename: "003_seed.sql",
        startedAt: new Date(1),
      });
      await repo.insertEvent({
        eventType: "file_apply",
        status: "rolled_back",
        source: "cli-migrate",
        filename: "003_seed.sql",
        startedAt: new Date(2),
      });
      await expect(
        resolveMigration({ mode: "applied", filename: "003_seed.sql", ...base })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING" });
    });

    it("still compares a no-transaction file that does have a snapshot", async () => {
      const { base } = makeDeps(testDb, {
        marksNoTransaction: () => Promise.resolve(true),
        introspectLive: () => Promise.resolve(EMPTY), // live != target
      });
      await expect(
        resolveMigration({ mode: "applied", filename: "x.sql", ...base })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_RESOLVE_DRIFT" });
    });

    it("reports a compared file as verified", async () => {
      const { base } = makeDeps(testDb);
      await expect(
        resolveMigration({ mode: "applied", filename: "x.sql", ...base })
      ).resolves.toMatchObject({ kind: "applied", verified: true });
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

    it("records a plugin module's rollback under its qualified key", async () => {
      // A plugin module's ledger key is `plugin:<name>/<module>`, with no
      // extension. Recorded under any other spelling, the rollback finds no
      // applied row to retire, and the module's newest state stays `applied`.
      const { repo, base } = makeDeps(testDb);
      await repo.insertEvent({
        eventType: "file_apply",
        status: "applied",
        source: "cli-migrate",
        filename: "plugin:@acme/fx/001_init",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "rolled-back",
        filename: "plugin:@acme/fx/001_init",
        ...base,
      });
      expect(r.kind).toBe("rolled-back");
      const rows = await repo.findFileApplies("plugin:@acme/fx/001_init");
      expect(rows.map(x => x.status).sort()).toEqual([
        "rolled_back",
        "superseded",
      ]);
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

    it("clears every failed attempt since the file's last other event, in one run", async () => {
      // Two failed retries in a row. Clearing only one left the other as the
      // newest attempt, and `nextly migrate` still refused the file.
      const { repo, base } = makeDeps(testDb);
      const file = "001_add_posts.sql";
      const at = (status: "failed" | "applied" | "rolled_back", t: number) =>
        repo.insertEvent({
          eventType: "file_apply",
          status,
          source: "cli-migrate",
          filename: file,
          startedAt: new Date(t),
        });
      const recovered = await at("failed", 1);
      await at("applied", 2);
      await at("rolled_back", 3);
      const older = await at("failed", 4);
      const newer = await at("failed", 5);

      const r = await resolveMigration({
        mode: "failed-cleanup",
        filename: file,
        ...base,
      });
      expect(r).toEqual({ kind: "failed-cleanup", updatedIds: [newer, older] });
      const status = async (id: string) => (await repo.findById(id))?.status;
      expect(await status(newer)).toBe("rolled_back");
      expect(await status(older)).toBe("rolled_back");
      // A failure the file later recovered from stays as recorded.
      expect(await status(recovered)).toBe("failed");
      expect(await repo.findFileApplies(file)).toHaveLength(5);
    });

    it("clears an attempt that recorded no outcome, giving it an end", async () => {
      const { repo, base } = makeDeps(testDb);
      const id = await repo.insertEvent({
        eventType: "file_apply",
        status: "in_progress",
        source: "cli-migrate",
        filename: "001_add_posts.sql",
        startedAt: new Date(1),
      });
      const r = await resolveMigration({
        mode: "failed-cleanup",
        filename: "001_add_posts.sql",
        ...base,
      });
      expect(r).toEqual({ kind: "failed-cleanup", updatedIds: [id] });
      const row = await repo.findById(id);
      expect(row?.status).toBe("rolled_back");
      expect(row?.endedAt).not.toBeNull();
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

  describe("modes that do not verify", () => {
    // These are the modes an operator reaches for when something is already
    // broken, so everything the equivalence check needs — the live database,
    // the Builder manifest, the resolved schema — has to stay out of their
    // path. The caller relies on this to defer that work into the callback:
    // if any of these ever started verifying, the deferral would silently
    // stop protecting them.
    const exploding = {
      introspectLive: (): Promise<NextlySchemaSnapshot> => {
        throw new Error("verification input must not be built for this mode");
      },
    };

    it("--rolled-back never builds the verification input", async () => {
      const { repo, base } = makeDeps(testDb, exploding);
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
    });

    it("--failed-cleanup never builds the verification input", async () => {
      const { repo, base } = makeDeps(testDb, exploding);
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
    });

    it("--applied with skipVerify never builds the verification input", async () => {
      const { base } = makeDeps(testDb, exploding);
      const r = await resolveMigration({
        mode: "applied",
        filename: "001_add_posts.sql",
        skipVerify: true,
        ...base,
      });
      expect(r.kind).toBe("applied");
    });
  });
});
