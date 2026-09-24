/**
 * `plugins install` and `plugins uninstall` have to DO the database work they
 * report.
 *
 * Both callbacks that perform it were optional, and the one runner that calls
 * these commands passed neither. So an install recorded the plugin as
 * installed and printed success while applying no migrations, and a confirmed
 * uninstall logged every module as reverted and recorded the plugin
 * uninstalled while its tables and their data stayed in the database.
 *
 * They are required now, which is the half a test cannot express: the type
 * refuses a caller that omits them. These cover the other half — that the
 * commands actually call them, in the right order.
 */
import { describe, expect, it, vi } from "vitest";

import {
  runPluginInstallCommand,
  runPluginUninstallCommand,
  type LifecyclePlugin,
  type PluginLifecycleDeps,
} from "../plugin-lifecycle";

const plugin: LifecyclePlugin = {
  name: "@acme/fx",
  version: "1.0.0",
  enabled: true,
  dependsOn: [],
  modules: [
    { name: "0001_init", reversible: true },
    { name: "0002_more", reversible: true },
  ],
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  debug: vi.fn(),
};

function deps(over: Partial<PluginLifecycleDeps> = {}): PluginLifecycleDeps {
  return {
    adapter: {} as never,
    // The owner registry reads through this. `read()` awaits the builder
    // itself when it filters nothing, so the builder has to BE the empty row
    // list as well as carry `.where`. An empty result is a plugin with
    // nothing recorded yet, which is what a first install looks like.
    db: {
      select: () => ({
        from: () => Object.assign([], { where: () => [] }),
      }),
    } as never,
    dialect: "sqlite",
    plugins: [plugin],
    logger: logger as never,
    applyMigrations: vi.fn(async () => {}),
    runDown: vi.fn(async () => 2),
    ...over,
  };
}

describe("plugins install", () => {
  it("applies the plugin's migrations", async () => {
    const applyMigrations = vi.fn(async () => {});
    await runPluginInstallCommand("@acme/fx", deps({ applyMigrations }));

    expect(applyMigrations).toHaveBeenCalledWith(plugin);
  });

  it("applies them BEFORE onInstall", async () => {
    // `onInstall` is documented as running against the plugin's own tables, so
    // a hook that seeds a row cannot do it into a table no migration made.
    const order: string[] = [];
    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        applyMigrations: vi.fn(async () => {
          order.push("migrations");
        }),
        runLifecycleHook: vi.fn(async () => {
          order.push("onInstall");
        }),
      })
    );

    expect(order).toEqual(["migrations", "onInstall"]);
  });
});

describe("plugins uninstall", () => {
  it("runs DOWN for every module it reports as reverted", async () => {
    const runDown = vi.fn(async () => 3);
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({ runDown })
    );

    // Both modules, not just the newest: the log claims each one.
    expect(
      runDown.mock.calls.map(c => (c as unknown as [unknown, string])[1])
    ).toEqual(["0002_more", "0001_init"]);
  });

  it("reports the statement count it actually ran", async () => {
    // The log used to omit the count entirely when nothing ran, which read
    // identically to a module that had been reverted.
    logger.info.mockClear();
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({ runDown: vi.fn(async () => 7) })
    );

    const reverted = logger.info.mock.calls
      .map(c => String(c[0]))
      .filter(line => line.startsWith("Reverted"));
    expect(reverted.every(line => line.includes("7 statement(s)"))).toBe(true);
  });
});
