/**
 * `plugins install` boots the runtime to run a plugin's `onInstall`, and has
 * to tear that boot down again however it ends — without the disconnect
 * `shutdownServices` would perform, because the command is still using the
 * adapter.
 *
 * The registration, the plugin teardown and the container reset are mocked:
 * what is under test is that the runner reaches the teardown on every path,
 * including the two where it used not to — a hook that throws, and a
 * registration that fails part way after plugins initialized.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEventBus } from "../../../events/event-bus";
import type { CommandContext } from "../../program";
import { runPluginInstall } from "../plugin-lifecycle-runner";

// Hoisted with the mocks that close over it.
const state = vi.hoisted(() => {
  const onInstall = vi.fn();
  // The loader's two configs: the transformed one commands read, and the
  // one the app wrote, which a boot must start from.
  const appConfig = {
    db: { migrationsDir: "./migrations" },
    plugins: [{ name: "@acme/fx", version: "1.0.0", onInstall }],
  };
  return {
    calls: [] as string[],
    alreadyRegistered: false,
    /** Whether `nextly migrate` has created the ledger and owner registry. */
    migrated: true,
    onInstall,
    registerServices: vi.fn(),
    appConfig,
    loadedConfig: { ...appConfig, plugins: [...appConfig.plugins] },
    bootedFrom: [] as unknown[],
  };
});
const { calls, onInstall, registerServices } = state;

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({
    config: state.loadedConfig,
    appConfig: state.appConfig,
  }),
}));

vi.mock("../../utils/adapter", () => ({
  createCliAdapter: async () => ({
    dialect: "sqlite",
    getDrizzle: () => ({}),
    tableExists: async () => state.migrated,
    disconnect: async () => {
      state.calls.push("disconnect");
    },
  }),
}));

// An empty ledger and no owner rows: a first install of a plugin with no
// dependencies, so nothing stands between the command and the hook. The
// install's record of the plugin is written, and goes nowhere.
vi.mock("../../../domains/schema/events/schema-events-repository", () => ({
  SchemaEventsRepository: class {
    listFileApplies() {
      return Promise.resolve([]);
    }
    listPluginLifecycle() {
      return Promise.resolve([]);
    }
    insertEvent() {
      return Promise.resolve("event");
    }
  },
}));

vi.mock(
  "../../../domains/schema/ownership/schema-owners-repository",
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaOwnersRepository: class {
      read() {
        return Promise.resolve([]);
      }
    },
  })
);

vi.mock("../../../di/register", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerServices: state.registerServices,
  isServicesRegistered: () => state.alreadyRegistered,
  getInitializedPluginContext: () => ({}),
  destroyRegisteredPlugins: async () => {
    state.calls.push("destroy");
  },
  clearServices: () => {
    state.calls.push("clear");
  },
}));

vi.mock("../../../init/build-service-config", () => ({
  buildServiceConfig: (options: { config: unknown }) => {
    state.bootedFrom.push(options.config);
    return {};
  },
}));
vi.mock("../../../storage/image-processor", () => ({
  getImageProcessor: () => undefined,
}));
vi.mock("../../../hooks/hook-registry", () => ({
  getHookRegistry: () => undefined,
}));

const context = {
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
} as unknown as CommandContext;

beforeEach(() => {
  calls.length = 0;
  state.bootedFrom.length = 0;
  state.migrated = true;
  state.alreadyRegistered = false;
  onInstall.mockReset().mockImplementation(async () => {
    calls.push("onInstall");
  });
  registerServices.mockReset().mockImplementation(async () => {
    calls.push("register");
  });
});

describe("the lifecycle hook's boot is torn down", () => {
  it("after the hook runs, before the adapter is released", async () => {
    await runPluginInstall("@acme/fx", {}, context);

    expect(calls).toEqual([
      "register",
      "onInstall",
      "destroy",
      "clear",
      "disconnect",
    ]);
  });

  it("only once the handlers of what the hook emitted have finished", async () => {
    // Emitting is fire-and-forget. Another plugin's handler for an event the
    // hook emitted (an uninstall reporting each account deleted, say) is
    // still working when the hook returns, and a teardown then would stop
    // its cleanup part way.
    const bus = getEventBus();
    const handler = async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      calls.push("handler finished");
    };
    bus.on("account.deleted", handler);
    onInstall.mockImplementation(async () => {
      calls.push("onInstall");
      bus.emit("account.deleted", { id: "acc_1" });
    });

    try {
      await runPluginInstall("@acme/fx", {}, context);
    } finally {
      bus.off("account.deleted", handler);
    }

    expect(calls).toEqual([
      "register",
      "onInstall",
      "handler finished",
      "destroy",
      "clear",
      "disconnect",
    ]);
  });

  it("when the hook throws", async () => {
    onInstall.mockImplementation(async () => {
      calls.push("onInstall");
      throw new Error("seed failed");
    });

    await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
      "seed failed"
    );

    expect(calls).toEqual([
      "register",
      "onInstall",
      "destroy",
      "clear",
      "disconnect",
    ]);
  });

  it("when registration fails part way", async () => {
    // Plugins initialize before registration completes, so a failure after
    // that point leaves their init() work running with nothing registered.
    registerServices.mockImplementation(async () => {
      calls.push("register");
      throw new Error("layer 8 failed");
    });

    await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
      "layer 8 failed"
    );

    expect(calls).toEqual(["register", "destroy", "clear", "disconnect"]);
  });

  it("when the database has not been migrated yet", async () => {
    // Refused before anything is read or run, and the adapter still
    // released: `connect` had not handed it back to the caller's `finally`.
    state.migrated = false;

    await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
      /nextly migrate/
    );

    expect(calls).toEqual(["disconnect"]);
  });

  it("but never tears down a registration it did not make", async () => {
    state.alreadyRegistered = true;

    await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
      /already registered/
    );

    expect(calls).toEqual(["disconnect"]);
  });
});

describe("the lifecycle hook's boot", () => {
  it("starts from the config as the app wrote it, not the loaded one", async () => {
    // The boot runs every setup transformer itself. The loaded config
    // already holds their result, so booting from it ran each one twice.
    await runPluginInstall("@acme/fx", {}, context);

    expect(state.bootedFrom).toHaveLength(1);
    const booted = state.bootedFrom[0] as typeof state.appConfig;
    // The app's own plugin list, not the loaded config's copy of it.
    expect(booted.plugins).toBe(state.appConfig.plugins);
    expect(booted.plugins).not.toBe(state.loadedConfig.plugins);
  });

  it("does not run boot migrations", async () => {
    // The hook runs inside the command's migrate lock. A boot that migrated
    // would wait on that lock itself, or on SQLite apply a module after the
    // uninstall had fixed which ones to undo.
    await runPluginInstall("@acme/fx", {}, context);

    expect(state.bootedFrom[0]).toEqual({
      ...state.appConfig,
      db: { ...state.appConfig.db, runMigrationsOnBoot: false },
    });
  });
});
