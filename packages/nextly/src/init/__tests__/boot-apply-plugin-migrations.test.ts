/**
 * The development boot applies the app's pending migrations through
 * `migrateCore`, which refuses every plugin table whose plugin it is not told
 * ships migrations. The boot has to hand it the same plugin migrations the
 * CLI and production boot do, or a configured plugin with tables stops the
 * app's own files applying.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the migrate run reports registering from its metadata phase. */
let registered = { collectionsRegistered: 0, singlesRegistered: 0 };
/** What the migrate run reports applying, per stream. */
let applied = { applied: 0, pluginModulesApplied: 0 };
const migrateCore = vi.fn(async (_args: unknown) => ({
  ...applied,
  metadata: registered,
}));
const permissionSeedService = {
  seedAllCollectionPermissions: vi.fn(async () => ({ newPermissionIds: [] })),
  seedAllSinglePermissions: vi.fn(async () => ({ newPermissionIds: [] })),
  assignNewPermissionsToSuperAdmin: vi.fn(async () => undefined),
};
const migrationModule = { name: "001_notes" };
/** The application's adapter, as the container holds it. */
const appAdapter = {
  dialect: "sqlite",
  getDrizzle: () => ({}),
  executeQuery: async () => [],
  tableExists: async () => true,
  disconnect: async () => {},
};
let migrationsRoot = "";
/** A plugin that ships one migration module. */
const pluginWithModules = {
  name: "fx",
  version: "1.0.0",
  contributes: { schema: { migrations: [migrationModule] } },
};
/** A plugin that ships none. */
const pluginWithoutModules = { name: "plain", version: "1.0.0" };
/** The plugins the loaded config lists. */
let configuredPlugins: readonly object[] = [];

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "migrations" },
      plugins: configuredPlugins,
    },
    deferredExtends: [],
  }),
}));
vi.mock("../../cli/commands/migrate", () => ({ migrateCore }));
vi.mock("../../cli/utils/adapter", () => ({
  validateDatabaseEnv: () => ({ valid: true, errors: [] }),
}));
/** The registry the apply asks about relations once it has reloaded. */
const schemaRegistry = { assertRelationsResolve: () => {} };
vi.mock("../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) =>
      name === "permissionSeedService"
        ? permissionSeedService
        : name === "schemaRegistry"
          ? schemaRegistry
          : appAdapter,
  },
}));
vi.mock("../../domains/schema/migrate/resolved-schema", () => ({
  resolveDeclaredSchema: async () => ({ knownJunctions: new Set<string>() }),
}));
vi.mock("../../domains/schema/extension/publish", () => ({
  compileExtensionSchema: async () => ({}),
}));
vi.mock("../reload-dynamic-tables", () => ({ reloadDynamicTables: vi.fn() }));
vi.mock("../reload-config", () => ({ reloadNextlyConfig: vi.fn() }));

import { runBootTimeApplyIfDev } from "../boot-apply";

describe("development boot migrations", () => {
  beforeEach(() => {
    migrationsRoot = mkdtempSync(join(tmpdir(), "nextly-boot-apply-"));
    // A project with a migrations directory.
    mkdirSync(join(migrationsRoot, "migrations"));
    vi.spyOn(process, "cwd").mockReturnValue(migrationsRoot);
    vi.stubEnv("NODE_ENV", "development");
    migrateCore.mockClear();
    permissionSeedService.seedAllCollectionPermissions.mockClear();
    registered = { collectionsRegistered: 0, singlesRegistered: 0 };
    applied = { applied: 0, pluginModulesApplied: 0 };
    configuredPlugins = [pluginWithModules];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(migrationsRoot, { recursive: true, force: true });
  });

  it("hands migrateCore a configured plugin's modules AND names it as having some", async () => {
    await runBootTimeApplyIfDev();

    expect(migrateCore).toHaveBeenCalledTimes(1);
    const passed = migrateCore.mock.calls[0][0] as {
      pluginMigrationSets?: readonly {
        pluginName: string;
        migrations: readonly unknown[];
      }[];
      pluginsWithMigrations?: ReadonlySet<string>;
      adapter?: unknown;
    };
    // The application's own adapter, not a stand-in with part of its surface.
    expect(passed.adapter).toBe(appAdapter);
    expect(passed.pluginMigrationSets).toEqual([
      expect.objectContaining({
        pluginName: "fx",
        migrations: [migrationModule],
      }),
    ]);
    expect([...(passed.pluginsWithMigrations ?? [])]).toEqual(["fx"]);
  });

  it("seeds permissions for collections the migrate run registered itself", async () => {
    // The run's metadata phase registers what the migration snapshots
    // describe, so the snapshot pass after it finds nothing left to register;
    // the seeding has to follow the run's count too.
    registered = { collectionsRegistered: 1, singlesRegistered: 0 };
    await runBootTimeApplyIfDev();
    expect(
      permissionSeedService.seedAllCollectionPermissions
    ).toHaveBeenCalledTimes(1);
  });

  it("seeds nothing when nothing was registered", async () => {
    await runBootTimeApplyIfDev();
    expect(
      permissionSeedService.seedAllCollectionPermissions
    ).not.toHaveBeenCalled();
  });

  it("counts plugin modules among what it says it applied", async () => {
    // A boot that ran only plugin modules still applied something.
    applied = { applied: 0, pluginModulesApplied: 2 };
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await runBootTimeApplyIfDev();
    const lines = log.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.endsWith("Applied 2 migration(s)"))).toBe(
      true
    );
    expect(lines.some(line => line.endsWith("No pending migrations"))).toBe(
      false
    );
  });
});

describe("development boot migrations without a migrations directory", () => {
  beforeEach(() => {
    // No `migrations` directory inside the project root.
    migrationsRoot = mkdtempSync(join(tmpdir(), "nextly-boot-apply-nodir-"));
    vi.spyOn(process, "cwd").mockReturnValue(migrationsRoot);
    vi.stubEnv("NODE_ENV", "development");
    migrateCore.mockClear();
    registered = { collectionsRegistered: 0, singlesRegistered: 0 };
    applied = { applied: 0, pluginModulesApplied: 0 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(migrationsRoot, { recursive: true, force: true });
  });

  it("still runs a configured plugin's modules, without creating the directory", async () => {
    configuredPlugins = [pluginWithModules];
    await runBootTimeApplyIfDev();

    expect(migrateCore).toHaveBeenCalledTimes(1);
    const passed = migrateCore.mock.calls[0][0] as {
      pluginMigrationSets?: readonly { pluginName: string }[];
      pluginsWithMigrations?: ReadonlySet<string>;
      migrationsDir?: string;
    };
    expect(passed.pluginMigrationSets?.map(set => set.pluginName)).toEqual([
      "fx",
    ]);
    expect([...(passed.pluginsWithMigrations ?? [])]).toEqual(["fx"]);
    // The configured path, absent: the run reads it as no app files.
    expect(passed.migrationsDir).toBe(join(migrationsRoot, "migrations"));
    expect(existsSync(join(migrationsRoot, "migrations"))).toBe(false);
  });

  it("does not run when no configured plugin ships a module", async () => {
    configuredPlugins = [pluginWithoutModules];
    await runBootTimeApplyIfDev();
    expect(migrateCore).not.toHaveBeenCalled();
  });

  it("does not run when no plugin is configured", async () => {
    configuredPlugins = [];
    await runBootTimeApplyIfDev();
    expect(migrateCore).not.toHaveBeenCalled();
  });

  it("runs for the directory alone when no plugin ships a module", async () => {
    // The control for the two cases above: they hold only because the
    // directory is absent, not because a plugin without modules stops the run.
    mkdirSync(join(migrationsRoot, "migrations"));
    configuredPlugins = [pluginWithoutModules];
    await runBootTimeApplyIfDev();
    expect(migrateCore).toHaveBeenCalledTimes(1);
  });
});
