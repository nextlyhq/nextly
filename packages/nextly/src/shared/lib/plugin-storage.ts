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

import { detachedField } from "./detached-field";

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

/**
 * What a plugin type holds when nothing has been written to it, if its type
 * states a value.
 *
 * The serialized value only, never SQL: the DDL caller quotes it for the
 * dialect it is generating, so a contributed type cannot get the escaping
 * wrong. Nothing is returned for a built-in type, an unregistered one, or a
 * type content with its primitive's default, which leaves every existing
 * branch as it was.
 *
 * The type is handed the same folded option view `validate` and `codegen`
 * receive, so a default can depend on the options the field declares rather
 * than only on the type.
 */
export function pluginEmptyValue(field: TypedField): string | undefined {
  if (typeof field.type !== "string") return undefined;
  const registered = getFieldType(field.type);
  if (!registered?.emptyValue) return undefined;
  return registered.emptyValue(
    detachedField(field as { name?: string; type: string })
  );
}
