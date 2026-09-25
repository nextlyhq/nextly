/**
 * Running plugin migrations: order, adoption, refusal, stop-on-failure.
 *
 * Every test drives the runner with fake effects, through the REAL
 * `reconcileFile` state machine — so the three-way decision tested here is
 * the same one the app's files get, not a plugin-only copy of it.
 */
import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../../../pipeline/diff/types";
import type { ColumnSpec, TableSpec } from "../../../pipeline/diff/types";
import type { ReconcileRepo } from "../../drift-reconcile";

import { migrationChecksum, type PluginMigration } from "../plugin-migration";
import { runPluginMigrations } from "../run-plugin-migrations";

function tableSpec(name: string, withScore: boolean): TableSpec {
  const columns: ColumnSpec[] = [
    { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
    { name: "label", type: "varchar(255)", nullable: false },
  ];
  if (withScore) columns.push({ name: "score", type: "int", nullable: true });
  return { name, columns, indexes: [] };
}

function module(args: {
  name: string;
  schemaVersion: number;
  before: TableSpec[];
  target: TableSpec[];
  up?: string[];
}): PluginMigration {
  const dialects = {
    postgresql: { up: args.up ?? ["-- up"], down: [] },
    mysql: { up: args.up ?? ["-- up"], down: [] },
    sqlite: { up: args.up ?? ["-- up"], down: [] },
  };
  return {
    name: args.name,
    schemaVersion: args.schemaVersion,
    checksum: migrationChecksum(dialects),
    dialects,
    snapshot: {
      postgresql: { tables: args.target },
      mysql: { tables: args.target },
      sqlite: { tables: args.target },
    },
    before: {
      postgresql: { tables: args.before },
      mysql: { tables: args.before },
      sqlite: { tables: args.before },
    },
  };
}

function fakeRepo() {
  const started: string[] = [];
  const applied: string[] = [];
  const failed: string[] = [];
  return {
    started,
    applied,
    failed,
    repo: {
      recordStart: async (args: { filename: string }) => {
        started.push(args.filename);
        return `id-${args.filename}`;
      },
      markApplied: async (id: string) => {
        applied.push(id);
        return true;
      },
      markFailed: async (id: string) => {
        failed.push(id);
      },
      supersede: async () => {},
      findFileApplies: async () => [],
    } satisfies ReconcileRepo,
  };
}

function deps(
  overrides: Partial<Parameters<typeof runPluginMigrations>[1]> = {}
) {
  const repo = fakeRepo();
  const executed: string[] = [];
  const owners: Array<Record<string, unknown>> = [];
  const live = new Map<string, TableSpec[]>();
  return {
    executed,
    owners,
    ...repo,
    deps: {
      dialect: "postgresql" as const,
      appliedShas: new Map<string, string | null>(),
      introspect: async (names: readonly string[]) =>
        ({
          tables: names.flatMap(n => live.get(n) ?? []),
        }) as NextlySchemaSnapshot,
      executeSql: async (sql: string) => {
        executed.push(sql);
        return 1;
      },
      repo: repo.repo,
      recordOwner: async (args: {
        pluginName: string;
        tables: readonly string[];
        adopted: boolean;
      }) => {
        owners.push({ ...args });
      },
      ...overrides,
    } as Parameters<typeof runPluginMigrations>[1],
    live,
  };
}

describe("runPluginMigrations", () => {
  const empty = tableSpec("fx__a", false);
  const created = tableSpec("fx__a", true);

  it("applies plugin a's module before dependent plugin b's", async () => {
    const h = deps();
    const aModule = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [empty],
    });
    const bModule = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__b", false)],
    });
    const result = await runPluginMigrations(
      [
        { pluginName: "a", pluginVersion: "1.0.0", migrations: [aModule] },
        { pluginName: "b", pluginVersion: "1.0.0", migrations: [bModule] },
      ],
      h.deps
    );
    expect(result).toEqual({ applied: 2, adopted: 0, skipped: 0 });
    expect(h.started).toEqual(["plugin:a/001", "plugin:b/001"]);
  });

  it("skips a module the ledger already records, without touching the database", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });
    const h = deps({
      appliedShas: new Map([["plugin:a/001", m.checksum]]),
    });
    const result = await runPluginMigrations(
      [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
      h.deps
    );
    expect(result.skipped).toBe(1);
    expect(h.executed).toEqual([]);
    expect(h.started).toEqual([]);
  });

  it("adopts a module whose target is already live (dev push), executing nothing", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });
    const h = deps();
    h.live.set("fx__a", [created]);
    const result = await runPluginMigrations(
      [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
      h.deps
    );
    expect(result.adopted).toBe(1);
    expect(h.executed).toEqual([]);
    expect(h.applied.length).toBe(1);
    expect(h.owners[0]).toMatchObject({ pluginName: "a", adopted: true });
  });

  it("refuses drift: live matches neither side", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [empty],
      target: [tableSpec("fx__a", true)],
    });
    const h = deps();
    h.live.set("fx__a", [tableSpec("fx__a", false)]);
    // Live == before here would APPLY; make it neither by altering a column set.
    h.live.set("fx__a", [
      {
        ...empty,
        columns: [
          ...empty.columns,
          { name: "extra", type: "text", nullable: true },
        ],
      },
    ]);
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toThrow(/does not match|drift/i);
    expect(h.executed).toEqual([]);
  });

  it("refuses a module edited after generation (checksum mismatch)", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });
    m.dialects.postgresql.up = ["-- tampered"];
    const h = deps();
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toThrow(/changed since it was generated/i);
  });

  it("refuses an applied module that no longer matches what ran", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });
    const h = deps({
      appliedShas: new Map([["plugin:a/001", "0".repeat(64)]]),
    });
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toThrow(/no longer matches what was applied/i);
  });

  it("a failing statement stops later modules in every set", async () => {
    const first = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });
    const second = module({
      name: "002",
      schemaVersion: 2,
      before: [created],
      target: [tableSpec("fx__a", true)],
    });
    const h = deps({
      executeSql: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      runPluginMigrations(
        [
          {
            pluginName: "a",
            pluginVersion: "1.0.0",
            migrations: [first, second],
          },
          { pluginName: "b", pluginVersion: "1.0.0", migrations: [second] },
        ],
        h.deps
      )
    ).rejects.toThrow(/boom/);
    // The failed module is recorded as failed; nothing after it starts.
    expect(h.failed.length).toBe(1);
    expect(h.started).toEqual(["plugin:a/001"]);
  });
});

describe("pluginMigrationSetsFrom", () => {
  const m = (): PluginMigration =>
    module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", true)],
    });

  function def(name: string, extra: Record<string, unknown> = {}) {
    return {
      name,
      version: "1.0.0",
      nextly: "^0.0.2",
      contributes: { schema: { migrations: [m()] } },
      ...extra,
    };
  }

  it("keeps every plugin that SHIPS migrations, in resolver order", async () => {
    const { pluginMigrationSetsFrom } = await import(
      "../run-plugin-migrations"
    );
    const b = { ...def("b"), dependsOn: { a: "*" } };
    const sets = await pluginMigrationSetsFrom([
      def("none-shipped", { contributes: {} }),
      { ...def("disabled"), enabled: false },
      b,
      def("a"),
    ]);
    // b depends on a, so resolver order puts a first even though b was listed first.
    // `disabled` keeps its listed position: it has no dependency edges, so the
    // resolver leaves it where it was.
    expect(sets.map(s => s.pluginName)).toEqual(["disabled", "a", "b"]);
    expect(sets[0].migrations).toHaveLength(1);
    expect(sets[0].pluginVersion).toBe("1.0.0");
  });

  it("includes a DISABLED plugin, because its tables still exist", async () => {
    // This reverses what this suite asserted before, deliberately.
    //
    // `enabled: false` is a behaviour switch, not a storage one, and the rest
    // of the runtime already reads it that way — `registerServices` keeps a
    // disabled plugin's collections and fields folded into the config "so the
    // schema is deterministic" and skips only its runtime hooks.
    //
    // Excluding its migrations made the two halves disagree: the compile side
    // describes its tables, so dev push creates them, while production skipped
    // the modules that create them. Disabling a plugin quietly changed the
    // database instead of quietly stopping its code, and its retained
    // collections could reference tables nothing had built.
    //
    // The old assertion recorded the behaviour without giving a reason for it;
    // this one records the decision.
    const { pluginMigrationSetsFrom } = await import(
      "../run-plugin-migrations"
    );
    const sets = await pluginMigrationSetsFrom([
      { ...def("off"), enabled: false },
    ]);

    expect(sets.map(s => s.pluginName)).toEqual(["off"]);
    expect(sets[0].migrations).toHaveLength(1);
  });

  it("still excludes a plugin that ships NO migrations", async () => {
    // The control. A filter that kept everything would satisfy the case above
    // while quietly feeding the runner sets with nothing in them.
    const { pluginMigrationSetsFrom } = await import(
      "../run-plugin-migrations"
    );
    const sets = await pluginMigrationSetsFrom([
      def("none-shipped", { contributes: {} }),
      def("a"),
    ]);
    expect(sets.map(s => s.pluginName)).toEqual(["a"]);
  });
});

describe("drop guard in the runner", () => {
  it("refuses a module whose UP drops another stream's table, before executing", async () => {
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", false)],
      up: ["DROP TABLE auth__identities"],
    });
    const h = deps({
      owners: new Map([
        [
          "auth__identities",
          {
            tableName: "auth__identities",
            ownerKind: "plugin" as const,
            ownerId: "auth",
            migratedBy: "plugin:auth",
            ownerVersion: "1.0.0",
            schemaVersion: 1,
            state: "active" as const,
          },
        ],
      ]) as never,
    });
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toThrow(/different owner/i);
    expect(h.executed).toEqual([]);
    expect(h.started).toEqual([]);
  });
});
