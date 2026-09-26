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

import type { CommandContext } from "../../program";
import { runPluginInstall } from "../plugin-lifecycle-runner";

// Hoisted with the mocks that close over it.
const state = vi.hoisted(() => ({
  calls: [] as string[],
  alreadyRegistered: false,
  onInstall: vi.fn(),
  registerServices: vi.fn(),
}));
const { calls, onInstall, registerServices } = state;

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "./migrations" },
      plugins: [
        { name: "@acme/fx", version: "1.0.0", onInstall: state.onInstall },
      ],
    },
  }),
}));

vi.mock("../../utils/adapter", () => ({
  createCliAdapter: async () => ({
    dialect: "sqlite",
    getDrizzle: () => ({}),
    disconnect: async () => {
      state.calls.push("disconnect");
    },
  }),
}));

// An empty ledger and no owner rows: a first install of a plugin with no
// dependencies, so nothing stands between the command and the hook.
vi.mock("../../../domains/schema/events/schema-events-repository", () => ({
  SchemaEventsRepository: class {
    listFileApplies() {
      return Promise.resolve([]);
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
  buildServiceConfig: () => ({}),
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

  it("but never tears down a registration it did not make", async () => {
    state.alreadyRegistered = true;

    await expect(runPluginInstall("@acme/fx", {}, context)).rejects.toThrow(
      /already registered/
    );

    expect(calls).toEqual(["disconnect"]);
  });
});
