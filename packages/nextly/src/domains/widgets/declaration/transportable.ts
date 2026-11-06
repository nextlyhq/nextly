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
 * - A property KEYED by a symbol maps to `never` as well, whatever its value:
 *   JSON drops the key with its value, so the browser would find nothing
 *   where the server's type promised something (`TransportableFields`).
 */
export type Transportable<T> = T extends TransportablePrimitive
  ? T
  : KnownTransportable<T> extends true
    ? T
    : T extends (...args: never[]) => unknown
      ? never
      : T extends object
        ? TransportableFields<T>
        : never;

/**
 * Whether `T` is exactly one of {@link TransportableValue}'s own object members: transportable by
 * definition, so judged no further.
 *
 * 🔴 Stops the recursion, not only the work: a row a read service handed back is typed
 * `{ readonly [field: string]: TransportableValue }`, and mapping that member's values maps the
 * same union again, without end. Answering such rows as a list's items failed to compile as an
 * instantiation "excessively deep", though nothing in them could fail to travel. Exactly, not
 * assignably: an object with a symbol-keyed property is assignable to the string-keyed member,
 * and must still be judged key by key.
 */
type KnownTransportable<T> =
  Same<T, { readonly [key: string]: TransportableValue }> extends true
    ? true
    : Same<T, readonly TransportableValue[]>;

/** Whether two types are each assignable to the other, undistributed. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * An object's properties, each mapped by {@link Transportable}, with a
 * symbol-keyed one mapped to `never`.
 *
 * 🔴 The KEY is judged as well as the value, because a mapped type keeps every
 * key `keyof` names, symbols included: `{ [K in keyof T]: … }` alone passed
 * `{ [tag]: "paid" }`, whose value is safe and whose key JSON throws away. One
 * type for both places a data function's answer is judged, the answer itself
 * (`defineWidget`'s bound on `Data`) and every object inside it, so the two
 * cannot disagree about which keys travel.
 */
export type TransportableFields<T> = {
  [K in keyof T]: K extends symbol ? never : Transportable<T[K]>;
};

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
  // The run-time half of `TransportableFields`' key rule: `JSON.stringify`
  // skips an enumerable symbol-keyed property without a word, as it skips a
  // non-enumerable one, so only the enumerable ones are data the author meant
  // to send.
  const symbolKey = Object.getOwnPropertySymbols(value).find(key =>
    Object.prototype.propertyIsEnumerable.call(value, key)
  );
  if (symbolKey !== undefined) {
    return `${at} has a property keyed by ${String(symbolKey)}, which JSON drops`;
  }
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

/**
 * `value` as JSON carries it to the browser: a date as its ISO string, an
 * absent property left out. What core's own reads answer is sent this way, so
 * a data function handed rows as they would arrive can answer them unchanged.
 * Throws as `JSON.stringify` does, on a cycle or a bigint.
 */
export function sentAsJson(value: unknown): TransportableValue {
  const text = JSON.stringify(value);
  // `undefined` alone is what `JSON.stringify` answers with no text: JSON has
  // no value for it, so the browser would receive nothing, which is `null`.
  return text === undefined ? null : (JSON.parse(text) as TransportableValue);
}

/** One row of fields as JSON carries it: an object of transportable values. */
export type TransportableRow = { readonly [field: string]: TransportableValue };

/**
 * The rows among `sent`, a list as {@link sentAsJson} answers it: each entry
 * that arrived as an object of fields, never a list or a lone value. Nothing
 * when `sent` is not a list at all.
 */
export function sentRows(sent: TransportableValue): TransportableRow[] {
  if (!Array.isArray(sent)) return [];
  const entries: readonly TransportableValue[] = sent;
  return entries.filter(
    (value): value is TransportableRow =>
      typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
