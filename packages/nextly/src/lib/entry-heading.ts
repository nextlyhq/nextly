/**
 * The label an entry is shown under, from whatever its collection nominated.
 *
 * `admin.useAsTitle` names a FIELD, and schema validation checks only that the
 * field exists -- never that it holds a primitive. `json`, `group`, `repeater`,
 * `component` and `chips` all arrive here as objects or arrays, and `String()`
 * on one of those renders `[object Object]`: a heading that says nothing, on
 * every surface whose job is to name the entry.
 *
 * So the candidates are narrowed by `typeof` before anything is stringified,
 * which is the rule the surrounding code already states -- every branch that
 * reaches `String()` must already be known to be a real primitive.
 *
 * One module rather than one per surface. The activity feed and the dashboard's
 * recent-entries list answer the same question about the same fields, and two
 * implementations of it would disagree about which entry is which depending on
 * where you read it.
 *
 * @module lib/entry-heading
 */

/**
 * The first candidate that is a usable heading, else `fallback`.
 *
 * Candidates, in descending preference: the collection's configured title
 * field, then a `title` field, then a `name` field. An absent `titleField`
 * simply starts the walk at `title`.
 *
 * An EMPTY string is skipped rather than returned. `??` only skips `null` and
 * `undefined`, so an untitled draft used to render as no heading at all --
 * indistinguishable from a row that failed to load.
 *
 * `fallback` is generic so a caller supplying a string gets `string` back and
 * one supplying `undefined` keeps the option of having no heading. The activity
 * feed needs the second: a delete row outlives the entry it names, and it may
 * legitimately have nothing to call it.
 */
export function entryHeading<TFallback extends string | undefined>(
  data: Record<string, unknown>,
  titleField: string | null | undefined,
  fallback: TFallback
): string | TFallback {
  const candidates = [
    titleField ? data[titleField] : undefined,
    data.title,
    data.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    if (typeof candidate === "number" || typeof candidate === "bigint") {
      return String(candidate);
    }
  }
  return fallback;
}
