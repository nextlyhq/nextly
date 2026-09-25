/**
 * `plugins install` and `plugins uninstall` have to DO the database work they
 * report.
 *
 * All three callbacks that perform it were optional, and the one runner that
 * calls these commands passed none. So an install recorded the plugin as
 * installed and printed success while applying no migrations and running no
 * `onInstall`, and a confirmed uninstall logged every module as reverted and
 * recorded the plugin uninstalled while its tables and their data stayed in
 * the database.
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
  requires: [],
  optionallyRequires: [],
  declaredModules: ["0001_init", "0002_more"],
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
    runLifecycleHook: vi.fn(async () => {}),
    readAppliedModules: vi.fn(async () => new Set<string>()),
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

  it("runs onInstall, rather than reporting an install that ran no hook", async () => {
    const runLifecycleHook = vi.fn(async () => {});
    await runPluginInstallCommand("@acme/fx", deps({ runLifecycleHook }));

    expect(runLifecycleHook).toHaveBeenCalledWith(plugin, "onInstall", {
      keepData: false,
    });
  });
});

describe("plugins install over a dependency that is not installed", () => {
  // `@acme/fx` requires `@acme/core`, which declares a module the ledger does
  // not show applied: its install never happened on this database.
  const dependent: LifecyclePlugin = { ...plugin, requires: ["@acme/core"] };
  const dependency: LifecyclePlugin = {
    name: "@acme/core",
    version: "1.0.0",
    enabled: true,
    dependsOn: [],
    requires: [],
    optionallyRequires: [],
    declaredModules: ["0001_core"],
    modules: [],
  };

  it("refuses before running migrations, owner activation or onInstall", async () => {
    // One EXISTING owner row for the dependent, so an owner activation that
    // slipped past the refusal would show up as a write.
    const writes: string[] = [];
    const row = {
      tableName: "fx__notes",
      elementKind: "table",
      elementName: "",
      ownerKind: "plugin",
      ownerId: "@acme/fx",
      migratedBy: "plugin:@acme/fx",
      ownerVersion: null,
      schemaVersion: null,
      state: "uninstalled",
    };
    const registryDb = {
      select: () => ({
        from: () => Object.assign([row], { where: () => [row] }),
      }),
      update: () => ({
        set: (values: { state?: string }) => ({
          where: () => {
            writes.push(`state:${values.state ?? "?"}`);
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({
        values: () => {
          writes.push("insert");
          return Promise.resolve();
        },
      }),
    };
    const applyMigrations = vi.fn(async () => {});
    const runLifecycleHook = vi.fn(async () => {});

    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({
          db: registryDb as never,
          plugins: [dependent, dependency],
          applyMigrations,
          runLifecycleHook,
        })
      )
    ).rejects.toMatchObject({
      code: "PLUGIN_DEPENDENCY_NOT_INSTALLED",
      publicMessage: expect.stringContaining(
        "nextly plugins install @acme/core"
      ),
    });

    expect(applyMigrations).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(runLifecycleHook).not.toHaveBeenCalled();
  });

  it("proceeds once the dependency's modules are applied", async () => {
    // The control: the same fixture with the ledger showing the dependency
    // installed, so the refusal above is about the dependency and nothing else.
    const applyMigrations = vi.fn(async () => {});
    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        plugins: [dependent, dependency],
        applyMigrations,
        readAppliedModules: vi.fn(
          async () => new Set(["plugin:@acme/core/0001_core"])
        ),
      })
    );
    expect(applyMigrations).toHaveBeenCalledWith(dependent);
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

  it("runs onUninstall BEFORE the DOWN statements", async () => {
    // The hook is documented as running while the plugin's tables are still
    // readable — after the first DOWN, some of them are not.
    const order: string[] = [];
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({
        runLifecycleHook: vi.fn(async () => {
          order.push("onUninstall");
        }),
        runDown: vi.fn(async () => {
          order.push("down");
          return 1;
        }),
      })
    );

    expect(order).toEqual(["onUninstall", "down", "down"]);
  });

  it("tells the hook which kind of uninstall this is", async () => {
    // `keepData` decides what onUninstall can still do: with the tables kept,
    // an external deregistration may be wanted; without, this is the last
    // moment anything can read them.
    const runLifecycleHook = vi.fn(async () => {});
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: true, yes: true },
      deps({ runLifecycleHook })
    );

    expect(runLifecycleHook).toHaveBeenCalledWith(plugin, "onUninstall", {
      keepData: true,
    });
  });

  it("clears the uninstalled mark BEFORE the hook boots", async () => {
    // The reinstall case. After a full uninstall the owner rows survive marked
    // `uninstalled`, and boot refuses an `uninstalled` owner that is still
    // listed in config — so a hook booting before the reset could never
    // complete a reinstall of a plugin declaring `onInstall`.
    const order: string[] = [];

    // One EXISTING row for this plugin, so `setState` has something to write:
    // with no rows it returns early and the ordering under test never happens.
    const row = {
      tableName: "fx__notes",
      elementKind: "table",
      elementName: "",
      ownerKind: "plugin",
      ownerId: "@acme/fx",
      migratedBy: "plugin:@acme/fx",
      ownerVersion: null,
      schemaVersion: null,
      state: "uninstalled",
    };
    const registryDb = {
      select: () => ({
        from: () => Object.assign([row], { where: () => [row] }),
      }),
      update: () => ({
        set: (values: { state?: string }) => ({
          where: () => {
            order.push(`state:${values.state ?? "?"}`);
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    };

    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        db: registryDb as never,
        applyMigrations: vi.fn(async () => {
          order.push("migrations");
        }),
        runLifecycleHook: vi.fn(async () => {
          order.push("hook");
        }),
      })
    );

    // Migrations first (the hook reads the plugin's own tables), then the
    // state reset, and only then the boot that would have rejected it.
    expect(order).toEqual(["migrations", "state:active", "hook"]);
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
