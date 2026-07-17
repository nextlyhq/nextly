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

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  clearCachedSnapshot,
  clearLiveSnapshots,
  setLiveSnapshot,
} from "../../../../init/schema-snapshot-cache";
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
        db: unknown,
        tablesFilter?: string[]
      ) => Promise<{
        sqlStatements: string[];
        hints: Array<{ hint: string; statement?: string }>;
      }>
    >;
    // Phase C: surface buildDrizzleSchema override so tests can populate
    // the schema returned to pushSchema (default returns `{}` which means
    // tablesFilter would be `[]`).
    buildDrizzleSchemaImpl?: (
      desired: DesiredSchema,
      dialect: SupportedDialect
    ) => Record<string, unknown>;
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
    // Task 6: inject pre-built resolvedOps to bypass diff+resolution.
    resolvedOpsOverride?: Operation[];
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
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
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
      _buildDrizzleSchemaOverride:
        overrides.buildDrizzleSchemaImpl ?? (() => ({})),
      _txOverride: dbTransactionImpl as <T>(
        fn: (tx: unknown) => Promise<T>
      ) => Promise<T>,
      _introspectSnapshotOverride: introspectImpl,
      _executePreResolutionOverride: executePreResImpl,
      _resolvedOpsOverride: overrides.resolvedOpsOverride,
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

// Phase 5: clear the globalThis-backed snapshot cache between tests so
// the dequal short-circuit doesn't carry over a snapshot from a prior
// test. Otherwise a successful apply in one test would short-circuit
// the next test unexpectedly.
beforeEach(() => {
  clearCachedSnapshot();
});

afterEach(() => {
  clearCachedSnapshot();
});

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
    // Phase D: pushSchema is NOT called when our diff says there's
    // nothing to apply on PostgreSQL. Letting drizzle-kit handle a
    // no-ops apply means it runs its own rename heuristics and can
    // emit destructive DDL we don't want (rext-site-v2 textarea→
    // richText regression). We trust our own diff for "no work."
    expect(mocks.pushSchema).not.toHaveBeenCalled();

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
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [
          `ALTER TABLE "dc_posts" ADD COLUMN "x" text`,
          `ALTER TABLE "dc_posts" ADD COLUMN "y" text`,
        ],
        hints: [],
      });

    // Phase 4 (Task 8): force the drizzle-kit fallback path. With
    // add_table now in FAST_PATH_OP_TYPES, the real diff against an
    // empty live snapshot would produce an add_table op that routes
    // to the in-memory emitter, skipping pushSchemaImpl entirely.
    // Empty resolvedOpsOverride makes canEmitWithoutDrizzleKit return
    // false so this test's pushSchemaImpl mock actually runs.
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

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

  it("blocks DROP TABLE for unmanaged tables (legacy behavior preserved)", async () => {
    // Legacy assertion: drizzle-kit emits DROP TABLE for an unmanaged user
    // table; the filter strips it. Phase C tightened this so MANAGED
    // tables also get blocked — see the next test for that regression.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [
          `DROP TABLE "user_orders"`, // unmanaged - should be filtered
          `ALTER TABLE "dc_posts" ADD COLUMN "x" text`, // safe - executed
        ],
        hints: [],
      });

    // Phase 4 (Task 8): force the drizzle-kit fallback path. With
    // add_table now in FAST_PATH_OP_TYPES, the real diff against an
    // empty live snapshot would produce an add_table op that routes
    // to the in-memory emitter, skipping pushSchemaImpl entirely.
    // Empty resolvedOpsOverride makes canEmitWithoutDrizzleKit return
    // false so this test's pushSchemaImpl mock actually runs.
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

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

  it("Phase C regression: blocks DROP TABLE for MANAGED tables (admin-UI / out-of-scope drops)", async () => {
    // Pre-Phase-C bug: filterUnsafeStatements allowed any `dc_*`/`single_*`/
    // `comp_*`-prefixed table to be DROPped, on the theory that "managed"
    // = "Nextly owns it" = "safe to drop." This silently destroyed
    // admin-UI-created tables on every server restart and any managed
    // table outside the current pipeline scope. Phase C blocks all
    // drizzle-kit-emitted DROP TABLE unconditionally; intentional drops
    // route through pre-resolution with explicit user confirmation.
    // See findings/schema-issues-findings-2.md § Issues 1+2 for the
    // full mechanism.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [
          // dc_jobs is an admin-UI table not in this pipeline's desired
          // schema. Pre-Phase-C the filter would have allowed this (dc_*
          // prefix matched isManagedTable). Now it must be blocked.
          `DROP TABLE "dc_jobs"`,
          `DROP TABLE IF EXISTS "single_old_homepage"`,
          `DROP TABLE "comp_legacy_button"`,
          `ALTER TABLE "dc_posts" ADD COLUMN "y" text`,
        ],
        hints: [],
      });

    // Phase 4 (Task 8): force the drizzle-kit fallback path. With
    // add_table now in FAST_PATH_OP_TYPES, the real diff against an
    // empty live snapshot would produce an add_table op that routes
    // to the in-memory emitter, skipping pushSchemaImpl entirely.
    // Empty resolvedOpsOverride makes canEmitWithoutDrizzleKit return
    // false so this test's pushSchemaImpl mock actually runs.
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    // Only the additive ALTER reaches the executor. Three DROP TABLE
    // statements were emitted; ALL must be blocked, including the
    // managed-prefixed ones.
    const [, executedStmts] = mocks.executor.executeStatements.mock
      .calls[0] as [unknown, string[]];
    expect(executedStmts).toHaveLength(1);
    expect(executedStmts[0]).toContain('ALTER TABLE "dc_posts"');
    // No DROP made it through.
    expect(executedStmts.some(s => /^DROP\s+TABLE/i.test(s))).toBe(false);
  });

  it("Phase C: passes desired-table names as tablesFilter to drizzle-kit pushSchema", async () => {
    // Verifies the second half of Phase C: drizzle-kit's PG pushSchema
    // gets the current pipeline's desired-table names as tablesFilter,
    // so its internal introspection sees only managed tables in scope.
    // Eliminates spurious rename-detection prompts and (on PG only)
    // false DROP emissions for tables outside scope.
    //
    // The fixture's default `_buildDrizzleSchemaOverride` returns `{}`,
    // which would yield `tablesFilter = []`. Override here so the test
    // reflects realistic Phase D state: drizzleSchema = { dc_posts: ... },
    // tablesFilter = ["dc_posts"].
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    const { pipeline } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: {} }),
      // Phase 4 (Task 8): force drizzle-kit fallback so pushSchemaImpl
      // is invoked. With add_table in FAST_PATH_OP_TYPES the natural
      // diff would route to the in-memory emitter and skip kit.
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);
    const [, , tablesFilter] = pushSchemaImpl.mock.calls[0]!;
    expect(Array.isArray(tablesFilter)).toBe(true);
    expect(tablesFilter).toContain("dc_posts");
  });

  it("Phase 6 follow-up: ALLOWS DROP TABLE for tables IN desired (SQLite rebuild pattern)", async () => {
    // Phase C's original strict rule blocked ALL DROP TABLE — that
    // turned out too aggressive on SQLite, where drizzle-kit emits
    // a CREATE/COPY/DROP/RENAME sequence to handle ALTER COLUMN
    // type changes (see filterUnsafeStatements comment for full
    // pattern). Blocking the DROP step left __new_dc_X dangling
    // and caused the subsequent RENAME to fail with "table already
    // exists".
    //
    // New rule: DROP for tables IN the desired schema is allowed
    // (intentional rebuild). DROP for tables NOT in the desired
    // schema is still blocked (the original Phase C scenario).
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [
          // SQLite rebuild sequence — all 4 statements should pass
          // through because dc_posts IS in desired.
          `CREATE TABLE "__new_dc_posts" ("id" text PRIMARY KEY NOT NULL)`,
          `INSERT INTO "__new_dc_posts" SELECT * FROM "dc_posts"`,
          `DROP TABLE "dc_posts"`,
          `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"`,
          // dc_jobs NOT in desired → still blocked (Phase C behavior).
          `DROP TABLE "dc_jobs"`,
        ],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: {} }),
      // Phase 4 (Task 8): force drizzle-kit fallback so the SQLite
      // rebuild sequence in pushSchemaImpl actually runs through
      // filterUnsafeStatements.
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
        // The scanner only trusts a rebuild block when OUR diff approved a
        // rebuild-justifying change for that table (an unapproved rebuild is
        // the kit encoding a column drop) — model the approved type change
        // that makes this dc_posts rebuild legitimate.
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "title",
          fromType: "text",
          toType: "integer",
        },
      ],
    });

    // Using PG dialect for the test — the filter logic is dialect-
    // agnostic; SQLite's runSqlitePragma path needs a mock db with
    // .run() that the harness doesn't provide. The rebuild SQL
    // shape is realistic for the SQLite path that this test models.
    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    const [, executedStmts] = mocks.executor.executeStatements.mock
      .calls[0] as [unknown, string[]];

    // The 4 rebuild statements pass through (CREATE / INSERT / DROP /
    // RENAME), the orphan DROP for dc_jobs gets blocked.
    expect(executedStmts).toHaveLength(4);
    expect(executedStmts[0]).toContain('CREATE TABLE "__new_dc_posts"');
    expect(executedStmts[1]).toContain("INSERT INTO");
    expect(executedStmts[2]).toContain('DROP TABLE "dc_posts"');
    expect(executedStmts[3]).toContain('RENAME TO "dc_posts"');
    // dc_jobs DROP did NOT make it through.
    expect(executedStmts.some(s => /DROP\s+TABLE\s+"?dc_jobs/i.test(s))).toBe(
      false
    );
  });

  it("Phase 5: dequal short-circuit skips pushSchema when desired is unchanged since last apply", async () => {
    // Run pipeline once to populate the snapshot cache; then run again
    // with the SAME desired and assert pushSchema is not called the
    // second time. Journal recordStart should also be skipped on the
    // second call.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Phase 4 (Task 8): force the drizzle-kit fallback path. With
    // add_table now in FAST_PATH_OP_TYPES, the real diff against an
    // empty live snapshot would produce an add_table op that routes
    // to the in-memory emitter, skipping pushSchemaImpl entirely.
    // Empty resolvedOpsOverride makes canEmitWithoutDrizzleKit return
    // false so this test's pushSchemaImpl mock actually runs.
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    // First run — populates the cache.
    const first = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });
    expect(first.success).toBe(true);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);
    const recordStartCallsAfterFirst =
      mocks.migrationJournal.recordStart.mock.calls.length;

    // Second run — same desired, dequal cache hit, should skip the
    // entire pipeline including journal recordStart.
    const second = await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });

    expect(second.success).toBe(true);
    expect(second.statementsExecuted).toBe(0);
    expect(second.renamesApplied).toBe(0);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1); // unchanged
    expect(mocks.migrationJournal.recordStart.mock.calls.length).toBe(
      recordStartCallsAfterFirst
    ); // no new journal entry

    // Operator-visible signal that the pipeline short-circuited.
    expect(
      consoleSpy.mock.calls.some(call =>
        String(call[0] ?? "").includes("No changes detected")
      )
    ).toBe(true);

    consoleSpy.mockRestore();
  });

  it("Phase 5: cache miss when desired actually changed — pipeline runs again", async () => {
    // Run with desired A, then with desired B — different shape — and
    // assert pushSchema is called both times.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    // Phase 4 (Task 8): force drizzle-kit fallback (see notes above).
    const { pipeline } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    await pipeline.apply({
      desired: onePostsCollection,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);

    // Different desired — extra collection added.
    const changedDesired: DesiredSchema = {
      collections: {
        ...onePostsCollection.collections,
        tags: {
          slug: "tags",
          tableName: "dc_tags",
          fields: [{ name: "label", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    await pipeline.apply({
      desired: changedDesired,
      db: {},
      dialect: "postgresql",
      source: "code",
      promptChannel: "terminal",
    });
    expect(pushSchemaImpl).toHaveBeenCalledTimes(2);
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
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockRejectedValue(new Error("simulated drizzle-kit failure"));

    // Phase 4 (Task 8): force drizzle-kit fallback (see notes above).
    const { pipeline } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
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
  });

  it("classifies executor failures as DDL_EXECUTION_FAILED", async () => {
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [`ALTER TABLE "dc_posts" ADD COLUMN "x" text`],
        hints: [],
      });
    const executor = {
      executeStatements: vi
        .fn<DrizzleStatementExecutor["executeStatements"]>()
        .mockRejectedValue(new Error("syntax error")),
    };

    // Phase 4 (Task 8): force drizzle-kit fallback.
    const { pipeline } = makePipeline({
      executor,
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
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
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockRejectedValue(new Error("boom"));

    // Phase 4 (Task 8): force the drizzle-kit fallback path. With
    // add_table now in FAST_PATH_OP_TYPES, the real diff against an
    // empty live snapshot would produce an add_table op that routes
    // to the in-memory emitter, skipping pushSchemaImpl entirely.
    // Empty resolvedOpsOverride makes canEmitWithoutDrizzleKit return
    // false so this test's pushSchemaImpl mock actually runs.
    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

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

describe("scoped pushSchema (Task 6)", () => {
  it("passes only the tables affected by resolvedOps to kit.pushSchema", async () => {
    // Desired: three collections. Live DB already has dc_posts and dc_tags
    // (with identical columns to desired), so the diff produces an add_table
    // op only for dc_articles. buildDrizzleSchemaImpl returns all three tables.
    // After scoping, kit.pushSchema should receive only dc_articles.

    const threeCollectionsDesired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
        tags: {
          slug: "tags",
          tableName: "dc_tags",
          fields: [{ name: "label", type: "text" }] as never,
        },
        articles: {
          slug: "articles",
          tableName: "dc_articles",
          fields: [{ name: "body", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    // Live snapshot: dc_posts and dc_tags exist (matching desired). dc_articles
    // is absent → diff emits add_table for dc_articles only.
    //
    // Column layout notes:
    //  - dc_posts has fields: [{ name: "title", type: "text" }]. hasTitleField=true
    //    so system columns are [id, slug, created_at, updated_at]; "title" is added
    //    as a user field with nullable: true (required is not set). The introspect
    //    mock must match desired's column shapes exactly to produce zero ops for
    //    dc_posts.
    //  - dc_tags has fields: [{ name: "label", type: "text" }]. hasTitleField=false
    //    so system columns are [id, title, slug, created_at, updated_at]; "label"
    //    is nullable: true (user field, not required). Introspect must match.
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
            // dc_posts: hasTitleField=true → system cols = [id, slug, created_at, updated_at]
            // + user field title (nullable: true).
            name: "dc_posts",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "slug", type: "text", nullable: false },
              { name: "created_at", type: "timestamp", nullable: true },
              { name: "updated_at", type: "timestamp", nullable: true },
              { name: "title", type: "text", nullable: true },
            ],
          },
          {
            // dc_tags: hasTitleField=false → system cols = [id, title, slug, created_at, updated_at]
            // + user field label (nullable: true).
            name: "dc_tags",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "title", type: "text", nullable: false },
              { name: "slug", type: "text", nullable: false },
              { name: "created_at", type: "timestamp", nullable: true },
              { name: "updated_at", type: "timestamp", nullable: true },
              { name: "label", type: "text", nullable: true },
            ],
          },
        ],
      });

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    // buildDrizzleSchemaImpl returns all three tables — before Task 6 the
    // full schema would be passed to pushSchema. After Task 6 only
    // dc_articles (the affected table) should appear.
    //
    // Phase 4 (Task 8) override: bypass the real diff via
    // resolvedOpsOverride containing a rename_table op so the apply
    // takes the drizzle-kit fallback path and the Task 6 scope-
    // reduction logic is exercised. rename_table is in
    // PRE_RESOLUTION_OP_TYPES (not FAST_PATH_OP_TYPES) so injecting
    // it directly into resolvedOps forces the slow path on PG; the
    // pre-resolution executor stub does nothing with it, leaving
    // the slow-path branch as the one under test.
    //
    // We previously used change_column_type here, but that op type
    // moved into the fast path during the rext-site-v2 silent-skip
    // fix and no longer routes to drizzle-kit on PG.
    const { pipeline } = makePipeline({
      introspectImpl,
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({
        dc_posts: { _sentinel: "posts" },
        dc_tags: { _sentinel: "tags" },
        dc_articles: { _sentinel: "articles" },
      }),
      resolvedOpsOverride: [
        {
          type: "rename_table",
          fromName: "dc_old_articles",
          toName: "dc_articles",
        },
      ],
    });

    const result = await pipeline.apply({
      desired: threeCollectionsDesired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);

    const [scopedSchema, , tableNames] = pushSchemaImpl.mock.calls[0]!;
    // Only dc_articles had a pending add_table op — the other two were
    // already in the live snapshot with no diff.
    expect(Object.keys(scopedSchema)).toEqual(["dc_articles"]);
    expect(tableNames).toEqual(["dc_articles"]);
  });

  it("falls back to full schema when resolvedOps has only drop_table ops (safety net)", async () => {
    // If resolvedOps contains only drop_table ops (pre-resolved, not in
    // drizzleSchema), the scoped set is empty. The safety net should kick
    // in and pass the full drizzleSchema to avoid calling pushSchema with
    // an empty schema.

    // Desired: one collection (dc_posts). Live DB has dc_posts + dc_orphan.
    // dc_orphan is not in desired → drop_table op emitted. dc_posts is
    // already up to date → no column ops. resolvedOps has only drop_table.

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

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
            // dc_posts: hasTitleField=true → system cols = [id, slug, created_at, updated_at]
            // + user field title (nullable: true). Must match desired exactly → zero ops.
            name: "dc_posts",
            columns: [
              { name: "id", type: "text", nullable: false },
              { name: "slug", type: "text", nullable: false },
              { name: "created_at", type: "timestamp", nullable: true },
              { name: "updated_at", type: "timestamp", nullable: true },
              { name: "title", type: "text", nullable: true },
            ],
          },
          // dc_orphan is in live but not in desired → drop_table op emitted.
          {
            name: "dc_orphan",
            columns: [{ name: "id", type: "text", nullable: false }],
          },
        ],
      });

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    const { pipeline } = makePipeline({
      introspectImpl,
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);

    const [scopedSchema, , tableNames] = pushSchemaImpl.mock.calls[0]!;
    // Safety net: empty scope → fall back to full drizzleSchema.
    expect(Object.keys(scopedSchema)).toEqual(["dc_posts"]);
    expect(tableNames).toEqual(["dc_posts"]);
  });

  it("uses cached live snapshot and skips introspect when cache is warm (Task 7)", async () => {
    // Pre-populate the live-snapshot cache so the pipeline's `apply()`
    // sees a hit and never calls `introspectLiveSnapshot`. We use an
    // empty desired schema (no collections/singles/components) so that:
    //   - managedTableNames = []
    //   - keyOf([]) = ""  (the cache key)
    //   - desired snapshot has tables: []
    //   - live cache returns { tables: [] }
    //   - diffSnapshots(live, desired) produces zero ops
    //   - pushSchema gets zero ops → reports sqlStatements: [],
    //
    // NO _introspectSnapshotOverride is set. If the cache misses for any
    // reason, the pipeline falls through to the real introspectLiveSnapshot
    // against db: {} as never — which throws immediately. That throw is
    // the hard-fail signal that the cache path was NOT taken.
    clearLiveSnapshots();

    const desired: DesiredSchema = {
      collections: {},
      singles: {},
      components: {},
    };

    // managedTableNames for empty desired is []; keyOf([]) = "".
    // Pre-populate that cache entry with an empty live snapshot so
    // diffSnapshots(live, desired) produces exactly zero operations.
    setLiveSnapshot([], { tables: [] });

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    // Construct pipeline the same way other Task 6 tests do — with
    // _kitOverride + _txOverride. Critically, _introspectSnapshotOverride
    // is NOT set so the cache path runs.
    const { pipeline } = makePipeline({
      pushSchemaImpl,
    });

    const result = await pipeline.apply({
      desired,
      db: {} as never,
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    // No DDL emitted because the diff produced zero ops (live === desired).
    expect(result.statementsExecuted).toBe(0);

    clearLiveSnapshots(); // cleanup
  });

  it("rename_table op uses toName (not fromName) when building scopedSchema", async () => {
    // Desired: one collection with the NEW name (dc_articles). The live DB
    // had the OLD name (dc_posts). The diff would normally produce a
    // drop_table + add_table pair; after rename resolution that becomes a
    // rename_table op. We inject the rename_table op directly via
    // _resolvedOpsOverride (the lightest setup path) because applyResolutions
    // only handles column-level renames today.
    //
    // After scope reduction the scopedSchema passed to kit.pushSchema should
    // contain dc_articles (toName) and NOT dc_posts (fromName).

    const desired: DesiredSchema = {
      collections: {
        articles: {
          slug: "articles",
          tableName: "dc_articles",
          fields: [{ name: "body", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    // buildDrizzleSchemaImpl reflects patchedDesired — the desired snapshot
    // uses dc_articles (new name), so the built schema has dc_articles.
    // dc_posts (old name) is NOT present because patchedDesired no longer
    // contains it after the rename.
    const { pipeline } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({
        dc_articles: { _sentinel: "articles" },
      }),
      resolvedOpsOverride: [
        {
          type: "rename_table",
          fromName: "dc_posts",
          toName: "dc_articles",
        },
      ],
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);

    const [scopedSchema, , tableNames] = pushSchemaImpl.mock.calls[0]!;
    // Scope reduction must pick dc_articles (toName), not dc_posts (fromName).
    expect(Object.keys(scopedSchema)).toContain("dc_articles");
    expect(Object.keys(scopedSchema)).not.toContain("dc_posts");
    expect(tableNames).toContain("dc_articles");
    expect(tableNames).not.toContain("dc_posts");
  });

  it("skips scope-reduction on non-PG dialects so drizzle-kit sees the full schema", async () => {
    // drizzle-kit ignores `tablesFilter` on SQLite/MySQL upstream, so a
    // scoped schema would make it flag the system tables that
    // buildDrizzleSchema injects (users, roles, accounts, ...) as drops
    // and fire its rename-detection TUI. The pipeline therefore passes
    // the full drizzleSchema on non-PG dialects.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [],
      });

    const buildDrizzleSchemaImpl = () => ({
      users: { _sentinel: "users" },
      roles: { _sentinel: "roles" },
      accounts: { _sentinel: "accounts" },
      sessions: { _sentinel: "sessions" },
      dynamic_collections: { _sentinel: "dynamic_collections" },
      dc_posts: { _sentinel: "dc_posts" },
    });

    // MySQL always routes to the drizzle-kit fallback (the fast in-memory
    // emitter is PG-only), so pushSchemaImpl is invoked here. The op type
    // is incidental — we just need a non-empty resolvedOps so the diff
    // engine has something to scope against.
    const { pipeline } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl,
      resolvedOpsOverride: [
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "body",
          fromType: "text",
          toType: "integer",
        },
      ],
    });

    const result = await pipeline.apply({
      desired: {
        collections: {
          posts: {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }] as never,
          },
        },
        singles: {},
        components: {},
      },
      db: {},
      dialect: "mysql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(pushSchemaImpl).toHaveBeenCalledTimes(1);

    const [effectiveSchema] = pushSchemaImpl.mock.calls[0]!;
    const keys = Object.keys(effectiveSchema);
    expect(keys).toContain("dc_posts");
    expect(keys).toContain("users");
    expect(keys).toContain("roles");
    expect(keys).toContain("accounts");
    expect(keys).toContain("sessions");
    expect(keys).toContain("dynamic_collections");
  });

  // Regression: rext-site-v2 / dc_case_studies (May 2026).
  // drizzle-kit's pushSchema returns successfully even when it has
  // declined to apply some changes — the skipped statements appear in
  // `warnings`, NOT in the executable statements list, and `success` is still
  // true. Older Nextly versions wrote `status='success'` to the journal
  // and the same drift re-appeared on every subsequent preview. The
  // safety net now throws so the journal correctly records a failed
  // apply with the warning text attached.
  it("fails loudly when drizzle-kit emits an unexpected destructive statement", async () => {
    // v1 semantics (observed rc.4): destructive statements arrive INSIDE
    // sqlStatements with EMPTY hints. Approved drops already ran in the
    // pre-resolution phase, so anything destructive here means the kit's
    // differ disagrees with ours — never execute, journal a failure.
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ["ALTER TABLE `dc_posts` DROP COLUMN `body`;"],
        hints: [],
      });

    const { pipeline } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({
        dc_posts: { _sentinel: "dc_posts" },
      }),
      // MySQL forces the kit path so the guard branch executes.
      // (On PG the same op would route to the fast in-memory emitter.)
      resolvedOpsOverride: [
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "body",
          fromType: "text",
          toType: "jsonb",
        },
      ],
    });

    const result = await pipeline.apply({
      desired: {
        collections: {
          posts: {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "json" }] as never,
          },
        },
        singles: {},
        components: {},
      },
      db: {},
      dialect: "mysql",
      source: "ui",
      promptChannel: "browser",
      databaseName: "test_db",
    });

    expect(result.success).toBe(false);
    expect(result.error?.message ?? "").toMatch(/destructive statement/);
    expect(result.error?.message ?? "").toContain("DROP COLUMN");
  });

  it("fails loudly when drizzle-kit returns hints on the additive remainder", async () => {
    // hints were empty in every observed rc.4 scenario — an appearing hint
    // means upstream semantics changed; refuse rather than ignore (the
    // May 2026 silent-drift incident is the standing lesson).
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: [],
        hints: [
          {
            hint: "You're about to change body column type from text to jsonb",
            statement: "ALTER TABLE `dc_posts` MODIFY `body` json;",
          },
        ],
      });

    const { pipeline } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({
        dc_posts: { _sentinel: "dc_posts" },
      }),
      resolvedOpsOverride: [
        {
          type: "change_column_type",
          tableName: "dc_posts",
          columnName: "body",
          fromType: "text",
          toType: "jsonb",
        },
      ],
    });

    const result = await pipeline.apply({
      desired: {
        collections: {
          posts: {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "json" }] as never,
          },
        },
        singles: {},
        components: {},
      },
      db: {},
      dialect: "mysql",
      source: "ui",
      promptChannel: "browser",
      databaseName: "test_db",
    });

    expect(result.success).toBe(false);
    expect(result.error?.message ?? "").toMatch(/hint/);
    expect(result.error?.message ?? "").toContain("body column type");
  });
});

// =============================================================================
// filterUnsafeStatements orphan-DDL guards (Task 6.1)
// =============================================================================
//
// drizzle-kit's tablesFilter narrows which TABLES it inspects but does NOT
// suppress DROP SEQUENCE / DROP INDEX for objects whose owner table isn't in
// the scoped schema. These tests verify that filterUnsafeStatements blocks
// (or allows) those statements correctly based on whether the inferred owner
// table is in the desired schema.
//
// Convention notes:
//   - We use resolvedOpsOverride so the diff/resolution phases are bypassed
//     and we can inject a precise add_column op against the target table.
//   - buildDrizzleSchemaImpl returns the scoped schema; its keys become
//     desiredTableNames (the allow-list passed to filterUnsafeStatements).
//   - pushSchemaImpl returns the DDL we want to test filtering on.
//   - We inspect executor.executeStatements.mock.calls[0][1] for the final
//     filtered statement list.

describe("filterUnsafeStatements orphan-DDL guards (Task 6.1)", () => {
  // ---------------------------------------------------------------------------
  // DROP SEQUENCE
  // ---------------------------------------------------------------------------

  it("blocks DROP SEQUENCE when owner table is not in desired schema", async () => {
    // Scenario: desired schema contains only dc_posts. drizzle-kit emits a
    // DROP SEQUENCE for accounts_id_seq (belongs to the accounts table which
    // is NOT in desired). filterUnsafeStatements must strip it.

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ['DROP SEQUENCE "public"."accounts_id_seq";'],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      // buildDrizzleSchemaImpl returns only dc_posts — accounts is not present.
      // Object.keys(effectiveDrizzleSchema) → ["dc_posts"]
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
      // Inject a single add_column op so scope reduction picks dc_posts.
      resolvedOpsOverride: [
        {
          type: "add_column",
          tableName: "dc_posts",
          column: { name: "title", type: "text", nullable: true } as never,
        },
      ],
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(mocks.executor.executeStatements).toHaveBeenCalled();
    const stmts: string[] = mocks.executor.executeStatements.mock.calls[0]![1];
    expect(stmts.filter(s => /DROP\s+SEQUENCE/i.test(s))).toEqual([]);
  });

  it("allows DROP SEQUENCE when the owner table IS in desired schema", async () => {
    // Scenario: desired schema contains dc_posts. drizzle-kit emits DROP
    // SEQUENCE for dc_posts_id_seq — the owner table IS in desired (SERIAL
    // column being rebuilt, e.g. type migration TEXT→INTEGER). Must pass
    // through to executor.

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ['DROP SEQUENCE "public"."dc_posts_id_seq";'],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
      // Empty resolvedOps forces canEmitWithoutDrizzleKit -> false so
      // the apply takes the drizzle-kit fallback path and the
      // filterUnsafeStatements logic under test gets exercised. Using
      // add_column here would route to the Phase 4 fast emitter and
      // never reach drizzle-kit's pushSchemaImpl.
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(mocks.executor.executeStatements).toHaveBeenCalled();
    const stmts: string[] = mocks.executor.executeStatements.mock.calls[0]![1];
    // The DROP SEQUENCE for dc_posts must be present (owner in desired).
    expect(stmts.filter(s => /DROP\s+SEQUENCE/i.test(s))).toHaveLength(1);
    expect(stmts[0]).toContain("dc_posts_id_seq");
  });

  // ---------------------------------------------------------------------------
  // DROP INDEX
  // ---------------------------------------------------------------------------

  it("blocks DROP INDEX when owner table is not in desired schema", async () => {
    // Scenario: desired schema contains only dc_posts. drizzle-kit emits a
    // DROP INDEX for accounts_user_id_idx (accounts is NOT in desired).
    // filterUnsafeStatements must strip it.

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ['DROP INDEX "public"."accounts_user_id_idx";'],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
      resolvedOpsOverride: [
        {
          type: "add_column",
          tableName: "dc_posts",
          column: { name: "title", type: "text", nullable: true } as never,
        },
      ],
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(mocks.executor.executeStatements).toHaveBeenCalled();
    const stmts: string[] = mocks.executor.executeStatements.mock.calls[0]![1];
    expect(stmts.filter(s => /DROP\s+INDEX/i.test(s))).toEqual([]);
  });

  it("allows DROP INDEX when owner table IS in desired schema", async () => {
    // Scenario: desired schema contains dc_posts. drizzle-kit emits DROP
    // INDEX for dc_posts_title_idx — owner IS in desired (index being
    // recreated as part of a column change). Must pass through.

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "title", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ['DROP INDEX "public"."dc_posts_title_idx";'],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
      // Empty resolvedOps forces canEmitWithoutDrizzleKit -> false so
      // the apply takes the drizzle-kit fallback path and the
      // filterUnsafeStatements logic under test gets exercised. Using
      // add_column here would route to the Phase 4 fast emitter and
      // never reach drizzle-kit's pushSchemaImpl.
      // Force the drizzle-kit slow path on PG by injecting a non-fast-
      // path op. rename_column is pre-resolution-only so the default
      // executePreRes mock counts it without running SQL; the slow-path
      // branch still gets exercised. Required after the empty-ops fast-
      // path bypass (textarea→richText regression fix).
      resolvedOpsOverride: [
        {
          type: "rename_column",
          tableName: "_force_slow_path",
          fromColumn: "x",
          toColumn: "x",
          fromType: "text",
          toType: "text",
        },
      ],
    });

    const result = await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    expect(result.success).toBe(true);
    expect(mocks.executor.executeStatements).toHaveBeenCalled();
    const stmts: string[] = mocks.executor.executeStatements.mock.calls[0]![1];
    // The DROP INDEX for dc_posts must be present (owner in desired).
    expect(stmts.filter(s => /DROP\s+INDEX/i.test(s))).toHaveLength(1);
    expect(stmts[0]).toContain("dc_posts_title_idx");
  });
});

describe("fast DDL emitter routing (Phase 4 Task 3)", () => {
  // Why: prove an add_column-only apply takes the fast path — never
  // calls kit.pushSchema — and the emitter's SQL reaches the executor.
  it("add_column-only apply executes emitter SQL and never calls kit.pushSchema", async () => {
    const pushSchemaImpl = vi
      .fn<
        (
          schema: Record<string, unknown>,
          db: unknown,
          tablesFilter?: string[]
        ) => Promise<{
          sqlStatements: string[];
          hints: Array<{ hint: string; statement?: string }>;
        }>
      >()
      .mockResolvedValue({
        sqlStatements: ["SHOULD_NOT_RUN"],
        hints: [],
      });

    const { pipeline, mocks } = makePipeline({
      pushSchemaImpl,
      buildDrizzleSchemaImpl: () => ({ dc_posts: { _sentinel: "posts" } }),
      resolvedOpsOverride: [
        {
          type: "add_column",
          tableName: "dc_posts",
          column: { name: "subtitle", type: "text", nullable: true } as never,
        },
      ],
    });

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts",
          fields: [{ name: "subtitle", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    await pipeline.apply({
      desired,
      db: {},
      dialect: "postgresql",
      source: "ui",
      promptChannel: "browser",
    });

    // drizzle-kit must NOT have been called.
    expect(pushSchemaImpl).not.toHaveBeenCalled();
    // The emitter's SQL must have reached the executor.
    expect(mocks.executor.executeStatements).toHaveBeenCalled();
    const passed: string[] = mocks.executor.executeStatements.mock.calls[0]![1];
    expect(passed).toContain(
      `ALTER TABLE "dc_posts" ADD COLUMN "subtitle" text`
    );
    expect(passed).not.toContain("SHOULD_NOT_RUN");
  });
});
