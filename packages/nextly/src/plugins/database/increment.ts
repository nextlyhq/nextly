/**
 * Adding to a stored number in the database itself, for `ctx.db.update`.
 *
 * A counter kept by reading the value and writing it back plus one loses
 * counts: two requests read the same value, and the second write overwrites
 * the first. Done in the statement that writes it, `col = col + n`, the
 * database adds under the row's own lock, so every concurrent add counts, and
 * the update still reports how many rows it changed, which tells a first
 * count apart from a later one.
 *
 * It is a value, not a fragment of SQL: `increment(1)` stands for "this
 * column plus one" and `ctx.db.update` alone turns it into the statement, for
 * a numeric column of the table it is updating. A plugin gains no way to write
 * SQL of its own through it, which `capabilities.db.rawSql` still governs.
 *
 * @module plugins/database/increment
 */
import { NextlyError } from "../../errors/nextly-error";

/** Brands a value as an increment; a symbol, so no stored value can carry it. */
const INCREMENT: unique symbol = Symbol("nextly.db.increment");

/**
 * @experimental What `increment` returns: "this column plus `by`", for a
 * numeric column in `ctx.db.update`'s `set`. Opaque on purpose: it is read
 * only by `ctx.db.update`.
 */
export interface Increment {
  readonly [INCREMENT]: number;
}

/**
 * @experimental Add `by` (1 when left out) to a numeric column in the same
 * statement that updates the row, on every dialect: `set: { hits:
 * increment(1) }` writes `hits = hits + 1`. Two updates at once both count. A
 * negative `by` subtracts. `by` must be a finite number; an integer column
 * takes an integer.
 *
 * Accepted by `ctx.db.update` (and a transaction's `tx.update`) for a column
 * declared `integer`, `smallint`, `bigint`, `real`, `double` or `decimal`; any
 * other column refuses it. A row whose column is null stays null, as SQL adds.
 */
export function increment(by: number = 1): Increment {
  if (typeof by !== "number" || !Number.isFinite(by)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "increment",
          code: "INVALID",
          message: `increment() takes a finite number, not ${String(by)}.`,
        },
      ],
    });
  }
  return Object.freeze({ [INCREMENT]: by });
}

/** Whether `value` is one `increment` returned. */
export function isIncrement(value: unknown): value is Increment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<Increment>)[INCREMENT] === "number"
  );
}

/** How much `value` adds. */
export function incrementBy(value: Increment): number {
  return value[INCREMENT];
}
