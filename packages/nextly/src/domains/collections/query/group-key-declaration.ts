/**
 * Why a field's DECLARATION stops it being a group key, if it does.
 *
 * Its own module because two callers need the same answer and neither can own
 * it. The read path refuses a group key it cannot bucket; the widget source
 * catalog marks the same fields so a card never offers one. Composed separately,
 * the two agree only until one of them changes -- and the direction that drifts
 * silently is the catalog's, which would keep hiding a key the read had started
 * accepting, leaving a supported path no author can reach.
 *
 * Only the reasons visible in the DECLARATION live here. Whether a field
 * carries a read rule is a registry question (`groupableFieldProblem`), and
 * whether it resolved to a column is a schema question the read answers with
 * the column in hand.
 *
 * @module domains/collections/query/group-key-declaration
 */

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { classifyFieldKind } from "../../schema/services/field-column-descriptor";
import { isJsonFieldType } from "../services/collection-utils";

/**
 * Why a field's KIND cannot be grouped, if it cannot.
 *
 * Asked of the CANONICAL classifier the DDL is built from, rather than of a
 * list of type names kept here. A plugin field type declaring `storage: "json"`
 * is mapped to a JSON column by that classifier and would be invisible to such
 * a list — so it would group, and answer differently per adapter.
 *
 * `skip` is a field whose values live in another table (a component, a
 * many-to-many), so this collection has no column to group by. `json` is a
 * structure: two rows holding the same content with their keys written in a
 * different order are ONE bucket under PostgreSQL's `jsonb`, which normalises,
 * and TWO under SQLite, which compares the stored text. The grouping happens in
 * the database, so no label chosen afterwards reconciles them.
 */
function ungroupableKind(field: FieldDefinition): string | undefined {
  // Asked of the LOGICAL storage as well as the physical column, because the
  // two disagree and only one of them decides what the value looks like.
  // `classifyFieldKind` answers what column the DDL emits: `richText` gets
  // `longText`, and a `hasMany` text or select gets a text column. The read
  // and mutation paths nonetheless serialize those values as JSON through
  // `isJsonFieldType`, so the stored bytes are a document and grouping them
  // returns raw serialized JSON as labels -- splitting equal content that was
  // written with its keys in a different order.
  if (isJsonFieldType(field.type, field)) {
    return "is stored as serialized JSON, so its buckets would depend on how that text was written rather than on what it means";
  }
  const kind = classifyFieldKind(field, "collection");
  if (kind === "skip") {
    return "keeps its values in another table, so this collection has no column for it";
  }
  if (kind === "json") {
    return "holds a structure rather than a value, so its buckets would depend on how the database compares stored JSON";
  }
  return undefined;
}

/**
 * Why a DECLARED field cannot be a group key, if it cannot.
 *
 * The reasons that depend on the declaration are answered together and before
 * the missing-column refusal, because a declared field can legitimately have no
 * column on this table and the reason matters more than the absence.
 *
 * A field nobody declared is not refused here: a system column carries no
 * declaration and is grouped on its own terms.
 */
export function groupKeyDeclarationProblem(
  declared: FieldDefinition | undefined,
  groupBy: string
): string | undefined {
  if (declared === undefined) return undefined;
  // A localized field's values live in the `_locales` companion rather than in
  // this table, so the column lookup finds nothing. Refusing it as "not a
  // column on this collection" reads as a typo for a field that is declared and
  // spelled correctly, which sends the reader looking in the wrong place.
  if (declared.localized === true) {
    return `"${groupBy}" is a localized field, so its values are stored per locale rather than on this collection. Grouping over a localized field is not supported yet.`;
  }
  const ungroupable = ungroupableKind(declared);
  if (ungroupable !== undefined) {
    return `"${groupBy}" ${ungroupable}. Group by a scalar field instead.`;
  }
  return undefined;
}

/** Whether a declaration leaves the field usable as a group key. */
export function isGroupKeyDeclaration(
  declared: FieldDefinition | undefined,
  name: string
): boolean {
  return groupKeyDeclarationProblem(declared, name) === undefined;
}
