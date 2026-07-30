import { describe, expect, it } from "vitest";

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
}) {
  const tables = new Set(initial.tables);
  const columns = new Map<string, ObservedColumn[]>(
    Object.entries(initial.columns ?? {})
  );
  const pointers = new Map<string, string[]>(
    Object.entries(initial.pointers ?? {})
  );
  const statements: string[] = [];
  let transactions = 0;

  function apply(sql: string, params: unknown[] = []): void {
    statements.push(sql);
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
    const update = /^UPDATE "(.+?)" SET "table_name" = \? WHERE/.exec(sql);
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
      } as never);
    },
  } as unknown as MigrationSession;

  const observer: StorageObserver = {
    tables: async () => [...tables],
    columns: async (_s, table) => columns.get(table),
    pointers: async (_s, registryTable) => [
      ...(pointers.get(registryTable) ?? []),
    ],
  };

  return {
    session,
    observer,
    statements,
    transactionCount: () => transactions,
    tableNames: () => [...tables],
    pointersOf: (registry: string) => [...(pointers.get(registry) ?? [])],
    columnsOf: (table: string) => (columns.get(table) ?? []).map(c => c.name),
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
  it("does not touch the pointer for a companion", async () => {
    const withCompanion = [row({ hasCompanion: true })];
    const w = createWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "comp_hero_locales"],
      columns: { comp_hero: [...TYPE_COLUMN] },
      pointers: { [LEGACY_REGISTRY]: ["comp_hero"] },
    });
    const built = buildMigrationManifest(withCompanion).entries;
    const steps = stepsFor(w, built);
    const companionIndex = built.findIndex(e => e.kind === "companion");
    await steps[companionIndex]?.run(w.session);

    expect(w.tableNames()).toContain("fg_hero_locales");
    expect(w.statements.filter(s => s.startsWith("UPDATE"))).toHaveLength(0);
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
    expect(w.statements).toHaveLength(0);
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
