/**
 * Who uses each field group, for a move refused into or out of one: every collection, Single and
 * field group placing it, directly or through another field group, as the field group's own "used
 * by" list reads them (`fieldGroupUsesAmong`), and named in the same words the Schema Builder uses
 * (`fieldGroupUsersClause`).
 *
 * @module domains/schema/field-moves/field-group-users
 */
import {
  fieldGroupUsesAmong,
  type FieldOwner,
} from "../../collections/services/collection-dependents";
import type { FieldGroupUserNamed } from "../../field-groups/storage/field-group-users-clause";

/**
 * The users of one field group, and whether the field lists they were read from are every one
 * there is: a reader who may not read every collection and Single is told of the ones they may.
 */
export interface FieldGroupUsers {
  uses: FieldGroupUserNamed[];
  complete: boolean;
}

/**
 * Each field group's users among `owners` (`fieldGroupUsesAmong`), read when a field group is
 * asked about.
 *
 * @param complete whether `owners` holds every field list there is (`FieldGroupUsers.complete`)
 */
export function fieldGroupUsersOf(
  owners: readonly FieldOwner[],
  complete: boolean
): (slug: string) => FieldGroupUsers {
  return slug => ({ uses: fieldGroupUsesAmong(owners, slug), complete });
}
