/**
 * A production boot that migrates on boot finishes with the gate SETTLED.
 *
 * Migrations run inside `registerServices`, before plugins initialise. The
 * gate used to be opened after that, at the end of registration — by which
 * point the run that settles it had already finished — so every production
 * boot with `runMigrationsOnBoot` left a pending promise nothing would
 * resolve: `requireNextly()` refused with NEXTLY_BOOT_MIGRATIONS_PENDING and
 * every awaiting surface hung.
 *
 * Driven through the real `registerServices` on an in-memory SQLite, in
 * production, with the flag on. Only `migrateCore` is replaced — the file
 * migrations themselves are another suite's subject; this one is about the
 * gate the boot leaves behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../database/factory";
import {
  _resetBootMigrationsGateForTest,
  awaitBootMigrations,
} from "../../init/boot-migrations-gate";

const migrateCore = vi.fn(async (_deps: unknown) => ({
  applied: 0,
  coreChanged: false,
  ran: true,
}));

vi.mock("../../cli/commands/migrate", () => ({
  migrateCore: (deps: unknown) => migrateCore(deps),
}));
/**
 * The registry's loader, watched: each load is counted, and each records
 * whether the migrations had run when it began, so the order the start reads
 * the registry in is observed rather than read from the code.
 */
const loaderState = vi.hoisted(() => ({
  migrated: false,
  loads: [] as boolean[],
}));
vi.mock("../load-dynamic-tables", async importOriginal => {
  const original =
    await importOriginal<typeof import("../load-dynamic-tables")>();
  return {
    ...original,
    loadDynamicTables: (
      ...args: Parameters<typeof original.loadDynamicTables>
    ) => {
      loaderState.loads.push(loaderState.migrated);
      return original.loadDynamicTables(...args);
    },
  };
});

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, shutdownServices } = await import("../register");
const { requireNextly, resetNextlyInstance } = await import(
  "../../direct-api/nextly"
);

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  vi.stubEnv("NODE_ENV", "production");
  // Production environment validation requires these; their values are not
  // what this test is about.
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
});

afterEach(async () => {
  loaderState.migrated = false;
  loaderState.loads = [];
  migrateCore.mockClear();
  vi.unstubAllEnvs();
  resetNextlyInstance();
  await shutdownServices();
  _resetBootMigrationsGateForTest();
});

describe("a production boot with runMigrationsOnBoot", () => {
  it("leaves the gate settled, so the Direct API serves", async () => {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    await registerServices({
      adapter,
      db: {
        runMigrationsOnBoot: true,
        migrationsDir: "./migrations",
        uiSchemaFile: "./ui-schema.json",
      },
    } as unknown as Parameters<typeof registerServices>[0]);

    // The mechanism was reached: the boot ran its migrations.
    expect(migrateCore).toHaveBeenCalledTimes(1);
    // The synchronous consumer first: a gate left pending makes it refuse
    // with NEXTLY_BOOT_MIGRATIONS_PENDING rather than hang.
    expect(() => requireNextly()).not.toThrow();
    // And the awaiting one, raced against a macrotask so a pending gate fails
    // this assertion instead of hanging the suite.
    const settled = await Promise.race([
      awaitBootMigrations().then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0)),
    ]);
    expect(settled).toBe(true);
  });

  it("reads the registry only after the migrations, and needs no reload", async () => {
    // The migrations at start run before the start reads anything of the
    // registry, so every load sees what they wrote, and none is a reload made
    // to catch up with them.
    migrateCore.mockImplementationOnce(async () => {
      loaderState.migrated = true;
      return { applied: 1, coreChanged: false, ran: true };
    });
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    await registerServices({
      adapter,
      db: {
        runMigrationsOnBoot: true,
        migrationsDir: "./migrations",
        uiSchemaFile: "./ui-schema.json",
      },
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(migrateCore).toHaveBeenCalledTimes(1);
    // The loader was reached, and never before the migrations had run.
    expect(loaderState.loads.length).toBeGreaterThan(0);
    expect(loaderState.loads).not.toContain(false);
    expect(() => requireNextly()).not.toThrow();
  });
});
