/**
 * Place one field's value into a copy of the document that holds it.
 *
 * A recovery point is the WHOLE document as the editor believes it stands, so a
 * surface recording its own live state has to merge that state over everything
 * else the form is holding. A field's path is not always a top-level key —
 * inside a group, a component or a repeatable it arrives dotted
 * (`hero.layout`, `sections.2.layout`) — and writing that string as a literal
 * key would store a snapshot whose restore leaves the real field untouched and
 * adds a stray one nobody reads.
 *
 * Copies only the containers along the path. Everything else is shared with the
 * original, which is what a snapshot wants: it is serialised immediately and
 * never mutated.
 *
 * @module @nextlyhq/plugin-page-builder/admin/snapshot-merge
 */

/** A path segment that addresses a position in an array rather than a key. */
function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * A container to write the next segment into.
 *
 * Reuses what is already there when it is the right shape, and otherwise makes
 * a fresh one — a path can legitimately run through a value the form has not
 * created yet, and refusing there would drop the recording for a field the
 * author is actively editing.
 */
function containerFor(
  current: unknown,
  nextSegment: string
): unknown[] | Record<string, unknown> {
  if (isIndex(nextSegment)) {
    return Array.isArray(current) ? [...current] : [];
  }
  return typeof current === "object" &&
    current !== null &&
    !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
}

/**
 * @param values - the form's current values
 * @param path - the field's RHF path, dotted for anything nested
 * @param value - what to place there
 * @returns a copy of `values` with `path` set to `value`
 */
export function withValueAtPath(
  values: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const segments = path.split(".").filter(segment => segment.length > 0);
  if (segments.length === 0) return { ...values };

  const root = { ...values };
  let cursor: unknown[] | Record<string, unknown> = root;

  /** Read one segment from whichever container kind the cursor is on. */
  function read(
    container: unknown[] | Record<string, unknown>,
    segment: string
  ) {
    return Array.isArray(container)
      ? container[Number(segment)]
      : container[segment];
  }

  /** Write one segment, likewise. */
  function write(
    container: unknown[] | Record<string, unknown>,
    segment: string,
    next: unknown
  ) {
    if (Array.isArray(container)) container[Number(segment)] = next;
    else container[segment] = next;
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const child = containerFor(read(cursor, segment), segments[i + 1]);
    write(cursor, segment, child);
    cursor = child;
  }

  write(cursor, segments[segments.length - 1], value);

  return root;
}
