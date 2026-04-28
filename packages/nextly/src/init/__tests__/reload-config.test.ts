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

vi.mock("../../cli/utils/config-loader.js", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

// Mock PushSchemaPipeline. The constructor records the deps object so
// tests can assert wiring (e.g., that the injected dispatcher actually
// arrives). apply() routes to its own spy.
vi.mock("../../domains/schema/pipeline/pushschema-pipeline.js", () => ({
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
vi.mock("../../domains/schema/services/drizzle-statement-executor.js", () => ({
  DrizzleStatementExecutor: class {
    executeStatements() {
      return Promise.resolve();
    }
  },
}));

// Pin live-DB introspection. Real buildDesiredTableFromFields and
// diffSnapshots run on top of whatever snapshot the test sets here.
vi.mock("../../domains/schema/pipeline/diff/introspect-live.js", () => ({
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
  function buildResolver(opts?: { withAdapter?: boolean }) {
    const withAdapter = opts?.withAdapter ?? true;
    const services: Record<string, unknown> = {
      logger: { warn: warnSpy, info: vi.fn(), error: errorSpy },
      databaseAdapter: withAdapter
        ? {
            // dialect is a readonly property on DrizzleAdapter, not a
            // method. Fakes must match.
            dialect: "sqlite" as const,
            getDrizzle: () => ({}),
          }
        : undefined,
    };
    return (name: string) => services[name];
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

  it("skips a standalone drop (no replacement add) and logs a warning", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            // No new fields -> phone gets dropped with no replacement.
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

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("users");
    expect(warningArg).toContain("dc_users");
    expect(warningArg).toContain("no replacement");
    expect(warningArg).toContain("data loss");
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

  it("skips a table where drops > adds (asymmetric, surplus would lose data)", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            // 1 add, but 3 drops below -> 2 drops cannot be renamed.
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

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("dc_posts");
    expect(warningArg).toContain("3 columns");
    expect(warningArg).toContain("only 1 replacement");
    expect(warningArg).toContain("2 cannot be renamed");
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

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("CONFIRMATION_REQUIRED_NO_TTY");
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
});
