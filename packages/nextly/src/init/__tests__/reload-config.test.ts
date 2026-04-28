// Tests for reloadNextlyConfig: the helper that drains an HMR reload flag
// and reapplies code-first schema state.
//
// F3 PR-2 rewrite: the reload-config flow no longer calls
// SchemaChangeService.apply per-collection. It now batches safe
// collections into a single PushSchemaPipeline.apply() call. Tests
// verify (1) preview-based destructive-skip behavior is preserved,
// (2) safe collections are batched into one pipeline call, (3) the
// pipeline is NOT called when nothing safe to apply.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted lets mock factories see these spies.
const {
  loadConfigSpy,
  clearConfigCacheSpy,
  pipelineApplySpy,
  previewSpy,
  getCollectionBySlugSpy,
  warnSpy,
  errorSpy,
} = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
  pipelineApplySpy: vi.fn(),
  previewSpy: vi.fn(),
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
// test path).
vi.mock("../../domains/schema/services/drizzle-statement-executor.js", () => ({
  DrizzleStatementExecutor: class {
    executeStatements() {
      return Promise.resolve();
    }
  },
}));

describe("reloadNextlyConfig", () => {
  beforeEach(() => {
    loadConfigSpy.mockReset();
    clearConfigCacheSpy.mockReset();
    pipelineApplySpy.mockReset();
    previewSpy.mockReset();
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
  function buildResolver(opts?: { withSchemaChangeService?: boolean }) {
    const withSchemaChangeService = opts?.withSchemaChangeService ?? true;
    const services: Record<string, unknown> = {
      schemaChangeService: withSchemaChangeService
        ? { preview: previewSpy, apply: vi.fn() }
        : undefined,
      collectionRegistryService: {
        getCollectionBySlug: getCollectionBySlugSpy,
      },
      logger: { warn: warnSpy, info: vi.fn(), error: errorSpy },
      databaseAdapter: {
        // F3 PR-2 review C1: dialect is a readonly property on
        // DrizzleAdapter, not a method. Test fakes must match.
        dialect: "sqlite" as const,
        getDrizzle: () => ({}),
      },
    };
    return (name: string) => services[name];
  }

  it("re-reads the config from disk on every call (clears the loader cache first)", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });
    expect(clearConfigCacheSpy).toHaveBeenCalledTimes(1);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
  });

  it("batches safe deltas into ONE PushSchemaPipeline.apply call with source 'code'", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    getCollectionBySlugSpy.mockResolvedValue({
      slug: "posts",
      tableName: "dc_posts",
      fields: [],
      schemaVersion: 0,
    });
    previewSpy.mockResolvedValue({
      hasChanges: true,
      hasDestructiveChanges: false,
      classification: "safe",
    });

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

  it("skips destructive deltas and logs a warning instead of including them in the batch", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      },
    });
    getCollectionBySlugSpy.mockResolvedValue({
      slug: "users",
      tableName: "dc_users",
      fields: [{ name: "phone", type: "text" }],
      schemaVersion: 0,
    });
    previewSpy.mockResolvedValue({
      hasChanges: true,
      hasDestructiveChanges: true,
      classification: "destructive",
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    // Pipeline NOT called because there are no safe collections to batch.
    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("destructive");
    expect(warningArg).toContain("users");
    expect(warningArg).toContain("needs review");
  });

  it("skips collections that have no changes (preview reports hasChanges=false)", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    getCollectionBySlugSpy.mockResolvedValue({
      slug: "posts",
      tableName: "dc_posts",
      fields: [{ name: "title", type: "text" }],
      schemaVersion: 0,
    });
    previewSpy.mockResolvedValue({
      hasChanges: false,
      hasDestructiveChanges: false,
      classification: "safe",
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
  });

  it("does not crash when SchemaChangeService is unavailable from DI", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await expect(
      reloadNextlyConfig({
        resolver: buildResolver({ withSchemaChangeService: false }),
      })
    ).resolves.toBeUndefined();
  });

  it("continues to next collection if one preview fails; batches the survivor", async () => {
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
    getCollectionBySlugSpy.mockResolvedValue({
      slug: "first",
      tableName: "dc_first",
      fields: [],
      schemaVersion: 0,
    });
    previewSpy
      .mockRejectedValueOnce(new Error("preview failed"))
      .mockResolvedValueOnce({
        hasChanges: true,
        hasDestructiveChanges: false,
        classification: "safe",
      });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    // Pipeline called once with only the survivor in the batch.
    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, unknown> };
    };
    expect(Object.keys(call.desired.collections)).toEqual(["second"]);
  });

  it("logs an error if the batch pipeline call returns failure", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    getCollectionBySlugSpy.mockResolvedValue({
      slug: "posts",
      tableName: "dc_posts",
      fields: [],
      schemaVersion: 0,
    });
    previewSpy.mockResolvedValue({
      hasChanges: true,
      hasDestructiveChanges: false,
      classification: "safe",
    });
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
});
