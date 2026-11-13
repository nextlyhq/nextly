/**
 * What renaming a field-group field means for its stored rows, answered once for every writer of
 * a schema change: the Schema Builder's save and push, and `nextly migrate:create`.
 *
 * A field group's instances live in the group's own table, keyed by the parent's table and the
 * FIELD NAME (`_parent_table`, `_parent_field`). The parent table has no column for the field, so
 * a rename changes no DDL at all: left alone, every stored instance stays keyed by the old name,
 * where nothing reads it, and the renamed field reads empty although no row was deleted. A rename
 * that keeps the rows re-keys them instead, and its reverse keys them back.
 *
 * Which removed and added fields MAY be one field renamed is decided here (`keepsFieldGroupRows`);
 * how a surface pairs them is its own: the Builder takes the one pair a save can hold and refuses
 * more, while `migrate:create` asks the operator about each.
 *
 * @module domains/field-groups/storage/field-group-rename
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { quoteIdent } from "../../schema/pipeline/sql-templates/identifier-quoting";
import { quoteSqlLiteral } from "../../schema/utils/sql-literal";

import {
  fieldGroupSlugList,
  isFieldGroupFieldType,
} from "./field-group-field-type";

/** A field as a rename detector reads it: its name, and what decides where its values live. */
export interface RenamedFieldShape {
  name: string;
  type?: unknown;
  repeatable?: unknown;
}

/**
 * The fields a change removed and the fields it added, among those `participates` accepts. Every
 * rename detector pairs from this same set, so a field renamed alongside other edits reads the
 * same way to each of them.
 */
export function removedAndAddedFields<T extends { name: string }>(
  oldFields: readonly T[],
  newFields: readonly T[],
  participates: (field: T) => boolean = () => true
): { oldOnly: T[]; newOnly: T[] } {
  const oldNames = new Set(oldFields.map(f => f.name));
  const newNames = new Set(newFields.map(f => f.name));
  return {
    oldOnly: oldFields.filter(f => !newNames.has(f.name) && participates(f)),
    newOnly: newFields.filter(f => !oldNames.has(f.name) && participates(f)),
  };
}

/** The removed and the added field-group fields of a change (`removedAndAddedFields`). */
export function removedAndAddedFieldGroups<T extends RenamedFieldShape>(
  oldFields: readonly T[],
  newFields: readonly T[]
): { oldOnly: T[]; newOnly: T[] } {
  return removedAndAddedFields(oldFields, newFields, f =>
    isFieldGroupFieldType(f.type)
  );
}

/**
 * Whether the rows stored under `from` are rows of `to`, so renaming one to the other can keep
 * them: both hold the same field groups (as a set: a reordered zone list is the same zone) with
 * the same cardinality (an unset `repeatable` and `false` both mean one instance). Anything else
 * is a remove of one field and an add of a different one.
 */
export function keepsFieldGroupRows(
  from: RenamedFieldShape,
  to: RenamedFieldShape
): boolean {
  if (!isFieldGroupFieldType(from.type) || !isFieldGroupFieldType(to.type)) {
    return false;
  }
  if (Boolean(from.repeatable) !== Boolean(to.repeatable)) return false;
  const fromSlugs = fieldGroupSlugList(from);
  const toSlugs = fieldGroupSlugList(to);
  return (
    fromSlugs.length === toSlugs.length &&
    fromSlugs.every(slug => toSlugs.includes(slug))
  );
}

/**
 * The statements that re-key the rows a field-group field stores in each of `groupTables` from
 * the field's old name to its new one, for the parent table `parentTable` only: a group table is
 * shared by every entity that uses the group, and another entity's field of the old name keeps its
 * rows. Unterminated, one per table; the reverse is the same call with the names swapped.
 */
export function fieldGroupRowMoves(args: {
  dialect: SupportedDialect;
  parentTable: string;
  from: string;
  to: string;
  groupTables: readonly string[];
}): string[] {
  const q = (name: string) => quoteIdent(name, args.dialect);
  const literal = (value: string) => quoteSqlLiteral(value, args.dialect);
  const { parentField, parentTable } = STORAGE_FORMAT.columns;
  return args.groupTables.map(
    table =>
      `UPDATE ${q(table)}\n` +
      `SET ${q(parentField)} = ${literal(args.to)}\n` +
      `WHERE ${q(parentField)} = ${literal(args.from)}\n` +
      `  AND ${q(parentTable)} = ${literal(args.parentTable)}`
  );
}
