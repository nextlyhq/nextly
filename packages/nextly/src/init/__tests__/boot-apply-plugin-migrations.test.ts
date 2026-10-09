/**
 * The development boot applies the app's pending migrations through
 * `migrateCore`, which refuses every plugin table whose plugin it is not told
 * ships migrations. The boot has to hand it the same plugin migrations the
 * CLI and production boot do, or a configured plugin with tables stops the
 * app's own files applying.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "migrations" },
      plugins: [
        {
          name: "fx",
          version: "1.0.0",
          contributes: { schema: { migrations: [migrationModule] } },
        },
      ],
    },
    deferredExtends: [],
  }),
}));
vi.mock("../../cli/commands/migrate", () => ({ migrateCore }));
vi.mock("../../cli/utils/adapter", () => ({
  validateDatabaseEnv: () => ({ valid: true, errors: [] }),
}));
vi.mock("../../di/container", () => ({
  container: {
    has: () => true,
    get: (name: string) =>
      name === "permissionSeedService" ? permissionSeedService : appAdapter,
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
    // The boot applies only when the migrations directory exists.
    mkdirSync(join(migrationsRoot, "migrations"));
    vi.spyOn(process, "cwd").mockReturnValue(migrationsRoot);
    vi.stubEnv("NODE_ENV", "development");
    migrateCore.mockClear();
    permissionSeedService.seedAllCollectionPermissions.mockClear();
    registered = { collectionsRegistered: 0, singlesRegistered: 0 };
    applied = { applied: 0, pluginModulesApplied: 0 };
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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
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
