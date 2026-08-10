/**
 * Writing a key onto a rebuilt object without going through the prototype.
 *
 * Several places rebuild an object key by key: detaching a field for plugin
 * code, stripping denied paths out of a webhook envelope, masking secrets in a
 * version diff, pruning a restored snapshot. All of them read keys from data
 * they do not control — a JSON column, a stored snapshot, a submitted
 * declaration — and all of them write into a fresh `{}`.
 *
 * Plain assignment is wrong for that. `{}` inherits `Object.prototype`, whose
 * `__proto__` is an accessor, so `out["__proto__"] = v` repoints the copy's
 * prototype instead of creating a property. The key then vanishes from the
 * result, which is silent data loss, and the copy carries a prototype it was
 * never meant to have. `JSON.parse` produces `__proto__` as an ordinary own
 * property, so any stored JSON value can carry one.
 *
 * @module shared/lib/own-property
 */

/**
 * Define `key` on `target` as an own, plain data property.
 *
 * Mirrors what assignment is meant to do — enumerable, writable, configurable —
 * without consulting the prototype chain for an accessor.
 */
export function defineOwnProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Whether `target` itself declares `key`.
 *
 * `key in target` answers for the whole prototype chain, so `constructor` and
 * `toString` read as present on any `{}`.
 */
export function hasOwnProperty(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}
