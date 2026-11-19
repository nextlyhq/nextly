/**
 * The adapter `nextly migrate` removes a dropped entity's rows through, on the transaction of the
 * step that removes them. A command outside a booted app never fills the schema registry the
 * adapter's own reads and deletes address a table through, so a field group's shared table would
 * read as one nothing can reach. Here every table is addressed by its catalog name, through
 * Drizzle's `sql` template, which quotes it and binds each value for the dialect.
 *
 * @module domains/schema/migrate/owned-rows-adapter
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";
import {
  teardownAdapterIn,
  type TeardownAdapter,
} from "../../collections/services/teardown-adapter-in-transaction";
import { instanceTablesOf } from "../../field-groups/services/teardown-entity-field-group-data";
import { querySqlRows } from "../pipeline/classifier/count-helpers";

/**
 * `adapter` bound to `tx`, as a development delete binds it (`teardownAdapterIn`). A table the
 * schema registry addresses (Nextly's own) is read and written through it as there. One it does
 * not (a field group's shared table, outside a booted app) is addressed by its catalog name
 * instead, and one without a `_parent_table` column holds no field-group values whatever its name,
 * so it reads as empty, as the walk's own count reads it: a statement naming a column it lacks
 * would abort the step's transaction on PostgreSQL.
 */
export function ownedRowsAdapterIn(
  adapter: DrizzleAdapter,
  tx: TransactionContext
): TeardownAdapter {
  const bound = teardownAdapterIn(adapter, tx);
  const { dialect } = adapter;
  const holdsInstances = new Map<string, Promise<boolean>>();
  const instanceTable = (table: string): Promise<boolean> => {
    let answer = holdsInstances.get(table);
    if (answer === undefined) {
      answer = instanceTablesOf(bound, [table])().then(found =>
        found.has(table)
      );
      holdsInstances.set(table, answer);
    }
    return answer;
  };
  return {
    ...bound,
    select: <T = Record<string, unknown>>(
      table: string,
      options: { where?: WhereClause }
    ) =>
      unlessUnregistered(
        () => bound.select<T>(table, options),
        async () =>
          (await instanceTable(table))
            ? querySqlRows<T>(
                bound.getDrizzle(),
                dialect,
                sql`SELECT * FROM ${sql.identifier(table)}${whereSql(options.where)}`
              )
            : []
      ),
    delete: (table: string, where: WhereClause) =>
      unlessUnregistered(
        () => bound.delete(table, where),
        async () =>
          (await instanceTable(table))
            ? affectedRowCount(
                await runStatement(
                  bound.getDrizzle(),
                  dialect,
                  sql`DELETE FROM ${sql.identifier(table)}${whereSql(where)}`
                ),
                dialect
              )
            : 0
      ),
  };
}

/**
 * `registered()`, or `otherwise()` where the schema registry does not address the table. The
 * registry refuses before any statement is sent, so the transaction is untouched by it.
 */
async function unlessUnregistered<T>(
  registered: () => Promise<T>,
  otherwise: () => Promise<T>
): Promise<T> {
  try {
    return await registered();
  } catch (error) {
    // The adapter reports an unregistered table by message; there is no distinct code for it.
    if (!/not found in schema registry/i.test(String(error))) throw error;
    return otherwise();
  }
}

/** Runs a statement that returns no rows, as each dialect's Drizzle handle runs one. */
function runStatement(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<unknown> {
  // SQLite's handle answers at once; the others answer with a promise.
  return Promise.resolve(
    dialect === "sqlite"
      ? (db as { run(q: SQL): unknown }).run(statement)
      : (db as { execute(q: SQL): Promise<unknown> }).execute(statement)
  );
}

/**
 * ` WHERE …` for `where`, or nothing. Only what a removal step asks is rendered: conditions joined
 * by `and`, each `=`, `IN` or `IS NULL`. Anything else is refused rather than read as a looser
 * condition, which would delete more than the step asked.
 */
function whereSql(where: WhereClause | undefined): SQL {
  const conditions = where?.and ?? [];
  if (
    where !== undefined &&
    (where.or !== undefined || where.not !== undefined)
  ) {
    throw unsupported("an `or` or `not` clause");
  }
  if (conditions.length === 0) return sql``;
  return sql` WHERE ${sql.join(conditions.map(conditionSql), sql` AND `)}`;
}

function conditionSql(condition: WhereCondition | WhereClause): SQL {
  if (!("column" in condition)) throw unsupported("a nested clause");
  const column = sql.identifier(condition.column);
  if (condition.op === "IS NULL") return sql`${column} IS NULL`;
  if (condition.op === "=") return sql`${column} = ${condition.value}`;
  if (condition.op === "IN" && Array.isArray(condition.value)) {
    // An empty list matches nothing, which `IN ()` cannot say on every dialect.
    if (condition.value.length === 0) return sql`1 = 0`;
    return sql`${column} IN (${sql.join(
      condition.value.map(value => sql`${value}`),
      sql`, `
    )})`;
  }
  throw unsupported(`the operator ${condition.op}`);
}

function unsupported(what: string): NextlyError {
  // The step's own condition, never a caller's input: a defect to name in the log.
  return NextlyError.internal({
    logContext: { reason: "owned-rows-where-unsupported", asked: what },
  });
}
