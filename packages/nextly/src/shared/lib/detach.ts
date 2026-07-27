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
  return detachValue(value) as T;
}

function detachValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(detachValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) {
    return new Map(
      Array.from(value, ([key, entry]) => [key, detachValue(entry)])
    );
  }
  if (value instanceof Set) {
    return new Set(Array.from(value, detachValue));
  }
  if (!value || typeof value !== "object") return value;

  // Plain objects only. A class instance carries behaviour that copying would
  // strip, and it is not the shape a callback mutates its way through.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = detachValue(entry);
  }
  return out;
}
