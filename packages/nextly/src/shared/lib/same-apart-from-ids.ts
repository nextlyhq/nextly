/**
 * Whether two rows hold the same values once every `id` key is set aside:
 * the test by which a row sent without its id is known to be the stored row
 * at its place, for its id and for the passwords it keeps.
 *
 * @module shared/lib/same-apart-from-ids
 */
import { deepEqual } from "./deep-equal";

/**
 * Whether a sent row holds what the stored one does, once every `id` key is
 * set aside at every depth. A key holding `undefined` counts as absent, as
 * storing the value as JSON leaves it out.
 */
export function sameApartFromIds(sent: unknown, stored: unknown): boolean {
  return deepEqual(withoutIds(sent), withoutIds(stored));
}

/** A copy of `value` with every `id` key, and every `undefined` value, left out. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (typeof value !== "object" || value === null || value instanceof Date) {
    return value;
  }
  // A null prototype, so an own `__proto__` key is copied as a key and
  // compared, rather than setting the copy's prototype and dropping out.
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    if (key === "id" || child === undefined) continue;
    out[key] = withoutIds(child);
  }
  return out;
}
