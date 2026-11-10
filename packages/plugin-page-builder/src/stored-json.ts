/**
 * Reading a `json` column back without depending on which dialect stored it.
 *
 * The runtime schema builds a `json` field as `jsonb` on Postgres and `json` on
 * MySQL, whose drivers hand back a parsed value, and as plain `text` on SQLite,
 * whose driver hands back the string it stored. So the shape a reader is given
 * is a property of the DEPLOYMENT, not of the data, and code that assumes one
 * of them is correct on some databases and silently wrong on others.
 *
 * Silently is the operative word, and it is why this is a module rather than a
 * guard written twice. Both readers of these columns fail in the direction that
 * looks like a valid answer: a class-reference walk reports that a page
 * references nothing, and a record comparison reports that every page's record
 * disagrees. Neither raises, and the first is the direction that gets a live
 * class deleted.
 *
 * @module stored-json
 */

/**
 * A stored column value as the document it holds, whichever shape it arrives
 * in.
 *
 * Answers rather than throwing for text that is not JSON. Callers run inside a
 * write hook, where raising would fail an author's save over a bookkeeping
 * field, and a column holding unparseable text holds nothing a reader can act
 * on either way.
 */
export function readStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * A JSON value with every object's keys in one order, so two values holding
 * the same thing compare equal however they were stored: Postgres `jsonb`
 * reorders keys, and an unchanged set sent back by a form must not read as a
 * change.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/** Whether two stored values hold the same thing, whatever their key order. */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(canonical(a ?? null)) ===
    JSON.stringify(canonical(b ?? null))
  );
}
