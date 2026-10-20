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
import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";

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

/**
 * The kind a staff user takes wherever a record names a person by kind and
 * id, as an audit row names one. No plugin kind can be spelled this way, since
 * every plugin kind holds a colon.
 */
export const STAFF_PERSON_KIND = "staff";

/**
 * The longest staff user id a delivery record can name: the narrowest column
 * a record keeps an id in. A staff user's id is not bound by the 128 characters
 * a plugin-defined person's is, and `users.id` is unbounded text on
 * PostgreSQL and SQLite, so this is the bound that decides. Read from the
 * columns rather than restated, so a column changed later moves it.
 */
export const STAFF_PERSON_ID_MAX_LENGTH = Math.min(
  ...[emailDeliveriesPg.principalId, emailDeliveriesMysql.principalId].map(
    column => {
      const length = (column as { length?: number }).length;
      return typeof length === "number" ? length : Number.MAX_SAFE_INTEGER;
    }
  )
);

/** A staff user, named by kind and id for a record that names a person. */
export function staffPerson(userId: string): PrincipalRef {
  return { kind: STAFF_PERSON_KIND, id: userId };
}

/**
 * The staff user `value` names, copied, or `null` when it names no staff
 * user: not an object, another kind, or an id that is not a string a delivery
 * record can hold (1 to `STAFF_PERSON_ID_MAX_LENGTH` characters). Whether that
 * user exists is the caller's to ask.
 */
export function staffPersonOf(value: unknown): PrincipalRef | null {
  if (typeof value !== "object" || value === null) return null;
  let kind: unknown;
  let id: unknown;
  try {
    // Read once each, as principalRefOf does.
    ({ kind, id } = value as { kind?: unknown; id?: unknown });
  } catch {
    return null;
  }
  if (kind !== STAFF_PERSON_KIND) return null;
  if (!isStaffPersonId(id)) return null;
  return staffPerson(id);
}

/** Whether `id` is one a delivery record can name a staff user by. */
export function isStaffPersonId(id: unknown): id is string {
  // In characters, as `varchar(191)` counts them, not in UTF-16 units.
  return (
    typeof id === "string" &&
    id.length > 0 &&
    [...id].length <= STAFF_PERSON_ID_MAX_LENGTH
  );
}
