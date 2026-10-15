/**
 * The values a widget's data may hold: what JSON carries to the browser
 * unchanged.
 *
 * A data function answers on the server and its answer is drawn in the
 * browser, so everything in it is encoded on the way. JSON keeps strings,
 * numbers, booleans, null, arrays and plain objects, and changes everything
 * else without a word: a `Date` arrives as a string, a `Map` as `{}`, a
 * function disappears. A component typed against the server's value would then
 * read a method that is not there.
 *
 * 🔴 A mapped CHECK rather than a recursive `Json` union to assign to. An
 * interface has no implicit index signature, so `interface Row { title: string
 * }` is not assignable to `{ [key: string]: Json }` even though every value in
 * it is safe -- an author would be told to rewrite a correct type as an alias.
 * Mapping the answer's own type keeps whatever the author wrote, and turns only
 * the unsafe parts into `never`, so the error names the property that cannot
 * travel.
 *
 * What a type cannot see, the runtime still checks: a number that is not
 * finite, a cycle, a class instance whose fields happen to be all data. Those
 * fail that one card when it is encoded, not the whole dashboard.
 *
 * @module domains/widgets/declaration/transportable
 */

/** A value JSON writes and reads back as itself. */
export type TransportablePrimitive = string | number | boolean | null;

/**
 * `T` with every part JSON would change replaced by `never`.
 *
 * Used as an F-bound, `D extends Transportable<D>`: a safe type maps to itself,
 * so it satisfies the bound, and an unsafe one maps to a type it is not
 * assignable to.
 *
 * - A function, and so any object with a method (`Date`, `Map`, `Set`), maps
 *   to `never` at that property.
 * - `undefined` maps to `never`. An OPTIONAL property stays allowed, because
 *   the mapping keeps the `?`, and JSON leaving out an absent key is no change
 *   at all; a required property typed `T | undefined` loses its `undefined`,
 *   since the browser would find the key missing.
 * - `bigint` and `symbol` are neither primitives JSON writes nor objects, so
 *   they fall to `never` too: `JSON.stringify` throws on the first and drops
 *   the second.
 */
export type Transportable<T> = T extends TransportablePrimitive
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? { [K in keyof T]: Transportable<T[K]> }
      : never;

/**
 * A value already known to be transportable, as core's read services hand rows
 * back.
 *
 * A row read from the database has passed through the same encoding, so it is
 * typed as what it is. A data function can then answer rows it read without
 * restating their type, and still cannot add a `Date` to one.
 */
export type TransportableValue =
  | TransportablePrimitive
  | readonly TransportableValue[]
  | { readonly [key: string]: TransportableValue };
