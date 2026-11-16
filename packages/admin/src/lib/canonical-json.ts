/**
 * JSON with every object's keys in order, so two values that hold the same
 * thing compare equal whatever order their keys were written in.
 *
 * One spelling for every admin comparison of stored values: a widget setting
 * against its default, and a recovery point against the document it would
 * replace.
 *
 * @module lib/canonical-json
 */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as JSON, every object's keys sorted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isPlainRecord(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map(key => [key, inner[key]])
        )
      : inner
  );
}
