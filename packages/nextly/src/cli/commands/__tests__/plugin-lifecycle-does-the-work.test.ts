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
  unshippedModules,
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
  hasInstallHook: true,
  unshippedModules: [],
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
    // One prepared DOWN per module, carrying its name, in the order asked.
    prepareDowns: vi.fn(async (_plugin, moduleNames: readonly string[]) =>
      moduleNames.map(moduleName => ({
        moduleName,
        filename: `plugin:@acme/fx/${moduleName}`,
        statements: [`DROP TABLE IF EXISTS fx__${moduleName}`],
        transaction: true,
        destructive: true,
      }))
    ),
    runDown: vi.fn(async () => 2),
    underMigrateLock: async <T>(work: () => Promise<T>) => work(),
    runLifecycleHook: vi.fn(async () => {}),
    readAppliedModules: vi.fn(async () => new Set<string>()),
    // Every table the owner rows name is still there, unless a test says not.
    liveTables: vi.fn(async (tables: readonly string[]) => [...tables]),
    readLifecycleStates: vi.fn(async () => new Map()),
    recordLifecycleState: vi.fn(async () => {}),
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
    hasInstallHook: false,
    unshippedModules: [],
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
      runDown.mock.calls.map(
        c => (c as unknown as [unknown, { moduleName: string }])[1].moduleName
      )
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

  it("says boot will refuse only after an uninstall that leaves it refusing", async () => {
    // Boot refuses a configured plugin left `uninstalled`; one uninstalled with
    // --keep-data is left `orphaned` and still boots. Told otherwise, an
    // operator deletes the config line in a hurry for no reason.
    const said = async (keepData: boolean): Promise<string> => {
      logger.info.mockClear();
      await runPluginUninstallCommand(
        "@acme/fx",
        { keepData, yes: true },
        deps()
      );
      return logger.info.mock.calls.map(c => String(c[0])).join("\n");
    };

    expect(await said(false)).toContain("boot will refuse to start");
    expect(await said(true)).not.toContain("boot will refuse to start");
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

describe("plugins uninstall over a DOWN that drops a column", () => {
  // No owner row, so the plan drops no table: what loses data here is a DOWN
  // dropping a column, such as one the plugin added to a dependency's table.
  const prepared = (destructive: boolean) =>
    vi.fn(async (_plugin, moduleNames: readonly string[]) =>
      moduleNames.map(moduleName => ({
        moduleName,
        filename: `plugin:@acme/fx/${moduleName}`,
        statements: [`ALTER TABLE dep__notes DROP COLUMN fx_${moduleName}`],
        transaction: true,
        destructive,
      }))
    );

  it("asks for --yes before running it, and runs nothing", async () => {
    const runDown = vi.fn(async () => 1);
    const runLifecycleHook = vi.fn(async () => {});
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: false },
        deps({ prepareDowns: prepared(true), runDown, runLifecycleHook })
      )
    ).rejects.toMatchObject({ code: "PLUGIN_UNINSTALL_UNCONFIRMED" });
    expect(runLifecycleHook).not.toHaveBeenCalled();
    expect(runDown).not.toHaveBeenCalled();
  });

  it("runs a DOWN that loses no data without asking", async () => {
    // The control: the same uninstall, its DOWNs judged not destructive.
    const runDown = vi.fn(async () => 1);
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: false },
      deps({ prepareDowns: prepared(false), runDown })
    );
    expect(runDown).toHaveBeenCalledTimes(2);
  });
});

describe("plugins uninstall decides before it takes the lock", () => {
  // One table this plugin owns, so a full uninstall has something to drop
  // and reaches the confirmation.
  const owned = {
    tableName: "fx__notes",
    elementKind: "table",
    elementName: "",
    ownerKind: "plugin",
    ownerId: "@acme/fx",
    migratedBy: "plugin:@acme/fx",
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
  const ownsTable = {
    select: () => ({
      from: () => Object.assign([owned], { where: () => [owned] }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };

  /** Deps whose lock, hook and DOWN runner record that they were reached. */
  function watched(over: Partial<PluginLifecycleDeps> = {}) {
    const reached: string[] = [];
    return {
      reached,
      deps: deps({
        db: ownsTable as never,
        underMigrateLock: async <T>(work: () => Promise<T>) => {
          reached.push("lock");
          return work();
        },
        runLifecycleHook: vi.fn(async () => {
          reached.push("hook");
        }),
        runDown: vi.fn(async () => {
          reached.push("down");
          return 1;
        }),
        ...over,
      }),
    };
  }

  it("refuses an unconfirmed drop without taking the lock", async () => {
    // An exit inside the locked work skipped the lock's release; on
    // PostgreSQL that left a lock row blocking every migration until it
    // expired. The refusal is thrown, and before the lock.
    const { reached, deps: d } = watched();
    await expect(
      runPluginUninstallCommand("@acme/fx", { keepData: false, yes: false }, d)
    ).rejects.toMatchObject({ code: "PLUGIN_UNINSTALL_UNCONFIRMED" });
    expect(reached).toEqual([]);
  });

  it("proceeds under the lock once confirmed", async () => {
    // The control: the same fixture with --yes takes the lock and runs
    // everything inside it.
    const { reached, deps: d } = watched();
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      d
    );
    expect(reached).toEqual(["lock", "hook", "down", "down"]);
  });

  it("refuses an unknown plugin without taking the lock", async () => {
    const { reached, deps: d } = watched();
    await expect(
      runPluginUninstallCommand("@acme/nope", { keepData: false, yes: true }, d)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      publicMessage: expect.stringContaining("Configured: @acme/fx"),
    });
    expect(reached).toEqual([]);
  });

  it("refuses tables no applied module can undo without taking the lock", async () => {
    // A development push: owner rows, and no module in the ledger.
    const { reached, deps: d } = watched({
      plugins: [{ ...plugin, modules: [] }],
    });
    await expect(
      runPluginUninstallCommand("@acme/fx", { keepData: false, yes: true }, d)
    ).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "no-applied-module" },
    });
    expect(reached).toEqual([]);
  });

  it("judges every module's DOWN before the hook or any DOWN runs", async () => {
    // The older module's DOWN is the refused one. Judged per module as it
    // ran, the newer module's DOWN and the hook would already be done.
    const prepareDowns = vi.fn(async () => {
      throw Object.assign(new Error("refused"), {
        code: "DROP_OF_FOREIGN_TABLE",
      });
    });
    const { reached, deps: d } = watched({ prepareDowns });
    await expect(
      runPluginUninstallCommand("@acme/fx", { keepData: false, yes: true }, d)
    ).rejects.toMatchObject({ code: "DROP_OF_FOREIGN_TABLE" });
    expect(prepareDowns).toHaveBeenCalledWith(plugin, [
      "0002_more",
      "0001_init",
    ]);
    expect(reached).toEqual([]);
  });

  it("runs the decision made under the lock, from the plan re-read there", async () => {
    // A module applied between the first decision and the lock is part of
    // what the uninstall has to undo.
    const target: LifecyclePlugin = {
      ...plugin,
      modules: [{ name: "0001_init", reversible: true }],
    };
    const runDown = vi.fn(async () => 1);
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({
        db: ownsTable as never,
        plugins: [target],
        runDown,
        underMigrateLock: async <T>(work: () => Promise<T>) => {
          target.modules = [
            { name: "0001_init", reversible: true },
            { name: "0002_more", reversible: true },
          ];
          return work();
        },
      })
    );
    expect(
      runDown.mock.calls.map(
        c => (c as unknown as [unknown, { moduleName: string }])[1].moduleName
      )
    ).toEqual(["0002_more", "0001_init"]);
  });
});

/** An owner registry over one table row of `@acme/fx`, recording state writes. */
function registryWith(state: string, writes: string[]) {
  const row = {
    tableName: "fx__notes",
    elementKind: "table",
    elementName: "",
    ownerKind: "plugin",
    ownerId: "@acme/fx",
    migratedBy: "plugin:@acme/fx",
    ownerVersion: null,
    schemaVersion: null,
    state,
  };
  return {
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
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

describe("plugins install holds the migrate lock", () => {
  it("from the first module through onInstall", async () => {
    // Released between the modules and the owner rows, an uninstall could
    // roll the modules down in the gap, and the install then marked the rows
    // active again over dropped tables.
    const order: string[] = [];
    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        underMigrateLock: async <T>(work: () => Promise<T>) => {
          order.push("lock");
          const result = await work();
          order.push("unlock");
          return result;
        },
        applyMigrations: vi.fn(async () => {
          order.push("migrations");
        }),
        recordLifecycleState: vi.fn(async () => {
          order.push("recorded");
        }),
        runLifecycleHook: vi.fn(async () => {
          order.push("hook");
        }),
      })
    );

    expect(order).toEqual(["lock", "migrations", "recorded", "hook", "unlock"]);
  });

  it("checks the dependencies again once it holds the lock", async () => {
    // Read before the lock as well, so a refusal takes none; read again under
    // it, where the answer holds until the install is done.
    const readAppliedModules = vi.fn(async () => new Set<string>());
    await runPluginInstallCommand("@acme/fx", deps({ readAppliedModules }));
    expect(readAppliedModules).toHaveBeenCalledTimes(2);
  });
});

describe("plugins install and uninstall record the plugin's own state", () => {
  it("records it installed, before the hook boots", async () => {
    // A reinstall boots for the hook; recorded after, boot would still read
    // the plugin uninstalled and refuse it.
    const recordLifecycleState = vi.fn(async () => {});
    await runPluginInstallCommand("@acme/fx", deps({ recordLifecycleState }));
    expect(recordLifecycleState).toHaveBeenCalledWith(plugin, "installed");
  });

  it("records an uninstall for a plugin that owns no table", async () => {
    // No owner row to carry it, so the state set on the rows went nowhere
    // and the next boot initialised the plugin again.
    const recordLifecycleState = vi.fn(async () => {});
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({ recordLifecycleState })
    );
    expect(recordLifecycleState).toHaveBeenCalledWith(plugin, "uninstalled");
  });

  it("records an uninstall with --keep-data as orphaned", async () => {
    const recordLifecycleState = vi.fn(async () => {});
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: true, yes: true },
      deps({ recordLifecycleState })
    );
    expect(recordLifecycleState).toHaveBeenCalledWith(plugin, "orphaned");
  });
});

describe("plugins uninstall over a module the plugin no longer ships", () => {
  it("refuses before the hook or any DOWN runs, naming the module", async () => {
    // Skipped, the module's schema, data and applied row stayed while the
    // plugin was recorded uninstalled.
    const runLifecycleHook = vi.fn(async () => {});
    const runDown = vi.fn(async () => 1);
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({
          plugins: [{ ...plugin, unshippedModules: ["0000_legacy"] }],
          runLifecycleHook,
          runDown,
        })
      )
    ).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: expect.stringContaining("0000_legacy"),
    });
    expect(runLifecycleHook).not.toHaveBeenCalled();
    expect(runDown).not.toHaveBeenCalled();
  });
});

describe("plugins uninstall after its modules were rolled back", () => {
  // `migrate:down --plugin` rolled back every module: no applied module is
  // left, and the owner rows remain as history naming a table the DOWN
  // dropped.
  const rolledBack = { ...plugin, modules: [] };

  it("finishes, recording the state, when the tables are gone", async () => {
    const writes: string[] = [];
    const recordLifecycleState = vi.fn(async () => {});
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: false },
      deps({
        db: registryWith("active", writes) as never,
        plugins: [rolledBack],
        liveTables: vi.fn(async () => []),
        recordLifecycleState,
      })
    );
    // Nothing left to drop, so nothing to confirm either.
    expect(writes).toEqual(["state:uninstalled"]);
    expect(recordLifecycleState).toHaveBeenCalledWith(
      rolledBack,
      "uninstalled"
    );
  });

  it("still refuses when a table is there and nothing can undo it", async () => {
    // The control: a development push's table, which no applied module made.
    const writes: string[] = [];
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({
          db: registryWith("active", writes) as never,
          plugins: [rolledBack],
        })
      )
    ).rejects.toMatchObject({ code: "PLUGIN_UNINSTALL_IRREVERSIBLE" });
    expect(writes).toEqual([]);
  });
});

describe("unshippedModules", () => {
  const applied = new Set([
    "plugin:@acme/fx/0001_init",
    "plugin:@acme/fx/0000_legacy",
    "plugin:@acme/fx-extra/0001_init",
    "plugin:@acme/other/0009_x",
  ]);

  it("names an applied module the plugin no longer declares", () => {
    expect(unshippedModules("@acme/fx", ["0001_init"], applied)).toEqual([
      "0000_legacy",
    ]);
  });

  it("names none when every applied module is declared", () => {
    // The control: a helper that named every applied module passes the case
    // above too.
    expect(
      unshippedModules("@acme/fx", ["0000_legacy", "0001_init"], applied)
    ).toEqual([]);
  });

  it("never claims another plugin's modules, whatever its name begins with", () => {
    expect(
      unshippedModules("@acme/fx", ["0001_init", "0000_legacy"], applied)
    ).toEqual([]);
    expect(unshippedModules("@acme/fx-extra", [], applied)).toEqual([
      "0001_init",
    ]);
  });
});
