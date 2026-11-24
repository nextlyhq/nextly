/**
 * Which fields a save keeps by name but stores differently: a write prepared before the save would
 * read or write each where, or as, it no longer is.
 *
 * @module domains/schema/services/fields-stored-differently
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { fieldTypeChangesOf } from "../value-conversion/type-change/field-type-changes";

import type { ColumnOrigin } from "./field-column-descriptor";
import { fieldsStoredOnRow } from "./field-column-descriptor";
import { linkMoveOf } from "./field-storage-moves";
import { sameRelationTarget } from "./relationship-key-target";

/**
 * The names of the fields `next` keeps from `previous`, stored differently: a many-to-many whose
 * links are in another table, or a relationship that points at another collection (`linkMoveOf`,
 * `sameRelationTarget`); a field that joins or leaves translation; and a column of another type
 * (`fieldTypeChangesOf`). Asked where the two definitions differ: a change that stores nothing
 * differently (a label, a hint) names none.
 */
export function fieldsStoredDifferently(args: {
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): ReadonlySet<string> {
  const before = new Map(
    fieldsStoredOnRow(args.previous).map(field => [field.name, field])
  );
  const changed = new Set<string>();
  for (const now of fieldsStoredOnRow(args.next)) {
    const was = before.get(now.name);
    if (was === undefined) continue;
    if (
      linkMoveOf(was, now) !== null ||
      (was.type === "relationship" &&
        now.type === "relationship" &&
        !sameRelationTarget(was, now)) ||
      was.localized !== now.localized
    ) {
      changed.add(now.name);
    }
  }
  for (const change of fieldTypeChangesOf({
    previous: args.previous,
    next: args.next,
    dialect: args.dialect,
    builtBy: args.builtBy,
  })) {
    changed.add(change.to.name);
  }
  return changed;
}
