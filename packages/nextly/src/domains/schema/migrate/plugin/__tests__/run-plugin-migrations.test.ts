/**
 * Running plugin migrations: order, adoption, refusal, stop-on-failure.
 *
 * Every test drives the runner with fake effects, through the REAL
 * `reconcileFile` state machine — so the three-way decision tested here is
 * the same one the app's files get, not a plugin-only copy of it.
 */
import { createHash } from "node:crypto";

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
  const sides = {
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
  const content = {
    name: args.name,
    schemaVersion: args.schemaVersion,
    dialects,
    ...sides,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

/**
 * A checksum over the SQL alone, with no snapshot side in it.
 *
 * Built by hand from the statements in the canonical dialect order, because
 * no production path produces this form: it is what a module would carry if
 * its snapshots had been left out of the checksum, and the runner must treat
 * it as not matching.
 */
function sqlOnlyChecksum(migration: PluginMigration): string {
  const base = (["postgresql", "mysql", "sqlite"] as const).map(dialect => [
    dialect,
    migration.dialects[dialect].up,
    migration.dialects[dialect].down,
  ]);
  return createHash("sha256").update(JSON.stringify(base)).digest("hex");
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

  it("refuses a module whose target snapshot was edited, even though its SQL was not", async () => {
    // The target is what decides adoption: edited to match the live table,
    // it would have the runner record the module as applied without running
    // a statement. The checksum covers it, so the edit is caught first.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", false)],
    });
    m.snapshot.postgresql = { tables: [created] };
    const h = deps();
    h.live.set("fx__a", [created]);
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    expect(h.executed).toEqual([]);
    expect(h.started).toEqual([]);
    expect(h.owners).toEqual([]);
  });

  it("refuses a snapshot-bearing module whose checksum covers only its SQL, after its snapshot was edited", async () => {
    // A checksum over the SQL alone says nothing about the snapshots, so the
    // module below — target edited to match the live table, checksum still
    // valid for its untouched SQL — would otherwise be adopted and its
    // ownership recorded without the reviewed SQL ever running.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [tableSpec("fx__a", false)],
    });
    m.snapshot = {
      postgresql: { tables: [created] },
      mysql: { tables: [created] },
      sqlite: { tables: [created] },
    };
    m.checksum = sqlOnlyChecksum(m);
    const h = deps();
    h.live.set("fx__a", [created]);
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    expect(h.executed).toEqual([]);
    expect(h.started).toEqual([]);
    expect(h.owners).toEqual([]);
  });

  it("refuses a SQL-only checksum even on an unedited module, so there is no second accepted form", async () => {
    // Nothing distinguishes an unedited module with a SQL-only checksum from
    // an edited one, so neither is accepted: the one checksum form covers the
    // snapshots.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [created],
    });
    m.checksum = sqlOnlyChecksum(m);
    const h = deps();
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    expect(h.started).toEqual([]);
  });

  it("refuses a module whose schemaVersion was edited after sealing", async () => {
    // The version is written to the owner rows the version gate reads, so a
    // bumped one would claim a schema the module's SQL never produced.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [created],
    });
    m.schemaVersion = 2;
    const h = deps();
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    expect(h.started).toEqual([]);
    expect(h.owners).toEqual([]);
  });

  it("refuses an applied module renamed after sealing, instead of judging it afresh", async () => {
    // The name is the ledger key. Renamed, an applied module is no longer
    // found there, so without the seal it would be reconciled as new —
    // adopted here, since its target is live — under a key nobody reviewed.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [created],
    });
    const h = deps({
      appliedShas: new Map([["plugin:a/001", m.checksum]]),
    });
    h.live.set("fx__a", [created]);
    m.name = "002";
    await expect(
      runPluginMigrations(
        [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
        h.deps
      )
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    expect(h.started).toEqual([]);
    expect(h.owners).toEqual([]);
  });

  it("applies a module whose checksum covers its SQL and snapshots", async () => {
    // The control for the refusals above: the same shape, correctly sealed,
    // runs its SQL.
    const m = module({
      name: "001",
      schemaVersion: 1,
      before: [],
      target: [created],
      up: ["CREATE TABLE fx__a (id varchar(36))"],
    });
    const h = deps();
    const result = await runPluginMigrations(
      [{ pluginName: "a", pluginVersion: "1.0.0", migrations: [m] }],
      h.deps
    );
    expect(result).toEqual({ applied: 1, adopted: 0, skipped: 0 });
    expect(h.executed.join("\n")).toContain("CREATE TABLE fx__a");
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

describe("contributed tables are judged on the plugin's own elements", () => {
  // A module generated before contributions were recorded: which elements are
  // the plugin's is replayed from its own sides — `extra` is on `contributed`
  // and not on `contributedBefore` — through the same function the generator
  // reads them with.
  const host = (extra: ColumnSpec[]): TableSpec => ({
    name: "host__items",
    columns: [
      { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
      ...extra,
    ],
    indexes: [],
  });
  const extra: ColumnSpec = { name: "extra", type: "text", nullable: true };
  const note: ColumnSpec = { name: "note", type: "text", nullable: true };

  function recordless(): PluginMigration {
    const up = ["ALTER TABLE host__items ADD COLUMN extra text"];
    const dialects = {
      postgresql: { up, down: [] },
      mysql: { up, down: [] },
      sqlite: { up, down: [] },
    };
    const none = { tables: [] };
    const side = (table: TableSpec) => ({
      postgresql: { tables: [table] },
      mysql: { tables: [table] },
      sqlite: { tables: [table] },
    });
    const content = {
      name: "001",
      schemaVersion: 1,
      dialects,
      snapshot: { postgresql: none, mysql: none, sqlite: none },
      before: { postgresql: none, mysql: none, sqlite: none },
      contributedBefore: side(host([])),
      contributed: side(host([extra])),
    };
    return { ...content, checksum: migrationChecksum(content) };
  }

  it("applies over a dependency that changed the table since", async () => {
    // Live has the owner's later `note` and not yet `extra`: neither frozen
    // copy, but exactly the plugin's before-state on its own element.
    const h = deps();
    h.live.set("host__items", [host([note])]);
    const result = await runPluginMigrations(
      [{ pluginName: "c", pluginVersion: "1.0.0", migrations: [recordless()] }],
      h.deps
    );
    expect(result).toEqual({ applied: 1, adopted: 0, skipped: 0 });
    expect(h.executed.join("\n")).toContain("ADD COLUMN extra");
  });

  it("adopts when the element is already live beside the owner's change", async () => {
    const h = deps();
    h.live.set("host__items", [host([note, extra])]);
    const result = await runPluginMigrations(
      [{ pluginName: "c", pluginVersion: "1.0.0", migrations: [recordless()] }],
      h.deps
    );
    expect(result).toEqual({ applied: 0, adopted: 1, skipped: 0 });
    expect(h.executed).toEqual([]);
    // The contributed table stays out of the plugin's owned tables.
    expect(h.owners[0]).toMatchObject({ tables: [] });
  });

  it("refuses the plugin's own element in a shape neither side declares", async () => {
    const h = deps();
    h.live.set("host__items", [
      host([note, { name: "extra", type: "integer", nullable: true }]),
    ]);
    await expect(
      runPluginMigrations(
        [
          {
            pluginName: "c",
            pluginVersion: "1.0.0",
            migrations: [recordless()],
          },
        ],
        h.deps
      )
    ).rejects.toThrow(/does not match|drift/i);
    expect(h.executed).toEqual([]);
  });
});
