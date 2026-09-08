/**
 * The value a widget store actually holds: a detached, frozen copy.
 *
 * One implementation, because the registry and the source store ask the same
 * question of the same kind of value. Keeping a caller's object by reference
 * makes every gate in either module optional: validation ran at registration
 * and a plugin that still holds the object can edit it afterwards, so a widget
 * definition's archetype or `component`, or a source's `fields` allowlist, can
 * change with nothing revalidating them.
 *
 * DETACHED and FROZEN, because either alone leaves a way in: a copy handed back
 * unfrozen is mutated through the getter, and a frozen original is still the
 * caller's object to keep a reference into. Frozen also means the getters can
 * return the stored value directly rather than copying per read.
 *
 * `structuredClone` is available because both are DATA by construction -- the
 * module contract is that a host reads a widget definition without executing
 * the plugin that declared it, and a source is ids, labels and `{ name, type }`
 * pairs. It throws on a function, symbol or class instance, which is a value
 * that already violated that contract.
 *
 * `blocks-engine`'s registry stores by reference in the same way and is
 * deliberately left alone: a `BlockDefinition` may carry a `markProp` FUNCTION,
 * so it is not structured-cloneable and this does not transfer.
 *
 * @module domains/widgets/detached-snapshot
 */

/** Freezes an object and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * A frozen deep copy of `value`, or whatever `refuse` throws when it carries
 * something `structuredClone` cannot hold.
 *
 * The refusal is the CALLER's, rather than one message shared by both stores.
 * A definition and a source fail for the same mechanical reason and mean
 * different things to the author reading the error, and `structuredClone`'s own
 * `DOMException` is outside the `NextlyError` contract either way -- so each
 * store names its own subject and this names none.
 */
export function detachedSnapshot<T>(value: T, refuse: () => never): T {
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    refuse();
  }
}
