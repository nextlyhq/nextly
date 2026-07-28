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
 */
export function detachData<T>(value: T): T {
  return detachValue(value) as T;
}

function detachValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(detachValue);
  if (value instanceof Date) return new Date(value.getTime());
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
