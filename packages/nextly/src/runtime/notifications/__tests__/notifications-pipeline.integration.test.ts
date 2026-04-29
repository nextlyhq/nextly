// F10 PR 3 — pipeline → notify() integration test.
//
// Wires a fake Notifier into a real PushSchemaPipeline + real PG and
// verifies that a successful apply triggers exactly one notification
// event with the expected shape (ts/source/scope/summary/durationMs/
// journalId).
//
// Auto-skips when TEST_POSTGRES_URL isn't set. CI runs it with the
// env var set per F18 infra. Local devs can run it via:
//   TEST_POSTGRES_URL=postgresql://… pnpm exec vitest run …integration

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../database/__tests__/integration/helpers/test-db.js";
import { RealClassifier } from "../../../domains/schema/pipeline/classifier/classifier.js";
import { RealPreCleanupExecutor } from "../../../domains/schema/pipeline/pre-cleanup/executor.js";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../../../domains/schema/pipeline/pushschema-pipeline-stubs.js";
import { PushSchemaPipeline } from "../../../domains/schema/pipeline/pushschema-pipeline.js";
import { DrizzleStatementExecutor } from "../../../domains/schema/services/drizzle-statement-executor.js";
import type { DesiredSchema } from "../../../domains/schema/pipeline/types.js";
import { createNotifier } from "../dispatcher.js";
import type {
  MigrationNotificationEvent,
  NotificationChannel,
} from "../types.js";

const ctx = makeTestContext("postgresql");

describe("Notifications pipeline — real-PG integration", () => {
  if (!ctx.available || !ctx.url) {
    it.skip("Skipping — TEST_POSTGRES_URL not set", () => {});
    return;
  }

  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: ctx.url ?? undefined });
    db = drizzle(pool);

    // Pre-clean — pushSchema will create our managed table fresh.
    await pool.query(`DROP TABLE IF EXISTS "${ctx.prefix}_dc_posts" CASCADE`);
  });

  afterAll(async () => {
    if (pool) {
      await pool
        .query(`DROP TABLE IF EXISTS "${ctx.prefix}_dc_posts" CASCADE`)
        .catch(() => {});
      await pool.end();
    }
  });

  it("fires exactly one notify() event after a successful apply", async () => {
    const captured: MigrationNotificationEvent[] = [];
    const captureChannel: NotificationChannel = {
      name: "capture",
      write: e => {
        captured.push(e);
        return Promise.resolve();
      },
    };
    const notifier = createNotifier({ channels: [captureChannel] });

    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("postgresql", db),
        renameDetector: noopRenameDetector,
        classifier: new RealClassifier(),
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: noopMigrationJournal,
        notifier,
      },
      {
        // Stub pushSchema so the test isolates the pipeline +
        // notifier wiring, not drizzle-kit's diff. The fake returns
        // a single CREATE TABLE statement to feed the executor.
        _kitOverride: {
          pushSchema: () =>
            Promise.resolve({
              statementsToExecute: [
                `CREATE TABLE "${ctx.prefix}_dc_posts" (id text primary key, title text)`,
              ],
              hasDataLoss: false,
              warnings: [],
            }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: `${ctx.prefix}_dc_posts`,
          fields: [
            { name: "title", type: "text" },
          ] as DesiredSchema["collections"][string]["fields"],
        },
      },
      singles: {},
      components: {},
    };

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "terminal",
      uiTargetSlug: "posts",
    });

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);

    const e = captured[0];
    expect(e.status).toBe("success");
    expect(e.source).toBe("ui");
    expect(e.scope).toEqual({ kind: "collection", slug: "posts" });
    if (e.status === "success") {
      // create_table counts as added.
      expect(e.summary.added).toBeGreaterThanOrEqual(1);
    }
    expect(typeof e.durationMs).toBe("number");
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof e.journalId).toBe("string");
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("fires a failure event when the executor throws", async () => {
    const captured: MigrationNotificationEvent[] = [];
    const captureChannel: NotificationChannel = {
      name: "capture",
      write: e => {
        captured.push(e);
        return Promise.resolve();
      },
    };
    const notifier = createNotifier({ channels: [captureChannel] });

    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("postgresql", db),
        renameDetector: noopRenameDetector,
        classifier: new RealClassifier(),
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: noopMigrationJournal,
        notifier,
      },
      {
        _kitOverride: {
          pushSchema: () =>
            Promise.resolve({
              // Intentionally invalid SQL → DDL_EXECUTION_FAILED.
              statementsToExecute: ["CREATE TABLE invalid syntax oops"],
              hasDataLoss: false,
              warnings: [],
            }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: `${ctx.prefix}_dc_posts_bad`,
          fields: [
            { name: "title", type: "text" },
          ] as DesiredSchema["collections"][string]["fields"],
        },
      },
      singles: {},
      components: {},
    };

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    expect(captured).toHaveLength(1);

    const e = captured[0];
    expect(e.status).toBe("failed");
    expect(e.source).toBe("code");
    expect(e.scope).toEqual({ kind: "global" });
    if (e.status === "failed") {
      expect(e.error.message).toBeTruthy();
    }
  });

  it("isolates a failing channel — apply still succeeds", async () => {
    const failingChannel: NotificationChannel = {
      name: "fail",
      write: () => Promise.reject(new Error("boom")),
    };
    const successCalls: MigrationNotificationEvent[] = [];
    const successChannel: NotificationChannel = {
      name: "ok",
      write: e => {
        successCalls.push(e);
        return Promise.resolve();
      },
    };
    const warns: string[] = [];
    const notifier = createNotifier({
      channels: [failingChannel, successChannel],
      logger: { warn: m => warns.push(m) },
    });

    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("postgresql", db),
        renameDetector: noopRenameDetector,
        classifier: new RealClassifier(),
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: noopMigrationJournal,
        notifier,
      },
      {
        _kitOverride: {
          pushSchema: () =>
            Promise.resolve({
              statementsToExecute: [
                `CREATE TABLE "${ctx.prefix}_dc_isolation" (id text primary key)`,
              ],
              hasDataLoss: false,
              warnings: [],
            }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: `${ctx.prefix}_dc_isolation`,
          fields: [] as DesiredSchema["collections"][string]["fields"],
        },
      },
      singles: {},
      components: {},
    };

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "terminal",
      uiTargetSlug: "posts",
    });

    expect(result.success).toBe(true);
    expect(successCalls).toHaveLength(1);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("[notifications] fail channel failed");

    await pool.query(`DROP TABLE IF EXISTS "${ctx.prefix}_dc_isolation"`).catch(() => {});
  });
});
