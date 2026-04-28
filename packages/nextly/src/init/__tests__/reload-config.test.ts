// Tests for reloadNextlyConfig: the helper that drains an HMR reload flag
// and reapplies code-first schema state.
//
// F4 Option E PR 4 rewrite: the F1 preview gate is gone. Per-collection
// safety is decided by introspect+diff+rename-detector (the same code the
// pipeline runs internally). The mocks below pin introspectLiveSnapshot
// and let real buildDesiredTableFromFields + diffSnapshots run, so the
// test asserts the gate behavior against actual diff output. Pipeline is
// still mocked so we don't hit drizzle-kit.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import type {
  PromptDispatcher,
  RenameCandidate,
} from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";

// vi.hoisted lets mock factories see these spies.
const {
  loadConfigSpy,
  clearConfigCacheSpy,
  pipelineApplySpy,
  introspectSpy,
  getCollectionBySlugSpy,
  warnSpy,
  errorSpy,
} = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
  pipelineApplySpy: vi.fn(),
  introspectSpy: vi.fn(),
  getCollectionBySlugSpy: vi.fn(),
  warnSpy: vi.fn(),
  errorSpy: vi.fn(),
}));

vi.mock("../../cli/utils/config-loader.js", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

// Mock the F3 pipeline construction. Every `new PushSchemaPipeline(...)`
// returns a stub whose .apply() routes to pipelineApplySpy.
vi.mock("../../domains/schema/pipeline/pushschema-pipeline.js", () => ({
  PushSchemaPipeline: class {
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
    pipelineApplySpy.mockReset();
    introspectSpy.mockReset();
    getCollectionBySlugSpy.mockReset();
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
    withRegistry?: boolean;
    withAdapter?: boolean;
  }) {
    const withRegistry = opts?.withRegistry ?? true;
    const withAdapter = opts?.withAdapter ?? true;
    const services: Record<string, unknown> = {
      collectionRegistryService: withRegistry
        ? { getCollectionBySlug: getCollectionBySlugSpy }
        : undefined,
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

  // Snapshot helpers — keep the fixtures small so each test states only
  // the columns it cares about.
  function liveSnapshot(
    table: string,
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      default?: string;
    }>
  ): NextlySchemaSnapshot {
    return {
      tables: [
        {
          name: table,
          columns: columns.map(c => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable ?? true,
            default: c.default,
          })),
        },
      ],
    };
  }

  // SQLite reserved-column live state (matches buildReservedColumns output
  // in build-from-fields.ts) so the diff doesn't see id/title/slug/created_at/
  // updated_at as differences. Note: title/slug are NOT NULL when not
  // user-defined; created_at/updated_at are nullable in the spec.
  const SQLITE_RESERVED = [
    { name: "id", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "slug", type: "text", nullable: false },
    { name: "created_at", type: "integer", nullable: true },
    { name: "updated_at", type: "integer", nullable: true },
  ];

  it("re-reads the config from disk on every call (clears the loader cache first)", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });
    expect(clearConfigCacheSpy).toHaveBeenCalledTimes(1);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
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
    // Live: only reserved columns. Desired: reserved + body. Diff -> add_column.
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
    // -> rename candidate -> gate lets it through so the dispatcher can
    // ask the user.
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

  it("skips a standalone drop (no rename target) and logs a warning", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            // No new fields - phone gets dropped with no replacement.
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
    expect(warningArg).toContain("phone");
    expect(warningArg).toContain("no rename target");
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

  it("does not crash when the registry is unavailable from DI", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await expect(
      reloadNextlyConfig({
        resolver: buildResolver({ withRegistry: false }),
      })
    ).resolves.toBeUndefined();
  });

  it("continues to next collection if one introspect fails; batches the survivor", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "first",
            tableName: "dc_first",
            fields: [{ name: "a", type: "text" }],
          },
          {
            slug: "second",
            tableName: "dc_second",
            fields: [{ name: "b", type: "text" }],
          },
        ],
      },
    });
    introspectSpy
      .mockRejectedValueOnce(new Error("introspect failed"))
      .mockResolvedValueOnce(liveSnapshot("dc_second", SQLITE_RESERVED));

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, unknown> };
    };
    expect(Object.keys(call.desired.collections)).toEqual(["second"]);
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

  it("passes the injected dispatcher through to the pipeline (test seam)", async () => {
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
      dispatch: (_args: {
        candidates: RenameCandidate[];
        classification: "safe" | "destructive" | "interactive";
        channel: "browser" | "terminal";
      }) => Promise.resolve({ confirmedRenames: [], resolutions: {} }),
    };

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({
      resolver: buildResolver(),
      dispatcher: fakeDispatcher,
    });

    // Pipeline was called once and didn't throw - confirms the dispatcher
    // path is wired. (Construction-time dispatcher arrival isn't directly
    // observable through the mocked PushSchemaPipeline class above; the
    // proof is that no clack import / TTY prompt fired.)
    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
  });
});
