/**
 * An in-memory stand-in for the tables the data steps rewrite.
 *
 * The steps reach their tables through the adapter's typed CRUD, which is strict
 * in ways that matter here: it refuses a table the schema registry does not
 * declare, refuses a `where` naming a column that does not exist, and projects
 * only the columns a table actually has — so a projection naming the wrong
 * property yields a row without that key rather than a row with `undefined`.
 * A double that answered every request would certify a rewrite that cannot run.
 *
 * It also rolls a transaction back on failure, because the batched walk's whole
 * safety argument is that a cursor is written only after its batch committed,
 * and a double that kept a failed batch's writes could not tell the two apart.
 *
 * The errors it raises are the ones production raises, which is why they are not
 * `NextlyError`s despite the repository rule: an unresolvable table comes out of
 * the adapter as a `DatabaseError` (`adapter.ts` `select`), and an unresolvable
 * column comes out of the where builder as a bare `Error` (`drizzle-where.ts`
 * `buildCondition`). Raising a different error type here would test refusal
 * handling against errors the code will never actually meet.
 *
 * And it treats what escapes a transaction callback the way every real adapter
 * does, which is to distinguish two things. An error the WORK raised is the
 * application refusing the write, and reaches the caller as it was thrown, with
 * the code and payload it chose. Anything else is a failure of the transaction
 * and is classified. A double that rewrapped both would be stricter than
 * production, and a test written against it would pass while the real path
 * handed the caller a different error entirely.
 */
import {
  createDatabaseError,
  isApplicationError,
  isDatabaseError,
  type SelectOptions,
  type TransactionContext,
  type WhereClause,
  type WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { vi } from "vitest";

import type { MetaService } from "../../../../meta/services/meta-service";
import type { MigrationSession } from "../../session";

/** One table: the columns it declares, and the rows it holds. */
export interface TableFixture {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface TableWorldOptions {
  /**
   * Called before each write. Throwing models a statement the database refused,
   * so the surrounding transaction rolls back.
   */
  onUpdate?: (table: string, id: unknown) => void;
}

export interface TableWorld {
  session: MigrationSession;
  meta: MetaService;
  /** Rows as they now stand, for assertions. */
  rows(table: string): Record<string, unknown>[];
  /** A `nextly_meta` value, or `undefined` when the key is absent. */
  metaValue(key: string): unknown;
  /** Insert a row after the world was built, to model a concurrent write. */
  insert(table: string, row: Record<string, unknown>): void;
  /** Every `select` this world served, so a test can assert how it was asked. */
  reads: { table: string; forUpdate: boolean }[];
  counts: { transactions: number; selects: number; updates: number };
}

export function createTableWorld(
  fixtures: Record<string, TableFixture>,
  options: TableWorldOptions = {}
): TableWorld {
  const tables = new Map<string, TableFixture>(
    Object.entries(fixtures).map(([name, fixture]) => [
      name,
      { columns: [...fixture.columns], rows: structuredClone(fixture.rows) },
    ])
  );
  const meta = new Map<string, unknown>();
  const reads: { table: string; forUpdate: boolean }[] = [];
  const counts = { transactions: 0, selects: 0, updates: 0 };

  function tableOf(name: string): TableFixture {
    const fixture = tables.get(name);
    if (fixture === undefined) {
      // The adapter refuses a name the schema registry does not declare, and
      // does it as a DatabaseError -- so this raises the same type, which the
      // transaction boundary then passes through rather than reclassifying.
      throw createDatabaseError({
        kind: "query",
        message: `Table "${name}" not found in schema registry.`,
      });
    }
    return fixture;
  }

  function requireColumn(fixture: TableFixture, column: string): void {
    if (fixture.columns.includes(column)) return;
    // A bare Error, because that is what the where builder raises. A double that
    // ignored the column would silently widen every filter it was given.
    throw new Error(`Column "${column}" not found in table.`);
  }

  function matches(
    fixture: TableFixture,
    row: Record<string, unknown>,
    where: WhereClause | undefined
  ): boolean {
    if (where === undefined) return true;
    const clauses = where.and ?? [];
    return clauses.every(clause => {
      if (!("column" in clause)) return matches(fixture, row, clause);
      const condition = clause satisfies WhereCondition;
      requireColumn(fixture, condition.column);
      const actual = row[condition.column];
      if (condition.op === "=") return actual === condition.value;
      if (condition.op === ">") {
        return (
          typeof actual === "string" &&
          typeof condition.value === "string" &&
          actual > condition.value
        );
      }
      throw new Error(`unsupported operator ${condition.op} in this double`);
    });
  }

  function select(
    table: string,
    selectOptions?: SelectOptions
  ): Record<string, unknown>[] {
    counts.selects += 1;
    reads.push({ table, forUpdate: selectOptions?.forUpdate === true });
    const fixture = tableOf(table);
    let rows = fixture.rows.filter(row =>
      matches(fixture, row, selectOptions?.where)
    );

    for (const order of selectOptions?.orderBy ?? []) {
      // The adapter drops an order it cannot resolve rather than refusing, so
      // this does the same: a double that threw here would hide the behaviour
      // the walk has to be correct in spite of.
      if (!fixture.columns.includes(order.column)) continue;
      rows = [...rows].sort((a, b) =>
        String(a[order.column]) < String(b[order.column]) ? -1 : 1
      );
    }

    if (selectOptions?.limit !== undefined) {
      rows = rows.slice(0, selectOptions.limit);
    }

    const projection = selectOptions?.columns;
    return rows.map(row => {
      if (projection === undefined) return structuredClone(row);
      const projected: Record<string, unknown> = {};
      for (const column of projection) {
        // Only columns the table declares survive a projection, so asking for a
        // property that is not there produces a row without the key -- which is
        // exactly what the steps have to refuse rather than rewrite.
        if (!fixture.columns.includes(column)) continue;
        projected[column] = structuredClone(row[column]);
      }
      return projected;
    });
  }

  function update(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): void {
    counts.updates += 1;
    const fixture = tableOf(table);
    for (const column of Object.keys(data)) requireColumn(fixture, column);
    for (const row of fixture.rows) {
      if (!matches(fixture, row, where)) continue;
      options.onUpdate?.(table, row.id);
      Object.assign(row, structuredClone(data));
    }
  }

  const ctx = {
    select: vi.fn(async (table: string, selectOptions?: SelectOptions) =>
      select(table, selectOptions)
    ),
    update: vi.fn(
      async (
        table: string,
        data: Record<string, unknown>,
        where: WhereClause
      ) => {
        update(table, data, where);
        return [];
      }
    ),
  } as unknown as TransactionContext;

  const session: MigrationSession = {
    dialect: "postgresql",
    // This double stands in for a session that CLAIMED the lock, which is what
    // every step it serves requires. `null` is that session's real answer:
    // under a claim the owner is this session itself, and reporting it would
    // let a step mistake its own claim for someone else's contention.
    observedLockOwner: null,
    async inTransaction(work) {
      counts.transactions += 1;
      const snapshot = new Map(
        [...tables].map(([name, fixture]) => [
          name,
          structuredClone(fixture.rows),
        ])
      );
      try {
        return await work(ctx);
      } catch (error) {
        for (const [name, rows] of snapshot) {
          const fixture = tables.get(name);
          if (fixture !== undefined) fixture.rows = rows;
        }
        // Mirrors every adapter's transaction boundary, which distinguishes two
        // things: an error the WORK raised is the application refusing the
        // write and reaches the caller as it was thrown, while anything else is
        // a failure of the transaction and is classified. A double that
        // rewrapped both would be stricter than production, and a test written
        // against it would pass while the real path returned a different error.
        if (isApplicationError(error) || isDatabaseError(error)) throw error;
        throw createDatabaseError({
          kind: "unknown",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };

  const metaService = {
    get: vi.fn(async (key: string) => meta.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      meta.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key: string) => {
      meta.delete(key);
    }),
  } as unknown as MetaService;

  return {
    session,
    meta: metaService,
    rows: name => tableOf(name).rows,
    metaValue: key => meta.get(key),
    insert: (name, row) => {
      tableOf(name).rows.push(structuredClone(row));
    },
    reads,
    counts,
  };
}
