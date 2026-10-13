/**
 * A fresh install's foreign keys to code-first tables, at both ends of the
 * boot.
 *
 * First-run leaves a key whose target does not exist yet to the apply that
 * creates the code-first tables, rather than attempting it and warning about
 * a failure that was not one. `assertFreshInstallForeignKeys` then refuses a
 * fresh install whose extension tables still lack such a key, naming the
 * table, the key and the target.
 *
 * The database is faked at its two answers, which tables exist and what the
 * live tables hold, while the comparison is the pipeline's real diff, so each
 * case turns on the key's presence as the boot reads it.
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
  assertFreshInstallForeignKeys,
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

const refs = (foreignKeys: ForeignKeySpec[]): TableSpec => ({
  name: "cf__refs",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "post_id", type: "text", nullable: true },
    { name: "user_id", type: "text", nullable: true },
  ],
  foreignKeys,
  checks: [],
  indexes: [],
});

/** A database holding `tables`, whose live extension tables are `live`. */
function database(tables: string[], live: TableSpec[]) {
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

const created = new Set(["dc_cf_posts"]);
const declared = [refs([toPost, toUser])];

describe("assertFreshInstallForeignKeys", () => {
  it("resolves when every key to a created table exists (control)", async () => {
    const db = database(
      ["cf__refs", "dc_cf_posts", "users"],
      [refs([toPost, toUser])]
    );
    await expect(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    ).resolves.toBeUndefined();
  });

  it("refuses a key the database lacks while its target exists, naming the table, key and target", async () => {
    const db = database(["cf__refs", "dc_cf_posts", "users"], [refs([toUser])]);
    const errors = await refusalOf(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain('"fk_cf__refs_post_id"');
    expect(errors[0]?.message).toContain('"cf__refs"');
    expect(errors[0]?.message).toContain('"dc_cf_posts"');
    expect(errors[0]?.message).toContain("was not created");
  });

  it("refuses a key whose target table is missing, even where the database kept the key", async () => {
    // SQLite keeps a key in its CREATE TABLE whatever its target, so the
    // live table holds it while the table it names was never created.
    const db = database(["cf__refs", "users"], [refs([toPost, toUser])]);
    const errors = await refusalOf(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain('"dc_cf_posts"');
    expect(errors[0]?.message).toContain("did not create");
  });

  it("names a key once, by its missing target, when both are missing", async () => {
    // The missing target is the cause; the missing key follows from it on
    // PostgreSQL and MySQL, so reporting both would name one problem twice.
    const db = database(["cf__refs", "users"], [refs([toUser])]);
    const errors = await refusalOf(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
    expect(errors[0]?.message).toContain("did not create");
  });

  it("refuses every key of a table the database does not have", async () => {
    const db = database(["dc_cf_posts", "users"], []);
    const errors = await refusalOf(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    );
    expect(errors.map(entry => entry.path)).toEqual([
      "cf__refs.foreignKeys.fk_cf__refs_post_id",
    ]);
  });

  it("leaves alone a key to a table the boot did not set out to create", async () => {
    // `users` is missing and so is its key, but the boot never creates it
    // here: a Builder-made or adopted table arrives later, through migrations
    // or the Builder, and refusing it would stop the install from starting.
    const db = database(["cf__refs", "dc_cf_posts"], [refs([toPost])]);
    await expect(
      assertFreshInstallForeignKeys({
        ...db,
        specs: declared,
        createdTables: created,
      })
    ).resolves.toBeUndefined();
  });
});

describe("ensureFirstRunSetup and foreign keys whose target is created later", () => {
  it("replays a key to an existing table and leaves one to a missing table, without warning", async () => {
    // PostgreSQL, where a key is its own statement and fails while its
    // target is missing. `users` exists once the push has run;
    // `dc_cf_posts` is a code-first table, created later in the boot.
    const executed: string[] = [];
    const warn = vi.fn();
    const adapter = {
      dialect: "postgresql" as const,
      getDrizzle: () => ({}),
      executeQuery: (statement: string) => {
        executed.push(statement);
        return Promise.resolve(undefined);
      },
      tableExists: (name: string) => Promise.resolve(name === "users"),
    };
    // Only `specs` is read on this path; the rest of the compiled schema is
    // what the push and the registry consume, both faked or unused here.
    const extensionSchema = {
      specs: declared,
      drizzle: {},
    } as unknown as ExtensionSchema;

    const result = await ensureFirstRunSetup({
      adapter,
      logger: { info: () => {}, warn, error: () => {} },
      extensionSchema,
      deps: {
        freshPushSchema: () => Promise.resolve({ statementsExecuted: [] }),
        getDialectTables: () => ({}),
        getSchemaEventsDdl: () => [],
      },
    });

    expect(result.ranSetup).toBe(true);
    expect(executed.some(sql => sql.includes("fk_cf__refs_user_id"))).toBe(
      true
    );
    expect(executed.some(sql => sql.includes("fk_cf__refs_post_id"))).toBe(
      false
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
