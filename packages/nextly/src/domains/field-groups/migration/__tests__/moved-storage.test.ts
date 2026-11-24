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
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { isCompanionReady } from "../../../i18n/runtime/companion-readiness";
import { introspectLiveColumns } from "../../../schema/pipeline/diff/introspect-live";
import {
  forgetFieldGroupStorageNames,
  resolveRegistryTableName,
} from "../../storage/resolve-storage-names";
import { registerComponentRuntimeSchema } from "../../services/field-group-table-provisioning";
import {
  isMovedStorageError,
  isStorageMovingRefusal,
  lookingUpRegistry,
  notedRegistryName,
  noteRegistryName,
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

vi.mock("../../../i18n/runtime/companion-readiness", async original => ({
  ...(await original<
    typeof import("../../../i18n/runtime/companion-readiness")
  >()),
  isCompanionReady: vi.fn(async () => true),
}));

/** The tables the database holds, with their columns. */
let held: Record<string, string[]> = {};
/** The connections the catalog was read on. */
let readOn: unknown[] = [];

/** The connection of the transaction open in this flow, if one is. */
let inFlow: object | undefined;
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
  inFlow = undefined;
  registered = { comp_hero: "_component_type", comp_cta: "_component_type" };
  forgetFieldGroupStorageNames();
  vi.mocked(registerComponentRuntimeSchema).mockClear();
  vi.mocked(isCompanionReady).mockClear();
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
  const adapter = Object.assign(
    {
      dialect,
      getDrizzle: () => POOL,
      getCapabilities: () => ({ dialect }),
      tableExists: async (name: string) => held[name] !== undefined,
      listTables: async () => Object.keys(held),
      transactionOpenInFlow: () => inFlow !== undefined,
      transactionInFlow: () =>
        inFlow === undefined
          ? undefined
          : {
              transaction: inFlow,
              undone: () => false,
              runsOn: (executor: unknown) => executor === inFlow,
            },
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
  noteRegistryName(
    adapter as never,
    held.dynamic_field_groups ? "dynamic_field_groups" : "dynamic_components"
  );
  return adapter;
};
type Adapter = ReturnType<typeof adapterOf>;

/** A transaction, open in this flow, that records what was run on its connection. */
const txOf = () => {
  const said: string[] = [];
  const handle = {
    execute: async (statement: never) => {
      said.push(new PgDialect().sqlToQuery(statement).sql);
      if (/1 \/ 0/.test(said.at(-1)!)) throw new Error("division by zero");
    },
  };
  inFlow = handle;
  return { said, handle };
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
    executor: tx.handle,
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

describe("the savepoint a transaction takes", () => {
  const SAVEPOINT = /^SAVEPOINT "nextly_moved_storage_\d+"$/;
  const ROLLBACK = /^ROLLBACK TO SAVEPOINT "nextly_moved_storage_\d+"$/;
  const guarded = (
    adapter: Adapter,
    tx: ReturnType<typeof txOf>,
    error?: unknown
  ) =>
    refusingMovedStorage({
      adapter: adapter as never,
      rows: rowsOf("hero"),
      executor: tx.handle,
      work: () =>
        error === undefined ? Promise.resolve() : Promise.reject(error),
    }).catch((raised: unknown) => {
      // The failure it was given, or the refusal of it; anything else is the case's own.
      if (raised !== error && !isStorageMovingRefusal(raised)) throw raised;
    });
  const said = async (dialect: Dialect, error?: unknown) => {
    const tx = txOf();
    await guarded(adapterOf(dialect), tx, error);
    return tx.said;
  };

  it("is taken on PostgreSQL while the site is on the legacy names", async () => {
    held = { dynamic_components: ["id"] };
    expect(await said("postgresql")).toEqual([
      expect.stringMatching(SAVEPOINT),
    ]);
  });

  it("is taken once for a transaction, however many of its steps reach field groups", async () => {
    held = { dynamic_components: ["id"] };
    const adapter = adapterOf("postgresql");
    const tx = txOf();
    await guarded(adapter, tx);
    await guarded(adapter, tx);
    await lookingUpRegistry({
      adapter: adapter as never,
      executor: tx.handle,
      lookup: async () => null,
    });
    expect(tx.said).toHaveLength(1);
  });

  it("is rolled back to and the transaction left aborted, whether or not storage moved", async () => {
    // Rolled back it has lost what came after; a caller that went on would commit the rest.
    const expected = [
      expect.stringMatching(SAVEPOINT),
      expect.stringMatching(ROLLBACK),
      "SELECT 1 / 0",
    ];
    held = { dynamic_components: ["id"] };
    const error = missingTable.postgresql("comp_hero");
    expect(await said("postgresql", error)).toEqual(expected);
    held = { ...held, fg_hero: ["id"] };
    expect(await said("postgresql", error)).toEqual(expected);
  });

  it("is not rolled back to for a failure that names no field-group storage", async () => {
    held = { dynamic_components: ["id"] };
    expect(await said("postgresql", new Error("connection reset"))).toEqual([
      expect.stringMatching(SAVEPOINT),
    ]);
  });

  it("is not taken on SQLite or MySQL, whose transactions a failed statement leaves usable", async () => {
    held = { dynamic_components: ["id"] };
    for (const dialect of ["sqlite", "mysql"] as const) {
      expect(await said(dialect, missingTable[dialect]("comp_hero"))).toEqual(
        []
      );
    }
  });

  it("is not taken once the registry and every registered table are on the current names", async () => {
    held = { dynamic_field_groups: ["id"] };
    registered = {
      fg_hero: "_field_group_type",
      legal_blocks: "_field_group_type",
    };
    expect(await said("postgresql")).toEqual([]);
  });

  it("is taken while a table registered before the registry was renamed is still the old one", async () => {
    // The registry is renamed last and resolved again by a lookup; a group with a table name of
    // its own keeps that name, and only its discriminator says it was registered before.
    held = { dynamic_field_groups: ["id"] };
    registered = {
      fg_hero: "_field_group_type",
      legal_blocks: "_component_type",
    };
    expect(await said("postgresql")).toHaveLength(1);
  });

  it("is taken again as soon as a table is registered under the old names, with nothing told", async () => {
    held = { dynamic_field_groups: ["id"] };
    registered = { fg_hero: "_field_group_type" };
    expect(await said("postgresql")).toEqual([]);
    // A development reload, a schema-version change or a follow registers one.
    registered = { ...registered, fg_hero: "_component_type" };
    expect(await said("postgresql")).toHaveLength(1);
  });

  it("is taken again once the registry was found under its old name, and while it is resolved again", async () => {
    held = { dynamic_field_groups: ["id"] };
    registered = { fg_hero: "_field_group_type" };
    const adapter = adapterOf("postgresql");
    const settled = txOf();
    await guarded(adapter, settled);
    expect(settled.said).toEqual([]);

    noteRegistryName(adapter as never, "dynamic_components");
    const after = txOf();
    await guarded(adapter, after);
    expect(after.said).toHaveLength(1);
  });

  it("is taken by a process that has not found the registry yet, asking nothing to know", async () => {
    registered = { fg_hero: "_field_group_type" };
    const listTables = vi.fn(async () => ["dynamic_field_groups"]);
    const tx = txOf();
    await guarded({ ...adapterOf("postgresql"), listTables }, tx);
    expect(tx.said).toHaveLength(1);
    expect(listTables).not.toHaveBeenCalled();
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
});

describe("what a follow leaves settled", () => {
  it("is the registry's name, resolved off the transaction before the retry needs it", async () => {
    held = {
      dynamic_field_groups: ["id"],
      fg_hero: ["id", "_field_group_type"],
    };
    const listTables = vi.fn(async () => Object.keys(held));
    const adapter = { ...adapterOf("postgresql"), listTables };
    const effects: (() => unknown)[] = [];
    adapter.afterRollback = async effect => {
      effects.push(effect);
    };
    const error = missingTable.postgresql("comp_hero");
    await failing(adapter, error, txOf());

    inFlow = undefined;
    for (const effect of effects) await effect();
    const asked = listTables.mock.calls.length;
    expect(asked).toBeGreaterThan(0);

    // The retry, on a transaction of its own: nothing is left to ask of the catalog there.
    inFlow = {};
    await resolveRegistryTableName(adapter as never);
    expect(listTables).toHaveBeenCalledTimes(asked);
  });

  it("is the moved companion's readiness, for a group whose translations it keeps", async () => {
    held = {
      fg_hero: ["id", "_field_group_type"],
      fg_cta: ["id", "_field_group_type"],
    };
    await refusalAfterFollowing({
      adapter: adapterOf("sqlite") as never,
      rows: {
        getAllComponents: async () =>
          [
            { slug: "hero", tableName: "fg_hero", fields: [], localized: true },
            { slug: "cta", tableName: "fg_cta", fields: [] },
          ] as never,
      },
      error: missingTable.sqlite("comp_hero"),
    });
    expect(vi.mocked(isCompanionReady).mock.calls.map(call => call[1])).toEqual(
      ["fg_hero_locales"]
    );
  });
});

describe("raiseIfMoved", () => {
  const raise = (dialect: Dialect, executor?: object) => {
    inFlow = executor;
    return raiseIfMoved({
      adapter: adapterOf(dialect) as never,
      error: missingTable[dialect]("comp_hero"),
      ...(executor === undefined ? {} : { executor }),
    });
  };

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

describe("an executor that is the pool rather than a transaction", () => {
  it("is read as no transaction: a lookup follows a moved registry and goes on", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(missingTable.postgresql("dynamic_components"))
      .mockResolvedValueOnce({ slug: "hero" });
    await expect(
      lookingUpRegistry({
        adapter: adapterOf("postgresql") as never,
        executor: POOL,
        lookup,
      })
    ).resolves.toEqual({ slug: "hero" });
    expect(readOn).toEqual([]);
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

describe("lookingUpRegistry", () => {
  /** A lookup that finds the registry under `names`, starting with the legacy one. */
  const lookupOf = (dialect: Dialect, ...names: string[]) => {
    const asked: string[] = [];
    return {
      asked,
      lookup: (adapter: Adapter) => async () => {
        const name = notedRegistryName(adapter as never)!;
        asked.push(name);
        if (!names.includes(name)) throw missingTable[dialect](name);
        return { slug: "hero" };
      },
    };
  };
  const run = (
    adapter: Adapter,
    registry: ReturnType<typeof lookupOf>,
    executor?: unknown
  ) =>
    lookingUpRegistry({
      adapter: adapter as never,
      executor,
      lookup: registry.lookup(adapter),
    });

  it("looks up once more off a transaction, and never a third time", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(missingTable.sqlite("dynamic_components"))
      .mockResolvedValueOnce({ slug: "hero" });
    const args = {
      adapter: adapterOf("sqlite") as never,
      executor: undefined,
      lookup,
    };
    await expect(lookingUpRegistry(args)).resolves.toEqual({ slug: "hero" });

    lookup.mockReset();
    lookup.mockRejectedValue(missingTable.sqlite("dynamic_components"));
    await expect(lookingUpRegistry(args)).rejects.toThrow("dynamic_components");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not look up again after any other failure, another missing table among them", async () => {
    for (const error of [
      new Error("connection reset"),
      missingTable.sqlite("comp_hero"),
    ]) {
      const lookup = vi.fn().mockRejectedValue(error);
      await expect(
        lookingUpRegistry({
          adapter: adapterOf("sqlite") as never,
          executor: undefined,
          lookup,
        })
      ).rejects.toBe(error);
      expect(lookup).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["sqlite", "mysql", "postgresql"] as const)(
    "answers on a transaction that meets a moved registry first, asking on its connection (%s)",
    async dialect => {
      const tx = txOf();
      const registry = lookupOf(dialect, "dynamic_field_groups");
      const adapter = adapterOf(dialect);
      // What this process resolved, before the move: the registry under its legacy name.
      held = { dynamic_components: ["id"] };
      await resolveRegistryTableName(adapter as never);
      held = { dynamic_field_groups: ["id"] };

      await expect(run(adapter, registry, tx.handle)).resolves.toEqual({
        slug: "hero",
      });
      expect(registry.asked).toEqual([
        "dynamic_components",
        "dynamic_field_groups",
      ]);
      expect(readOn).toEqual([tx.handle]);
    }
  );

  it("refuses a PostgreSQL write that came after the savepoint, rather than losing it", async () => {
    const adapter = adapterOf("postgresql");
    held = { dynamic_components: ["id"] };
    const tx = txOf();
    await run(adapter, lookupOf("postgresql", "dynamic_components"), tx.handle);
    held = { dynamic_field_groups: ["id"] };

    await expect(
      run(adapter, lookupOf("postgresql", "dynamic_field_groups"), tx.handle)
    ).rejects.toMatchObject(MOVING);
    expect(tx.said.at(-1)).toBe("SELECT 1 / 0");
  });

  it("finds the registry again after a rollback of the migration, for a retry that asks on transactions alone", async () => {
    // Nothing of the retry asks off a transaction, so what the rolled-back attempt leaves noted is
    // all it has: a stale name there would fail every try.
    const adapter = adapterOf("postgresql");
    noteRegistryName(adapter as never, "dynamic_field_groups");
    registered = { fg_hero: "_field_group_type" };
    held = { dynamic_components: ["id"] };
    const registry = lookupOf("postgresql", "dynamic_components");
    await expect(run(adapter, registry, txOf().handle)).rejects.toThrow(
      /dynamic_field_groups/
    );

    inFlow = undefined;
    await adapter.rolledBack();
    await expect(run(adapter, registry, txOf().handle)).resolves.toEqual({
      slug: "hero",
    });
  });

  it.each(["sqlite", "mysql", "postgresql"] as const)(
    "raises the failure as it was when the registry is in neither place (%s)",
    async dialect => {
      const tx = txOf();
      await expect(
        run(adapterOf(dialect), lookupOf(dialect), tx.handle)
      ).rejects.toThrow(/dynamic_components/);
    }
  );
});

describe("storageMovingRefusal", () => {
  it("carries the code a caller retries on, and keeps the table out of what the caller is told", () => {
    const refusal = storageMovingRefusal("fg_hero");
    expect(refusal).toMatchObject(MOVING);
    expect(JSON.stringify(refusal.publicData)).not.toContain("fg_hero");
    expect(refusal.publicMessage).toMatch(/retry the save/i);
  });
});
