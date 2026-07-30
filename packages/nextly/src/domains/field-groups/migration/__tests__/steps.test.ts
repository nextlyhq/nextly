import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";

import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import { buildMigrationManifest, invertManifest } from "../manifest";
import type { ManifestEntry, RegistryRow } from "../manifest";
import type { MigrationSession } from "../session";
import {
  buildMigrationSteps,
  registryNameAt,
  type ObservedColumn,
  type StorageObserver,
} from "../steps";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return { slug: "hero", tableName: "comp_hero", hasCompanion: false, ...over };
}

/**
 * A database stand-in that applies what the steps issue.
 *
 * It parses the statements rather than merely recording them, so a step that
 * emits SQL the real database would reject cannot pass here either: a rename of
 * a table that is absent throws, exactly as a server would. A double looser than
 * the thing it replaces certifies a path that does not exist.
 */
function createWorld(initial: {
  tables: string[];
  columns?: Record<string, ObservedColumn[]>;
  pointers?: Record<string, string[]>;
  indexes?: Record<string, string[]>;
}) {
  const tables = new Set(initial.tables);
  const columns = new Map<string, ObservedColumn[]>(
    Object.entries(initial.columns ?? {})
  );
  const pointers = new Map<string, string[]>(
    Object.entries(initial.pointers ?? {})
  );
  const indexes = new Map<string, string[]>(
    Object.entries(initial.indexes ?? {})
  );
  const statements: string[] = [];
  let transactions = 0;

  function apply(raw: string, params: unknown[] = []): void {
    statements.push(raw);
    // Line breaks and indentation in a statement are nothing to a driver, so
    // this world does not treat them as meaningful either. Everything that IS
    // meaningful stays strict below: the quoting, and `$1`/`$2` binding.
    const sql = raw.replace(/\s+/g, " ").trim();
    const rename = /^ALTER TABLE "(.+?)" RENAME TO "(.+?)"$/.exec(sql);
    if (rename?.[1] !== undefined && rename[2] !== undefined) {
      if (!tables.has(rename[1])) {
        throw new Error(`relation "${rename[1]}" does not exist`);
      }
      tables.delete(rename[1]);
      tables.add(rename[2]);
      const cols = columns.get(rename[1]);
      if (cols !== undefined) {
        columns.delete(rename[1]);
        columns.set(rename[2], cols);
      }
      // Indexes follow the table on every supported dialect.
      const idx = indexes.get(rename[1]);
      if (idx !== undefined) {
        indexes.delete(rename[1]);
        indexes.set(rename[2], idx);
      }
      return;
    }
    const renameColumn =
      /^ALTER TABLE "(.+?)" RENAME COLUMN "(.+?)" TO "(.+?)"$/.exec(sql);
    if (
      renameColumn?.[1] !== undefined &&
      renameColumn[2] !== undefined &&
      renameColumn[3] !== undefined
    ) {
      const cols = columns.get(renameColumn[1]);
      const target = cols?.find(c => c.name === renameColumn[2]);
      if (target === undefined) {
        throw new Error(`column "${renameColumn[2]}" does not exist`);
      }
      target.name = renameColumn[3];
      return;
    }
    // `$1`/`$2`, because this world stands in for node-postgres and that is what
    // it binds. Accepting `?` here is what let a Postgres-breaking statement pass.
    const update =
      /^UPDATE "(.+?)" SET "table_name" = \$1 WHERE "table_name" = \$2$/.exec(
        sql
      );
    if (update?.[1] !== undefined) {
      if (!tables.has(update[1])) {
        throw new Error(`relation "${update[1]}" does not exist`);
      }
      const [to, from] = params as [string, string];
      const current = pointers.get(update[1]) ?? [];
      pointers.set(
        update[1],
        current.map(value => (value === from ? to : value))
      );
      return;
    }
    throw new Error(`unrecognised statement: ${sql}`);
  }

  const session = {
    dialect: "postgresql",
    async inTransaction<T>(work: (ctx: never) => Promise<T>): Promise<T> {
      transactions += 1;
      // Errors propagate exactly as a real transaction's would; swallowing them
      // would let a step that failed look like one that succeeded.
      return work({
        async execute(sql: string, params?: unknown[]) {
          apply(sql, params);
          return [];
        },
        // Compiled through a real Drizzle dialect, which is what the adapters
        // hand their driver. A double that inspected the template object
        // instead would accept identifiers this dialect refuses to quote and
        // parameters it never extracts, and certify a statement no driver
        // could run.
        async runStatement(statement: SQL) {
          const compiled = new PgDialect().sqlToQuery(statement);
          apply(compiled.sql, compiled.params);
        },
      } as never);
    },
  } as unknown as MigrationSession;

  const observer: StorageObserver = {
    tables: async () => [...tables],
    columns: async (_s, table) => columns.get(table),
    pointers: async (_s, registryTable) => [
      ...(pointers.get(registryTable) ?? []),
    ],
    indexNames: async table => indexes.get(table),
  };

  return {
    session,
    observer,
    statements,
    transactionCount: () => transactions,
    tableNames: () => [...tables],
    pointersOf: (registry: string) => [...(pointers.get(registry) ?? [])],
    columnsOf: (table: string) => (columns.get(table) ?? []).map(c => c.name),
    dropIndexes: (table: string) => indexes.set(table, []),
  };
}

const LEGACY_REGISTRY = "dynamic_components";
const TARGET_REGISTRY = "dynamic_field_groups";
const TYPE_COLUMN: ObservedColumn[] = [
  { name: "_component_type", type: "text" },
];

describe("registryNameAt", () => {
  const up = buildMigrationManifest([row()]).entries;

  // Going up the registry renames last, so every pointer update precedes it and
  // addresses the legacy name.
  it("uses the legacy name for every step of an up plan", () => {
    for (let position = 1; position <= up.length; position += 1) {
      expect(registryNameAt(up, position)).toBe(LEGACY_REGISTRY);
    }
  });

  // A rollback reverses the order, so the registry moves first and every later
  // step addresses the name the rollback restored. Hardcoding either constant,
  // or deriving it from direction alone, is wrong for one of these.
  it("switches after the registry's own rename in a down plan", () => {
    const down = invertManifest(up).entries;
    expect(down[0]?.kind).toBe("registry");
    expect(registryNameAt(down, 1)).toBe(TARGET_REGISTRY);
    expect(registryNameAt(down, 2)).toBe(LEGACY_REGISTRY);
    expect(registryNameAt(down, down.length)).toBe(LEGACY_REGISTRY);
  });

  it("refuses a plan with no registry rename", () => {
    expect(() => registryNameAt([], 1)).toThrowError();
  });
});

describe("rename steps", () => {
  function world() {
    return createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
  }

  function stepsFor(
    w: ReturnType<typeof createWorld>,
    entries: ManifestEntry[]
  ) {
    return buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
  }

  const entries = buildMigrationManifest([row()]).entries;

  // The pairing is the point: apart, there is a window where the row addresses a
  // table that no longer exists.
  it("renames a table and moves its pointer in one transaction", async () => {
    const w = world();
    const [tableStep] = stepsFor(w, entries);
    await tableStep?.run(w.session);

    expect(w.tableNames()).toContain("fg_hero");
    expect(w.pointersOf(LEGACY_REGISTRY)).toEqual(["fg_hero"]);
    expect(w.transactionCount()).toBe(1);
    await expect(tableStep?.verify(w.session)).resolves.toBe(true);
  });

  // The state the pairing exists to prevent, and the reason `verify` checks the
  // pointer as well as the catalog.
  it("fails verification when the rename landed but the pointer did not", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
    const [tableStep] = stepsFor(w, entries);
    await expect(tableStep?.verify(w.session)).resolves.toBe(false);
  });

  // MySQL commits DDL implicitly, so a step can be resumed with the rename
  // already applied. Re-issuing it would fail on a source that is gone.
  it("re-runs safely when the rename already committed", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
    const [tableStep] = stepsFor(w, entries);
    await expect(tableStep?.run(w.session)).resolves.toBeUndefined();
    // The half that did not land is applied, and no rename is re-issued.
    expect(w.pointersOf(LEGACY_REGISTRY)).toEqual(["fg_hero"]);
    expect(w.statements.filter(s => s.includes("RENAME TO"))).toHaveLength(0);
    await expect(tableStep?.verify(w.session)).resolves.toBe(true);
  });

  // A companion's name derives from its owner's `table_name`, so the owner's
  // update already moves it; writing a pointer for it would target no row.
  // A companion has no step of its own to occupy a position: it moves on its
  // owner's entry. A second position is what left the resume crash window unable
  // to explain the companion, and what let inversion separate the two.
  it("gives a companion no step of its own", async () => {
    const withCompanion = [row({ hasCompanion: true })];
    const built = buildMigrationManifest(withCompanion).entries;

    // One table entry, one column entry, one registry entry — the companion adds
    // no fourth.
    expect(built.map(e => e.kind)).toEqual(["table", "column", "registry"]);
    expect(built[0]?.companion).toEqual({
      from: "comp_hero_locales",
      to: "fg_hero_locales",
    });
  });

  // No registry row addresses the registry itself.
  it("does not touch the pointer for the registry", async () => {
    const w = world();
    const steps = stepsFor(w, entries);
    const registryIndex = entries.findIndex(e => e.kind === "registry");
    await steps[registryIndex]?.run(w.session);

    expect(w.tableNames()).toContain(TARGET_REGISTRY);
    expect(w.statements.filter(s => s.startsWith("UPDATE"))).toHaveLength(0);
  });

  // Reconciliation marks work already reflected in the database. Re-issuing it
  // would fail, and the postcondition is what is worth confirming.
  it("verifies a satisfied entry without re-running it", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["fg_hero"] },
    });
    const satisfied = entries.map(e =>
      e.kind === "table" ? { ...e, satisfied: true } : e
    );
    const [tableStep] = stepsFor(w, satisfied);
    await tableStep?.run(w.session);
    // The DDL is skipped, but the pointer repair is not: reconciliation can mark
    // a rename satisfied while its pointer update never landed, and skipping
    // both would fail verification on every resume, forever.
    expect(w.statements.filter(s => s.includes("RENAME TO"))).toHaveLength(0);
    expect(w.statements.filter(s => s.startsWith("UPDATE"))).toHaveLength(1);
    await expect(tableStep?.verify(w.session)).resolves.toBe(true);
  });
});

describe("column steps", () => {
  const entries = buildMigrationManifest([row()]).entries;

  it("renames the discriminator on the table the entry names", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["fg_hero"] },
    });
    const steps = buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
    const columnIndex = entries.findIndex(e => e.kind === "column");
    await steps[columnIndex]?.run(w.session);

    expect(w.columnsOf("fg_hero")).toEqual(["_field_group_type"]);
    await expect(steps[columnIndex]?.verify(w.session)).resolves.toBe(true);
  });

  // Renaming a column on a table that is not there cannot be a silent no-op:
  // the discriminator is required on every field-group table.
  it("refuses when the column's table is absent", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY],
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
    const steps = buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
    const columnIndex = entries.findIndex(e => e.kind === "column");
    await expect(steps[columnIndex]?.run(w.session)).rejects.toThrowError();
  });

  it("re-runs safely when the column rename already committed", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [{ name: "_field_group_type", type: "text" }] },
      pointers: { [LEGACY_REGISTRY]: ["fg_hero"] },
    });
    const steps = buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
    const columnIndex = entries.findIndex(e => e.kind === "column");
    await expect(steps[columnIndex]?.run(w.session)).resolves.toBeUndefined();
    expect(w.statements).toHaveLength(0);
    await expect(steps[columnIndex]?.verify(w.session)).resolves.toBe(true);
  });
});

describe("index survival across a rename", () => {
  const entries = buildMigrationManifest([row()]).entries;

  function stepFor(w: ReturnType<typeof createWorld>) {
    return buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    })[0];
  }

  it("accepts a rename that carried the table's indexes", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
      indexes: { comp_hero: ["idx_hero_slug"] },
    });
    const step = stepFor(w);
    await step?.run(w.session);
    await expect(step?.verify(w.session)).resolves.toBe(true);
  });

  // A lost index is not "not yet done" — a retry cannot bring it back — so this
  // refuses rather than returning false and letting the runner retry forever.
  it("refuses a rename that dropped an index", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
      indexes: { comp_hero: ["idx_hero_slug"] },
    });
    const step = stepFor(w);
    await step?.run(w.session);
    // The rename landed but the index did not come with it.
    w.dropIndexes("fg_hero");

    const error = await step?.verify(w.session).catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.lost).toEqual(["idx_hero_slug"]);
      expect(error.logContext?.table).toBe("fg_hero");
    }
  });

  // On a resumed step the source is already gone, so there is no before-state.
  // Reported as not comparable rather than as nothing lost.
  it("does not claim index survival when the source was already renamed", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "fg_hero"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
      indexes: { fg_hero: [] },
    });
    const step = stepFor(w);
    await step?.run(w.session);
    await expect(step?.verify(w.session)).resolves.toBe(true);
  });
});

describe("a companion moves with its owner", () => {
  const rows = [row({ hasCompanion: true })];
  const entries = buildMigrationManifest(rows).entries;

  function world() {
    return createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "comp_hero_locales"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
  }

  // The registry derives the companion's name from the owner's `table_name`, so
  // the moment the pointer moves it starts deriving `fg_hero_locales`. If the
  // companion were renamed by a later independently recorded step, a crash or a
  // concurrent reader in that window would see localized storage missing.
  it("renames the companion in the same step that moves the pointer", async () => {
    const w = world();
    const [tableStep] = buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
    await tableStep?.run(w.session);

    expect(w.tableNames()).toContain("fg_hero");
    expect(w.tableNames()).toContain("fg_hero_locales");
    expect(w.pointersOf(LEGACY_REGISTRY)).toEqual(["fg_hero"]);
    // One transaction, so no window exists between the two renames and the
    // pointer at all.
    expect(w.transactionCount()).toBe(1);
  });

  // The companion still has its own entry and position, so the plan's shape and
  // hash are unchanged. Its step finds the source already gone and does nothing.
  // MySQL commits each RENAME on its own, so a crash between the base and the
  // companion is reachable. The resume must finish the companion rather than
  // treat the entry as done because reconciliation marked it satisfied — which
  // is why the step decides per table from the catalog, not per entry.
  it("finishes a companion whose rename did not land with its owner's", async () => {
    const w = createWorld({
      // The torn state: base already moved, companion still under its old name.
      tables: [LEGACY_REGISTRY, "fg_hero", "comp_hero_locales"],
      columns: { fg_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["fg_hero"] },
    });
    const satisfied: ManifestEntry[] = entries.map((entry, index) =>
      index === 0 ? { ...entry, satisfied: true } : entry
    );
    const steps = buildMigrationSteps({
      entries: satisfied,
      identifierCase: PRESERVING,
      observer: w.observer,
    });

    await steps[0]?.run(w.session);

    expect(w.tableNames()).toContain("fg_hero_locales");
    expect(w.tableNames()).not.toContain("comp_hero_locales");
    await expect(steps[0]?.verify(w.session)).resolves.toBe(true);
  });

  // A companion's indexes are as lost as a table's if a rename drops them, and
  // the companion is the half with no entry of its own to check for it.
  it("refuses when a rename dropped a companion's index", async () => {
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "comp_hero_locales"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
      indexes: { comp_hero: ["hero_slug_ix"], comp_hero_locales: ["loc_ix"] },
    });
    const steps = buildMigrationSteps({
      entries,
      identifierCase: PRESERVING,
      observer: w.observer,
    });
    await steps[0]?.run(w.session);
    w.dropIndexes("fg_hero_locales");

    const error = await steps[0]?.verify(w.session).catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.table).toBe("fg_hero_locales");
      expect(error.logContext?.lost).toEqual(["loc_ix"]);
    }
  });
});

describe("observation never happens inside a step transaction", () => {
  const entries = buildMigrationManifest([row()]).entries;

  // The observer reads through the adapter, which checks out its own
  // connection. Asking it from inside a transaction waits for a second checkout
  // and hangs a pool sized to one, so every step must gather what it needs
  // first. This asserts it for both step kinds, because the table path was fixed
  // while the column path was left behind once already.
  it.each([
    ["table", 0],
    // 0 = the table rename, 1 = the discriminator column, 2 = the registry.
    ["column", 1],
  ])(
    "gathers observations before opening the transaction (%s)",
    async (_k, i) => {
      // Both names present, so each step finds the table its entry addresses:
      // the table entry names `comp_hero`, the column entry `fg_hero`.
      const w = createWorld({
        tables: [LEGACY_REGISTRY, "comp_hero", "fg_hero"],
        columns: { comp_hero: [...TYPE_COLUMN], fg_hero: [...TYPE_COLUMN] },
        pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
      });
      let inTransaction = false;
      let observedInside = false;
      const guarded = {
        ...w.observer,
        tables: async (...a: Parameters<typeof w.observer.tables>) => {
          if (inTransaction) observedInside = true;
          return w.observer.tables(...a);
        },
        columns: async (...a: Parameters<typeof w.observer.columns>) => {
          if (inTransaction) observedInside = true;
          return w.observer.columns(...a);
        },
        indexNames: async (...a: Parameters<typeof w.observer.indexNames>) => {
          if (inTransaction) observedInside = true;
          return w.observer.indexNames(...a);
        },
      };
      const session = {
        dialect: "postgresql",
        inTransaction: async (work: (ctx: unknown) => Promise<unknown>) => {
          inTransaction = true;
          try {
            return await w.session.inTransaction(work as never);
          } finally {
            inTransaction = false;
          }
        },
      } as unknown as typeof w.session;

      const steps = buildMigrationSteps({
        entries,
        identifierCase: PRESERVING,
        observer: guarded,
      });
      await steps[i]?.run(session);
      expect(observedInside).toBe(false);
    }
  );
});
