/**
 * Rules about a field, or a pair of sibling fields, that the server and the
 * Builder both apply: whether two names clash, and whether a field's column is
 * unique. One implementation, so the Builder refuses a move by the very rule a
 * save refuses it by, rather than by a copy that could come to disagree.
 *
 * Browser-safe on purpose: it imports only two browser-safe predicates (a
 * virtual field, a field-group field type), so `nextly/config` can offer it to
 * the admin. The server's own modules (sibling-fields, the column descriptor,
 * the dynamic-collection schema service) import from here.
 *
 * @module domains/schema/field-rules
 */
import { isVirtualField } from "../../collections/fields/virtual";
import { isFieldGroupFieldType } from "../field-groups/storage/field-group-field-type";

/** Why two sibling fields clash, in the order the rule asks. */
export type SiblingClashKind =
  | "same-name"
  | "same-name-ignoring-case"
  | "same-column";

/**
 * The column a field's name becomes: `fooBar` and `foo_bar` both `foo_bar`.
 * The column descriptor, field-to-column mapping's home, re-exports it.
 */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Whether two sibling names clash, and why: the same name, names that differ
 * only in letter case, or names that become the same column. The column is
 * what the database refuses, and MySQL and SQLite compare column names without
 * regard to case, so all three are asked.
 *
 * @experimental Published for the Builder's move and copy rules.
 */
export function siblingNameClash(
  a: string,
  b: string
): SiblingClashKind | null {
  if (a === b) return "same-name";
  if (a.toLowerCase() === b.toLowerCase()) return "same-name-ignoring-case";
  if (toSnakeCase(a) === toSnakeCase(b)) return "same-column";
  return null;
}

/**
 * Whether a Builder field's column is unique.
 *
 * A one-to-one relationship is unique by its cardinality, not by anything the author ticks, so
 * the flag alone does not decide it. Asked in one place because the answer has to be the same
 * whether the column arrives with its table or is added to one that already exists (a table
 * that gained its one-to-one by an edit was not enforcing the cardinality it declared), and
 * whether a later save keeps the constraint its table holds.
 *
 * @experimental Published for the Builder's move rule, which refuses moving such a field into a
 * group or repeating rows.
 */
export function builderColumnIsUnique(field: {
  readonly type?: unknown;
  readonly unique?: unknown;
  readonly hasMany?: unknown;
  readonly options?: unknown;
}): boolean {
  // A relation holding a list is never unique, whatever it is marked
  // (`relationHoldsReferenceList` says why).
  if (relationHoldsReferenceList(field)) return false;
  if (field.unique === true) return true;
  if (field.type !== "relationship") return false;
  // Read as given: a relationship's options are an object, other fields'
  // a list of choices or nothing, and only the object can say one-to-one.
  const options = field.options as { relationType?: unknown } | undefined;
  return options?.relationType === "oneToOne";
}

/**
 * Whether a field's values live in a junction table instead of a column on its own row.
 *
 * The DDL generator asks this to decide whether to emit a junction table, and `fieldProducesColumn`
 * asks it to decide there is no parent column — one rule, so the two cannot disagree about the same
 * field. They did disagree, and the disagreement was resolved toward the row: an `upload` carrying
 * `relationType: "manyToMany"` had no descriptor column while the generator emitted one.
 *
 * **Junction storage is a `relationship` feature only**, deliberately, because that is the only
 * shape the persistence layer implements. Both halves select junction-backed fields by type:
 * `collection-mutation-service` filters `f.type === "relationship" && relationType === "manyToMany"`
 * on every write, and `collection-relationship-service` builds its relation set from
 * `isRelationshipField`, which is `field.type === "relationship"`. Treating an upload as
 * junction-backed would give it a table that nothing writes to and nothing reads from, so an upload
 * keeps its column and the option is inert on it.
 */
export function usesJunctionTable(field: {
  type?: unknown;
  options?: unknown;
}): boolean {
  if (field.type !== "relationship") return false;
  const options: unknown = field.options;
  const relationType =
    typeof options === "object" && options !== null
      ? (options as { relationType?: unknown }).relationType
      : undefined;
  return relationType === "manyToMany";
}

/**
 * Whether a field becomes a column of the table it is declared on.
 *
 * The single answer to that question: the column descriptor's `classifyFieldKind` and
 * `getColumnDescriptor` both defer to it, the save's field-name rule asks it whether a column's
 * length reaches a name, and the Builder asks it through `nextly/config` (@experimental), so a rule that only applies to columns cannot disagree with the generator about which fields
 * have one.
 *
 * Dialect-free by construction — a component and a many-to-many relationship keep their values in
 * their own tables on every dialect. Structural rather than typed because config validation asks
 * this before the field has been parsed. Anything unrecognised counts as a column, matching the
 * column descriptor's text fallback, so a field type whose plugin has not registered yet is still held to the
 * rules that columns carry rather than quietly escaping them.
 */
export function fieldProducesColumn(field: {
  type?: unknown;
  options?: unknown;
  /** The root-level `virtual` flag every field type accepts. */
  virtual?: unknown;
}): boolean {
  if (typeof field.type !== "string") return true;
  // A virtual field stores nothing: no column, no insert, no select. Both
  // spellings of the flag are read by the one predicate the localization
  // classifier also asks.
  if (isVirtualField(field)) return false;
  // Field-group and component values live in their own dedicated tables (fg_{slug} or
  // comp_{slug}) and are stripped from the parent row on write, so the parent needs no column.
  if (isFieldGroupFieldType(field.type)) return false;
  // A many-to-many relationship stores its links in a dedicated junction table, not on the parent
  // row. Every other relationship shape does get a column.
  if (usesJunctionTable(field)) return false;
  return true;
}

/**
 * Whether a relation holds a LIST of references, on any row: a `hasMany` relationship or upload (to
 * one collection or several), or a many-to-many, whose links a collection keeps in a junction table
 * and a component row in its own column.
 *
 * Also the rule for which relation is never unique, on every dialect. "Unique" on a list would mean
 * no two entries hold the identical list, which is rarely what is meant, and a unique btree over a
 * long list refuses the save on PostgreSQL once the list holds about a hundred ids. A single
 * reference, polymorphic or not, is one value and keeps its uniqueness.
 */
export function relationHoldsReferenceList(field: {
  type?: unknown;
  hasMany?: unknown;
  options?: unknown;
}): boolean {
  const isRelation = field.type === "relationship" || field.type === "upload";
  return (isRelation && Boolean(field.hasMany)) || usesJunctionTable(field);
}

/**
 * The words every road uses to refuse a list relation marked unique (`relationHoldsReferenceList`
 * says why it cannot be): they name the field and what to do instead.
 */
export function uniqueNotOnListMessage(fieldName: string): string {
  return (
    `"${fieldName}" holds a list of links, which cannot be unique: it would mean ` +
    `no two entries hold the identical list. Turn Unique off on "${fieldName}", or ` +
    `make it a single link.`
  );
}

/**
 * Whether `field` is a relation holding a list that is marked unique: the one decision every road
 * refusing the mark asks (`relationHoldsReferenceList` says why no list can be unique), and the one
 * a change asks of the field as it was, to drop the index an earlier release made for it.
 */
export function isListMarkedUnique(field: {
  type?: unknown;
  unique?: unknown;
  hasMany?: unknown;
  options?: unknown;
}): boolean {
  return field.unique === true && relationHoldsReferenceList(field);
}

/**
 * The name of the first relation holding a list that is marked unique among `fields`, wherever it
 * is declared: at the top level, inside a group or a repeater at any depth, translated or not.
 * Undefined when there is none. Asked of the fields as declared, before any road filters them by
 * where their values are stored, so no storage location lets the mark through unjudged.
 */
export function listMarkedUnique(
  fields: readonly unknown[]
): string | undefined {
  for (const field of fields) {
    if (typeof field !== "object" || field === null) continue;
    const declared = field as {
      name?: unknown;
      type?: unknown;
      unique?: unknown;
      hasMany?: unknown;
      options?: unknown;
      fields?: unknown;
    };
    if (isListMarkedUnique(declared)) {
      return typeof declared.name === "string" ? declared.name : "";
    }
    if (Array.isArray(declared.fields)) {
      const nested = listMarkedUnique(declared.fields);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}
