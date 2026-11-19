/**
 * What a change does to where a field's values are kept, beyond its own column: a relationship's
 * links moving into, out of or to another link table, and a field kept by name that no longer has
 * a column on its row. One home for these rules, read by the schema dialog's preview, which warns
 * of them, and by the dialog's questions, which ask a save that would drop such values to confirm
 * them (`refuseUnansweredDialogQuestions`), so the warning and the question cannot disagree.
 *
 * @module domains/schema/services/field-storage-moves
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { columnDescriptorAt } from "../value-conversion/type-change/field-type";

import {
  fieldsStoredOnRow,
  usesJunctionTable,
  type ColumnOrigin,
} from "./field-column-descriptor";
import { sameRelationTarget } from "./relationship-key-target";

/**
 * Which way a relationship's links move: out of its link table (`leaving`); out of its column into
 * a new, empty one (`joining`); or kept a many-to-many but pointed elsewhere, its table dropped for
 * an empty one (`retargeted`).
 */
export type LinkMove = "leaving" | "joining" | "retargeted";

/**
 * Which way a kept relationship's links move, if they do: into a link table, out of one, or to a
 * new one for another target. Kept a many-to-many and pointed the same way, its link table is
 * carried (`sameRelationTarget`, the save's own pairing), so no link moves.
 */
export function linkMoveOf(
  before: FieldDefinition,
  after: FieldDefinition
): LinkMove | null {
  const hadTable = usesJunctionTable(before);
  const hasTable = usesJunctionTable(after);
  if (!hadTable) return hasTable ? "joining" : null;
  if (!hasTable) return "leaving";
  return sameRelationTarget(before, after) ? null : "retargeted";
}

/**
 * The row's fields, as they were, that the change keeps by name but that no longer have a column
 * there: a field turned into a field group, whose values its group's own table would hold, drops
 * its column and what it holds, as a removed field does. Whether a field has a column is asked of
 * the row it sits on, by its builder's own rule (`columnDescriptorAt`): a field group's row keeps a
 * many-to-many in a column of its own, where a collection keeps it in a link table. A relationship
 * that now keeps its links in a link table is asked of as a move of its links
 * (`relationshipsDroppingLinks`).
 */
export function fieldsLosingTheirColumn(
  oldFields: readonly FieldDefinition[],
  newFields: readonly FieldDefinition[],
  row: { dialect: SupportedDialect; builtBy: ColumnOrigin }
): FieldDefinition[] {
  const at = {
    builtBy: row.builtBy,
    ...(row.builtBy === "fieldGroup" ? { componentRow: true } : {}),
  };
  const hasColumn = (field: FieldDefinition) =>
    columnDescriptorAt(field, row.dialect, at) !== null;
  const after = new Map(
    fieldsStoredOnRow(newFields).map(field => [field.name, field] as const)
  );
  return fieldsStoredOnRow(oldFields).flatMap(field => {
    const kept = after.get(field.name);
    return kept !== undefined &&
      hasColumn(field) &&
      !hasColumn(kept) &&
      !usesJunctionTable(kept)
      ? [field]
      : [];
  });
}

/**
 * The relationships, as they were, whose links the save drops by a link table: a many-to-many
 * removed, and one kept by name whose links move into, out of or to another link table
 * (`linkMoveOf`), none of which carries a link over. A many-to-many renamed under the same target
 * is carried, its link table renamed with every link, by the save's own pairing
 * (`detectJunctionRename`). Only a collection's or a Single's row keeps a link table; a field
 * group's row keeps a many-to-many in a column of its own, which `fieldsLosingTheirColumn` asks of.
 */
export function relationshipsDroppingLinks(
  oldFields: readonly FieldDefinition[],
  newFields: readonly FieldDefinition[],
  builtBy: ColumnOrigin,
  dialect: SupportedDialect
): FieldDefinition[] {
  if (builtBy === "fieldGroup") return [];
  const before = fieldsStoredOnRow(oldFields);
  const now = fieldsStoredOnRow(newFields);
  const after = new Map(now.map(field => [field.name, field] as const));
  const carried = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).detectJunctionRename(before, now)?.from.name;
  return before.filter(field => {
    if (field.name === carried) return false;
    const kept = after.get(field.name);
    return kept === undefined
      ? usesJunctionTable(field)
      : linkMoveOf(field, kept) !== null;
  });
}
