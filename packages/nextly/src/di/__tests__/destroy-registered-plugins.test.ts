// Plugin teardown has one implementation, shared by `shutdownServices` and
// the `plugins install|uninstall` command, which cannot disconnect.
//
// What it has to get right: destroy() in REVERSE init order, one plugin's
// failure isolated from the rest, and nothing destroyed twice.
//
// The recorded list is set directly rather than by booting services, so these
// cover the teardown itself; `registerServices` writing that list is covered
// by the plugin integration suites.

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PluginContext,
  PluginDefinition,
} from "../../plugins/plugin-context";
import { destroyRegisteredPlugins, shutdownServices } from "../register";

const registry = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
  __nextly_pluginTeardown?: Array<{
    plugin: PluginDefinition;
    context: PluginContext;
  }>;
};

function recordPlugins(names: string[], log: string[], failing?: string) {
  registry.__nextly_pluginTeardown = names.map(name => ({
    plugin: {
      name,
      version: "1.0.0",
      destroy: () => {
        log.push(name);
        if (name === failing) throw new Error(`${name} could not stop`);
      },
    } as unknown as PluginDefinition,
    context: {} as PluginContext,
  }));
}

afterEach(() => {
  registry.__nextly_pluginTeardown = undefined;
  registry.__nextly_isRegistered = undefined;
  vi.restoreAllMocks();
});

describe("destroyRegisteredPlugins", () => {
  it("destroys in reverse init order", async () => {
    const log: string[] = [];
    recordPlugins(["a", "b", "c"], log);

    await destroyRegisteredPlugins();

    expect(log).toEqual(["c", "b", "a"]);
  });

  it("isolates a failing destroy from the others", async () => {
    // `b` throws; `a`, initialized before it, still has to stop.
    const log: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    recordPlugins(["a", "b", "c"], log, "b");

    await expect(destroyRegisteredPlugins()).resolves.toBeUndefined();

    expect(log).toEqual(["c", "b", "a"]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Plugin "b" destroy failed')
    );
  });

  it("does not destroy anything twice", async () => {
    const log: string[] = [];
    recordPlugins(["a", "b"], log);

    await destroyRegisteredPlugins();
    await destroyRegisteredPlugins();

    expect(log).toEqual(["b", "a"]);
  });

  it("runs without a completed registration", async () => {
    // A registration that initialized plugins and then failed never sets the
    // registered flag; its plugins are running all the same.
    const log: string[] = [];
    registry.__nextly_isRegistered = false;
    recordPlugins(["a", "b"], log);

    await destroyRegisteredPlugins();

    expect(log).toEqual(["b", "a"]);
  });
});

describe("shutdownServices", () => {
  it("destroys plugins through the same teardown", async () => {
    const log: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    registry.__nextly_isRegistered = true;
    recordPlugins(["a", "b", "c"], log, "b");

    await shutdownServices();

    expect(log).toEqual(["c", "b", "a"]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Plugin "b" destroy failed')
    );
    expect(registry.__nextly_pluginTeardown).toBeUndefined();
    expect(registry.__nextly_isRegistered).toBe(false);
  });
});
