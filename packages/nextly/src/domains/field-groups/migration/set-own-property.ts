/**
 * Assigns a key onto a rebuilt JSON object without letting the key decide how.
 *
 * The rewriters here rebuild objects key by key so a renamed property keeps its
 * position. Plain assignment is wrong for that: `__proto__` is an accessor
 * inherited from `Object.prototype`, so `target.__proto__ = value` runs its
 * setter instead of creating an own property — the key vanishes from the
 * rewritten document, and a migration that persists the result has silently
 * dropped author data.
 *
 * It is reachable rather than theoretical. `JSON.parse` creates `__proto__` as
 * an ordinary own property, so any stored document whose JSON contained that key
 * arrives carrying one, and every one of these columns is parsed JSON.
 *
 * Defining the property rather than switching the whole object to a null
 * prototype keeps the result an ordinary object for every consumer — equality
 * checks, serialization, and the `in` tests these rewriters do — and fixes only
 * the thing that was broken.
 *
 * @module domains/field-groups/migration/set-own-property
 */

/** Set `key` on `target` as an own, enumerable property, whatever `key` is. */
export function setOwnProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
