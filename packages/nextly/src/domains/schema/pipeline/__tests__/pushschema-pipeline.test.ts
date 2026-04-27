import { describe, expect, it, vi } from "vitest";

import type { DesiredSchema } from "../types.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs.js";

import { PushSchemaPipeline } from "../pushschema-pipeline.js";

// Build a stub pipeline with mockable deps. Each mock is a vi.fn so tests
// can override per scenario.
function makePipeline(
  overrides: {
    executor?: { executeStatements: ReturnType<typeof vi.fn> };
    renameDetector?: { detect: ReturnType<typeof vi.fn> };
    classifier?: { classify: ReturnType<typeof vi.fn> };
    promptDispatcher?: { dispatch: ReturnType<typeof vi.fn> };
    preRenameExecutor?: { execute: ReturnType<typeof vi.fn> };
    migrationJournal?: {
      recordStart: ReturnType<typeof vi.fn>;
      recordEnd: ReturnType<typeof vi.fn>;
    };
    pushSchemaImpl?: ReturnType<typeof vi.fn>;
    dbTransactionImpl?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const executor = overrides.executor ?? {
    executeStatements: vi.fn().mockResolvedValue(undefined),
  };
  const renameDetector = overrides.renameDetector ?? {
    detect: vi.fn(noopRenameDetector.detect),
  };
  const classifier = overrides.classifier ?? {
    classify: vi.fn(noopClassifier.classify),
  };
  const promptDispatcher = overrides.promptDispatcher ?? {
    dispatch: vi.fn(noopPromptDispatcher.dispatch),
  };
  const preRenameExecutor = overrides.preRenameExecutor ?? {
    execute: vi.fn(noopPreRenameExecutor.execute),
  };
  const migrationJournal = overrides.migrationJournal ?? {
    recordStart: vi.fn(noopMigrationJournal.recordStart),
    recordEnd: vi.fn(noopMigrationJournal.recordEnd),
  };

  // Mock pushSchema: returns no statements by default.
  const pushSchemaImpl =
    overrides.pushSchemaImpl ??
    vi.fn().mockResolvedValue({
      statementsToExecute: [],
      warnings: [],
      hasDataLoss: false,
    });

  // Mock db.transaction: invokes the callback with a fake tx and returns
  // its result.
  const dbTransactionImpl =
    overrides.dbTransactionImpl ??
    vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));

  const pipeline = new PushSchemaPipeline({
    executor,
    renameDetector,
    classifier,
    promptDispatcher,
    preRenameExecutor,
    migrationJournal,
    _kitOverride: { pushSchema: pushSchemaImpl },
    _buildDrizzleSchemaOverride: () => ({}),
    _txOverride: dbTransactionImpl,
  });

  return {
    pipeline,
    mocks: {
      executor,
      renameDetector,
      classifier,
      promptDispatcher,
      preRenameExecutor,
      migrationJournal,
      pushSchema: pushSchemaImpl,
      dbTransaction: dbTransactionImpl,
    },
  };
}

const emptyDesired: DesiredSchema = {
  collections: {},
  singles: {},
  components: {},
};

const onePostsCollection: DesiredSchema = {
  collections: {
    posts: { slug: "posts", tableName: "dc_posts", fields: [] },
  },
  singles: {},
  components: {},
};

describe("PushSchemaPipeline (safe path with all stubs)", () => {
  it("returns success when no statements to execute", async () => {
    const { pipeline, mocks } = makePipeline();

    const result = await pipeline.apply({
      desired: emptyDesired,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);
    expect(result.statementsExecuted).toBe(0);
    expect(result.renamesApplied).toBe(0);
    expect(mocks.migrationJournal.recordStart).toHaveBeenCalledOnce();
    expect(mocks.migrationJournal.recordEnd).toHaveBeenCalledOnce();
  });

  it("calls pushSchema TWICE (first pass + second pass after pre-rename)", async () => {
    const { pipeline, mocks } = makePipeline();

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.pushSchema).toHaveBeenCalledTimes(2);
  });

  it("does NOT call PromptDispatcher when classifier returns 'safe' and no candidates", async () => {
    const { pipeline, mocks } = makePipeline();

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.promptDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("calls PreRenameExecutor with empty array (no confirmed renames)", async () => {
    const { pipeline, mocks } = makePipeline();

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.preRenameExecutor.execute).toHaveBeenCalledWith(
      expect.anything(),
      []
    );
  });

  it("passes statements from second pushSchema pass to executor", async () => {
    const pushSchemaImpl = vi
      .fn()
      .mockResolvedValueOnce({
        statementsToExecute: ["ALTER TABLE dc_posts ADD COLUMN body text"],
        warnings: [],
        hasDataLoss: false,
      })
      .mockResolvedValueOnce({
        statementsToExecute: ["ALTER TABLE dc_posts ADD COLUMN body text"],
        warnings: [],
        hasDataLoss: false,
      });

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.executor.executeStatements).toHaveBeenCalledWith(
      expect.anything(),
      ["ALTER TABLE dc_posts ADD COLUMN body text"]
    );
    expect(result.statementsExecuted).toBe(1);
  });
});

describe("PushSchemaPipeline (non-safe path)", () => {
  it("calls PromptDispatcher when classifier returns 'destructive'", async () => {
    const { pipeline, mocks } = makePipeline({
      classifier: { classify: vi.fn().mockReturnValue("destructive") },
    });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(mocks.promptDispatcher.dispatch).toHaveBeenCalledWith({
      candidates: [],
      classification: "destructive",
      channel: "browser",
    });
  });

  it("forwards confirmed renames to PreRenameExecutor", async () => {
    const candidate = {
      tableName: "dc_posts",
      fromColumn: "title",
      toColumn: "name",
      fromType: "text",
      toType: "text",
      typesCompatible: true,
      defaultSuggestion: "rename" as const,
    };

    const { pipeline, mocks } = makePipeline({
      renameDetector: { detect: vi.fn().mockReturnValue([candidate]) },
      promptDispatcher: {
        dispatch: vi.fn().mockResolvedValue({
          confirmedRenames: [candidate],
          resolutions: {},
        }),
      },
    });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(mocks.preRenameExecutor.execute).toHaveBeenCalledWith(
      expect.anything(),
      [candidate]
    );
    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(1);
  });
});

describe("PushSchemaPipeline (unsafe-statement filtering)", () => {
  it("strips DROP TABLE for non-managed tables (e.g. user app tables)", async () => {
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: [
        "ALTER TABLE dc_posts ADD COLUMN body text",
        "DROP TABLE orders",
        "DROP TABLE analytics_events",
      ],
      warnings: [],
      hasDataLoss: false,
    });

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    // Executor sees only the managed-table ALTER, not the DROPs.
    expect(mocks.executor.executeStatements).toHaveBeenCalledWith(
      expect.anything(),
      ["ALTER TABLE dc_posts ADD COLUMN body text"]
    );
  });

  it("keeps DROP TABLE for managed tables (legitimate collection removal)", async () => {
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: [
        'DROP TABLE "dc_old_collection"',
        "DROP TABLE single_archived_homepage",
      ],
      warnings: [],
      hasDataLoss: false,
    });

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.executor.executeStatements).toHaveBeenCalledWith(
      expect.anything(),
      ['DROP TABLE "dc_old_collection"', "DROP TABLE single_archived_homepage"]
    );
  });

  it("strips schema-qualified DROP TABLE for non-managed tables (PG)", async () => {
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: [
        'DROP TABLE "public"."orders"',
        'ALTER TABLE "dc_posts" ADD COLUMN x text',
      ],
      warnings: [],
      hasDataLoss: false,
    });

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.executor.executeStatements).toHaveBeenCalledWith(
      expect.anything(),
      ['ALTER TABLE "dc_posts" ADD COLUMN x text']
    );
  });

  it("does not affect non-DROP statements (CREATE / ALTER pass through)", async () => {
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: [
        "CREATE TABLE dc_new_collection (id serial PRIMARY KEY)",
        "ALTER TABLE dc_posts DROP COLUMN obsolete",
      ],
      warnings: [],
      hasDataLoss: false,
    });

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.executor.executeStatements).toHaveBeenCalledWith(
      expect.anything(),
      [
        "CREATE TABLE dc_new_collection (id serial PRIMARY KEY)",
        "ALTER TABLE dc_posts DROP COLUMN obsolete",
      ]
    );
  });
});

describe("PushSchemaPipeline (error paths)", () => {
  it("returns PUSHSCHEMA_FAILED when pushSchema throws with drizzle-kit signature", async () => {
    const drizzleKitError = new Error("connection refused");
    drizzleKitError.stack =
      "Error: connection refused\n    at pushSchema (/node_modules/drizzle-kit/api.js:42:1)";
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl: vi.fn().mockRejectedValue(drizzleKitError),
    });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PUSHSCHEMA_FAILED");
    expect(mocks.migrationJournal.recordEnd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ success: false })
    );
  });

  it("returns DDL_EXECUTION_FAILED when executor throws", async () => {
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: ["ALTER TABLE x ADD y int"],
      warnings: [],
      hasDataLoss: false,
    });

    const { pipeline } = makePipeline({
      pushSchemaImpl,
      executor: {
        executeStatements: vi.fn().mockRejectedValue(new Error("syntax error")),
      },
    });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DDL_EXECUTION_FAILED");
  });

  it("calls journal.recordEnd on failure", async () => {
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl: vi.fn().mockRejectedValue(new Error("oops")),
    });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.migrationJournal.recordEnd).toHaveBeenCalledOnce();
  });
});
