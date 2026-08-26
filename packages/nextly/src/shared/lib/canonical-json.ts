/**
 * A stable serialisation of a stored value, for deciding whether it changed.
 *
 * Object keys are sorted at every depth, so key ORDER is not content: a
 * serializer upgrade that merely reorders exported properties, or a database
 * that normalises key order on the way out, must not read as an edit. Arrays
 * keep their order, which IS content — an author who reorders a list changed
 * something.
 *
 * Shared rather than per-caller because several places ask exactly this
 * question — the rich-text and source comparisons, and any registry deciding
 * whether stored config still matches what the code declares. Two
 * implementations of it would agree on the day they were written and drift
 * after, and the drift would be silent because each looks correct beside its
 * own caller.
 *
 * @module shared/lib/canonical-json
 */

/**
 * Rebuild a value with its object keys sorted at every depth.
 *
 * The rebuilt objects have a NULL prototype, which is what makes an own
 * `"__proto__"` key survive. Assigning that key to an ordinary `{}` invokes the
 * legacy prototype setter instead of creating an enumerable property, so
 * `JSON.stringify` omits it — and two values differing only under `__proto__`
 * would serialise identically and be reported unchanged.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalise(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * The canonical serialisation of a value, or `undefined` for a value JSON has
 * no representation for.
 *
 * `undefined` is returned rather than thrown so a caller can compare two
 * unrepresentable values as equal-to-each-other without special-casing, and a
 * caller that needs to REFUSE such a value can test for it.
 */
export function canonicalJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(canonicalise(value));
  } catch {
    // A cyclic value. Nothing can be claimed about it.
    return undefined;
  }
}
