import { describe, expect, it, vi, type Mock } from "vitest";

import type { DesiredSchema } from "../types.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs.js";
import type {
  Classifier,
  DrizzleStatementExecutor,
  MigrationJournal,
  PreRenameExecutor,
  PromptDispatcher,
  RenameDetector,
} from "../pushschema-pipeline-interfaces.js";

import { PushSchemaPipeline } from "../pushschema-pipeline.js";

// Build a stub pipeline with mockable deps. Each mock is a typed vi.fn
// so the deps satisfy the strict interface contracts (and tests still
// have access to .toHaveBeenCalledWith etc. via the mock type).
function makePipeline(
  overrides: {
    executor?: {
      executeStatements: Mock<DrizzleStatementExecutor["executeStatements"]>;
    };
    renameDetector?: { detect: Mock<RenameDetector["detect"]> };
    classifier?: { classify: Mock<Classifier["classify"]> };
    promptDispatcher?: { dispatch: Mock<PromptDispatcher["dispatch"]> };
    preRenameExecutor?: { execute: Mock<PreRenameExecutor["execute"]> };
    migrationJournal?: {
      recordStart: Mock<MigrationJournal["recordStart"]>;
      recordEnd: Mock<MigrationJournal["recordEnd"]>;
    };
    pushSchemaImpl?: Mock<
      (
        schema: Record<string, unknown>,
        db: unknown
      ) => Promise<{
        statementsToExecute: string[];
        warnings: string[];
        hasDataLoss: boolean;
      }>
    >;
    dbTransactionImpl?: Mock<
      <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
    >;
  } = {}
) {
  const executor = overrides.executor ?? {
    executeStatements: vi
      .fn<DrizzleStatementExecutor["executeStatements"]>()
      .mockResolvedValue(undefined),
  };
  const renameDetector = overrides.renameDetector ?? {
    detect: vi
      .fn<RenameDetector["detect"]>()
      .mockImplementation(noopRenameDetector.detect),
  };
  const classifier = overrides.classifier ?? {
    classify: vi
      .fn<Classifier["classify"]>()
      .mockImplementation(noopClassifier.classify),
  };
  const promptDispatcher = overrides.promptDispatcher ?? {
    dispatch: vi
      .fn<PromptDispatcher["dispatch"]>()
      .mockImplementation(noopPromptDispatcher.dispatch),
  };
  const preRenameExecutor = overrides.preRenameExecutor ?? {
    execute: vi
      .fn<PreRenameExecutor["execute"]>()
      .mockImplementation(noopPreRenameExecutor.execute),
  };
  const migrationJournal = overrides.migrationJournal ?? {
    recordStart: vi
      .fn<MigrationJournal["recordStart"]>()
      .mockImplementation(noopMigrationJournal.recordStart),
    recordEnd: vi
      .fn<MigrationJournal["recordEnd"]>()
      .mockImplementation(noopMigrationJournal.recordEnd),
  };

  // Mock pushSchema: returns no statements by default.
  const pushSchemaImpl =
    overrides.pushSchemaImpl ??
    vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown
        ) => Promise<{
          statementsToExecute: string[];
          warnings: string[];
          hasDataLoss: boolean;
        }>
      >()
      .mockResolvedValue({
        statementsToExecute: [],
        warnings: [],
        hasDataLoss: false,
      });

  // Mock db.transaction: invokes the callback with a fake tx and returns
  // its result. vi.fn cannot preserve the generic <T> in the runner
  // signature, so we cast at the construction site — the generic is
  // type-erased at runtime anyway.
  const dbTransactionImpl =
    overrides.dbTransactionImpl ??
    vi
      .fn<<T>(fn: (tx: unknown) => Promise<T>) => Promise<T>>()
      .mockImplementation(async fn => fn({}));

  const pipeline = new PushSchemaPipeline(
    {
      executor,
      renameDetector,
      classifier,
      promptDispatcher,
      preRenameExecutor,
      migrationJournal,
    },
    {
      _kitOverride: { pushSchema: pushSchemaImpl },
      _buildDrizzleSchemaOverride: () => ({}),
      _txOverride: dbTransactionImpl as <T>(
        fn: (tx: unknown) => Promise<T>
      ) => Promise<T>,
    }
  );

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

  it("KEEPS schema-qualified DROP TABLE for managed tables (PG; regex must capture the bare table name)", async () => {
    // Regression for review C1: an earlier regex iteration captured
    // only the schema half of `"public"."dc_old_collection"` and
    // stripped the legitimate managed-table DROP. This test prevents
    // that regression.
    const pushSchemaImpl = vi.fn().mockResolvedValue({
      statementsToExecute: [
        'DROP TABLE "public"."dc_old_collection"',
        "DROP TABLE `public`.`single_archived`",
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
        'DROP TABLE "public"."dc_old_collection"',
        "DROP TABLE `public`.`single_archived`",
      ]
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
  it("returns PUSHSCHEMA_FAILED when pushSchema throws (typed via try/catch around the call)", async () => {
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl: vi
        .fn<
          (
            schema: Record<string, unknown>,
            db: unknown
          ) => Promise<{
            statementsToExecute: string[];
            warnings: string[];
            hasDataLoss: boolean;
          }>
        >()
        .mockRejectedValue(new Error("connection refused")),
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
