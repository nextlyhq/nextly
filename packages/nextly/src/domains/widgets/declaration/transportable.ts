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

/**
 * Why a value would not reach the browser as itself, or `undefined` when it
 * would: the run-time half of {@link Transportable}, for what no type saw (a
 * plain JavaScript declaration's example, and anything built at run time).
 *
 * The same rules: strings, booleans, null, finite numbers, arrays and plain
 * objects, with an absent (`undefined`) property allowed because JSON leaving
 * it out changes nothing. A cycle is refused, since `JSON.stringify` throws on
 * one, and so is any object that is not plain (`Date`, `Map`, a class
 * instance), which JSON would turn into something else.
 */
export function transportableProblem(value: unknown): string | undefined {
  return problemAt(value, "the value", new Set());
}

function problemAt(
  value: unknown,
  at: string,
  ancestors: Set<object>
): string | undefined {
  if (value === null) return undefined;
  switch (typeof value) {
    case "string":
    case "boolean":
      return undefined;
    case "number":
      return Number.isFinite(value) ? undefined : `${at} is ${String(value)}`;
    case "object":
      return objectProblem(value, at, ancestors);
    default:
      // bigint, symbol, function and undefined (in an array, or on its own).
      return `${at} is a ${typeof value}`;
  }
}

function objectProblem(
  value: object,
  at: string,
  ancestors: Set<object>
): string | undefined {
  if (ancestors.has(value)) return `${at} refers back to itself`;
  const notPlain = notPlainProblem(value, at);
  if (notPlain !== undefined) return notPlain;
  ancestors.add(value);
  try {
    for (const [key, item] of childrenOf(value)) {
      const problem = problemAt(item, `${at}${key}`, ancestors);
      if (problem !== undefined) return problem;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

/** Why an object is not an array or a plain object, which JSON keeps. */
function notPlainProblem(value: object, at: string): string | undefined {
  if (Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return undefined;
  return `${at} is a ${value.constructor?.name ?? "non-plain object"}`;
}

/**
 * An array's items and an object's properties, each with how a fault names
 * it. An object's absent (`undefined`) property is left out, as JSON leaves
 * it; an array's is kept, since JSON turns it into `null`.
 */
function childrenOf(value: object): [string, unknown][] {
  if (Array.isArray(value)) {
    // By `length` and index, as `JSON.stringify` reads an array: neither a
    // sparse array's holes nor an iterator the array overrides change what
    // it is judged on. A hole reads as `undefined`, which JSON writes as
    // `null`, so it is refused like any other `undefined` in an array.
    const items: readonly unknown[] = value;
    const children: [string, unknown][] = [];
    for (let index = 0; index < items.length; index += 1) {
      children.push([`[${index}]`, items[index]]);
    }
    return children;
  }
  return Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [`.${key}`, item]);
}
