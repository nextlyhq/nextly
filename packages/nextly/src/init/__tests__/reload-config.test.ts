// Tests for reloadNextlyConfig: the helper that drains an HMR reload flag
// and reapplies code-first schema state.
//
// F4 Option E PR 4 rewrite: the F1 preview gate is gone. Per-collection
// safety is decided by introspect+diff+rename-detector (the same code the
// pipeline runs internally). The mocks below pin introspectLiveSnapshot
// (called once with all desired tables) and let real
// buildDesiredTableFromFields + diffSnapshots run, so the test asserts
// the gate behavior against actual diff output. Pipeline is still mocked
// so we don't hit drizzle-kit.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import type { PromptDispatcher } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";

// vi.hoisted lets mock factories see these spies.
const {
  loadConfigSpy,
  clearConfigCacheSpy,
  pipelineCtorSpy,
  pipelineApplySpy,
  introspectSpy,
  warnSpy,
  errorSpy,
} = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
  pipelineCtorSpy: vi.fn(),
  pipelineApplySpy: vi.fn(),
  introspectSpy: vi.fn(),
  warnSpy: vi.fn(),
  errorSpy: vi.fn(),
}));

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

// Mock PushSchemaPipeline. The constructor records the deps object so
// tests can assert wiring (e.g., that the injected dispatcher actually
// arrives). apply() routes to its own spy.
vi.mock("../../domains/schema/pipeline/pushschema-pipeline", () => ({
  PushSchemaPipeline: class {
    constructor(deps: unknown) {
      pipelineCtorSpy(deps);
    }
    apply(args: unknown) {
      return pipelineApplySpy(args);
    }
  },
}));

// Mock the executor — constructor only needed (no method calls in this
// test path, since the pipeline mock above swallows the apply call).
vi.mock("../../domains/schema/services/drizzle-statement-executor", () => ({
  DrizzleStatementExecutor: class {
    executeStatements() {
      return Promise.resolve();
    }
  },
}));

// Pin live-DB introspection. Real buildDesiredTableFromFields and
// diffSnapshots run on top of whatever snapshot the test sets here.
vi.mock("../../domains/schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: introspectSpy,
}));

describe("reloadNextlyConfig", () => {
  beforeEach(() => {
    loadConfigSpy.mockReset();
    clearConfigCacheSpy.mockReset();
    pipelineCtorSpy.mockReset();
    pipelineApplySpy.mockReset();
    introspectSpy.mockReset();
    warnSpy.mockReset();
    errorSpy.mockReset();
    pipelineApplySpy.mockResolvedValue({
      success: true,
      statementsExecuted: 1,
      renamesApplied: 0,
    });
  });

  // Build a service resolver fake. Returns the service or undefined per
  // service name. Tests pass this into reloadNextlyConfig via opts.resolver.
  function buildResolver(opts?: {
    withAdapter?: boolean;
    allCollections?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      status?: boolean;
      source?: string;
    }>;
    allSingles?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      status?: boolean;
      source?: string;
    }>;
    allComponents?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      source?: string;
    }>;
  }) {
    const withAdapter = opts?.withAdapter ?? true;
    const syncCodeFirstComponentsSpy = vi.fn().mockResolvedValue({});
    const registerDynamicSchemaSpy = vi.fn();
    const updateCollectionMigrationStatusSpy = vi
      .fn()
      .mockResolvedValue(undefined);
    const services: Record<string, unknown> = {
      logger: { warn: warnSpy, info: vi.fn(), error: errorSpy },
      // The DI key is "adapter" (renamed from "databaseAdapter" — see the
      // comment in reload-config.ts line ~205 for the history).
      adapter: withAdapter
        ? {
            // dialect is a readonly property on DrizzleAdapter, not a
            // method. Fakes must match.
            dialect: "sqlite" as const,
            getDrizzle: () => ({}),
          }
        : undefined,
      collectionRegistryService: {
        syncCodeFirstCollections: vi.fn().mockResolvedValue({}),
        // Mirrors CollectionRegistryService.getAllCollections — the DB-backed
        // list of every registered collection (code + UI). Defaults to empty.
        getAllCollections: vi
          .fn()
          .mockResolvedValue(opts?.allCollections ?? []),
        updateMigrationStatus: updateCollectionMigrationStatusSpy,
      },
      singleRegistryService: {
        syncCodeFirstSingles: vi.fn().mockResolvedValue({}),
        getAllSingles: vi.fn().mockResolvedValue(opts?.allSingles ?? []),
      },
      componentRegistryService: {
        syncCodeFirstComponents: syncCodeFirstComponentsSpy,
        getAllComponents: vi.fn().mockResolvedValue(opts?.allComponents ?? []),
      },
      schemaRegistry: {
        registerDynamicSchema: registerDynamicSchemaSpy,
      },
      migrationJournal: undefined,
    };
    return Object.assign((name: string) => services[name], {
      syncCodeFirstComponentsSpy,
      registerDynamicSchemaSpy,
      updateCollectionMigrationStatusSpy,
    });
  }

  // SQLite reserved-column live state (matches buildReservedColumns output
  // in build-from-fields.ts) so the diff doesn't see id/title/slug/
  // created_at/updated_at as differences. Note: title/slug are NOT NULL
  // when not user-defined; created_at/updated_at are nullable in the spec.
  const SQLITE_RESERVED = [
    { name: "id", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
    { name: "created_at", type: "integer", nullable: true },
    { name: "updated_at", type: "integer", nullable: true },
  ];

  // Build a single-table NextlySchemaSnapshot for the introspect mock.
  // Multi-table snapshots use buildSnapshot() below.
  function liveSnapshot(
    table: string,
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      default?: string;
    }>
  ): NextlySchemaSnapshot {
    return buildSnapshot([
      {
        name: table,
        columns,
      },
    ]);
  }

  function buildSnapshot(
    tables: Array<{
      name: string;
      columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        default?: string;
      }>;
    }>
  ): NextlySchemaSnapshot {
    return {
      tables: tables.map(t => ({
        name: t.name,
        columns: t.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable ?? true,
          default: c.default,
        })),
      })),
    };
  }

  it("re-reads the config from disk on every call (clears the loader cache first)", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });
    expect(clearConfigCacheSpy).toHaveBeenCalledTimes(1);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
  });

  it("introspects all desired tables in ONE batched call", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
          {
            slug: "users",
            tableName: "dc_users",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        { name: "dc_posts", columns: SQLITE_RESERVED },
        { name: "dc_users", columns: SQLITE_RESERVED },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(introspectSpy).toHaveBeenCalledTimes(1);
    const args = introspectSpy.mock.calls[0] as [unknown, string, string[]];
    expect(args[2]).toEqual(["dc_posts", "dc_users"]);
  });

  it("batches additive deltas into ONE PushSchemaPipeline.apply call with source 'code'", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(liveSnapshot("dc_posts", SQLITE_RESERVED));

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, unknown> };
      source: string;
      promptChannel: string;
    };
    expect(call.source).toBe("code");
    expect(call.promptChannel).toBe("terminal");
    expect(Object.keys(call.desired.collections)).toEqual(["posts"]);
  });

  it("preserves UI-created collections (registry-only) in the desired schema so a code-first apply never drops them", async () => {
    // User's exact scenario: a `test_collection` exists (created via the admin
    // UI, so it lives in the DB/registry but NOT in nextly.config.ts). The user
    // then adds `code_collection` in code. The HMR apply must include
    // test_collection in the desired schema, otherwise drizzle-kit (which, on
    // SQLite, introspects the whole DB) flags dc_test_collection as a
    // data-losing orphan DROP and the apply fails.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "code_collection",
            tableName: "dc_code_collection",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    // Live DB has neither code table yet → dc_code_collection is a new table.
    introspectSpy.mockResolvedValue(buildSnapshot([]));

    const resolver = buildResolver({
      allCollections: [
        // The new code collection (already covered by the config loop).
        {
          slug: "code_collection",
          tableName: "dc_code_collection",
          fields: [{ name: "body", type: "text" }],
        },
        // The pre-existing UI collection — must be preserved.
        {
          slug: "test_collection",
          tableName: "dc_test_collection",
          fields: [{ name: "note", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.collections);
    expect(keys).toContain("code_collection"); // the code change itself
    expect(keys).toContain("test_collection"); // UI collection PRESERVED
    expect(call.desired.collections.test_collection?.tableName).toBe(
      "dc_test_collection"
    );
  });

  it("marks a newly-created code-first collection as 'applied' after a successful apply", async () => {
    // User's bug: a collection added in code AFTER initial DB setup gets its
    // table created by the HMR apply, but registerCollection defaults
    // migration_status to 'pending' and nothing flips it — so the builder
    // listing shows "pending" forever. Mirrors the singles branch.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "books",
            tableName: "dc_books",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    // dc_books absent from the live DB → it's a brand-new table.
    introspectSpy.mockResolvedValue(buildSnapshot([]));

    const resolver = buildResolver();
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    expect(resolver.updateCollectionMigrationStatusSpy).toHaveBeenCalledWith(
      "books",
      "applied"
    );
  });

  it("preserves UI-created singles (registry-only) in the desired schema", async () => {
    // A code change (new single) triggers the apply; a pre-existing UI single
    // must ride along in the desired schema so drizzle-kit doesn't drop it.
    loadConfigSpy.mockResolvedValue({
      config: {
        singles: [
          { slug: "settings", fields: [{ name: "site_name", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(buildSnapshot([])); // single_settings is new

    const resolver = buildResolver({
      allSingles: [
        {
          slug: "settings",
          tableName: "single_settings",
          fields: [{ name: "site_name", type: "text" }],
        },
        {
          slug: "ui_single",
          tableName: "single_ui_single",
          fields: [{ name: "x", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { singles: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.singles);
    expect(keys).toContain("settings"); // code change
    expect(keys).toContain("ui_single"); // UI single PRESERVED
  });

  it("preserves UI-created components (registry-only) in the desired schema", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [{ name: "title", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(buildSnapshot([])); // comp_hero is new

    const resolver = buildResolver({
      allComponents: [
        {
          slug: "hero",
          tableName: "comp_hero",
          fields: [{ name: "title", type: "text" }],
        },
        {
          slug: "ui_comp",
          tableName: "comp_ui_comp",
          fields: [{ name: "y", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { components: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.components);
    expect(keys).toContain("hero"); // code change
    expect(keys).toContain("ui_comp"); // UI component PRESERVED
  });

  it("lets a drop+add pair (rename candidate) flow through to the pipeline", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    // Live has `body text`; desired has `summary text`. Same type family
    // -> rename candidate -> gate lets it through.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...SQLITE_RESERVED,
        { name: "body", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passes a standalone drop through to the pipeline (destructive_drop event handled by ClassifierEvent + dispatcher)", async () => {
    // The HMR gate used to block standalone drops because the pipeline
    // had no destructive-confirm event for them. Now drop_column
    // emits a destructive_drop ClassifierEvent that the dispatcher
    // prompts on, so the HMR layer just hands off.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            fields: [],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_users", [
        ...SQLITE_RESERVED,
        { name: "phone", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    // No "needs review" warning — the pipeline's dispatcher owns the
    // confirmation UX now.
    const blockingWarning = warnSpy.mock.calls
      .map(c => c[0] as string)
      .find(s => s.includes("needs review"));
    expect(blockingWarning).toBeUndefined();
  });

  it("passes asymmetric drop+add (drops > adds) through to the pipeline", async () => {
    // Previously gated at the HMR layer. The pipeline's shrinking-pool
    // prompt now handles the rename ambiguity for the paired columns,
    // and surplus drops emit destructive_drop events.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            fields: [{ name: "mobile", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_users", [
        ...SQLITE_RESERVED,
        { name: "phone", type: "text", nullable: true },
        { name: "fax", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
  });

  it("skips a column type change and logs a warning", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            // `boolean` maps to SQLite `integer` token in build-from-fields,
            // which differs from the live `text` -> change_column_type op.
            fields: [{ name: "active", type: "boolean" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...SQLITE_RESERVED,
        { name: "active", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("active");
    expect(warningArg).toContain("type");
  });

  it("passes a 3-drop / 1-add asymmetric change through to the pipeline", async () => {
    // The pipeline's rename detector pairs the 1 add against one of the
    // drops via the shrinking-pool prompt; the other 2 drops emit
    // destructive_drop ClassifierEvents that the dispatcher prompts on.
    // The HMR layer no longer pre-blocks asymmetric edits.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...SQLITE_RESERVED,
        { name: "body", type: "text", nullable: true },
        { name: "tagline", type: "text", nullable: true },
        { name: "byline", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
  });

  it("skips collections that have no changes (diff returns empty)", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    // Live state already matches desired -> no operations.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...SQLITE_RESERVED,
        { name: "body", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
  });

  it("does not crash when the database adapter is unavailable from DI", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await expect(
      reloadNextlyConfig({
        resolver: buildResolver({ withAdapter: false }),
      })
    ).resolves.toBeUndefined();
  });

  it("aborts (no pipeline call) and logs error when batched introspect fails", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockRejectedValue(new Error("connection refused"));

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const errorArg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorArg).toContain("introspect");
    expect(errorArg).toContain("connection refused");
  });

  it("logs an error if the batch pipeline call returns a non-TTY-related failure", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(liveSnapshot("dc_posts", SQLITE_RESERVED));
    pipelineApplySpy.mockResolvedValue({
      success: false,
      statementsExecuted: 0,
      renamesApplied: 0,
      error: { code: "PUSHSCHEMA_FAILED", message: "drizzle-kit error" },
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(errorSpy).toHaveBeenCalled();
    const errorArg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorArg).toContain("PUSHSCHEMA_FAILED");
    expect(errorArg).toContain("drizzle-kit error");
  });

  it("logs a WARN (not error) when the pipeline reports CONFIRMATION_REQUIRED_NO_TTY", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    // drop body + add summary = rename candidate -> gate lets through ->
    // pipeline runs, dispatcher would prompt, but sim a non-TTY result.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...SQLITE_RESERVED,
        { name: "body", type: "text", nullable: true },
      ])
    );
    pipelineApplySpy.mockResolvedValue({
      success: false,
      statementsExecuted: 0,
      renamesApplied: 0,
      error: {
        code: "CONFIRMATION_REQUIRED_NO_TTY",
        message: "TTY required for schema confirmation",
      },
    });

    // The CONFIRMATION_REQUIRED_NO_TTY path uses console.warn (not
    // logger.warn) to surface a top-level, scannable instruction in the
    // dev terminal without a logger prefix.
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    const warningArg = consoleSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("confirmation");

    consoleSpy.mockRestore();
  });

  it("passes the injected dispatcher straight into the pipeline", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(liveSnapshot("dc_posts", SQLITE_RESERVED));

    const fakeDispatcher: PromptDispatcher = {
      dispatch: () =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: [],
          proceed: true,
        }),
    };

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({
      resolver: buildResolver(),
      dispatcher: fakeDispatcher,
    });

    expect(pipelineCtorSpy).toHaveBeenCalledTimes(1);
    const deps = pipelineCtorSpy.mock.calls[0]?.[0] as {
      promptDispatcher: PromptDispatcher;
    };
    expect(deps.promptDispatcher).toBe(fakeDispatcher);
  });

  describe("component support", () => {
    it("includes component table names in the batched introspect call", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "hero", fields: [{ name: "title", type: "text" }] },
            {
              slug: "seo-meta",
              fields: [{ name: "description", type: "text" }],
            },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_hero", columns: SQLITE_RESERVED },
          { name: "comp_seo_meta", columns: SQLITE_RESERVED },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(introspectSpy).toHaveBeenCalledTimes(1);
      const tableNames = (
        introspectSpy.mock.calls[0] as [unknown, string, string[]]
      )[2];
      expect(tableNames).toContain("comp_hero");
      expect(tableNames).toContain("comp_seo_meta");
    });

    it("normalises slug to comp_<snake_case> table name (hyphens → underscores)", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "seo-meta", fields: [{ name: "title", type: "text" }] },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([{ name: "comp_seo_meta", columns: SQLITE_RESERVED }])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      const tableNames = (
        introspectSpy.mock.calls[0] as [unknown, string, string[]]
      )[2];
      expect(tableNames).toContain("comp_seo_meta");
      expect(tableNames).not.toContain("comp_seo-meta");
    });

    it("flows an additive component field change through to the pipeline", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
          ],
        },
      });
      // Live table exists with only reserved columns — subtitle is a new add.
      introspectSpy.mockResolvedValue(
        buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      const call = pipelineApplySpy.mock.calls[0]?.[0] as {
        desired: { components: Record<string, unknown> };
      };
      expect(Object.keys(call.desired.components)).toContain("hero");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("passes a standalone drop on a component table through to the pipeline", async () => {
      // Same behavior as the collection/single equivalent: the
      // pipeline classifier emits a destructive_drop event and the
      // dispatcher prompts the user. HMR layer no longer pre-blocks.
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "hero", fields: [] }, // removed `headline` field
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: "comp_hero",
            columns: [
              ...SQLITE_RESERVED,
              { name: "headline", type: "text", nullable: true },
            ],
          },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      const blockingWarning = warnSpy.mock.calls
        .map(c => c[0] as string)
        .find(s => s.includes("needs review"));
      expect(blockingWarning).toBeUndefined();
    });

    it("calls syncCodeFirstComponents after a successful apply", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            {
              slug: "hero",
              label: { singular: "Hero" },
              fields: [{ name: "subtitle", type: "text" }],
            },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
      );

      const resolver = buildResolver();
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver });

      expect(resolver.syncCodeFirstComponentsSpy).toHaveBeenCalledTimes(1);
      const configs = resolver.syncCodeFirstComponentsSpy.mock
        .calls[0]?.[0] as Array<{ slug: string; label: string }>;
      expect(configs[0]?.slug).toBe("hero");
      expect(configs[0]?.label).toBe("Hero");
    });

    it("calls registerDynamicSchema for the component table after a successful apply", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
      );

      const resolver = buildResolver();
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver });

      expect(resolver.registerDynamicSchemaSpy).toHaveBeenCalledWith(
        "comp_hero",
        expect.anything()
      );
    });

    it("does not call the pipeline when all component diffs are empty", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          components: [
            { slug: "hero", fields: [{ name: "title", type: "text" }] },
          ],
        },
      });
      // Live already matches desired.
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: "comp_hero",
            columns: [
              ...SQLITE_RESERVED,
              { name: "title", type: "text", nullable: true },
            ],
          },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).not.toHaveBeenCalled();
    });
  });
});
