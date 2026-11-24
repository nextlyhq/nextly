/**
 * The stored field lists a request's reader may learn about: what a field group's own editor lists
 * as its users, and who a Schema Builder save's refused move into or out of a field group names.
 *
 * @module dispatcher/helpers/readable-field-owners
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldOwner } from "../../domains/collections/services/collection-dependents";
import {
  checkMove,
  type FieldMoveRequest,
  type MoveEntity,
} from "../../domains/schema/field-moves/check-move";
import { NextlyError } from "../../errors";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { readableSlugsOfKind } from "../../services/lib/readable-slug-allowlist";
import { readAccessCallerForDispatch } from "../handlers/read-access-caller";

import { readAuthenticatedUser } from "./authenticated-user";

/**
 * Every stored field list this reader may learn about, for where a field
 * group is used and how often. A collection or Single the reader may not read
 * is left out, by the same decision their own lists are scoped by
 * (`readableSlugAllowlist`), so neither answer names or counts one those
 * lists hide. A delete's refusal reads every field list instead: it must know
 * every use, whoever asks.
 */
export async function readableFieldOwners(adapter: DrizzleAdapter): Promise<{
  owners: FieldOwner[];
  /**
   * Whether the reader may read every collection and Single there is. Decided by the reader alone,
   * as the field-group list's counts are, and never by the field group asked about: a flag that
   * followed the field group would tell a reader that a collection or Single hidden from them
   * uses it.
   */
  complete: boolean;
}> {
  const { ownersReadableBy, readFieldOwners } = await import(
    "../../domains/collections/services/collection-dependents"
  );
  const reader = readAuthenticatedUser();
  const caller = reader ? readAccessCallerForDispatch(reader) : undefined;
  const [collection, single, owners] = await Promise.all([
    readableOwnerSlugs(caller, "collection"),
    readableOwnerSlugs(caller, "single"),
    readFieldOwners(adapter),
  ]);
  const readable = ownersReadableBy(owners, { collection, single });
  // Every collection and Single is an owner, so dropping any means the
  // reader may not read all of them.
  return { owners: readable, complete: readable.length === owners.length };
}

/**
 * The slugs of `kind` the reader may read, or `undefined` for no reader.
 * A registry that cannot be enumerated rejects rather than answering none:
 * leaving out a whole kind would claim the field group is used less, or not
 * at all, when that is not known. The caller turns the rejection into its
 * own "could not be read".
 */
async function readableOwnerSlugs(
  caller: ReturnType<typeof readAccessCallerForDispatch> | undefined,
  kind: "collection" | "single"
): Promise<string[] | undefined> {
  if (!caller) return undefined;
  const { slugs, reachable } = await readableSlugsOfKind(caller, kind);
  if (!reachable) {
    throw NextlyError.serviceUnavailable({
      logContext: { reason: "readable-owners-unreachable", kind },
    });
  }
  return slugs;
}

/**
 * Who uses each field group, as this reader may know them, for a save that moves fields: a move
 * into or out of a field group is refused naming them (`checkMove`). Read only where `checkMove`
 * refuses one of the save's moves for a field group, the one refusal that names them, so no other
 * save reads every field list or depends on reading them; none otherwise.
 *
 * @param fields the entity's fields before the save and after it, as the moves are checked against
 */
export async function fieldGroupUsersForMoves(
  adapter: DrizzleAdapter | undefined,
  moves: readonly FieldMoveRequest[],
  fields: {
    before: readonly FieldDefinition[];
    after: readonly FieldDefinition[];
  }
): Promise<MoveEntity["fieldGroupUsers"]> {
  if (adapter === undefined) return undefined;
  const refusedForFieldGroup = moves.some(move => {
    const checked = checkMove(fields.before, fields.after, move);
    return !checked.ok && checked.reason === "field-group";
  });
  if (!refusedForFieldGroup) return undefined;
  const { fieldGroupUsersOf } = await import(
    "../../domains/schema/field-moves/field-group-users"
  );
  const { owners, complete } = await readableFieldOwners(adapter);
  return fieldGroupUsersOf(owners, complete);
}
