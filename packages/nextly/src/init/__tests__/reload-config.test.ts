// Tests for reloadNextlyConfig: the helper that drains an HMR reload flag
// and reapplies code-first schema state.
// What: verifies config re-read, safe deltas auto-apply, destructive deltas
// log + skip.
// Why: this is the in-process replacement for the wrapper's chokidar-driven
// schema apply flow. Unit-level coverage protects the safety invariant
// (no automatic destructive DDL without explicit resolutions).

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted lets mock factories see these spies.
const {
  loadConfigSpy,
  clearConfigCacheSpy,
  applySpy,
  previewSpy,
  getCollectionBySlugSpy,
  warnSpy,
} = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
  applySpy: vi.fn(),
  previewSpy: vi.fn(),
  getCollectionBySlugSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock("../../cli/utils/config-loader.js", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

describe("reloadNextlyConfig", () => {
  beforeEach(() => {
    loadConfigSpy.mockReset();
    clearConfigCacheSpy.mockReset();
    applySpy.mockReset();
    previewSpy.mockReset();
    getCollectionBySlugSpy.mockReset();
    warnSpy.mockReset();
  });

  // Build a service resolver fake. Returns the service or undefined per
  // service name. Tests pass this into reloadNextlyConfig via opts.resolver.
  function buildResolver(opts?: { withSchemaChangeService?: boolean }) {
    const withSchemaChangeService = opts?.withSchemaChangeService ?? true;
    const services: Record<string, unknown> = {
      schemaChangeService: withSchemaChangeService
        ? { preview: previewSpy, apply: applySpy }
        : undefined,
      collectionRegistryService: {
        getCollectionBySlug: getCollectionBySlugSpy,
      },
      logger: { warn: warnSpy, info: vi.fn(), error: vi.fn() },
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

  it("applies safe deltas via SchemaChangeService.apply with source 'code'", async () => {
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
    applySpy.mockResolvedValue({ success: true, newSchemaVersion: 1 });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(applySpy).toHaveBeenCalledTimes(1);
    const applyCall = applySpy.mock.calls[0];
    expect(applyCall?.[0]).toBe("posts"); // slug
    expect(applyCall?.[1]).toBe("dc_posts"); // tableName
    // 7th positional arg (resolutions) is undefined for code-first auto-apply
    expect(applyCall?.[6]).toBeUndefined();
    // 8th arg is the options object with source: 'code'
    expect(applyCall?.[7]).toEqual({ source: "code" });
  });

  it("skips destructive deltas and logs a warning instead of applying", async () => {
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

    expect(applySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    // The classification string is in the message, even though the
    // headline avoids the word "destructive" (see reload-config.ts
    // explanatory comment for why).
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

    expect(applySpy).not.toHaveBeenCalled();
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

  it("continues to the next collection if one fails", async () => {
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
    applySpy.mockResolvedValue({ success: true, newSchemaVersion: 1 });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    // First collection failed at preview; second proceeded.
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]?.[0]).toBe("second");
  });
});
