/**
 * Detached copies of document data for callbacks that decide rather than
 * transform.
 *
 * @module shared/lib/detach
 */

/**
 * Copy plain containers deeply, pass everything else through by reference.
 *
 * Access callbacks are app code and receive the data as an argument, so handing
 * them the live object lets a callback rewrite what it was only asked to judge.
 * A shallow copy is not enough — every nested group, repeater, component and
 * expanded relation stays shared.
 *
 * `structuredClone` is the obvious tool and the wrong one here: it throws on a
 * value it cannot clone, and a document may legitimately carry one. A JSON
 * field whose value defines `toJSON()` to choose its stored representation is
 * supported, and a payload containing one would fail the read or write outright
 * rather than reaching validation. A copy that isolates containers and leaves
 * exotic values alone cannot throw, and containers are the whole exposure: a
 * callback rewrites a response by reaching into a nested object, not by
 * replacing a function.
 *
 * A class instance is passed by reference, deliberately. Copying one means
 * reconstructing it from its own enumerable properties, which silently discards
 * whatever lives in private fields or internal slots — turning a callback that
 * misbehaves into data that is quietly wrong, which is the worse failure. Map
 * and Set are copied because their state is reachable and their reconstruction
 * is exact.
 */
export function detachData<T>(value: T): T {
  return detachValue(value, new WeakMap()) as T;
}

/**
 * `seen` does two jobs: it terminates on a cycle, which a hook is free to
 * create, and it preserves identity — a value reachable by two paths stays one
 * object in the copy, so a callback comparing them by reference still sees what
 * the document says.
 */
/**
 * Carry a collection's own properties onto its copy.
 *
 * A `Map` or `Set` can hold state beyond its entries, and a rule reading one of
 * those properties would otherwise be shown a collection missing it.
 */
function copyOwnProperties(
  source: object,
  target: object,
  seen: WeakMap<object, unknown>
): void {
  // Symbol keys too: metadata is often attached under one, and dropping it
  // shows a rule a collection without the state it was meant to decide on.
  const keys: (string | symbol)[] = [
    ...Object.keys(source),
    ...Object.getOwnPropertySymbols(source).filter(
      symbol => Object.getOwnPropertyDescriptor(source, symbol)?.enumerable
    ),
  ];
  for (const key of keys) {
    // Defined rather than assigned. Assignment resolves the target's inherited
    // accessors — a `size` own property on a Map would hit the prototype's
    // getter-only `size` and throw — and a `__proto__` key would repoint the
    // copy's prototype instead of becoming a property on it. Reading the
    // descriptor also leaves any getter on the source uninvoked.
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    Object.defineProperty(
      target,
      key,
      "value" in descriptor
        ? { ...descriptor, value: detachValue(descriptor.value, seen) }
        : descriptor
    );
  }
}

function detachValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (!value || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    // Length first, then only the indices that exist: iterating fills holes
    // with `undefined`, which a callback testing `0 in items` can tell apart
    // from the array it was given.
    const copy: unknown[] = new Array(value.length) as unknown[];
    seen.set(value, copy);
    // Keys as they are: `"01"` and `"1"` both coerce to the number 1, so
    // keying off that would let a decoration overwrite a real element.
    copyOwnProperties(value, copy, seen);
    return copy;
  }

  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    seen.set(value, copy);
    return copy;
  }

  // Exact prototypes only. A subclass of Map or Set carries behaviour and
  // private state that rebuilding as the base collection would discard, and the
  // rule for such a value is the same as for any other class instance: pass it
  // through untouched.
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (value instanceof Map && prototype === Map.prototype) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    // Keys are copied too: a mutable object used as a key is as reachable, and
    // as writable, as the value it points at.
    for (const [key, entry] of value) {
      copy.set(detachValue(key, seen), detachValue(entry, seen));
    }
    copyOwnProperties(value, copy, seen);
    return copy;
  }

  if (value instanceof Set && prototype === Set.prototype) {
    const copy = new Set<unknown>();
    seen.set(value, copy);
    for (const entry of value) copy.add(detachValue(entry, seen));
    copyOwnProperties(value, copy, seen);
    return copy;
  }

  // Plain objects only, on the same reasoning.
  if (prototype !== Object.prototype && prototype !== null) return value;

  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, entry] of Object.entries(value)) {
    out[key] = detachValue(entry, seen);
  }
  return out;
}
