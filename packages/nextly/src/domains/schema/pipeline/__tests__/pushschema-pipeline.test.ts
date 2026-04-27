import { describe, expect, it, vi, type Mock } from "vitest";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

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
    liveColumnTypesImpl?: Mock<
      (
        db: unknown,
        dialect: SupportedDialect,
        tableNames: string[]
      ) => Promise<Map<string, Map<string, string>>>
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

  // Mock the live-column-types introspection: returns empty map by default.
  // Tests that exercise rename detection with non-empty types pass an
  // override returning a stubbed map.
  const liveColumnTypesImpl =
    overrides.liveColumnTypesImpl ??
    vi
      .fn<
        (
          db: unknown,
          dialect: SupportedDialect,
          tableNames: string[]
        ) => Promise<Map<string, Map<string, string>>>
      >()
      .mockResolvedValue(new Map<string, Map<string, string>>());

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
      _liveColumnTypesOverride: liveColumnTypesImpl,
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
      liveColumnTypes: liveColumnTypesImpl,
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

describe("PushSchemaPipeline live-column-types introspection (F4 PR 2)", () => {
  it("calls queryLiveColumnTypes with managed table names from desired", async () => {
    const { pipeline, mocks } = makePipeline();

    const desired: DesiredSchema = {
      collections: {
        posts: { slug: "posts", tableName: "dc_posts", fields: [] },
        users: { slug: "users", tableName: "dc_users", fields: [] },
      },
      singles: {},
      components: {},
    };

    await pipeline.apply({
      desired,
      db: { sentinel: "db" },
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.liveColumnTypes).toHaveBeenCalledTimes(1);
    expect(mocks.liveColumnTypes).toHaveBeenCalledWith(
      { sentinel: "db" },
      "postgresql",
      ["dc_posts", "dc_users"]
    );
  });

  it("forwards introspection result into renameDetector.detect()", async () => {
    const stubbedTypes = new Map([["dc_posts", new Map([["title", "text"]])]]);
    const liveColumnTypesImpl = vi
      .fn<
        (
          db: unknown,
          dialect: SupportedDialect,
          tableNames: string[]
        ) => Promise<Map<string, Map<string, string>>>
      >()
      .mockResolvedValue(stubbedTypes);

    const { pipeline, mocks } = makePipeline({ liveColumnTypesImpl });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(mocks.renameDetector.detect).toHaveBeenCalledTimes(1);
    expect(mocks.renameDetector.detect).toHaveBeenCalledWith(
      [],
      "postgresql",
      stubbedTypes
    );
  });
});

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

// =============================================================
// SQLite PRAGMA wrapping integration check (real in-memory DB)
// =============================================================
//
// Regression test for the F3 PR-4 review C1: SQLite silently no-ops
// PRAGMA foreign_keys = OFF/ON when issued inside a transaction.
// PR-4 hoisted the PRAGMA toggling out of the executor and into the
// pipeline (BEFORE/AFTER the txFn call). This test wraps a real
// recreate-table-pattern apply in db.transaction() and verifies the
// FK-referenced table can be dropped without tripping FK violations.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs.js";

describe("PushSchemaPipeline SQLite PRAGMA wrapping (real DB)", () => {
  it("wraps the txFn with PRAGMA foreign_keys = OFF/ON so recreate-pattern works on FK-referenced tables", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    // Pre-create parent + child with FK enforcement.
    sqlite.exec(`
      CREATE TABLE dc_parent (id integer PRIMARY KEY);
      CREATE TABLE dc_child (
        id integer PRIMARY KEY,
        parent_id integer REFERENCES dc_parent(id)
      );
      INSERT INTO dc_parent (id) VALUES (1);
      INSERT INTO dc_child (id, parent_id) VALUES (1, 1);
    `);

    // Build a pipeline with the real executor + drizzle wrapper.
    // pushSchema is mocked (returns the recreate sequence directly)
    // because we are testing the PRAGMA-around-tx wiring, not the
    // drizzle-kit diff itself.
    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("sqlite", db),
        renameDetector: noopRenameDetector,
        classifier: noopClassifier,
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
      },
      {
        // Both pushSchema passes return the same recreate sequence —
        // CREATE __new + INSERT + DROP + RENAME on dc_parent. Without
        // PRAGMA OFF outside the tx, the DROP would trip FK violations
        // because dc_child still references dc_parent at that moment.
        _kitOverride: {
          pushSchema: () =>
            Promise.resolve({
              statementsToExecute: [
                "CREATE TABLE `__new_dc_parent` (id integer PRIMARY KEY)",
                'INSERT INTO `__new_dc_parent`("id") SELECT "id" FROM `dc_parent`',
                "DROP TABLE dc_parent",
                "ALTER TABLE `__new_dc_parent` RENAME TO `dc_parent`",
              ],
              warnings: [],
              hasDataLoss: false,
            }),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const result = await pipeline.apply({
      desired: {
        collections: {
          parent: { slug: "parent", tableName: "dc_parent", fields: [] },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(true);

    // FK enforcement restored after the apply.
    const fkRow = sqlite.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(fkRow.foreign_keys).toBe(1);

    // Recreate completed: dc_parent still exists, dc_child still
    // references it (FK relationship preserved through the rebuild).
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dc_parent'"
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    sqlite.close();
  });

  it("restores PRAGMA foreign_keys = ON even if the apply throws", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    const pipeline = new PushSchemaPipeline(
      {
        executor: new DrizzleStatementExecutor("sqlite", db),
        renameDetector: noopRenameDetector,
        classifier: noopClassifier,
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
      },
      {
        _kitOverride: {
          pushSchema: () =>
            Promise.reject(new Error("simulated drizzle-kit failure")),
        },
        _buildDrizzleSchemaOverride: () => ({}),
      }
    );

    const result = await pipeline.apply({
      desired: {
        collections: {
          x: { slug: "x", tableName: "dc_x", fields: [] },
        },
        singles: {},
        components: {},
      },
      db,
      dialect: "sqlite",
      source: "code",
      promptChannel: "terminal",
    });

    expect(result.success).toBe(false);

    // FK setting restored even though the apply path threw.
    const fkRow = sqlite.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };
    expect(fkRow.foreign_keys).toBe(1);

    sqlite.close();
  });
});
