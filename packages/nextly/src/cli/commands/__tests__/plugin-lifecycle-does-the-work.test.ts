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

import type { PluginLifecycleRecord } from "../../../domains/schema/ownership/plugin-lifecycle-state";
import {
  runPluginInstallAllCommand,
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
  unshippedModules: [],
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  debug: vi.fn(),
};

/**
 * A database whose tables exist until a DOWN runs, and are gone after it:
 * what an uninstall checks before it records the plugin uninstalled.
 */
function droppedByDowns(
  runDown: PluginLifecycleDeps["runDown"] = async () => 1
): Pick<PluginLifecycleDeps, "liveTables" | "runDown"> {
  let dropped = false;
  return {
    liveTables: async tables => new Set(dropped ? [] : tables),
    runDown: async (plugin, down) => {
      dropped = true;
      return runDown(plugin, down);
    },
  };
}

function deps(over: Partial<PluginLifecycleDeps> = {}): PluginLifecycleDeps {
  const given = depsWithout(over);
  return {
    // Each live table as its own, unchanged one: a test that changes a
    // table's identity says so; one that drops or renames a table does it
    // through `liveTables`, which this reads.
    tableIdentities: async tables =>
      new Map(
        [...(await given.liveTables(tables))].map(table => [table, table])
      ),
    // The same tables before and after any hook: a test whose hook creates
    // one says so.
    listTables: async () => ["fx__notes", "users"],
    ...given,
  };
}

function depsWithout(
  over: Partial<PluginLifecycleDeps>
): Omit<PluginLifecycleDeps, "tableIdentities" | "listTables"> &
  Partial<Pick<PluginLifecycleDeps, "tableIdentities" | "listTables">> {
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
        // The first module created the plugin's table, so its DOWN drops it.
        statements: [
          moduleName === "0001_init"
            ? "DROP TABLE IF EXISTS fx__notes"
            : `DROP TABLE IF EXISTS fx__${moduleName}`,
        ],
        transaction: true,
        destructive: true,
      }))
    ),
    runDown: vi.fn(async () => 2),
    underMigrateLock: async <T>(work: () => Promise<T>) => work(),
    runLifecycleHook: vi.fn(async () => {}),
    readAppliedModules: vi.fn(async () => new Set<string>()),
    // Every recorded table still exists, as after an ordinary install.
    liveTables: vi.fn(async (tables: readonly string[]) => new Set(tables)),
    // Both plugins these tests configure, recorded installed.
    readLifecycle: vi.fn(
      async () =>
        new Map([
          ["@acme/fx", { state: "installed" as const }],
          ["@acme/core", { state: "installed" as const }],
        ])
    ),
    recordLifecycle: vi.fn(async () => {}),
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

describe("plugins install holds the migrate lock throughout", () => {
  it("applies the modules and runs onInstall inside one lock", async () => {
    // Released between them, an uninstall could roll the new modules back
    // and mark the plugin uninstalled, and the install would then mark it
    // active again over tables that were gone.
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
          order.push("apply");
        }),
        runLifecycleHook: vi.fn(async () => {
          order.push("hook");
        }),
      })
    );
    expect(order).toEqual(["lock", "apply", "hook", "unlock"]);
  });
});

describe("what uninstall tells the operator to do next", () => {
  const row = {
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
      from: () => Object.assign([row], { where: () => [row] }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  };

  async function lastInfo(
    opts: { keepData: boolean },
    over: Partial<PluginLifecycleDeps>
  ): Promise<string> {
    const info = vi.fn();
    await runPluginUninstallCommand(
      "@acme/fx",
      { ...opts, yes: true },
      deps({
        logger: { ...logger, info } as never,
        ...droppedByDowns(),
        ...over,
      })
    );
    return String(info.mock.calls.at(-1)?.[0]);
  }

  // Every uninstall is recorded, so the boot refuses the plugin while it is
  // configured: after a full uninstall, after --keep-data, and for a plugin
  // that owns no schema, which has no owner rows to carry any state.
  it.each([
    ["a full uninstall", { keepData: false }, { db: ownsTable as never }],
    ["--keep-data", { keepData: true }, { db: ownsTable as never }],
    ["a plugin that owns no schema", { keepData: false }, {}],
  ])(
    "says boot refuses until the plugin leaves the config, after %s",
    async (_case, opts, over) => {
      expect(await lastInfo(opts, over)).toMatch(
        /from your config to finish\. Until you do, boot will refuse to start/
      );
    }
  );
});

describe("plugins uninstall over a DOWN that leaves a table", () => {
  it("refuses to record the plugin uninstalled while the table exists", async () => {
    const row = {
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
    const updates: unknown[] = [];
    const db = {
      select: () => ({
        from: () => Object.assign([row], { where: () => [row] }),
      }),
      update: () => ({
        set: (values: unknown) => {
          updates.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
    // Every DOWN runs without error, and the table is still there after.
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({ db: db as never })
      )
    ).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "tables-left-by-down", tables: ["fx__notes"] },
    });
    expect(updates).toEqual([]);
  });
});

describe("what install reports", () => {
  it("counts tables, not owner rows", async () => {
    // One table, with an index row on it and a column the plugin added to
    // another owner's table: three rows, one table.
    const base = {
      ownerKind: "plugin",
      ownerId: "@acme/fx",
      migratedBy: "plugin:@acme/fx",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    };
    const rows = [
      {
        ...base,
        tableName: "fx__notes",
        elementKind: "table",
        elementName: "",
      },
      {
        ...base,
        tableName: "fx__notes",
        elementKind: "index",
        elementName: "i",
      },
      {
        ...base,
        tableName: "dc_posts",
        elementKind: "column",
        elementName: "c",
      },
    ];
    const success = vi.fn();
    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        logger: { ...logger, success } as never,
        db: {
          select: () => ({
            from: () => Object.assign(rows, { where: () => rows }),
          }),
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        } as never,
      })
    );
    expect(success).toHaveBeenCalledWith(
      "@acme/fx installed (1 table(s) recorded)."
    );
  });
});

describe("plugins uninstall judges what its DOWNs drop before running them", () => {
  const row = {
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
  const ownsNotes = {
    select: () => ({
      from: () => Object.assign([row], { where: () => [row] }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  /** A SQLite rebuild of fx__notes, as the pipeline writes one. */
  const rebuild = [
    'CREATE TABLE "__new_fx__notes" ("id" text PRIMARY KEY)',
    'INSERT INTO "__new_fx__notes" ("id") SELECT "id" FROM "fx__notes"',
    'DROP TABLE "fx__notes"',
    'ALTER TABLE "__new_fx__notes" RENAME TO "fx__notes"',
  ];

  /** A registry holding these owner rows, as `ownsNotes` holds `row`. */
  const owning = (rows: (typeof row)[]) => ({
    select: () => ({
      from: () => Object.assign(rows, { where: () => rows }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  });

  async function uninstallWith(
    statements: string[][],
    db: unknown = ownsNotes,
    over: Partial<PluginLifecycleDeps> = {}
  ) {
    const runDown = vi.fn(async () => 1);
    const runLifecycleHook = vi.fn(async () => {});
    const run = runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({
        db: db as never,
        runLifecycleHook,
        ...droppedByDowns(runDown),
        prepareDowns: vi.fn(async (_plugin, moduleNames: readonly string[]) =>
          moduleNames.map((moduleName, at) => ({
            moduleName,
            filename: `plugin:@acme/fx/${moduleName}`,
            statements: statements[at] ?? [],
            transaction: true,
            destructive: true,
          }))
        ),
        ...over,
      })
    );
    return { run, runDown, runLifecycleHook };
  }

  it("refuses when no DOWN drops a table the plugin owns, running nothing", async () => {
    const { run, runDown, runLifecycleHook } = await uninstallWith([
      ["DROP TABLE IF EXISTS fx__other"],
      [],
    ]);
    await expect(run).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
    });
    expect(runLifecycleHook).not.toHaveBeenCalled();
    expect(runDown).not.toHaveBeenCalled();
  });

  it("counts a table a DOWN only rebuilds as left in place", async () => {
    // A rebuild drops the table and renames its copy into the name.
    const { run, runDown } = await uninstallWith([rebuild, []]);
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables" },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("counts a table another is renamed into after its drop as left in place", async () => {
    // The drop is read, but a table stands under the name once the DOWN ends.
    const { run, runDown } = await uninstallWith([
      ["DROP TABLE fx__notes", "ALTER TABLE fx__archive RENAME TO fx__notes"],
      [],
    ]);
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("follows a table renamed away, so a drop of its old name does not count", async () => {
    // The drop names fx__notes, which no longer holds anything: the table and
    // its rows are under fx__backup.
    const { run, runDown } = await uninstallWith([
      [
        "ALTER TABLE fx__notes RENAME TO fx__backup",
        "DROP TABLE IF EXISTS fx__notes",
      ],
      [],
    ]);
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("counts a table created again under IF NOT EXISTS after its drop as left in place", async () => {
    const { run, runDown } = await uninstallWith([
      [
        "DROP TABLE fx__notes",
        "CREATE TABLE IF NOT EXISTS fx__notes (id text)",
      ],
      [],
    ]);
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a temporary table of the same name, created and dropped",
      ["CREATE TEMP TABLE fx__notes (id text)", "DROP TABLE fx__notes"],
    ],
    [
      "a temporary table dropped by name",
      ["DROP TEMPORARY TABLE IF EXISTS fx__notes"],
    ],
    [
      "a rebuild's twin dropped on its own",
      ['DROP TABLE IF EXISTS "__new_fx__notes"'],
    ],
  ])("counts a table left in place under %s", async (_case, statements) => {
    // Each drop reaches some other table: a temporary one shadowing the
    // plugin's, or the twin, which the guard names by the table it stands
    // in for.
    const { run, runDown } = await uninstallWith([statements, []]);
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a savepoint rolled back over the drop",
      ["SAVEPOINT s", "DROP TABLE fx__notes", "ROLLBACK TO s", "RELEASE s"],
    ],
    [
      "a view taking the name after the drop",
      ["DROP TABLE fx__notes", "CREATE VIEW fx__notes AS SELECT 1 AS id"],
    ],
    [
      "a virtual table taking the name after the drop",
      [
        "DROP TABLE fx__notes",
        "CREATE VIRTUAL TABLE fx__notes USING fts5(body)",
      ],
    ],
    ["a drop through the temp schema", ["DROP TABLE IF EXISTS temp.fx__notes"]],
  ])(
    "counts every table left when a DOWN holds %s, which the reading does not model",
    async (_case, statements) => {
      const { run, runDown } = await uninstallWith([statements, []]);
      await expect(run).rejects.toMatchObject({
        logContext: { reason: "down-leaves-tables", tables: ["fx__notes"] },
      });
      expect(runDown).not.toHaveBeenCalled();
    }
  );

  it("counts an owned table whose stored name keeps upper case as left on PostgreSQL", async () => {
    // `"Fx__Notes"` survives an unquoted drop of fx__notes there.
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      owning([{ ...row, tableName: "Fx__Notes" }]),
      { dialect: "postgresql" }
    );
    await expect(run).rejects.toMatchObject({
      logContext: { reason: "down-leaves-tables", tables: ["Fx__Notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("drops a table whose stored name keeps upper case on SQLite, where names ignore case", async () => {
    // The control: the same uninstall where a lower-cased drop reaches it.
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      owning([{ ...row, tableName: "Fx__Notes" }])
    );
    await run;
    expect(runDown).toHaveBeenCalledTimes(2);
  });

  it("refuses to run any DOWN once onUninstall has renamed a table away", async () => {
    // The DOWNs were judged with fx__notes in place. The hook renamed it, so
    // the drop they were approved for now reaches nothing.
    let hookRan = false;
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      {
        runLifecycleHook: vi.fn(async () => {
          hookRan = true;
        }),
        liveTables: vi.fn(
          async (tables: readonly string[]) => new Set(hookRan ? [] : tables)
        ),
      }
    );
    await expect(run).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "tables-changed-by-hook", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  /**
   * A database in which onUninstall renames fx__notes away and creates a new
   * fx__notes: the name is still there, but its table is another one.
   */
  function replacedByHook() {
    let hookRan = false;
    return {
      runLifecycleHook: vi.fn(async () => {
        hookRan = true;
      }),
      liveTables: vi.fn(async (tables: readonly string[]) => new Set(tables)),
      tableIdentities: vi.fn(
        async (tables: readonly string[]) =>
          new Map(tables.map(table => [table, hookRan ? "t2" : "t1"]))
      ),
    };
  }

  it("refuses to run any DOWN once onUninstall has put another table under a name", async () => {
    // Renamed away and replaced: a check of the name alone passes, and the
    // approved drop then takes the replacement while the original and its
    // rows survive under the other name.
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      replacedByHook()
    );
    await expect(run).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: { reason: "tables-changed-by-hook", tables: ["fx__notes"] },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("refuses before the hook and the record when a table's identity cannot be read", async () => {
    // An identity the database does not report cannot show the table is the
    // one the DOWNs were judged against, so the uninstall cannot succeed.
    // Refused before anything changes: run past here, the hook ran and the
    // plugin was recorded uninstalling, and every run again did the same.
    const recordLifecycle = vi.fn(async () => {});
    const { run, runDown, runLifecycleHook } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      {
        recordLifecycle,
        tableIdentities: vi.fn(
          async (tables: readonly string[]) =>
            new Map(tables.map(table => [table, null]))
        ),
      }
    );
    await expect(run).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: {
        reason: "table-identity-unreadable",
        tables: ["fx__notes"],
      },
    });
    expect(runLifecycleHook).not.toHaveBeenCalled();
    expect(recordLifecycle).not.toHaveBeenCalled();
    expect(runDown).not.toHaveBeenCalled();
  });

  /**
   * A SQLite database in which onUninstall renames fx__notes away, runs
   * VACUUM and creates a new fx__notes: the root page the original moved off
   * is given to the replacement, so its identity reads the same. Only the
   * name the original now goes by is new.
   */
  function rootPageReusedByHook() {
    let hookRan = false;
    return {
      dialect: "sqlite" as const,
      runLifecycleHook: vi.fn(async () => {
        hookRan = true;
      }),
      tableIdentities: vi.fn(
        async (tables: readonly string[]) =>
          new Map(tables.map(table => [table, "4"]))
      ),
      listTables: vi.fn(async () =>
        hookRan
          ? ["fx__notes", "fx__notes_moved", "users"]
          : ["fx__notes", "users"]
      ),
    };
  }

  it("refuses on SQLite once onUninstall has left a table under a new name", async () => {
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      rootPageReusedByHook()
    );
    await expect(run).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      logContext: {
        reason: "tables-changed-by-hook",
        tables: ["fx__notes"],
        created: ["fx__notes_moved"],
      },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("runs the DOWNs on SQLite when onUninstall adds no table (control)", async () => {
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      {
        dialect: "sqlite",
        listTables: vi.fn(async () => ["fx__notes", "users"]),
      }
    );
    await run;
    expect(runDown).toHaveBeenCalledTimes(2);
  });

  it("runs the DOWNs when onUninstall leaves each table as it was (control)", async () => {
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE IF EXISTS fx__notes"], []],
      ownsNotes,
      {
        tableIdentities: vi.fn(
          async (tables: readonly string[]) =>
            new Map(tables.map(table => [table, "t1"]))
        ),
      }
    );
    await run;
    expect(runDown).toHaveBeenCalledTimes(2);
  });

  it("counts two owned tables whose names differ only in case as left", async () => {
    // Read lower-cased, the one drop could be either table's.
    const { run, runDown } = await uninstallWith(
      [["DROP TABLE fx__notes"], []],
      owning([row, { ...row, tableName: "FX__Notes" }])
    );
    await expect(run).rejects.toMatchObject({
      logContext: {
        reason: "down-leaves-tables",
        tables: ["fx__notes", "FX__Notes"],
      },
    });
    expect(runDown).not.toHaveBeenCalled();
  });

  it("allows a table renamed away and dropped under its new name", async () => {
    const { run, runDown } = await uninstallWith([
      ["ALTER TABLE fx__notes RENAME TO fx__backup", "DROP TABLE fx__backup"],
      [],
    ]);
    await run;
    expect(runDown).toHaveBeenCalledTimes(2);
  });

  it("allows a table rebuilt by one DOWN and dropped by a later one", async () => {
    // The control: newest first, so 0002's rebuild runs before 0001's drop.
    const { run, runDown } = await uninstallWith([
      rebuild,
      ['DROP TABLE "fx__notes"'],
    ]);
    await run;
    expect(runDown).toHaveBeenCalledTimes(2);
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
    unshippedModules: [],
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

  it("runs no DOWN when onUninstall fails", async () => {
    // The hook fails when what it set off had not finished: dropping the
    // plugin's tables then would cut that work off part way.
    const runDown = vi.fn(async () => 1);
    const states: string[] = [];
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({
          runLifecycleHook: vi.fn(async () => {
            throw new Error("hook failed");
          }),
          runDown,
          recordLifecycle: vi.fn(async (_plugin, record) => {
            states.push(record.state);
          }),
        })
      )
    ).rejects.toThrow("hook failed");
    expect(runDown).not.toHaveBeenCalled();
    // Left as it stopped: `uninstalling`, which running the command again
    // finishes.
    expect(states).toEqual(["uninstalling"]);
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
        ...droppedByDowns(async () => {
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
        ...droppedByDowns(runDown),
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

describe("plugins install records the plugin installed", () => {
  it("once onInstall has returned, not before", async () => {
    const order: string[] = [];
    await runPluginInstallCommand(
      "@acme/fx",
      deps({
        runLifecycleHook: vi.fn(async () => {
          order.push("onInstall");
        }),
        recordLifecycle: vi.fn(async (_plugin, record) => {
          order.push(`record:${record.state}`);
        }),
      })
    );
    expect(order).toEqual(["onInstall", "record:installed"]);
  });

  it("not when onInstall fails", async () => {
    const recordLifecycle = vi.fn(async () => {});
    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({
          runLifecycleHook: vi.fn(async () => {
            throw new Error("hook failed");
          }),
          recordLifecycle,
        })
      )
    ).rejects.toThrow("hook failed");
    expect(recordLifecycle).not.toHaveBeenCalled();
  });
});

describe("plugins install over a dependency its install never recorded", () => {
  const dependent: LifecyclePlugin = { ...plugin, requires: ["@acme/core"] };
  const core = (declaredModules: string[]): LifecyclePlugin => ({
    ...plugin,
    name: "@acme/core",
    declaredModules,
    modules: [],
  });
  const onlyFx = vi.fn(
    async () => new Map([["@acme/fx", { state: "installed" as const }]])
  );

  it("refuses one whose modules a plain migrate applied", async () => {
    // Its tables are there and its onInstall never ran.
    const applyMigrations = vi.fn(async () => {});
    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({
          plugins: [dependent, core(["0001_core"])],
          readAppliedModules: vi.fn(
            async () => new Set(["plugin:@acme/core/0001_core"])
          ),
          readLifecycle: onlyFx,
          applyMigrations,
        })
      )
    ).rejects.toMatchObject({
      code: "PLUGIN_DEPENDENCY_NOT_INSTALLED",
      publicMessage: expect.stringContaining("has not run on this database"),
    });
    expect(applyMigrations).not.toHaveBeenCalled();
  });

  it("refuses one that owns no schema and was never installed", async () => {
    // No module and no owner row: nothing but the record can show it.
    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({ plugins: [dependent, core([])], readLifecycle: onlyFx })
      )
    ).rejects.toMatchObject({ code: "PLUGIN_DEPENDENCY_NOT_INSTALLED" });
  });

  it("refuses one whose uninstall began", async () => {
    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({
          plugins: [dependent, core([])],
          readLifecycle: vi.fn(
            async () =>
              new Map([
                [
                  "@acme/core",
                  { state: "uninstalling" as const, keepData: false },
                ],
              ])
          ),
        })
      )
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining("did not finish"),
    });
  });

  it("proceeds once its install is recorded", async () => {
    // The control: the same dependency, recorded installed.
    const applyMigrations = vi.fn(async () => {});
    await runPluginInstallCommand(
      "@acme/fx",
      deps({ plugins: [dependent, core([])], applyMigrations })
    );
    expect(applyMigrations).toHaveBeenCalledWith(dependent);
  });
});

describe("plugins uninstall records how far it got", () => {
  const record = () => {
    const order: string[] = [];
    const recordLifecycle = vi.fn(
      async (_plugin: LifecyclePlugin, value: { state: string }) => {
        order.push(
          "keepData" in value
            ? `record:${value.state}:${String(value.keepData)}`
            : `record:${value.state}`
        );
      }
    );
    return { order, recordLifecycle };
  };

  it("records it begun before the hook and finished after the DOWNs", async () => {
    const { order, recordLifecycle } = record();
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({
        recordLifecycle,
        runLifecycleHook: vi.fn(async () => {
          order.push("onUninstall");
        }),
        ...droppedByDowns(async () => {
          order.push("down");
          return 1;
        }),
      })
    );
    expect(order).toEqual([
      "record:uninstalling:false",
      "onUninstall",
      "down",
      "down",
      "record:uninstalled",
    ]);
  });

  it("leaves it recorded begun when a DOWN fails part way", async () => {
    const { order, recordLifecycle } = record();
    let downs = 0;
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({
          recordLifecycle,
          runDown: vi.fn(async () => {
            downs += 1;
            if (downs === 2) throw new Error("connection lost");
            return 1;
          }),
        })
      )
    ).rejects.toThrow("connection lost");
    expect(order).toEqual(["record:uninstalling:false"]);
  });

  it("records an uninstall keeping data as orphaned", async () => {
    const { order, recordLifecycle } = record();
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: true, yes: true },
      deps({ recordLifecycle })
    );
    expect(order).toEqual(["record:uninstalling:true", "record:orphaned"]);
  });
});

describe("plugins uninstall run again after it stopped part way", () => {
  const begun = (keepData: boolean) =>
    vi.fn(
      async () =>
        new Map([["@acme/fx", { state: "uninstalling" as const, keepData }]])
    );

  it("refuses the other --keep-data setting before anything runs", async () => {
    const runLifecycleHook = vi.fn(async () => {});
    const underMigrateLock = vi.fn(<T>(work: () => Promise<T>) => work());
    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: true, yes: true },
        deps({
          readLifecycle: begun(false),
          runLifecycleHook,
          underMigrateLock: underMigrateLock as never,
        })
      )
    ).rejects.toMatchObject({
      code: "PLUGIN_UNINSTALL_UNFINISHED",
      publicMessage: expect.stringContaining("without --keep-data"),
    });
    expect(underMigrateLock).not.toHaveBeenCalled();
    expect(runLifecycleHook).not.toHaveBeenCalled();
  });

  it("finishes when run the way it was begun", async () => {
    const recordLifecycle = vi.fn(async () => {});
    await runPluginUninstallCommand(
      "@acme/fx",
      { keepData: false, yes: true },
      deps({
        readLifecycle: begun(false),
        recordLifecycle,
        ...droppedByDowns(),
      })
    );
    expect(recordLifecycle).toHaveBeenLastCalledWith(plugin, {
      state: "uninstalled",
    });
  });
});

/**
 * A disabled plugin's hooks never run, so an install or an uninstall of it
 * cannot do the work it records. Refused before anything changes: a record
 * of "installed" or "uninstalled" would describe a hook that did not run.
 */
describe("a disabled plugin is refused by install and uninstall", () => {
  const disabled: LifecyclePlugin = { ...plugin, enabled: false };

  it("refuses to install it, applying nothing and recording nothing", async () => {
    const applyMigrations = vi.fn(async () => {});
    const runLifecycleHook = vi.fn(async () => {});
    const recordLifecycle = vi.fn(async () => {});

    await expect(
      runPluginInstallCommand(
        "@acme/fx",
        deps({
          plugins: [disabled],
          applyMigrations,
          runLifecycleHook,
          recordLifecycle,
        })
      )
    ).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });

    expect(applyMigrations).not.toHaveBeenCalled();
    expect(runLifecycleHook).not.toHaveBeenCalled();
    expect(recordLifecycle).not.toHaveBeenCalled();
  });

  it("refuses to uninstall it, running no DOWN and recording nothing", async () => {
    const runDown = vi.fn(async () => 2);
    const recordLifecycle = vi.fn(async () => {});

    await expect(
      runPluginUninstallCommand(
        "@acme/fx",
        { keepData: false, yes: true },
        deps({
          plugins: [disabled],
          recordLifecycle,
          ...droppedByDowns(runDown),
        })
      )
    ).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });

    expect(runDown).not.toHaveBeenCalled();
    expect(recordLifecycle).not.toHaveBeenCalled();
  });
});

/*
 * `plugins install --all`: every configured plugin, in the order the config
 * loader resolved. The loader's sort is tested where it lives; what these pin
 * is that the run follows the order it is given, skips a disabled plugin by
 * name instead of refusing the whole run, and stops at the first failure.
 */
describe("plugins install --all", () => {
  const core: LifecyclePlugin = { ...plugin, name: "@acme/core" };
  const fx: LifecyclePlugin = { ...plugin, dependsOn: ["@acme/core"] };

  it("installs every configured plugin, in the order the loader resolved", async () => {
    const applied: string[] = [];
    await runPluginInstallAllCommand(
      deps({
        plugins: [core, fx],
        applyMigrations: vi.fn(async (p: LifecyclePlugin) => {
          applied.push(p.name);
        }),
      })
    );

    expect(applied).toEqual(["@acme/core", "@acme/fx"]);
  });

  it("installs a dependency and records it before its dependent, on a fresh database", async () => {
    // Nothing recorded at the start, as on a database no install has touched.
    // The dependent's install asks whether its dependency is installed, so it
    // succeeds only if the dependency was installed AND recorded first.
    const lifecycle = new Map<string, PluginLifecycleRecord>();
    const recorded: string[] = [];
    await runPluginInstallAllCommand(
      deps({
        plugins: [core, fx],
        readLifecycle: vi.fn(async () => new Map(lifecycle)),
        recordLifecycle: vi.fn(
          async (p: LifecyclePlugin, record: PluginLifecycleRecord) => {
            lifecycle.set(p.name, record);
            recorded.push(p.name);
          }
        ),
      })
    );

    expect(recorded).toEqual(["@acme/core", "@acme/fx"]);
    expect(lifecycle.get("@acme/fx")).toEqual({ state: "installed" });
  });

  it("skips a disabled plugin by name and installs the rest", async () => {
    const applied: string[] = [];
    const warn = vi.fn();
    await runPluginInstallAllCommand(
      deps({
        plugins: [
          { ...core, enabled: false },
          { ...fx, dependsOn: [] },
        ],
        logger: { ...logger, warn } as never,
        applyMigrations: vi.fn(async (p: LifecyclePlugin) => {
          applied.push(p.name);
        }),
      })
    );

    expect(applied).toEqual(["@acme/fx"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("@acme/core"));
  });

  it("stops at the first install that fails, before the plugins after it", async () => {
    const applied: string[] = [];
    await expect(
      runPluginInstallAllCommand(
        deps({
          plugins: [core, fx],
          applyMigrations: vi.fn(async (p: LifecyclePlugin) => {
            applied.push(p.name);
            if (p.name === "@acme/core") throw new Error("disk full");
          }),
        })
      )
    ).rejects.toThrow("disk full");

    expect(applied).toEqual(["@acme/core"]);
  });

  it("installs nothing, and says so, when no plugin is configured", async () => {
    const info = vi.fn();
    const applyMigrations = vi.fn(async () => {});
    await runPluginInstallAllCommand(
      deps({
        plugins: [],
        logger: { ...logger, info } as never,
        applyMigrations,
      })
    );

    expect(applyMigrations).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("No plugins are configured.");
  });
});
