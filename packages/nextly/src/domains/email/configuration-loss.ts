/**
 * Whether serialising a parsed configuration LOST anything.
 *
 * The stored configuration is its serialisation, so a value JSON can only
 * carry as text is COERCED rather than refused: a `Date` becoming an ISO
 * string keeps the information, and that cost is deliberate.
 *
 * Loss is a different thing and is not permitted, because it corrupts a
 * configuration rather than restyling it. It arrives in two shapes, and one
 * question cannot answer both:
 *
 *   - a KEY disappears. JSON drops an `undefined` value and an array's named
 *     properties, so `{ label: undefined }` and `Object.assign([], {region})`
 *     reach the column smaller than they left.
 *   - the key SURVIVES and its CONTENT vanishes. A `Map`, a `Set` or a class
 *     instance keeps its data somewhere `JSON.stringify` cannot reach, so it
 *     serialises to `{}` while reporting no own enumerable keys to compare.
 *
 * Separating those from coercion is the whole job. Refusing everything that
 * changes shape is the old guard, which refused the `Date` this decision
 * accepts; accepting everything that serialises misses both shapes above.
 *
 * @module domains/email/configuration-loss
 */

/**
 * Whether a value keeps its data in its OWN enumerable properties.
 *
 * This is the property that decides whether serialisation can see everything
 * a value holds, and it is asked structurally rather than by constructor name:
 * a plain object and an array expose their contents as own properties, while
 * a `Map`, a `Set` or a class with private fields does not, whatever it is
 * called. A null-prototype object counts, because its data is still its own
 * properties.
 */
function keepsDataInOwnProperties(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/** A readable path to the field that lost something. */
function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

/**
 * The first thing serialisation lost, as a path, or null when nothing was.
 *
 * `parsed` is what `parseConfig` returned; `stored` is what the column will
 * hold, which the caller obtains by serialising and re-parsing rather than by
 * inspecting. Comparing those two is what makes the question answerable at
 * all: the loss is only visible across that boundary.
 */
export function findConfigurationLoss(
  parsed: unknown,
  stored: unknown,
  path = ""
): string | null {
  // A primitive on the parsed side cannot have lost anything: it had no parts.
  if (parsed === null || typeof parsed !== "object") return null;

  // COERCION, and the case this module exists to permit. An object that
  // serialises to a primitive was flattened rather than emptied -- a `Date`
  // becoming its ISO string is the example the decision names. The
  // information survives in a form the column can hold, so this is where the
  // walk stops rather than where it complains.
  if (stored === null || typeof stored !== "object") return null;

  // CONTENT LOSS. The value holds data somewhere serialisation cannot reach,
  // and it still produced an object, so nothing downstream will notice. Asked
  // before the key comparison because such a value reports no own keys at
  // all: comparing key sets would find `{}` against `{}` and pass it.
  if (!keepsDataInOwnProperties(parsed)) {
    return path === "" ? "the configuration" : path;
  }

  // KEY LOSS, recursively. Every own enumerable key on the parsed side must
  // survive into the stored form. A function-valued key is exempt: JSON drops
  // it by design and no configuration can carry behaviour into a column, so
  // reporting it would refuse the ordinary `toJSON` idiom rather than the
  // discarding one -- which is caught anyway by the keys it discards.
  const storedRecord = stored as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "function") continue;

    if (!(key in storedRecord)) return join(path, key);

    const deeper = findConfigurationLoss(
      value,
      storedRecord[key],
      join(path, key)
    );
    if (deeper !== null) return deeper;
  }

  return null;
}
