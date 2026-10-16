/**
 * A production boot refuses a configured plugin that `nextly plugins
 * install` never installed, with boot migrations on and off alike, and
 * before any migration runs.
 *
 * The adapter is the real in-memory SQLite one, created where registration
 * creates it, so the gate reads a real, empty ledger. `migrateCore` records
 * that it ran: a boot that refused after it would already have applied the
 * plugin's modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBootMigrationsGateForTest } from "../../init/boot-migrations-gate";
import type { PluginDefinition } from "../../plugins/plugin-context";

const seen = vi.hoisted(() => ({ migrations: 0 }));

vi.mock("../../database/factory", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../database/factory")>();
  return {
    ...original,
    createAdapterFromEnv: async () =>
      original.createAdapter({
        type: "sqlite",
        memory: true,
      } as Parameters<typeof original.createAdapter>[0]),
  };
});
vi.mock("../../cli/commands/migrate", () => ({
  migrateCore: async () => {
    seen.migrations += 1;
    return { applied: 0, coreChanged: false, ran: false };
  },
}));
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

const plugin = {
  name: "@acme/never-installed",
  version: "1.0.0",
  nextly: "*",
} as unknown as PluginDefinition;

/** Whatever `registerServices` rejected with. */
async function bootError(runMigrationsOnBoot: boolean): Promise<unknown> {
  try {
    await registerServices({
      db: {
        runMigrationsOnBoot,
        migrationsDir: "./migrations",
        uiSchemaFile: "./ui-schema.json",
      },
      plugins: [plugin],
    } as unknown as Parameters<typeof registerServices>[0]);
  } catch (error) {
    return error;
  }
  throw new Error("expected the boot to refuse");
}

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  seen.migrations = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  vi.stubEnv("DB_DIALECT", "sqlite");
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetBootMigrationsGateForTest();
});

describe("a production boot over a plugin never installed", () => {
  it.each([true, false])(
    "is refused, naming the install command (boot migrations on: %s)",
    async runMigrationsOnBoot => {
      expect(await bootError(runMigrationsOnBoot)).toMatchObject({
        code: "PLUGIN_NOT_INSTALLED",
        publicMessage: expect.stringContaining(
          "nextly plugins install @acme/never-installed"
        ),
      });
      // Refused before the migrations, not after them.
      expect(seen.migrations).toBe(0);
    }
  );
});
