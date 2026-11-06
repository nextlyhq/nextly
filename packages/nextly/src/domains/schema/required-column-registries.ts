/**
 * The registry tables a road reads to name the entity a table belongs to, by kind. The one list
 * the required-column checks of every road read, so `nextly migrate` and the Schema Builder name
 * the same entity for the same table.
 *
 * @module domains/schema/required-column-registries
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { resolveRegistryNameFromCatalog } from "../field-groups/storage/resolve-storage-names";

import type { RequiredColumnEntityKind } from "./required-column-refusal";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
} from "./services/field-column-descriptor";

/**
 * Each entity kind's registry table. The field-group registry may still sit under its earlier
 * name, so it is resolved as the push resolves it (`fieldGroupRegistryTable` when the caller
 * already knows it); a catalog that cannot answer leaves the current spelling.
 */
export async function requiredColumnRegistries(
  db: unknown,
  dialect: SupportedDialect,
  fieldGroupRegistryTable?: string
): Promise<Array<[Exclude<RequiredColumnEntityKind, "table">, string]>> {
  return [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
    [
      "fieldGroup",
      fieldGroupRegistryTable ??
        (await resolveRegistryNameFromCatalog({
          dialect,
          getDrizzle: <T>() => db as T,
        }).catch(() => STORAGE_FORMAT.registryTable)),
    ],
  ];
}

/**
 * Each field's column, lower-cased, to the field's name: the descriptor's answer for a
 * collection's or Single's row, or a field group's row, never a second spelling of it. How every
 * road names the field a column belongs to.
 */
export function fieldsByColumnOf(
  fields: readonly FieldDefinition[],
  dialect: SupportedDialect,
  fieldGroup: boolean
): Map<string, string> {
  const byColumn = new Map<string, string>();
  for (const field of fields) {
    if (typeof field?.name !== "string") continue;
    const descriptor = fieldGroup
      ? getComponentRowColumnDescriptor(field, dialect, "fieldGroup")
      : getColumnDescriptor(field, dialect, "collection");
    if (descriptor !== null)
      byColumn.set(descriptor.name.toLowerCase(), field.name);
  }
  return byColumn;
}
