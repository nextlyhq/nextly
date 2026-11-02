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
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

// Hoisted with the mocks that close over it.
const state = vi.hoisted(() => {
  const onInstall = vi.fn();
  const onUninstall = vi.fn();
  // The loader's two configs: the transformed one commands read, and the
  // one the app wrote, which a boot must start from.
  const appConfig = {
    db: { migrationsDir: "./migrations" },
    plugins: [{ name: "@acme/fx", version: "1.0.0", onInstall, onUninstall }],
  };
  return {
    calls: [] as string[],
    alreadyRegistered: false,
    /** Whether `nextly migrate` has created the ledger and owner registry. */
    migrated: true,
    onInstall,
    onUninstall,
    registerServices: vi.fn(),
    appConfig,
    loadedConfig: { ...appConfig, plugins: [...appConfig.plugins] },
    bootedFrom: [] as unknown[],
  };
});
const { calls, onInstall, onUninstall, registerServices } = state;

// The schema lock is exercised against real databases in its own suites. These drive the lifecycle hook's boot
// through a narrow adapter double that cannot hold it, so here the lock runs the work as given.
vi.mock("../../../domains/schema/pipeline/locks", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/schema/pipeline/locks")
  >()),
  withMigrateLock: async <T>(
    _adapter: unknown,
    _dialect: unknown,
    fn: () => Promise<T>
  ) => ({ ran: true as const, value: await fn() }),
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({
    config: state.loadedConfig,
    appConfig: state.appConfig,
    // The project `--cwd` named, which is not the directory the test runs in.
    projectRoot: "/projects/site",
  }),
}));

vi.mock("../../utils/adapter", () => ({
  createCliAdapter: async () => ({
    dialect: "sqlite",
    getDrizzle: () => ({}),
    tableExists: async () => state.migrated,
    // Each read of SQLite's schema version, so the order of the
    // uninstall's reads around the boot and the hook can be told.
    queryStatement: async () => {
      state.calls.push("schemaVersion");
      return [{ schema_version: 1 }];
    },
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
  getInitializedPluginContext: () => ({}),
  destroyRegisteredPlugins: async () => {
    state.calls.push("destroy");
  },
  clearServices: () => {
    state.calls.push("clear");
  },
}));
vi.mock("../../../di/service-access", () => ({
  isServicesRegistered: () => state.alreadyRegistered,
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
  onUninstall.mockReset().mockImplementation(async () => {
    calls.push("onUninstall");
  });
  registerServices.mockReset().mockImplementation(async () => {
    calls.push("register");
  });
});

describe("the lifecycle hook's boot", () => {
  // The start check judges the Next.js and React of the app the command was
  // pointed at, not of wherever the CLI happened to run.
  it("judges the project --cwd names", async () => {
    await runPluginInstall("@acme/fx", {}, context);

    expect(registerServices).toHaveBeenCalledWith(
      expect.objectContaining({ appRoot: "/projects/site" })
    );
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

  it("drains the follow-up events a handler of the hook's emits", async () => {
    // A handler that emits a second event before it finishes sets off more
    // of the hook's own work, which a teardown must not cut off either.
    const bus = getEventBus();
    const first = async () => {
      await new Promise(resolve => setTimeout(resolve, 2));
      bus.emit("account.erased", {});
    };
    const second = async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      calls.push("follow-up finished");
    };
    bus.on("account.deleted", first);
    bus.on("account.erased", second);
    onInstall.mockImplementation(async () => {
      calls.push("onInstall");
      bus.emit("account.deleted", { id: "acc_1" });
    });

    try {
      await runPluginInstall("@acme/fx", {}, context);
    } finally {
      bus.off("account.deleted", first);
      bus.off("account.erased", second);
    }

    expect(calls).toEqual([
      "register",
      "onInstall",
      "follow-up finished",
      "destroy",
      "clear",
      "disconnect",
    ]);
  });

  it("is not held open by a producer a plugin started outside its hook", async () => {
    // A producer its plugin starts in init() and stops in destroy() never
    // lets the bus empty; started outside the hook, it is not waited for, and
    // the teardown that stops it runs.
    const bus = getEventBus();
    let producing = true;
    const handler = async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (producing) bus.emit("tick", {});
    };
    bus.on("tick", handler);
    bus.emit("tick", {});

    try {
      await runPluginInstall("@acme/fx", {}, context);
    } finally {
      producing = false;
      bus.off("tick", handler);
      await bus.settle();
    }

    expect(calls).toEqual([
      "register",
      "onInstall",
      "destroy",
      "clear",
      "disconnect",
    ]);
  }, 5_000);

  it("and fails the hook when what it set off was still running at the time limit", async () => {
    // The wait is bounded, and a command that went on to drop the plugin's
    // tables would cut that work off; the runtime is still torn down.
    const settleRunning = vi
      .spyOn(getEventBus(), "settleCaused")
      .mockResolvedValue(false);
    try {
      await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
        /still running/
      );
    } finally {
      settleRunning.mockRestore();
    }

    expect(calls).toEqual([
      "register",
      "onInstall",
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

describe("an uninstall's table baseline", () => {
  it("is read after the hook's boot, right before onUninstall", async () => {
    // The boot syncs code-first schema and can create tables; read before
    // it, those read as tables onUninstall created.
    await runPluginUninstall(
      "@acme/fx",
      { keepData: false, yes: true },
      context
    );

    expect(calls).toEqual([
      // Read before anything changes, to refuse an unreadable identity.
      "schemaVersion",
      "register",
      "schemaVersion",
      "onUninstall",
      "destroy",
      "clear",
      // And once the hook has run, to compare with.
      "schemaVersion",
      "disconnect",
    ]);
  });
});
