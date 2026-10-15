/**
 * Reading a person named by kind and id (`PrincipalRef`) from what a plugin
 * passed.
 *
 * Where a plugin names a person for a record (an audit row, a deletion
 * report), core keeps the kind and the id and nothing else, and refuses a
 * value that could not name one: a JavaScript plugin has no types, and a kind
 * without its `<plugin>:` prefix could read as one of core's own actor kinds.
 *
 * @module plugins/principals/ref
 */
import { MAX_PRINCIPAL_ID_LENGTH } from "./recognise";
import type { PrincipalRef } from "./types";

/**
 * A kind's full name, as core gives it: the plugin's slug, a colon, and the
 * name the plugin registered (`[a-z][a-z0-9-]{0,31}`).
 */
const FULL_KIND = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z][a-z0-9-]{0,31}$/;

/**
 * The kind and id of `value`, copied, or `null` when it cannot name a person:
 * not an object, a kind not of the full form, or an id that is not a string
 * of 1 to 128 characters. A `Principal` names its person.
 */
export function principalRefOf(value: unknown): PrincipalRef | null {
  if (typeof value !== "object" || value === null) return null;
  let kind: unknown;
  let id: unknown;
  try {
    // Read once each: an accessor could answer differently a second time.
    ({ kind, id } = value as { kind?: unknown; id?: unknown });
  } catch {
    return null;
  }
  if (typeof kind !== "string" || !FULL_KIND.test(kind)) return null;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > MAX_PRINCIPAL_ID_LENGTH
  ) {
    return null;
  }
  return { kind, id };
}
