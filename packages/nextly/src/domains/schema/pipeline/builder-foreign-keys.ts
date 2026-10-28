/**
 * The foreign keys a Schema Builder collection's table carries in the
 * desired schema.
 *
 * The Builder creates a table with each relationship's key, but every later
 * save goes through the push pipeline, whose desired schema described no key
 * at all. So a relationship added to an existing table got none, on any
 * dialect, and the keys a table did have were invisible to the diff. On
 * SQLite that was worst: a key lives only in `CREATE TABLE`, the push
 * rebuilds a table to change a column's type, and the rebuild was made from
 * a definition without the key, so it was dropped, or the whole save was
 * refused because drizzle-kit, reading the whole database, saw a key nothing
 * declared.
 *
 * The table's keys here are the ones its live table already holds, kept
 * while their columns remain, and the key of each relationship whose column
 * this push adds, described by the Builder's own rule
 * (`relationshipForeignKey`). A relationship the change adds whose column an
 * earlier apply already added counts as added: MySQL commits each schema
 * statement, so an apply refused part-way can leave the column without its
 * key. Nothing else: a relationship the registry already records whose
 * column has no key keeps it that way, so an existing install is planned no
 * new key it did not ask for, and a code-first collection is not touched.
 *
 * @module domains/schema/pipeline/builder-foreign-keys
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";

import type { ForeignKeySpec, TableSpec } from "./diff/types";
import type { DesiredCollection } from "./types";

export function withBuilderForeignKeys(
  spec: TableSpec,
  collection: DesiredCollection,
  live: TableSpec | undefined,
  dialect: SupportedDialect
): TableSpec {
  if (collection.builderOwned !== true) return spec;

  const lower = (name: string) => name.toLowerCase();
  const columns = new Set(spec.columns.map(column => lower(column.name)));
  const liveColumns = new Set(
    (live?.columns ?? []).map(column => lower(column.name))
  );
  // Without the recorded field list, every column already in place counts as recorded.
  const recorded =
    collection.recordedFields === undefined
      ? undefined
      : new Set(collection.recordedFields);

  // Kept: every key the live table holds whose columns the table keeps. A key
  // over a column this push drops goes with the column.
  const kept = (live?.foreignKeys ?? []).filter(fk =>
    fk.columns.every(column => columns.has(lower(column)))
  );
  const keyed = new Set(kept.flatMap(fk => fk.columns.map(lower)));

  // Created: the key of each relationship whose column this push adds.
  const builder = new DynamicCollectionSchemaService(undefined, dialect);
  const created: ForeignKeySpec[] = [];
  for (const field of collection.fields as unknown as FieldDefinition[]) {
    // Read first without judging the actions: a relationship whose column
    // already exists keeps whatever it has, and a combination an older save
    // accepted (a required relationship that nulls on delete) must not block
    // every later save of the collection over a key nothing is creating.
    const described = builder.relationshipForeignKey(spec.name, field, false);
    if (described === null) continue;
    const column = lower(described.columns[0]);
    const addedByThisChange =
      !liveColumns.has(column) ||
      (recorded !== undefined && !recorded.has(field.name));
    if (!columns.has(column) || !addedByThisChange || keyed.has(column)) {
      continue;
    }
    // A key this push creates is judged: what a save asks for has to be
    // possible, exactly as when the Builder creates the table.
    const fk = builder.relationshipForeignKey(spec.name, field);
    if (fk !== null) created.push(fk);
  }

  return { ...spec, foreignKeys: [...kept, ...created] };
}
