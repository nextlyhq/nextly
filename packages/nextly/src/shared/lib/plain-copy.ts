/**
 * Copies of configuration values that plugin code is handed.
 *
 * Configuration is a tree of plain objects and arrays with behaviour hung on
 * it: a hook, a validator, a component. When plugin code receives part of it,
 * an edit the code makes to what it received must not reach the object core
 * goes on reading. The copy rebuilds every plain object and array, and keeps
 * everything else by reference: a function is behaviour rather than data, and
 * an instance of a class (a `Date`, a schema object, a store) cannot be
 * rebuilt as a bare object without losing the prototype its methods live on.
 *
 * A rebuilt object carries every enumerable own property of the original,
 * symbol-keyed as well as string-keyed. A symbol key is how a value is marked
 * without the mark showing up in `Object.keys` or `JSON.stringify` (the brand
 * `pluginField()` puts on a field declaration is one), and the copy has to
 * keep it: code handed the copy reads the mark to decide what the value is,
 * and a copy a `setup` transformer returns becomes the configuration the boot
 * goes on with. A non-enumerable property is left out, whichever kind its key
 * is, as an object spread would leave it out.
 *
 * An accessor is read once, while copying, and the copy holds the value it
 * returned. A getter that answers differently on a later read therefore
 * cannot change what the copy says.
 *
 * @module shared/lib/plain-copy
 */
import { defineOwnProperty } from "./own-property";

/** Whether a value is a `{}` literal or a null-prototype object. */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Anything that can be called or constructed. */
type Callable =
  | ((...args: never[]) => unknown)
  | (abstract new (...args: never[]) => unknown);

/**
 * The built-in classes whose instances turn up in configuration. The copy
 * keeps such an instance by reference and does not freeze it, so the type
 * leaves it as it is: a `Date` stays a `Date` with its setters, a `Map` keeps
 * `set`.
 */
type KeptInstance =
  | Date
  | RegExp
  | Error
  | Promise<unknown>
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | ArrayBuffer
  | ArrayBufferView;

/**
 * @experimental The type of an object or array `copyPlainValues(value, { freeze: true })`
 * returns: every array a `readonly` array of frozen elements, every object's
 * properties `readonly`, all the way down, symbol keys included. A write the
 * type allowed would throw at runtime, because the copy is frozen.
 *
 * What the copy keeps by reference the type keeps as it is (`FrozenValue`):
 * a function (a hook, a validator, a component) stays callable with its own
 * signature, and a built-in instance (`KeptInstance`) keeps its methods. The
 * type cannot tell any other class instance from a plain object, since both
 * are only a shape to it, so a store or a schema object reads as readonly
 * here although the copy holds the original unfrozen. That errs towards
 * refusing a write the runtime would allow, never towards allowing one it
 * refuses.
 *
 * A mapped type at the top rather than a conditional one, because a mapped
 * type keeps its name where the compiler writes it out. A plugin's emitted
 * declarations then say `FrozenCopy<UsersConfig>` instead of spelling the
 * structure out, which would need the symbol keys a field declaration
 * carries (`pluginUserField()`'s brand), and those have no name a plugin's
 * declaration file can import.
 */
export type FrozenCopy<T> = {
  readonly [K in keyof T]: FrozenValue<T[K]>;
};

/**
 * @experimental One value inside a `FrozenCopy`: `any` stays `any`, a function or built-in
 * instance stays as it is, any other object is a `FrozenCopy` in turn, and
 * anything not an object (`unknown` included) is left as it is.
 *
 * Exported beside `FrozenCopy` because each property of a `FrozenCopy` is a
 * `FrozenValue`, so a plugin's emitted declarations can need to name it.
 */
export type FrozenValue<V> = 0 extends 1 & V
  ? V
  : V extends Callable | KeptInstance
    ? V
    : V extends object
      ? FrozenCopy<V>
      : V;

/** How `copyPlainValues` builds the copy. */
export interface PlainCopyOptions {
  /** Freeze every object and array the copy builds. Default false. */
  freeze?: boolean;
}

/**
 * A copy of `value` in which every plain object and array is new, and
 * frozen when `options.freeze` is set, including the values under symbol
 * keys. Functions and other objects are kept by reference.
 *
 * A container reached twice is copied once, so shared structure stays shared
 * in the copy and a cycle does not recurse forever.
 */
export function copyPlainValues<T>(
  value: T,
  options: PlainCopyOptions = {}
): T {
  const copies = new Map<object, unknown>();
  const finish = <C extends object>(built: C): C =>
    options.freeze ? Object.freeze(built) : built;
  const copy = (current: unknown): unknown => {
    if (!Array.isArray(current) && !isPlainObject(current)) return current;
    const seen = copies.get(current);
    if (seen !== undefined) return seen;
    return Array.isArray(current)
      ? finish(copyArray(current, copies, copy))
      : finish(copyRecord(current, copies, copy));
  };
  return copy(value) as T;
}

/**
 * A new array of `source`'s elements, each passed through `copy`. The array is
 * recorded in `copies` before its elements are copied, so an element that
 * leads back to `source` finds the array rather than recursing.
 */
function copyArray(
  source: readonly unknown[],
  copies: Map<object, unknown>,
  copy: (current: unknown) => unknown
): unknown[] {
  const items: unknown[] = [];
  copies.set(source, items);
  for (const item of source) items.push(copy(item));
  return items;
}

/**
 * A new object holding `source`'s enumerable own properties, symbol-keyed
 * ones included, each value passed through `copy`. Recorded in `copies`
 * before its values are copied, as `copyArray` does.
 */
function copyRecord(
  source: Record<string, unknown>,
  copies: Map<object, unknown>,
  copy: (current: unknown) => unknown
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  copies.set(source, record);
  // `Reflect.ownKeys` lists string keys in the order `Object.keys` does and
  // then the symbols, so one loop copies both kinds; the enumerability
  // filter is what `Object.keys` applied to strings alone.
  for (const key of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
    defineOwnProperty(record, key, copy(Reflect.get(source, key)));
  }
  return record;
}
