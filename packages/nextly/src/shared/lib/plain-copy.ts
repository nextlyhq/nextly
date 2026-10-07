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

/** How `copyPlainValues` builds the copy. */
export interface PlainCopyOptions {
  /** Freeze every object and array the copy builds. Default false. */
  freeze?: boolean;
}

/**
 * A copy of `value` in which every plain object and array is new, and
 * frozen when `options.freeze` is set. Functions and other objects are kept
 * by reference.
 *
 * A container reached twice is copied once, so shared structure stays shared
 * in the copy and a cycle does not recurse forever.
 */
export function copyPlainValues<T>(
  value: T,
  options: PlainCopyOptions = {}
): T {
  const copies = new Map<object, unknown>();
  const copy = (current: unknown): unknown => {
    if (!Array.isArray(current) && !isPlainObject(current)) return current;
    const seen = copies.get(current);
    if (seen !== undefined) return seen;
    if (Array.isArray(current)) {
      const items: unknown[] = [];
      copies.set(current, items);
      for (const item of current) items.push(copy(item));
      return options.freeze ? Object.freeze(items) : items;
    }
    const record: Record<string, unknown> = {};
    copies.set(current, record);
    for (const key of Object.keys(current)) {
      defineOwnProperty(record, key, copy(current[key]));
    }
    return options.freeze ? Object.freeze(record) : record;
  };
  return copy(value) as T;
}
