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
 * - a transaction's connection is never waited for while the transaction holds it;
 * - a registry lookup that failed as a move runs once more, and never a third time.
 *
 * @module domains/field-groups/migration/__tests__/moved-storage.test
 */
import { tableNotRegisteredError } from "@nextlyhq/adapter-drizzle/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { introspectLiveColumns } from "../../../schema/pipeline/diff/introspect-live";
import { registerComponentRuntimeSchema } from "../../services/field-group-table-provisioning";
import {
  followingMovedRegistry,
  isMovedStorageError,
  refusalAfterFollowing,
  refusalOnTransaction,
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

const TX = { select: () => undefined };
/** The pool, which MySQL's table-name case setting is read from as well as the catalog. */
const POOL = {
  execute: async () => [[{ value: 0, lower_case_table_names: 0 }]],
};
const MOVING = {
  publicData: { errors: [{ code: "FIELD_GROUP_STORAGE_MOVING" }] },
};

beforeEach(() => {
  held = {};
  readOn = [];
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
const adapterOf = (dialect: Dialect) =>
  ({
    dialect,
    getDrizzle: () => POOL,
    getCapabilities: () => ({ dialect }),
    tableExists: async (name: string) => held[name] !== undefined,
  }) as never;
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

describe.each(["sqlite", "mysql", "postgresql"] as const)(
  "a failed save (%s)",
  dialect => {
    /** Both ways a save fails, on a transaction and off one. */
    const refusals = async (error: unknown, slugs = ["hero"]) => {
      const failure = {
        adapter: adapterOf(dialect),
        rows: rowsOf("hero", "cta"),
        error,
        tableNames: slugs.map(slug => `comp_${slug}`),
      };
      return [
        await refusalOnTransaction({ ...failure, executor: TX }),
        await refusalAfterFollowing(failure),
      ];
    };

    it("is refused to be retried when its table moved", async () => {
      held = { fg_hero: ["id", "_field_group_type"] };
      for (const refusal of await refusals(
        NextlyError.internal({ cause: missingTable[dialect]("comp_hero") })
      )) {
        expect(refusal).toMatchObject(MOVING);
      }
    });

    it("is refused to be retried when its table was rolled back", async () => {
      held = { comp_hero: ["id", "_component_type"] };
      for (const refusal of await refusals(missingTable[dialect]("fg_hero"))) {
        expect(refusal).toMatchObject(MOVING);
      }
    });

    it("keeps its own error when no migration has made the table yet", async () => {
      // Another group is there, under the current names: it says nothing about this one.
      held = { fg_cta: ["id", "_field_group_type"] };
      expect(
        await refusals(missingTable[dialect]("comp_hero"), ["cta", "hero"])
      ).toEqual([undefined, undefined]);
    });

    it("is refused to be retried when its discriminator column moved", async () => {
      held = { comp_hero: ["id", "_field_group_type"] };
      for (const refusal of await refusals(
        missingColumn[dialect]("comp_hero", "_component_type")
      )) {
        expect(refusal).toMatchObject(MOVING);
      }
    });

    it("keeps its own error when no migration has made the project's column yet", async () => {
      // The table is there, and has moved: the column that is missing is the project's.
      held = { fg_hero: ["id", "_field_group_type"] };
      expect(
        await refusals(missingColumn[dialect]("fg_hero", "subtitle"))
      ).toEqual([undefined, undefined]);
    });

    it("keeps its own error when the discriminator is missing under both names", async () => {
      held = { comp_hero: ["id"] };
      expect(
        await refusals(missingColumn[dialect]("comp_hero", "_component_type"))
      ).toEqual([undefined, undefined]);
    });

    it("keeps its own error when the catalog cannot be read", async () => {
      vi.mocked(introspectLiveColumns).mockRejectedValue(new Error("denied"));
      expect(await refusals(missingTable[dialect]("comp_hero"))).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("follows the table the database named, which need not be the first the field allows", async () => {
      held = {
        fg_cta: ["id", "_field_group_type"],
        fg_hero: ["id", "_field_group_type"],
      };
      await refusalAfterFollowing({
        adapter: adapterOf(dialect),
        rows: rowsOf("hero", "cta"),
        error: missingTable[dialect]("comp_hero"),
        tableNames: ["comp_cta"],
      });
      expect(
        vi
          .mocked(registerComponentRuntimeSchema)
          .mock.calls.map(call => call[2])
      ).toEqual(["fg_cta", "fg_hero"]);
    });
  }
);

describe("a save on a caller's transaction", () => {
  it.each(["sqlite", "mysql"] as const)(
    "asks the catalog on the transaction's own connection (%s)",
    async dialect => {
      held = { fg_hero: ["id"] };
      await refusalOnTransaction({
        adapter: adapterOf(dialect),
        executor: TX,
        error: missingTable[dialect]("comp_hero"),
        tableNames: [],
      });
      expect(readOn).toEqual([TX]);
    }
  );

  it("does not wait for a connection the pool does not have, and keeps its error (postgresql)", async () => {
    // A pool of one, which the transaction holds: the read never answers.
    vi.mocked(introspectLiveColumns).mockReturnValue(new Promise(() => {}));
    await expect(
      refusalOnTransaction({
        adapter: adapterOf("postgresql"),
        executor: TX,
        error: missingTable.postgresql("comp_hero"),
        tableNames: [],
      })
    ).resolves.toBeUndefined();
  }, 5000);
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
      adapterOf("sqlite")
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
      adapterOf("sqlite")
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
      adapterOf("sqlite")
    );

    await expect(registry.getComponent("hero")).rejects.toThrow(
      "dynamic_components"
    );
    expect(getComponent).toHaveBeenCalledTimes(2);
  });

  it("on a transaction, refuses a registry that moved, without looking up again", async () => {
    held = { dynamic_field_groups: ["id"] };
    const getComponent = vi.fn().mockRejectedValue(MISSING);
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite")
    );

    await expect(registry.getComponent("hero", TX)).rejects.toMatchObject(
      MOVING
    );
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("on a transaction, raises the failure as it was when the registry is in neither place", async () => {
    const getComponent = vi.fn().mockRejectedValue(MISSING);
    const registry = followingMovedRegistry(
      { getComponent },
      adapterOf("sqlite")
    );

    await expect(registry.getComponent("hero", TX)).rejects.toBe(MISSING);
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
