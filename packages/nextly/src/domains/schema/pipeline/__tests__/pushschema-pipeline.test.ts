// PushSchemaPipeline unit tests (F4 Option E flow).
//
// Tests the rewired pipeline:
//   Phase A: introspect live + diff -> ops
//   Phase B: rename detection + prompt + apply resolutions
//   Phase C: pre-resolution executor (renames + drops via our SQL)
//   Phase D: pushSchema for purely-additive remainder
//
// We mock all dependencies + test hooks so each test exercises the
// orchestrator in isolation without a real DB.

import { describe, expect, it, vi, type Mock } from "vitest";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot, Operation } from "../diff/types";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import type {
  Classifier,
  DrizzleStatementExecutor,
  MigrationJournal,
  PreRenameExecutor,
  PromptDispatcher,
  RenameCandidate,
  RenameDetector,
} from "../pushschema-pipeline-interfaces";

import { PushSchemaPipeline } from "../pushschema-pipeline";
import type { DesiredSchema } from "../types";

// =============================================================================
// Test harness
// =============================================================================

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
    introspectImpl?: Mock<
      (
        db: unknown,
        dialect: SupportedDialect,
        tableNames: string[]
      ) => Promise<NextlySchemaSnapshot>
    >;
    executePreResImpl?: Mock<
      (
        txOrDb: unknown,
        ops: Operation[],
        dialect: SupportedDialect
      ) => Promise<number>
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

  const dbTransactionImpl =
    overrides.dbTransactionImpl ??
    vi
      .fn<<T>(fn: (tx: unknown) => Promise<T>) => Promise<T>>()
      .mockImplementation(async fn => fn({}));

  // Default introspect override returns an empty snapshot. Tests that need
  // a non-empty previous-state snapshot pass their own.
  const introspectImpl =
    overrides.introspectImpl ??
    vi
      .fn<
        (
          db: unknown,
          dialect: SupportedDialect,
          tableNames: string[]
        ) => Promise<NextlySchemaSnapshot>
      >()
      .mockResolvedValue({ tables: [] });

  // Default pre-resolution mock just counts ops without running SQL.
  const executePreResImpl =
    overrides.executePreResImpl ??
    vi
      .fn<
        (
          txOrDb: unknown,
          ops: Operation[],
          dialect: SupportedDialect
        ) => Promise<number>
      >()
      .mockImplementation((_, ops) =>
        Promise.resolve(
          ops.filter(o =>
            [
              "rename_column",
              "rename_table",
              "drop_column",
              "drop_table",
            ].includes(o.type)
          ).length
        )
      );

  const pipeline = new PushSchemaPipeline(
    {
      executor,
      renameDetector,
      classifier,
      promptDispatcher,
      preRenameExecutor,
      preCleanupExecutor: noopPreCleanupExecutor,
      migrationJournal,
      notifier: noopNotifier,
    },
    {
      _kitOverride: { pushSchema: pushSchemaImpl },
      _buildDrizzleSchemaOverride: () => ({}),
      _txOverride: dbTransactionImpl as <T>(
        fn: (tx: unknown) => Promise<T>
      ) => Promise<T>,
      _introspectSnapshotOverride: introspectImpl,
      _executePreResolutionOverride: executePreResImpl,
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
      introspect: introspectImpl,
      executePreRes: executePreResImpl,
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
    posts: {
      slug: "posts",
      tableName: "dc_posts",
      fields: [{ name: "summary", type: "text" }] as never,
    },
  },
  singles: {},
  components: {},
};

// =============================================================================
// Tests
// =============================================================================

describe("PushSchemaPipeline (Option E flow) - empty desired", () => {
  it("succeeds with statementsExecuted: 0 when no ops", async () => {
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

    // Phase A: introspect was called.
    expect(mocks.introspect).toHaveBeenCalledTimes(1);
    // Phase B: detector called with empty ops; it returns [].
    expect(mocks.renameDetector.detect).toHaveBeenCalledTimes(1);
    // Phase C: pre-resolution called (with empty ops).
    expect(mocks.executePreRes).toHaveBeenCalledTimes(1);
    // Phase D: pushSchema called once.
    expect(mocks.pushSchema).toHaveBeenCalledTimes(1);

    // Journal: start + end.
    expect(mocks.migrationJournal.recordStart).toHaveBeenCalledTimes(1);
    expect(mocks.migrationJournal.recordEnd).toHaveBeenCalledTimes(1);
  });
});

describe("PushSchemaPipeline (Option E flow) - introspection wired", () => {
  it("calls introspectLiveSnapshot with managed table names from desired", async () => {
    const desired: DesiredSchema = {
      collections: {
        posts: { slug: "posts", tableName: "dc_posts", fields: [] as never },
        users: { slug: "users", tableName: "dc_users", fields: [] as never },
      },
      singles: {},
      components: {},
    };
    const { pipeline, mocks } = makePipeline();

    await pipeline.apply({
      desired,
      db: { sentinel: "db" },
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.introspect).toHaveBeenCalledWith(
      { sentinel: "db" },
      "postgresql",
      ["dc_posts", "dc_users"]
    );
  });

  it("forwards diff output (operations) to renameDetector.detect", async () => {
    // prev has dc_posts with reserved cols + body. desired has reserved
    // cols + summary. Diff -> drop_column body + add_column summary.
    const introspectImpl = vi
      .fn<
        (
          db: unknown,
          dialect: SupportedDialect,
          tableNames: string[]
        ) => Promise<NextlySchemaSnapshot>
      >()
      .mockResolvedValue({
        tables: [
          {
            name: "dc_posts",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "title", type: "text", nullable: false },
              { name: "slug", type: "text", nullable: false },
              { name: "created_at", type: "timestamp", nullable: true },
              { name: "updated_at", type: "timestamp", nullable: true },
              // Extra column not in desired -> drop_column expected.
              { name: "body", type: "text", nullable: true },
            ],
          },
        ],
      });

    const { pipeline, mocks } = makePipeline({ introspectImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.renameDetector.detect).toHaveBeenCalledTimes(1);
    const [opsArg, dialectArg] = mocks.renameDetector.detect.mock.calls[0] as [
      Operation[],
      SupportedDialect,
    ];
    expect(dialectArg).toBe("postgresql");
    // body dropped, summary added.
    expect(opsArg.some(op => op.type === "drop_column")).toBe(true);
    expect(opsArg.some(op => op.type === "add_column")).toBe(true);
  });
});

describe("PushSchemaPipeline (Option E flow) - prompt + resolution flow", () => {
  it("does NOT call promptDispatcher when no candidates AND classification is safe", async () => {
    const { pipeline, mocks } = makePipeline();

    await pipeline.apply({
      desired: emptyDesired,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.promptDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("calls promptDispatcher when candidates exist", async () => {
    const candidate: RenameCandidate = {
      tableName: "dc_posts",
      fromColumn: "title",
      toColumn: "name",
      fromType: "text",
      toType: "text",
      typesCompatible: true,
      defaultSuggestion: "rename",
    };
    const renameDetector = {
      detect: vi.fn<RenameDetector["detect"]>().mockReturnValue([candidate]),
    };
    const promptDispatcher = {
      dispatch: vi.fn<PromptDispatcher["dispatch"]>().mockResolvedValue({
        confirmedRenames: [candidate],
        resolutions: [],
        proceed: true,
      }),
    };

    const { pipeline, mocks } = makePipeline({
      renameDetector,
      promptDispatcher,
    });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.promptDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(result.renamesApplied).toBe(1);
  });
});

describe("PushSchemaPipeline (Option E flow) - phase D pushSchema", () => {
  it("executes statements that pushSchema returns", async () => {
    const pushSchemaImpl = vi
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
        statementsToExecute: [
          `ALTER TABLE "dc_posts" ADD COLUMN "x" text`,
          `ALTER TABLE "dc_posts" ADD COLUMN "y" text`,
        ],
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

    expect(result.success).toBe(true);
    expect(result.statementsExecuted).toBe(2);
    expect(mocks.executor.executeStatements).toHaveBeenCalledTimes(1);
  });

  it("filters DROP TABLE statements for non-managed tables", async () => {
    // pushSchema emits DROP TABLE for an unmanaged user table; the filter
    // strips it before execution.
    const pushSchemaImpl = vi
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
        statementsToExecute: [
          `DROP TABLE "user_orders"`, // unmanaged - should be filtered
          `ALTER TABLE "dc_posts" ADD COLUMN "x" text`, // safe - executed
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

    // The executor received only the managed-table ALTER, not the DROP.
    const [, executedStmts] = mocks.executor.executeStatements.mock
      .calls[0] as [unknown, string[]];
    expect(executedStmts).toHaveLength(1);
    expect(executedStmts[0]).toContain('ALTER TABLE "dc_posts"');
  });
});

describe("PushSchemaPipeline (Option E flow) - error paths", () => {
  it("classifies pushSchema failures as PUSHSCHEMA_FAILED", async () => {
    const pushSchemaImpl = vi
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
      .mockRejectedValue(new Error("simulated drizzle-kit failure"));

    const { pipeline } = makePipeline({ pushSchemaImpl });

    const result = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PUSHSCHEMA_FAILED");
  });

  it("classifies executor failures as DDL_EXECUTION_FAILED", async () => {
    const pushSchemaImpl = vi
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
        statementsToExecute: [`ALTER TABLE "dc_posts" ADD COLUMN "x" text`],
        warnings: [],
        hasDataLoss: false,
      });
    const executor = {
      executeStatements: vi
        .fn<DrizzleStatementExecutor["executeStatements"]>()
        .mockRejectedValue(new Error("syntax error")),
    };

    const { pipeline } = makePipeline({ executor, pushSchemaImpl });

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

  it("classifies pre-resolution failures as DDL_EXECUTION_FAILED", async () => {
    const executePreResImpl = vi
      .fn<
        (
          txOrDb: unknown,
          ops: Operation[],
          dialect: SupportedDialect
        ) => Promise<number>
      >()
      .mockRejectedValue(new Error("pre-rename SQL failed"));

    const { pipeline } = makePipeline({ executePreResImpl });

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

  it("journals failure with success: false", async () => {
    const pushSchemaImpl = vi
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
      .mockRejectedValue(new Error("boom"));

    const { pipeline, mocks } = makePipeline({ pushSchemaImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.migrationJournal.recordEnd).toHaveBeenCalledTimes(1);
    const [, args] = mocks.migrationJournal.recordEnd.mock.calls[0];
    expect(args.success).toBe(false);
  });
});
