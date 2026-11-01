import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import {
  createTableIfAbsent,
  isConcurrentCreateError,
} from "../concurrent-create";

/** A driver error as node-postgres raises it: the SQLSTATE on `code`, the index on `constraint`. */
function pgError(
  code: string,
  message: string,
  constraint?: string
): Error & { code: string; constraint?: string } {
  return Object.assign(new Error(message), { code, constraint });
}

/** Drizzle's wrapper: the statement as its message, no code, the driver's error on `cause`. */
function drizzleWrapped(cause: unknown): Error {
  return new Error("Failed query: CREATE TABLE IF NOT EXISTS t (id integer)", {
    cause,
  });
}

/** The adapter's DatabaseError: the code and constraint copied up, the original on `cause`. */
function adapterWrapped(driver: {
  code: string;
  constraint?: string;
  message: string;
}): Error {
  return Object.assign(
    new Error(driver.message, { cause: drizzleWrapped(driver) }),
    { code: driver.code, constraint: driver.constraint, kind: "unknown" }
  );
}

const DUPLICATE_TABLE = pgError("42P07", 'relation "t" already exists');
const DUPLICATE_TYPE = pgError("42710", 'type "t" already exists');
const TYPE_NAME_TAKEN = pgError(
  "23505",
  'duplicate key value violates unique constraint "pg_type_typname_nsp_index"',
  "pg_type_typname_nsp_index"
);
const RELATION_NAME_TAKEN = pgError(
  "23505",
  'duplicate key value violates unique constraint "pg_class_relname_nsp_index"',
  "pg_class_relname_nsp_index"
);

describe("isConcurrentCreateError", () => {
  it.each([
    ["42P07 duplicate_table", DUPLICATE_TABLE],
    ["42710 duplicate_object", DUPLICATE_TYPE],
    ["23505 on pg_type's name index", TYPE_NAME_TAKEN],
    ["23505 on pg_class's name index", RELATION_NAME_TAKEN],
  ])("tolerates %s, raw and wrapped", (_label, driver) => {
    expect(isConcurrentCreateError(driver)).toBe(true);
    expect(isConcurrentCreateError(drizzleWrapped(driver))).toBe(true);
    expect(isConcurrentCreateError(adapterWrapped(driver))).toBe(true);
  });

  it("reads the catalog index from the message when a level kept the code but not the field", () => {
    const codeOnly = Object.assign(new Error(TYPE_NAME_TAKEN.message), {
      code: "23505",
    });
    expect(isConcurrentCreateError(codeOnly)).toBe(true);
    expect(isConcurrentCreateError(drizzleWrapped(codeOnly))).toBe(true);
  });

  it.each([
    [
      "42501 insufficient_privilege",
      pgError("42501", "permission denied for schema public"),
    ],
    [
      "23505 on a table's own constraint",
      pgError(
        "23505",
        'duplicate key value violates unique constraint "t_pkey"',
        "t_pkey"
      ),
    ],
    [
      "23505 whose field names another constraint while the message names a catalog index",
      pgError(
        "23505",
        'duplicate key value violates unique constraint "pg_type_typname_nsp_index"',
        "t_pkey"
      ),
    ],
    [
      "08006 connection_failure",
      pgError("08006", "connection terminated unexpectedly"),
    ],
    [
      "ECONNREFUSED",
      pgError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432"),
    ],
    ["an error with no code", new Error('type "t" already exists')],
    ["a non-error", "42P07"],
  ])("does not tolerate %s, raw or wrapped", (_label, error) => {
    expect(isConcurrentCreateError(error)).toBe(false);
    expect(isConcurrentCreateError(drizzleWrapped(error))).toBe(false);
  });

  it("ends on a cyclic cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect(isConcurrentCreateError(a)).toBe(false);
  });
});

describe("createTableIfAbsent", () => {
  const STATEMENT = "CREATE TABLE IF NOT EXISTS t (id integer PRIMARY KEY)";

  /** An adapter whose CREATE fails with `createError` and whose read of the table succeeds or not. */
  function adapterFailingWith(createError: unknown, tableReadable: boolean) {
    const executeQuery = vi.fn().mockRejectedValue(createError);
    const queryStatement = tableReadable
      ? vi.fn().mockResolvedValue([])
      : vi
          .fn()
          .mockRejectedValue(pgError("42P01", 'relation "t" does not exist'));
    const adapter = {
      executeQuery,
      queryStatement,
    } as unknown as DrizzleAdapter;
    return { adapter, executeQuery, queryStatement };
  }

  it("succeeds on PostgreSQL when another session created the table", async () => {
    const error = adapterWrapped(TYPE_NAME_TAKEN);
    const { adapter, queryStatement } = adapterFailingWith(error, true);
    await expect(
      createTableIfAbsent(adapter, "postgresql", "t", STATEMENT)
    ).resolves.toBeUndefined();
    expect(queryStatement).toHaveBeenCalledTimes(1);
  });

  it("throws the original error when the table cannot be read afterwards", async () => {
    const error = adapterWrapped(DUPLICATE_TYPE);
    const { adapter } = adapterFailingWith(error, false);
    await expect(
      createTableIfAbsent(adapter, "postgresql", "t", STATEMENT)
    ).rejects.toBe(error);
  });

  it("throws any other error unchanged, without reading the table", async () => {
    const error = adapterWrapped(
      pgError("42501", "permission denied for schema public")
    );
    const { adapter, queryStatement } = adapterFailingWith(error, true);
    await expect(
      createTableIfAbsent(adapter, "postgresql", "t", STATEMENT)
    ).rejects.toBe(error);
    expect(queryStatement).not.toHaveBeenCalled();
  });

  it.each(["mysql", "sqlite"] as const)(
    "tolerates nothing on %s",
    async dialect => {
      const error = adapterWrapped(DUPLICATE_TABLE);
      const { adapter, queryStatement } = adapterFailingWith(error, true);
      await expect(
        createTableIfAbsent(adapter, dialect, "t", STATEMENT)
      ).rejects.toBe(error);
      expect(queryStatement).not.toHaveBeenCalled();
    }
  );

  it("runs the statement once when it succeeds", async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const queryStatement = vi.fn();
    const adapter = {
      executeQuery,
      queryStatement,
    } as unknown as DrizzleAdapter;
    await createTableIfAbsent(adapter, "postgresql", "t", STATEMENT);
    expect(executeQuery).toHaveBeenCalledWith(STATEMENT);
    expect(queryStatement).not.toHaveBeenCalled();
  });
});
