import { describe, expect, it, vi } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { createLogger } from "../../utils/logger";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import { CliError } from "../../errors";
import { migrateCore, migrateExitCode } from "../migrate";

function deps(over: Record<string, unknown> = {}) {
  return {
    extensionSchema: undefined,
    dialect: "postgresql" as const,
    // Answers the catalog probe the way a database with no field-group
    // registry does. Inert would let the resolution throw, and this orchestration
    // suite would then be asserting on an error from a collaborator rather than
    // on what `migrateCore` does with its steps.
    db: { execute: async () => ({ rows: [] }) },
    adapter: {} as never,
    migrationsDir: "/tmp/migrations",
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast" as const,
    reconcileCoreFn: vi.fn(async () => ({ changed: false })),
    planCoreDeletionsFn: vi.fn(async () => []),
    runFileMigrationsFn: vi.fn(async () => 0),
    refuseUnresolvedAttemptsFn: vi.fn(async () => {}),
    assertAppliedFilesUnchangedFn: vi.fn(async () => {}),
    markOldBuilderFilesFn: vi.fn(async () => {}),
    assertAppliedFilesPresentFn: vi.fn(async () => {}),
    syncElementOwnersFn: vi.fn(async () => {}),
    documentColumnsFn: vi.fn(async () => {}),
    reconcileMetadataFn: vi.fn(async () => ({
      collectionsRegistered: 0,
      singlesRegistered: 0,
      marked: 0,
      stillPending: 0,
      unreadable: [],
    })),
    // Pass-through lock that just runs fn (so we test the core, not the lock),
    // in the real shape: the outcome is discriminated so a caller cannot
    // confuse "returned undefined" with "never ran".
    withLock: async (
      _db: unknown,
      _d: unknown,
      fn: () => Promise<unknown>
    ) => ({
      ran: true as const,
      value: await fn(),
    }),
    ...over,
  };
}

describe("what migrateCore hands the core reconcile", () => {
  /*
   * OBSERVED on the real call rather than reconstructed. The retired-table
   * cleanup guards on these three operations and returns without them, so a
   * caller that omits one drops nothing and says nothing — which is exactly
   * what production did while the flow was documented as working. Asserting
   * the arguments is what makes the omission visible; asserting the outcome
   * cannot, because "nothing dropped" is also the correct answer for a
   * database with no retired tables.
   */
  it("passes the operations the retired-table drop needs", async () => {
    const d = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
    });
    await migrateCore(d as never);

    const passed = (d.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(typeof passed.tableExists).toBe("function");
    expect(typeof passed.countRows).toBe("function");
    expect(typeof passed.executeSql).toBe("function");
  });

  it("forwards the non-empty flag only when the operator set it", async () => {
    // Two decisions, not one: accepting a schema change is not accepting the
    // loss of rows nothing can recreate, so this must not ride along with
    // `allowDestructive`.
    const off = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
    });
    await migrateCore(off as never);
    const withoutFlag = (off.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(withoutFlag.allowDropNonEmptyRetired).toBeUndefined();

    const on = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
      allowDropNonEmptyRetired: true,
    });
    await migrateCore(on as never);
    const withFlag = (on.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(withFlag.allowDropNonEmptyRetired).toBe(true);
  });

  it("forwards the drop flag only when the operator set it", async () => {
    // The opt-in the whole cleanup waits on: without it the retired-table
    // drop returns before logging anything, so a caller that lost the flag
    // would drop nothing and say nothing.
    const off = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
    });
    await migrateCore(off as never);
    const withoutFlag = (off.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(withoutFlag.dropRetiredAuthTables).toBeUndefined();

    const on = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
      dropRetiredAuthTables: true,
    });
    await migrateCore(on as never);
    const withFlag = (on.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(withFlag.dropRetiredAuthTables).toBe(true);
  });
});

describe("what the core upgrade deletes, judged with the run's consent", () => {
  const ACCESS_RULES = ["dynamic_collections", "dynamic_singles"].map(
    table => ({
      kind: "column" as const,
      table,
      column: "access_rules",
      core: true,
      reason: "stored access rules, no longer enforced since 0.0.2-alpha.66",
    })
  );
  const NAMED = "dynamic_collections.access_rules,dynamic_singles.access_rules";

  it("refuses before the lock without consent, naming each column and the consent", async () => {
    const withLock = vi.fn();
    const d = deps({
      planCoreDeletionsFn: vi.fn(async () => ACCESS_RULES),
      consent: resolveDataLossConsent({}),
      interactive: false,
      withLock,
    });

    const run = migrateCore(d as never);
    await expect(run).rejects.toThrow(/dynamic_collections\.access_rules/);
    await expect(run).rejects.toThrow(`--accept-data-loss=${NAMED}`);
    expect(withLock).not.toHaveBeenCalled();
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
  });

  it("asks once at a terminal, the core upgrade listed under its own heading", async () => {
    const asked: string[] = [];
    const lines: string[] = [];
    const d = deps({
      planCoreDeletionsFn: vi.fn(async () => ACCESS_RULES),
      consent: resolveDataLossConsent({}),
      interactive: true,
      askToDelete: vi.fn(async (question: string) => {
        asked.push(question);
        return false;
      }),
      logger: {
        ...createLogger({ quiet: true }),
        warn: (line: string) => lines.push(line),
      },
    });

    await expect(migrateCore(d as never)).rejects.toMatchObject({});
    expect(asked).toHaveLength(1);
    expect(lines.join("\n")).toContain("Nextly's own tables (core upgrade)");
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
  });

  it("with consent naming the columns, hands the reconcile a judge that accepts them and refuses anything else", async () => {
    const d = deps({
      planCoreDeletionsFn: vi.fn(async () => ACCESS_RULES),
      consent: resolveDataLossConsent({ flag: NAMED }),
    });
    await migrateCore(d as never);

    const passed = (d.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      judgeDeletions?: (deletions: readonly unknown[]) => Promise<void>;
      allowDestructive?: boolean;
    };
    expect(passed.allowDestructive).toBeUndefined();
    await expect(
      passed.judgeDeletions?.(ACCESS_RULES)
    ).resolves.toBeUndefined();
    await expect(
      passed.judgeDeletions?.([
        ...ACCESS_RULES,
        { kind: "column", table: "users", column: "name", core: true },
      ])
    ).rejects.toThrow(/users\.name/);
  });

  it("the development boot's run plans no core deletion and hands the reconcile no judge", async () => {
    const d = deps({
      allowDestructive: true,
      planCoreDeletionsFn: vi.fn(async () => ACCESS_RULES),
    });
    await migrateCore(d as never);

    expect(d.planCoreDeletionsFn).not.toHaveBeenCalled();
    const passed = (d.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(passed.allowDestructive).toBe(true);
    expect(passed.judgeDeletions).toBeUndefined();
  });
});

describe("migrateCore", () => {
  it("runs reconcile + file migrations, returns a result, never process.exit", async () => {
    const d = deps();
    const res = await migrateCore(d as never);
    expect(d.reconcileCoreFn).toHaveBeenCalledOnce();
    expect(d.runFileMigrationsFn).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ applied: 0, coreChanged: false });
  });

  /*
   * 🔴 Phase 3 runs UNCONDITIONALLY, including when no migration file applied.
   * A run that applies nothing can still have bookkeeping to do: the DDL landed
   * on a previous invocation and the row stayed `pending`, which is exactly the
   * production shape this phase exists for. Gating it on `applied > 0` would
   * make the stuck row unreachable by the command that repairs it.
   */
  it("records metadata even when no migration file applied", async () => {
    const d = deps({ runFileMigrationsFn: vi.fn(async () => 0) });
    const res = await migrateCore(d as never);

    expect(d.reconcileMetadataFn).toHaveBeenCalledOnce();
    expect(res.applied).toBe(0);
  });

  it("reports what the metadata pass did", async () => {
    const d = deps({
      reconcileMetadataFn: vi.fn(async () => ({
        collectionsRegistered: 2,
        singlesRegistered: 1,
        marked: 3,
        stillPending: 1,
        unreadable: [],
      })),
    });

    // Surfaced on the RESULT rather than only logged, so a caller can report
    // what happened instead of inferring it from `applied`, which counts files.
    expect((await migrateCore(d as never)).metadata).toEqual({
      collectionsRegistered: 2,
      singlesRegistered: 1,
      marked: 3,
      stillPending: 1,
      unreadable: [],
    });
  });

  /*
   * 🔴 The command SUCCEEDS when bookkeeping fails, and this is the assertion
   * that keeps it that way. By Phase 3 the DDL has already landed -- MySQL
   * commits DDL implicitly, so there is no transaction to roll back into --
   * and failing here would report a migration that worked as broken. The row
   * is repaired by the next invocation, because this phase runs every time.
   */
  it("does not fail the command when recording metadata throws", async () => {
    const d = deps({
      reconcileMetadataFn: vi.fn(async () => {
        throw new Error("registry unreachable");
      }),
      runFileMigrationsFn: vi.fn(async () => 4),
    });

    const res = await migrateCore(d as never);

    // The applied count is the load-bearing half: the files really did land,
    // and the caller must still be told so.
    expect(res.applied).toBe(4);

    // 🔴 And the failure is REPORTED, not returned as zeroes. Zero rows
    // repaired and zero rows readable are the same numbers and opposite facts:
    // without `unreadable`, a pass that could not look at anything is
    // indistinguishable from a database that needed nothing.
    expect(res.metadata.marked).toBe(0);
    expect(res.metadata.unreadable).toEqual([
      "collection",
      "single",
      "field group",
    ]);
  });

  it("runs the metadata pass INSIDE the lock", async () => {
    // Ordering is the correctness property: outside the lock, two migrates
    // could sweep the same rows while one of them is still creating tables.
    const order: string[] = [];
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 1;
      }),
      reconcileMetadataFn: vi.fn(async () => {
        order.push("metadata");
        return {
          collectionsRegistered: 0,
          singlesRegistered: 0,
          marked: 0,
          stillPending: 0,
          unreadable: [],
        };
      }),
      withLock: async (
        _db: unknown,
        _d: unknown,
        fn: () => Promise<unknown>
      ) => {
        order.push("lock:acquired");
        const value = await fn();
        order.push("lock:released");
        return { ran: true as const, value };
      },
    });

    await migrateCore(d as never);

    expect(order).toEqual([
      "lock:acquired",
      "files",
      "metadata",
      "lock:released",
    ]);
  });

  it("asks the caller's precondition after the files and before the metadata, inside the lock", async () => {
    const order: string[] = [];
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 1;
      }),
      beforeMetadata: vi.fn(async () => {
        order.push("precondition");
      }),
      reconcileMetadataFn: vi.fn(async () => {
        order.push("metadata");
        return {
          collectionsRegistered: 0,
          singlesRegistered: 0,
          marked: 0,
          stillPending: 0,
          unreadable: [],
        };
      }),
    });

    await migrateCore(d as never);

    expect(order).toEqual(["files", "precondition", "metadata"]);
  });

  // Before the files, because a file written once the per-document columns existed may name
  // them (a SQLite table rebuild copies every column); after the files and the metadata, because a
  // file written before them creates tables without, whose registry rows the metadata records.
  it("adds the per-document columns before the files and again after the metadata", async () => {
    const order: string[] = [];
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 1;
      }),
      documentColumnsFn: vi.fn(async () => {
        order.push("document columns");
      }),
      reconcileMetadataFn: vi.fn(async () => {
        order.push("metadata");
        return {
          collectionsRegistered: 0,
          singlesRegistered: 0,
          marked: 0,
          stillPending: 0,
          unreadable: [],
        };
      }),
    });

    await migrateCore(d as never);

    expect(order).toEqual([
      "document columns",
      "files",
      "metadata",
      "document columns",
    ]);
  });

  // Refused there, the registry keeps the definitions it had, and the next run judges the same
  // change again; the files that ran stay applied.
  it("records no metadata when the caller's precondition refuses, and throws its refusal", async () => {
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => 2),
      beforeMetadata: vi.fn(async () => {
        throw new Error("a translations column cannot hold its field");
      }),
    });

    await expect(migrateCore(d as never)).rejects.toThrow(
      /cannot hold its field/
    );
    expect(d.runFileMigrationsFn).toHaveBeenCalledOnce();
    expect(d.reconcileMetadataFn).not.toHaveBeenCalled();
  });

  it("THROWS (does not exit) when file migrations reject", async () => {
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        throw new Error("apply failed");
      }),
    });
    await expect(migrateCore(d as never)).rejects.toThrow(/apply failed/);
  });

  it("omits them when the adapter cannot supply them", async () => {
    // The dev-boot path wraps the Drizzle adapter in a small object carrying
    // `executeQuery` and nothing else. Asserting the shape instead of
    // detecting it produced a call on `undefined`, and the TypeError was
    // caught by the boot handler — which silently skipped the WHOLE migration
    // phase on every project with a migrations directory. Omitted, the
    // cleanup reports itself as skipped instead.
    const d = deps({ adapter: { executeQuery: vi.fn() } });

    await expect(migrateCore(d as never)).resolves.toBeDefined();

    const passed = (d.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(passed).toBeDefined();
    expect(passed.tableExists).toBeUndefined();
    expect(passed.executeSql).toBeUndefined();
    expect(passed.countRows).toBeUndefined();
  });

  it("omits them for an adapter with neither operation", async () => {
    const d = deps({ adapter: {} });
    await expect(migrateCore(d as never)).resolves.toBeDefined();

    const passed = (d.reconcileCoreFn as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(passed.tableExists).toBeUndefined();
  });
});

describe("the extension schema migrateCore is handed", () => {
  // Handed, not read from the process-wide active schema — which only a
  // server boot publishes, so a CLI run saw none and both checks below
  // silently did nothing. No active schema is set anywhere in this file.
  const pluginSchema = () =>
    buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map([["fx", "fx"]]),
      plugins: [
        {
          owner: { kind: "plugin", id: "fx" },
          tables: [defineTable("notes", { id: col.id() })],
        },
      ],
    });

  it("refuses a plugin table with no migrations before anything runs", async () => {
    const d = deps({ extensionSchema: await pluginSchema() });
    await expect(migrateCore(d as never)).rejects.toMatchObject({
      code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
    });
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
  });

  it("refuses a plugin that only contributes an element and ships no migrations", async () => {
    // It owns no table, so a table-only check let it through, and its column
    // reached development through push and production never.
    const d = deps({
      extensionSchema: await buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map([
          ["host", "host"],
          ["contrib", "contrib"],
        ]),
        dependencies: new Map([["contrib", new Set(["host"])]]),
        plugins: [
          {
            owner: { kind: "plugin", id: "host" },
            tables: [defineTable("items", { id: col.id() })],
          },
          {
            owner: { kind: "plugin", id: "contrib" },
            extend: [
              ({ schema }) => {
                schema.extendTable("host__items", {
                  columns: { extra: col.shortText({ nullable: true }) },
                });
              },
            ],
          },
        ],
      }),
      // The table's owner ships migrations; the contributor does not.
      pluginsWithMigrations: new Set(["host"]),
    });
    await expect(migrateCore(d as never)).rejects.toMatchObject({
      code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
    });
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
  });

  it("lets the same table through when its plugin ships migrations", async () => {
    const d = deps({
      extensionSchema: await pluginSchema(),
      pluginsWithMigrations: new Set(["fx"]),
      // `listTables` answers the prefix check's "is there an owner
      // registry": none here, so nothing is recorded and nothing judged.
      adapter: {
        tableExists: vi.fn(),
        executeQuery: vi.fn(),
        listTables: vi.fn().mockResolvedValue([]),
      },
    });
    await expect(migrateCore(d as never)).resolves.toBeDefined();
  });
});

describe("element owner rows", () => {
  it("are synced after the app's files apply, never before", async () => {
    // A row must exist exactly when its element does: recorded before the
    // app's files, it named an element not yet created; retired before them,
    // it could strip one a pending drop still expects.
    const order: string[] = [];
    const d = deps({
      adapter: { tableExists: vi.fn(), executeQuery: vi.fn() },
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 0;
      }),
      syncElementOwnersFn: vi.fn(async () => {
        order.push("owners");
      }),
    });
    await migrateCore(d as never);
    expect(order).toEqual(["files", "owners"]);
  });
});

describe("a plugin's migration history", () => {
  // Checked before anything changes the database, the core reconcile
  // included: a deploy refused after the core reconcile would leave core's
  // tables upgraded under a release that never ran.
  const content = (name: string) => ({
    name,
    schemaVersion: 1,
    dialects: {
      postgresql: { up: ["CREATE TABLE fx__a (id text)"], down: [] },
      mysql: { up: ["CREATE TABLE fx__a (id text)"], down: [] },
      sqlite: { up: ["CREATE TABLE fx__a (id text)"], down: [] },
    },
    snapshot: {
      postgresql: { tables: [] },
      mysql: { tables: [] },
      sqlite: { tables: [] },
    },
    before: {
      postgresql: { tables: [] },
      mysql: { tables: [] },
      sqlite: { tables: [] },
    },
  });
  const sealed = (name: string): PluginMigration => ({
    ...content(name),
    checksum: migrationChecksum(content(name)),
  });

  it("refuses a list out of name order before the core reconcile runs", async () => {
    const d = deps({
      pluginMigrationSets: [
        {
          pluginName: "fx",
          pluginVersion: "1.0.0",
          migrations: [sealed("002_b"), sealed("001_a")],
        },
      ],
    });
    await expect(migrateCore(d as never)).rejects.toMatchObject({
      code: "PLUGIN_MIGRATIONS_OUT_OF_ORDER",
    });
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
  });

  it("refuses an applied module that changed before the core reconcile runs", async () => {
    const d = deps({
      pluginMigrationSets: [
        {
          pluginName: "fx",
          pluginVersion: "1.0.0",
          migrations: [sealed("001_a")],
        },
      ],
      appliedPluginModulesFn: vi.fn(
        async () => new Map([["plugin:fx/001_a", "0".repeat(64)]])
      ),
    });
    await expect(migrateCore(d as never)).rejects.toMatchObject({
      code: "MIGRATION_CHECKSUM_MISMATCH",
    });
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
  });

  it("reads the ledger inside the lock, and goes on to the core reconcile when the history holds", async () => {
    // The control: the same plugin, its applied module unchanged.
    const order: string[] = [];
    const d = deps({
      pluginMigrationSets: [
        {
          pluginName: "fx",
          pluginVersion: "1.0.0",
          migrations: [sealed("001_a")],
        },
      ],
      appliedPluginModulesFn: vi.fn(async () => {
        order.push("ledger");
        return new Map([["plugin:fx/001_a", sealed("001_a").checksum]]);
      }),
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
      withLock: async (
        _db: unknown,
        _d: unknown,
        fn: () => Promise<unknown>
      ) => {
        order.push("lock");
        return { ran: true as const, value: await fn() };
      },
    });
    // The plugin phase that follows reads the stub database and fails; only
    // what ran before it is under test here.
    await migrateCore(d as never).catch(() => undefined);
    const lock = order.indexOf("lock");
    // Before the lock only the data-loss consent reads which modules are
    // pending; under it the history check reads the ledger first, then the
    // consent is judged again, then the core reconcile runs.
    expect(order.slice(0, lock)).toEqual(["ledger"]);
    expect(order.slice(lock)).toEqual(["lock", "ledger", "ledger", "core"]);
  });
});

describe("a build that lacks an applied migration", () => {
  it("stops before the lock and before the core reconcile, exit 3", async () => {
    const missing = new CliError("MIGRATION_MISSING", {
      what: "The ledger records 1 applied migration this build's migrations folder lacks",
      why: "A newer build has migrated this database.",
      next: "Deploy the build that holds the file.",
    });
    const withLock = vi.fn(async () => ({ ran: true as const, value: 0 }));
    const d = deps({
      assertAppliedFilesPresentFn: vi.fn(async () => {
        throw missing;
      }),
      withLock,
    });
    const refusal = await migrateCore(d as never).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(refusal).toBe(missing);
    expect(migrateExitCode(refusal)).toBe(3);
    expect(withLock).not.toHaveBeenCalled();
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
  });

  it("is asked again under the lock, before the core reconcile", async () => {
    const order: string[] = [];
    let calls = 0;
    const d = deps({
      assertAppliedFilesPresentFn: vi.fn(async () => {
        calls += 1;
        order.push(`present ${String(calls)}`);
      }),
      withLock: async (
        _db: unknown,
        _d: unknown,
        fn: () => Promise<unknown>
      ) => {
        order.push("lock");
        return { ran: true as const, value: await fn() };
      },
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
    });
    await migrateCore(d as never);
    expect(order).toEqual(["present 1", "lock", "present 2", "core"]);
  });
});

describe("a pending plugin module that deletes data", () => {
  // Its UP runs in the plugin phase, before the app files: the consent the
  // run asks for covers it as it covers a file.
  const deleting: PluginMigration = (() => {
    const up = ["DELETE FROM posts"];
    const content = {
      name: "002_prune",
      schemaVersion: 2,
      dialects: {
        postgresql: { up, down: [] },
        mysql: { up, down: [] },
        sqlite: { up, down: [] },
      },
      snapshot: {
        postgresql: { tables: [] },
        mysql: { tables: [] },
        sqlite: { tables: [] },
      },
      before: {
        postgresql: { tables: [] },
        mysql: { tables: [] },
        sqlite: { tables: [] },
      },
    };
    return { ...content, checksum: migrationChecksum(content) };
  })();

  it("is refused before anything runs when no consent covers it and nobody can be asked", async () => {
    const d = deps({
      pluginMigrationSets: [
        { pluginName: "fx", pluginVersion: "1.0.0", migrations: [deleting] },
      ],
      appliedPluginModulesFn: vi.fn(async () => new Map()),
      interactive: false,
    });
    await expect(migrateCore(d as never)).rejects.toThrow(
      /plugin:fx\/002_prune/
    );
    expect(d.reconcileCoreFn).not.toHaveBeenCalled();
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
  });

  it("names the database's DDL event triggers beside the deletions, and asks no more consent for them", async () => {
    const planned = {
      pluginMigrationSets: [
        { pluginName: "fx", pluginVersion: "1.0.0", migrations: [deleting] },
      ],
      appliedPluginModulesFn: vi.fn(async () => new Map()),
      interactive: false,
      readEventTriggersFn: vi.fn(async () => ["audit_ddl", "watch_ddl"]),
    };
    const refusal = (over: Record<string, unknown>) =>
      migrateCore(deps({ ...planned, ...over }) as never).then(
        () => "ran",
        (error: Error) => error.message
      );
    // The triggers add no deletion to judge: the same refusal, told beside it.
    expect(await refusal({})).toBe(
      `${await refusal({ readEventTriggersFn: async () => [] })}\nThis database has the DDL event triggers audit_ddl, watch_ddl: they run on schema changes, and Nextly cannot see what they do, so what they delete is not listed.`
    );
  });

  it("says when whether the database has DDL event triggers could not be read", async () => {
    const d = deps({
      pluginMigrationSets: [
        { pluginName: "fx", pluginVersion: "1.0.0", migrations: [deleting] },
      ],
      appliedPluginModulesFn: vi.fn(async () => new Map()),
      interactive: false,
      readEventTriggersFn: vi.fn(async () => {
        throw new Error("permission denied for pg_event_trigger");
      }),
    });
    await expect(migrateCore(d as never)).rejects.toThrow(
      /could not read whether this database has DDL event triggers/
    );
  });
});

describe("an unresolved app attempt", () => {
  it("is refused before the lock, and so before the core reconcile writes anything", async () => {
    const order: string[] = [];
    const refusal = new Error("unresolved attempt");
    const d = deps({
      withLock: async (
        _db: unknown,
        _d: unknown,
        fn: () => Promise<unknown>
      ) => {
        order.push("lock");
        return { ran: true as const, value: await fn() };
      },
      refuseUnresolvedAttemptsFn: vi.fn(async (args: { command: string }) => {
        order.push(`refusal:${args.command}`);
        throw refusal;
      }),
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
      lockCommand: "boot migrations (db.runMigrationsOnBoot)",
    });
    await expect(migrateCore(d as never)).rejects.toBe(refusal);
    // Asked read-only before the lock is waited on, and again under it once
    // held; the command it names is the boot step's here.
    expect(order).toEqual(["refusal:boot migrations (db.runMigrationsOnBoot)"]);
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
  });
});

describe("an applied file edited since it ran", () => {
  it("is refused after the attempt check and before the core reconcile", async () => {
    const order: string[] = [];
    const refusal = new CliError("MIGRATION_TAMPERED", {
      what: "edited",
      why: "edited",
      next: "restore it",
    });
    const d = deps({
      refuseUnresolvedAttemptsFn: vi.fn(async () => {
        order.push("attempts");
      }),
      assertAppliedFilesUnchangedFn: vi.fn(
        async (args: { command: string }) => {
          order.push(`checksums:${args.command}`);
          throw refusal;
        }
      ),
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
    });
    await expect(migrateCore(d as never)).rejects.toBe(refusal);
    expect(order).toEqual(["attempts", "checksums:nextly migrate"]);
    expect(d.runFileMigrationsFn).not.toHaveBeenCalled();
    // The code the guide documents, so a deploy script can tell it apart.
    expect(migrateExitCode(refusal)).toBe(2);
    expect(migrateExitCode(new Error("anything else"))).toBe(1);
    // An app migration the folder lacks ends with its own code, 3.
    expect(
      migrateExitCode(
        new CliError("MIGRATION_MISSING", { what: "x", why: "x", next: "x" })
      )
    ).toBe(3);
  });
});

describe("a Builder-named file the signature does not recognise", () => {
  it("is refused again inside the lock, before the core reconcile", async () => {
    // Checked before the lock too; a file changed while waiting for the lock
    // must not reach the first write unrefused.
    const order: string[] = [];
    const d = deps({
      refuseUnrecognisedBuilderFiles: true,
      refuseUnrecognisedBuilderFilesFn: vi.fn(async () => {
        order.push("refuse");
      }),
      assertAppliedFilesUnchangedFn: vi.fn(async () => {
        order.push("checksums");
      }),
      withLock: vi.fn(
        async (_a: unknown, _d: unknown, fn: () => Promise<unknown>) => {
          order.push("lock");
          return { ran: true as const, value: await fn() };
        }
      ),
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
    });
    await migrateCore(d as never);
    // Ahead of the checksum check, which records a missing checksum: a run
    // refused for an unrecognised file writes nothing.
    // Before the lock the checksum check only reads (records nothing), so the
    // unrecognised file is refused there after it, as it is inside the lock.
    expect(order).toEqual([
      "checksums",
      "refuse",
      "lock",
      "refuse",
      "checksums",
      "core",
    ]);
  });
});

describe("the marks of old Schema Builder files", () => {
  it("are written after the core reconcile, the run's first write", async () => {
    const order: string[] = [];
    const d = deps({
      reconcileCoreFn: vi.fn(async () => {
        order.push("core");
        return { changed: false };
      }),
      markOldBuilderFilesFn: vi.fn(async () => {
        order.push("marks");
      }),
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 0;
      }),
    });
    await migrateCore(d as never);
    expect(order.slice(0, 2)).toEqual(["core", "marks"]);
  });

  it("are never written when a history check refuses", async () => {
    const refusal = new CliError("MIGRATION_TAMPERED", {
      what: "edited",
      why: "edited",
      next: "restore it",
    });
    const d = deps({
      assertAppliedFilesUnchangedFn: vi.fn(async () => {
        throw refusal;
      }),
    });
    await expect(migrateCore(d as never)).rejects.toBe(refusal);
    expect(d.markOldBuilderFilesFn).not.toHaveBeenCalled();
  });
});

describe("how migrateCore asks for the schema lock", () => {
  /** The options the lock was asked for, observed on the real call. */
  async function lockOptions(over: Record<string, unknown> = {}) {
    const withLock = vi.fn(
      async (
        _adapter: unknown,
        _dialect: unknown,
        fn: () => Promise<unknown>,
        _options?: Record<string, unknown>
      ) => ({ ran: true as const, value: await fn() })
    );
    await migrateCore(deps({ withLock, ...over }) as never);
    return withLock.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
  }

  // A boot — production or development — runs inside a server, whose shutdown may let the
  // migration run on after a signal; releasing the lock then would free it under running work.
  it("leaves the lock to lapse on an interrupt unless its caller asks to release it", async () => {
    expect((await lockOptions())?.releaseOnInterrupt).toBe(false);
  });

  it("releases it on an interrupt when the command asks, as `nextly migrate` does", async () => {
    expect(
      (await lockOptions({ lockReleaseOnInterrupt: true }))?.releaseOnInterrupt
    ).toBe(true);
  });
});
