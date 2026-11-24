/**
 * How a running server tells field-group storage the migration moved under it from any other
 * failure, and what it does then.
 *
 * What separates a correct answer from a plausibly broken one:
 * - a move is storage the database holds under the migration's other name. A table or column no
 *   migration has made yet is missing in the same words, and its failure stays the failure it was:
 *   refused as moving, every retry would be refused again;
 * - of columns, only the discriminator moves: a project's own missing column never counts;
 * - the tables followed include the one the database named, not only those the caller thought of;
 * - on a transaction everything is asked on its own connection, and followed after it rolls back;
 * - PostgreSQL pays for a savepoint only while this process may still meet a move, which the
 *   registry's name alone does not say: the tables it registered before may be the old ones;
 * - a registry lookup that failed as a move runs once more, and never a third time.
 *
 * @module domains/field-groups/migration/__tests__/moved-storage.test
 */
import { tableNotRegisteredError } from "@nextlyhq/adapter-drizzle/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { introspectLiveColumns } from "../../../schema/pipeline/diff/introspect-live";
import { forgetFieldGroupStorageNames } from "../../storage/resolve-storage-names";
import { registerComponentRuntimeSchema } from "../../services/field-group-table-provisioning";
import {
  followingMovedRegistry,
  isMovedStorageError,
  raiseIfMoved,
  refusalAfterFollowing,
  refusingMovedStorage,
  storageMovingRefusal,
} from "../moved-storage";

// What a follow registers, and what the catalog holds, stand in for a database.
vi.mock("../../services/field-group-table-provisioning", () => ({
  registerComponentRuntimeSchema: vi.fn(() => ({ registered: true })),
}));
vi.mock("../../../schema/pipeline/diff/introspect-live", async original => ({
  ...(await original<
    typeof import("../../../schema/pipeline/diff/introspect-live")
  >()),
  introspectLiveColumns: vi.fn(),
}));

/** The tables the database holds, with their columns. */
let held: Record<string, string[]> = {};
/** The connections the catalog was read on. */
let readOn: unknown[] = [];

/** The field groups' tables this process registered, each with its discriminator. */
let registered: Record<string, string> = {};
/** What the pool's connections see, MySQL's table-name case setting among it. */
const POOL = {
  execute: async () => [[{ value: 0, lower_case_table_names: 0 }]],
};
const MOVING = {
  publicData: { errors: [{ code: "FIELD_GROUP_STORAGE_MOVING" }] },
};

beforeEach(() => {
  held = {};
  readOn = [];
  registered = { comp_hero: "_component_type", comp_cta: "_component_type" };
  forgetFieldGroupStorageNames();
  vi.mocked(registerComponentRuntimeSchema).mockClear();
  vi.mocked(introspectLiveColumns).mockImplementation(
    async (db, _dialect, names) => {
      readOn.push(db);
      return {
        tables: names
          .filter(name => held[name] !== undefined)
          .map(name => ({
            name,
            columns: held[name]!.map(column => ({ name: column })),
          })),
      } as never;
    }
  );
});

type Dialect = "sqlite" | "mysql" | "postgresql";
/** An adapter whose rollback effects run when `rolledBack` says the transaction ended. */
const adapterOf = (dialect: Dialect) => {
  const effects: (() => unknown)[] = [];
  return Object.assign(
    {
      dialect,
      getDrizzle: () => POOL,
      getCapabilities: () => ({ dialect }),
      tableExists: async (name: string) => held[name] !== undefined,
      listTables: async () => Object.keys(held),
      afterRollback: async (effect: () => unknown) => {
        effects.push(effect);
      },
      tableResolver: {
        getDynamicTableNames: () => Object.keys(registered),
        getTable: (name: string) => ({
          _component_type: { name: registered[name] },
        }),
      },
    },
    {
      rolledBack: async () => {
        for (const effect of effects) await effect();
      },
    }
  );
};
type Adapter = ReturnType<typeof adapterOf>;

/** A transaction that records the savepoints taken on it. */
const txOf = () => {
  const said: string[] = [];
  const handle = { select: () => undefined };
  return {
    said,
    handle,
    tx: {
      getDrizzle: () => handle,
      savepoint: async () => void said.push("savepoint"),
      rollbackToSavepoint: async () => void said.push("rollback"),
      releaseSavepoint: async () => void said.push("release"),
    } as never,
  };
};
const TX = { select: () => undefined };
const rowsOf = (...slugs: string[]) => ({
  getAllComponents: async () =>
    slugs.map(slug => ({
      slug,
      tableName: held[`fg_${slug}`] ? `fg_${slug}` : `comp_${slug}`,
      fields: [],
    })) as never,
});

/** Each dialect's driver saying a table is missing, and a column, on a read and on a write. */
const missingTable: Record<Dialect, (table: string) => Error> = {
  sqlite: table => new Error(`no such table: ${table}`),
  mysql: table =>
    Object.assign(new Error(`Table 'site.${table}' doesn't exist`), {
      code: "ER_NO_SUCH_TABLE",
    }),
  postgresql: table =>
    Object.assign(new Error(`relation "${table}" does not exist`), {
      code: "42P01",
    }),
};
const missingColumn: Record<Dialect, (table: string, c: string) => Error> = {
  sqlite: (table, c) => new Error(`table ${table} has no column named ${c}`),
  mysql: (_table, c) =>
    Object.assign(new Error(`Unknown column '${c}' in 'field list'`), {
      code: "ER_BAD_FIELD_ERROR",
    }),
  postgresql: (table, c) =>
    Object.assign(
      new Error(`column "${c}" of relation "${table}" does not exist`),
      { code: "42703" }
    ),
};

/** A failed write on a transaction, as its owner meets it. */
const failing = (adapter: Adapter, error: unknown, tx = txOf()) =>
  refusingMovedStorage({
    adapter: adapter as never,
    rows: rowsOf("hero", "cta"),
    tx: tx.tx,
    work: () => Promise.reject(error),
  }).then(
    () => undefined,
    (raised: unknown) => raised
  );

describe.each(["sqlite", "mysql", "postgresql"] as const)(
  "a failed save (%s)",
  dialect => {
    /** What a save is raised with on a transaction, and what off one; undefined is its own error. */
    const refusals = async (error: unknown) => {
      const adapter = adapterOf(dialect);
      const raised = await failing(adapter, error);
      return [
        raised === error ? undefined : raised,
        await refusalAfterFollowing({
          adapter: adapter as never,
          rows: rowsOf("hero", "cta"),
          error,
        }),
      ];
    };
    const expectMoving = (found: unknown[]) => {
      expect(found).toHaveLength(2);
      for (const refusal of found) expect(refusal).toMatchObject(MOVING);
    };
    const OWN_ERROR = [undefined, undefined];

    it("is refused to be retried when its table moved", async () => {
      held = { fg_hero: ["id", "_field_group_type"] };
      expectMoving(
        await refusals(
          NextlyError.internal({ cause: missingTable[dialect]("comp_hero") })
        )
      );
    });

    it("is refused to be retried when its table was rolled back", async () => {
      held = { comp_hero: ["id", "_component_type"] };
      registered = { fg_hero: "_component_type" };
      expectMoving(await refusals(missingTable[dialect]("fg_hero")));
    });

    it("keeps its own error when no migration has made the table yet", async () => {
      // Another group is there, under the current names: it says nothing about this one.
      held = { fg_cta: ["id", "_field_group_type"] };
      expect(await refusals(missingTable[dialect]("comp_hero"))).toEqual(
        OWN_ERROR
      );
    });

    it("is refused to be retried when its discriminator column moved", async () => {
      held = { comp_hero: ["id", "_field_group_type"] };
      expectMoving(
        await refusals(missingColumn[dialect]("comp_hero", "_component_type"))
      );
    });

    it("keeps its own error when no migration has made the project's column yet", async () => {
      // The table is there, and has moved: the column that is missing is the project's.
      held = { fg_hero: ["id", "_field_group_type"] };
      expect(
        await refusals(missingColumn[dialect]("fg_hero", "subtitle"))
      ).toEqual(OWN_ERROR);
    });

    it("keeps its own error when the discriminator is missing under both names", async () => {
      held = { comp_hero: ["id"] };
      expect(
        await refusals(missingColumn[dialect]("comp_hero", "_component_type"))
      ).toEqual(OWN_ERROR);
    });

    it("is refused to be retried when its registry row names the moved table before it is registered", async () => {
      held = { fg_hero: ["id", "_field_group_type"] };
      expectMoving(await refusals(tableNotRegisteredError("fg_hero")));
    });

    it("keeps the unregistered refusal of a table made since the process started", async () => {
      held = { fg_new: ["id", "_field_group_type"] };
      expect(await refusals(tableNotRegisteredError("fg_new"))).toEqual(
        OWN_ERROR
      );
    });

    it("keeps the unregistered refusal of a table the database does not hold", async () => {
      expect(await refusals(tableNotRegisteredError("fg_hero"))).toEqual(
        OWN_ERROR
      );
    });

    it("keeps its own error when the catalog cannot be read", async () => {
      vi.mocked(introspectLiveColumns).mockRejectedValue(new Error("denied"));
      expect(await refusals(missingTable[dialect]("comp_hero"))).toEqual(
        OWN_ERROR
      );
    });

    it("asks on the transaction's own connection, and follows every table once it has rolled back", async () => {
      held = {
        fg_cta: ["id", "_field_group_type"],
        fg_hero: ["id", "_field_group_type"],
      };
      const adapter = adapterOf(dialect);
      const tx = txOf();
      await failing(adapter, missingTable[dialect]("comp_hero"), tx);

      expect(readOn).toEqual([tx.handle]);
      expect(registerComponentRuntimeSchema).not.toHaveBeenCalled();

      await adapter.rolledBack();
      expect(
        vi
          .mocked(registerComponentRuntimeSchema)
          .mock.calls.map(call => call[2])
      ).toEqual(expect.arrayContaining(["fg_cta", "fg_hero"]));
    });
  }
);

describe("the savepoint a write takes", () => {
  const said = async (dialect: Dialect, error?: unknown) => {
    const tx = txOf();
    await refusingMovedStorage({
      adapter: adapterOf(dialect) as never,
      rows: rowsOf("hero"),
      tx: tx.tx,
      work: () =>
        error === undefined ? Promise.resolve() : Promise.reject(error),
    }).catch(() => undefined);
    return tx.said;
  };

  it("is taken on PostgreSQL while the site is on the legacy names, and released", async () => {
    held = { dynamic_components: ["id"] };
    expect(await said("postgresql")).toEqual(["savepoint", "release"]);
    expect(
      await said("postgresql", missingTable.postgresql("comp_hero"))
    ).toEqual(["savepoint", "rollback", "release"]);
  });

  it("is not taken on SQLite or MySQL, whose transactions a failed statement leaves usable", async () => {
    held = { dynamic_components: ["id"] };
    expect(await said("sqlite")).toEqual([]);
    expect(await said("mysql")).toEqual([]);
  });

  it("is not taken once the registry and every registered table are on the current names", async () => {
    held = { dynamic_field_groups: ["id"] };
    registered = {
      fg_hero: "_field_group_type",
      legal_blocks: "_field_group_type",
    };
    expect(await said("postgresql")).toEqual([]);
  });

  it("a settled process meeting a rollback keeps its error, and follows the names once it has ended", async () => {
    held = {
      dynamic_field_groups: ["id"],
      comp_hero: ["id", "_component_type"],
    };
    registered = { fg_hero: "_field_group_type" };
    const adapter = adapterOf("postgresql");
    const error = missingTable.postgresql("fg_hero");
    expect(await failing(adapter, error)).toBe(error);
    expect(registerComponentRuntimeSchema).not.toHaveBeenCalled();
    await adapter.rolledBack();
    expect(
      vi.mocked(registerComponentRuntimeSchema).mock.calls.map(call => call[2])
    ).toContain("comp_hero");
  });

  it("is taken while a table registered before the registry was renamed is still the old one", async () => {
    // The registry is renamed last and resolved again by a lookup; a group with a table name of
    // its own keeps that name, and only its discriminator says it was registered before.
    held = { dynamic_field_groups: ["id"] };
    registered = {
      fg_hero: "_field_group_type",
      legal_blocks: "_component_type",
    };
    expect(await said("postgresql")).toContain("savepoint");
  });

  it("is taken again as soon as a table is registered under the old names, with nothing told", async () => {
    held = { dynamic_field_groups: ["id"] };
    registered = { fg_hero: "_field_group_type" };
    expect(await said("postgresql")).toEqual([]);
    // A development reload, a schema-version change or a follow registers one.
    registered = { ...registered, fg_hero: "_component_type" };
    expect(await said("postgresql")).toContain("savepoint");
  });

  it("is taken when the registry cannot be resolved", async () => {
    registered = { fg_hero: "_field_group_type" };
    const tx = txOf();
    await refusingMovedStorage({
      adapter: {
        ...adapterOf("postgresql"),
        listTables: () => Promise.reject(new Error("denied")),
      } as never,
      rows: rowsOf("hero"),
      tx: tx.tx,
      work: () => Promise.resolve(),
    });
    expect(tx.said).toContain("savepoint");
  });
});

describe("raiseIfMoved", () => {
  const raise = (dialect: Dialect, executor?: unknown) =>
    raiseIfMoved({
      adapter: adapterOf(dialect) as never,
      error: missingTable[dialect]("comp_hero"),
      ...(executor === undefined ? {} : { executor }),
    });

  it("raises a moved table, on a transaction and off one", async () => {
    held = { fg_hero: ["id"] };
    for (const dialect of ["sqlite", "mysql", "postgresql"] as const) {
      await expect(raise(dialect, TX)).rejects.toThrow(/comp_hero/);
      await expect(raise(dialect)).rejects.toThrow(/comp_hero/);
    }
  });

  it("leaves a table no migration has made to its caller, where the transaction can go on", async () => {
    for (const dialect of ["sqlite", "mysql"] as const) {
      await expect(raise(dialect, TX)).resolves.toBeUndefined();
    }
    for (const dialect of ["sqlite", "mysql", "postgresql"] as const) {
      await expect(raise(dialect)).resolves.toBeUndefined();
    }
  });
});

describe("isMovedStorageError", () => {
  it("counts a name this process has not registered, as a read meets after a move", () => {
    expect(isMovedStorageError(tableNotRegisteredError("fg_hero"))).toBe(true);
    expect(isMovedStorageError(new Error("connection reset"))).toBe(false);
  });

  it("never reads a decided refusal as a move, whatever its message names", () => {
    expect(
      isMovedStorageError(
        NextlyError.validation({
          errors: [
            {
              path: "",
              code: "UNREGISTERED",
              message: "relation comp_hero does not exist in this process.",
            },
          ],
        })
      )
    ).toBe(false);
  });
});

describe("followingMovedRegistry", () => {
  const MISSING = new Error("no such table: dynamic_components");

  it("looks up once more after a lookup failed as a move, and answers what that finds", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValueOnce(NextlyError.internal({ cause: MISSING }))
      .mockResolvedValueOnce({ slug: "hero", tableName: "fg_hero" });
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite") as never
    );

    await expect(registry.getComponent("hero")).resolves.toEqual({
      slug: "hero",
      tableName: "fg_hero",
    });
    expect(getComponent).toHaveBeenCalledTimes(2);
  });

  it("does not look up again after any other failure", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValue(new Error("connection reset"));
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite") as never
    );

    await expect(registry.getComponent("hero")).rejects.toThrow(
      "connection reset"
    );
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("looks up at most twice, so a move that does not resolve cannot loop", async () => {
    const getComponent = vi.fn().mockRejectedValue(MISSING);
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite") as never
    );

    await expect(registry.getComponent("hero")).rejects.toThrow(
      "dynamic_components"
    );
    expect(getComponent).toHaveBeenCalledTimes(2);
  });

  it("on a transaction, raises the failure as it was and looks up no more: the write decides", async () => {
    held = { dynamic_field_groups: ["id"] };
    const getComponent = vi.fn().mockRejectedValue(MISSING);
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite") as never
    );

    await expect(registry.getComponent("hero", TX)).rejects.toBe(MISSING);
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("a write whose registry lookup failed as a move is refused to be retried", async () => {
    held = { dynamic_field_groups: ["id"] };
    expect(await failing(adapterOf("sqlite"), MISSING)).toMatchObject(MOVING);
  });
});

describe("storageMovingRefusal", () => {
  it("carries the code a caller retries on, and keeps the table out of what the caller is told", () => {
    const refusal = storageMovingRefusal("fg_hero");
    expect(refusal).toMatchObject(MOVING);
    expect(JSON.stringify(refusal.publicData)).not.toContain("fg_hero");
    expect(refusal.publicMessage).toMatch(/retry the save/i);
  });
});
