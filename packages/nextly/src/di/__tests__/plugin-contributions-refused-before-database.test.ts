/**
 * A plugin route or widget source the boot refuses is refused before the
 * database is touched.
 *
 * Boot migrations, extension-table creation and the code-first syncs all run
 * inside `registerServices` before plugins initialise. A refusal that waited
 * for `initializePlugins` therefore came after a production database had
 * already been migrated for a configuration that was never going to serve.
 *
 * The adapter is the real in-memory SQLite one, created where registration
 * creates it (`createAdapterFromEnv`) and counted, and `migrateCore` records
 * that it ran. The positive controls boot the same configuration with a valid
 * contribution and watch it reach both, so the refusals below cannot be
 * satisfied by a boot that never reaches the database for some other reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBootMigrationsGateForTest } from "../../init/boot-migrations-gate";
import type { PluginDefinition } from "../../plugins/plugin-context";

const seen = vi.hoisted(() => ({ adapters: 0, migrations: 0 }));

vi.mock("../../database/factory", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../database/factory")>();
  return {
    ...original,
    createAdapterFromEnv: async () => {
      seen.adapters += 1;
      return original.createAdapter({
        type: "sqlite",
        memory: true,
      } as Parameters<typeof original.createAdapter>[0]);
    },
  };
});
vi.mock("../../cli/commands/migrate", () => ({
  // Reports that nothing ran, so a boot that gets this far refuses here —
  // the point the positive controls must reach.
  migrateCore: async () => {
    seen.migrations += 1;
    return { applied: 0, coreChanged: false, ran: false };
  },
}));
vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

/** A plugin contributing one route declared with `method`. */
function routePlugin(method: string): PluginDefinition {
  return {
    name: "@acme/routes",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      routes: [{ method, path: "/ping", handler: () => new Response("ok") }],
    },
  } as unknown as PluginDefinition;
}

/** A plugin contributing one widget source with the id `id`. */
function widgetSourcePlugin(id: string): PluginDefinition {
  return {
    name: "@acme/widgets",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      widgetSources: [
        { source: { id, kind: "plugin", label: "Ping" }, resolve: () => [] },
      ],
    },
  } as unknown as PluginDefinition;
}

/** Whatever `registerServices` rejected with. */
async function bootError(plugin: PluginDefinition): Promise<unknown> {
  try {
    await registerServices({
      db: {
        runMigrationsOnBoot: true,
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
  seen.adapters = 0;
  seen.migrations = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  vi.stubEnv("DB_DIALECT", "sqlite");
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetBootMigrationsGateForTest();
});

describe("a contributed route the boot refuses", () => {
  it("is refused before an adapter connects or a migration runs", async () => {
    expect(await bootError(routePlugin("post"))).toMatchObject({
      code: "PLUGIN_RESOLUTION_ERROR",
      logContext: { reason: "invalid-route-options" },
    });
    expect(seen.adapters).toBe(0);
    expect(seen.migrations).toBe(0);
  });

  it("lets a valid route through to the database", async () => {
    expect(await bootError(routePlugin("POST"))).toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
    expect(seen.adapters).toBe(1);
    expect(seen.migrations).toBe(1);
  });
});

describe("a contributed widget source the boot refuses", () => {
  it("is refused before an adapter connects or a migration runs", async () => {
    const error = await bootError(widgetSourcePlugin("collection:ping"));
    expect(String((error as Error).message)).toContain(
      "NEXTLY_WIDGET_SOURCE_RESERVED"
    );
    expect(seen.adapters).toBe(0);
    expect(seen.migrations).toBe(0);
  });

  it("lets a valid source through to the database", async () => {
    expect(await bootError(widgetSourcePlugin("plugin:ping"))).toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
    expect(seen.adapters).toBe(1);
    expect(seen.migrations).toBe(1);
  });
});
