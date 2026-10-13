/**
 * Extension tables' foreign keys to code-first tables, at both ends of the
 * boot.
 *
 * First-run leaves a key to a code-first table to the apply that creates those
 * tables, rather than attempting it and warning about a failure that was not
 * one, and still attempts every other key. `assertForeignKeysToCodeFirstTables`
 * then refuses a boot whose extension tables, while they hold no rows, still
 * lack such a key, naming the table, the key and the target.
 *
 * The database is faked at its three answers — which tables exist, what the
 * live tables hold, and whether a table has rows — while the comparison is the
 * pipeline's real diff, so each case turns on the key's presence as the boot
 * reads it.
 */
import { describe, expect, it, vi } from "vitest";

import type { ExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  TableSpec,
} from "../../domains/schema/pipeline/diff/types";
import { NextlyError } from "../../errors";
import {
  assertForeignKeysToCodeFirstTables,
  ensureFirstRunSetup,
} from "../first-run";

const toPost: ForeignKeySpec = {
  name: "fk_cf__refs_post_id",
  columns: ["post_id"],
  referencesTable: "dc_cf_posts",
  referencesColumns: ["id"],
  onDelete: "no action",
  onUpdate: "no action",
};
const toUser: ForeignKeySpec = {
  ...toPost,
  name: "fk_cf__refs_user_id",
  columns: ["user_id"],
  referencesTable: "users",
};
/** A key to a table no boot step creates: one made in the Builder, say. */
const toBuilderTable: ForeignKeySpec = {
  ...toPost,
  name: "fk_cf__refs_thing_id",
  columns: ["thing_id"],
  referencesTable: "dc_builder_things",
};

const refs = (foreignKeys: ForeignKeySpec[]): TableSpec => ({
  name: "cf__refs",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "post_id", type: "text", nullable: true },
    { name: "user_id", type: "text", nullable: true },
    { name: "thing_id", type: "text", nullable: true },
  ],
  foreignKeys,
  checks: [],
  indexes: [],
});

/**
 * A database holding `tables`, whose live extension tables are `live`, and
 * whose tables named in `withRows` hold rows.
 */
function database(
  tables: string[],
  live: TableSpec[],
  withRows: string[] = []
) {
  return {
    adapter: {
      dialect: "postgresql" as const,
      getDrizzle: () => ({}),
      executeQuery: () => Promise.resolve(undefined),
      tableExists: (name: string) => Promise.resolve(tables.includes(name)),
    },
    introspect: (names: string[]): Promise<NextlySchemaSnapshot> =>
      Promise.resolve({
        tables: live.filter(table => names.includes(table.name)),
      }),
    hasRows: (table: string) => Promise.resolve(withRows.includes(table)),
  };
}

/** The refusal's entries, or none when the call resolved. */
async function refusalOf(
  run: Promise<void>
): Promise<Array<{ path: string; message: string }>> {
  try {
    await run;
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    const data = (error as NextlyError).publicData as {
      errors: Array<{ path: string; message: string }>;
    };
    // The messages as plain strings too: printed, the error shows the
    // entries of `errors` only as `[Object]`.
    expect((error as NextlyError).logContext).toEqual({
      missingForeignKeys: data.errors.map(entry => entry.message),
    });
    return data.errors;
  }
}

const codeFirstTables = new Set(["dc_cf_posts"]);
const declared = [refs([toPost, toUser])];

describe("assertForeignKeysToCodeFirstTables", () => {
  it("resolves when every key to a code-first table exists (control)", async () => {
    const db = database(
      ["cf__refs", "dc_cf_posts", "users"],
      [refs([toPost, toUser])]
    );
    await expect(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    ).resolves.toBeUndefined();
  });

  it("refuses a key an empty table lacks while its target exists, naming the table, key and target", async () => {
    // Nothing here says whether this boot is the one that created the tables:
    // a restart after a refused boot whose apply committed the tables and not
    // the key reads exactly this, and is refused exactly the same.
    const db = database(["cf__refs", "dc_cf_posts", "users"], [refs([toUser])]);
    const errors = await refusalOf(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain('"fk_cf__refs_post_id"');
    expect(errors[0]?.message).toContain('"cf__refs"');
    expect(errors[0]?.message).toContain('"dc_cf_posts"');
    expect(errors[0]?.message).toContain("holds no rows");
  });

  it("refuses a key whose target table is missing, even where the database kept the key", async () => {
    // SQLite keeps a key in its CREATE TABLE whatever its target, so the
    // live table holds it while the table it names was never created.
    const db = database(["cf__refs", "users"], [refs([toPost, toUser])]);
    const errors = await refusalOf(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain('"dc_cf_posts"');
    expect(errors[0]?.message).toContain(
      "a code-first table that does not exist"
    );
  });

  it("names a key once, by its missing target, when both are missing", async () => {
    // The missing target is the cause; the missing key follows from it on
    // PostgreSQL and MySQL, so reporting both would name one problem twice.
    const db = database(["cf__refs", "users"], [refs([toUser])]);
    const errors = await refusalOf(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain(
      "a code-first table that does not exist"
    );
  });

  it("leaves alone a missing key on a table that holds rows", async () => {
    // Drift on a table in use, which its rows may legitimately block: the
    // development push, `nextly db:sync` and migrations reconcile it.
    const db = database(
      ["cf__refs", "dc_cf_posts", "users"],
      [refs([toUser])],
      ["cf__refs"]
    );
    await expect(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    ).resolves.toBeUndefined();
  });

  it("leaves alone a holding table the database does not have yet", async () => {
    // Whatever creates it adds its keys with it. Its key's target is missing
    // too, so a check that read the absent table as an empty one would refuse.
    const db = database(["users"], []);
    await expect(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: declared,
        codeFirstTables,
      })
    ).resolves.toBeUndefined();
  });

  it("leaves alone a key to a table that is not code-first", async () => {
    // A Builder-made or adopted table arrives later, through migrations or
    // the Builder, and refusing a key to it would stop a fresh install from
    // ever starting.
    const db = database(["cf__refs", "dc_cf_posts", "users"], [refs([toPost])]);
    await expect(
      assertForeignKeysToCodeFirstTables({
        ...db,
        specs: [refs([toPost, toBuilderTable])],
        codeFirstTables,
      })
    ).resolves.toBeUndefined();
  });
});

describe("ensureFirstRunSetup and foreign keys to code-first tables", () => {
  /** A fresh PostgreSQL database, where a key is a statement of its own. */
  function freshPostgres(failing: string) {
    const executed: string[] = [];
    const adapter = {
      dialect: "postgresql" as const,
      getDrizzle: () => ({}),
      executeQuery: (statement: string) => {
        executed.push(statement);
        return statement.includes(failing)
          ? Promise.reject(new Error(`relation does not exist: ${failing}`))
          : Promise.resolve(undefined);
      },
      tableExists: () => Promise.resolve(false),
    };
    return { adapter, executed };
  }

  /** First-run over `specs`, `dc_cf_posts` being the code-first table. */
  async function firstRun(
    adapter: ReturnType<typeof freshPostgres>["adapter"],
    specs: TableSpec[],
    warn: (message: string) => void
  ) {
    // Only `specs` and `codeFirstTables` are read on this path; the rest of
    // the compiled schema is what the push and the registry consume, both
    // faked or unused here.
    const extensionSchema = {
      specs,
      drizzle: {},
      codeFirstTables,
    } as unknown as ExtensionSchema;
    return ensureFirstRunSetup({
      adapter,
      logger: { info: () => {}, warn, error: () => {} },
      extensionSchema,
      deps: {
        freshPushSchema: () => Promise.resolve({ statementsExecuted: [] }),
        getDialectTables: () => ({}),
        getSchemaEventsDdl: () => [],
      },
    });
  }

  it("leaves a key to a code-first table to the later apply, and replays the others", async () => {
    const { adapter, executed } = freshPostgres("never");
    const warn = vi.fn();
    const result = await firstRun(adapter, declared, warn);

    expect(result.ranSetup).toBe(true);
    expect(executed.some(sql => sql.includes("fk_cf__refs_user_id"))).toBe(
      true
    );
    expect(executed.some(sql => sql.includes("fk_cf__refs_post_id"))).toBe(
      false
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("still attempts a key to a missing table that is not code-first, and reports its failure", async () => {
    // No later step creates this target, so leaving its key off here would
    // drop it without a word.
    const { adapter, executed } = freshPostgres("fk_cf__refs_thing_id");
    const warn = vi.fn();
    await firstRun(adapter, [refs([toPost, toBuilderTable])], warn);

    expect(executed.some(sql => sql.includes("fk_cf__refs_thing_id"))).toBe(
      true
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cf__refs"));
  });
});
