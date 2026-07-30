/**
 * The built-in field type a plugin-contributed type persists as.
 *
 * A plugin type reaches none of the branches keyed on the built-in tokens —
 * DDL, value serialization, date coercion — so anything dispatching on
 * `field.type` has to resolve the primitive first or it will build a column of
 * one shape and write a value of another. Kept here rather than beside any one
 * of those consumers because they sit in different layers and all need it.
 *
 * @module shared/lib/plugin-storage
 */
import type { BlockFieldCatalogType } from "../../collections/fields/catalog";
import { STORAGE_PRIMITIVE_AS_FIELD_TYPE } from "../../collections/fields/catalog";
import { getFieldType } from "../../domains/schema/field-types/field-type-registry";

/** A field as the callers hold it: a type, and whatever else it carries. */
interface TypedField {
  type?: unknown;
}

/**
 * The primitive's built-in token, or nothing for a built-in or unknown type.
 *
 * Returning nothing rather than a default keeps every caller's existing
 * handling intact: it consults this only where it would otherwise fall through.
 */
export function pluginStorageFieldType(
  field: TypedField
): BlockFieldCatalogType | undefined {
  if (typeof field.type !== "string") return undefined;
  const registered = getFieldType(field.type);
  if (!registered) return undefined;
  return STORAGE_PRIMITIVE_AS_FIELD_TYPE[registered.storage];
}

/**
 * The token a value-shape decision should be made on: the storage primitive
 * for a plugin type, and the declared type for everything else.
 */
export function storageTypeToken(field: TypedField): string | undefined {
  const primitive = pluginStorageFieldType(field);
  if (primitive !== undefined) return primitive;
  return typeof field.type === "string" ? field.type : undefined;
}
