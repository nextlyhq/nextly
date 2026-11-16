/**
 * The fields a picked template adds, as the Builder stores them: what an
 * unsaved entity starts with, beside its starting field. A field left out is
 * not added, nor anything inside it; arrays are copied, so editing the new
 * entity never reaches the declaration it came from.
 *
 * @module lib/builder/template-fields
 */
import type { FieldDefinition } from "@admin/types/collection";

import type { SchemaTemplate, SchemaTemplateField } from "./schema-templates";
import { templateFieldKey } from "./template-check";

/** A stored field, with a plugin type's own settings where the loader reads them. */
type StoredField = FieldDefinition & {
  pluginOptions?: Record<string, unknown>;
};

/** One template field as stored, its own fields with it. */
function storedField(
  field: SchemaTemplateField,
  key: string,
  leftOut: ReadonlySet<string>
): StoredField {
  const {
    fields,
    options,
    pluginOptions,
    admin,
    relationTo,
    components,
    ...rest
  } = field;
  return {
    ...rest,
    ...(relationTo === undefined
      ? {}
      : {
          relationTo:
            typeof relationTo === "string" ? relationTo : [...relationTo],
        }),
    ...(components ? { components: [...components] } : {}),
    ...(options ? { options: options.map(option => ({ ...option })) } : {}),
    ...(admin ? { admin: { ...admin } } : {}),
    ...(pluginOptions ? { pluginOptions: { ...pluginOptions } } : {}),
    ...(fields ? { fields: storedFields(fields, key, leftOut) } : {}),
  };
}

function storedFields(
  fields: readonly SchemaTemplateField[],
  parentKey: string | null,
  leftOut: ReadonlySet<string>
): FieldDefinition[] {
  return fields.flatMap((field, at) => {
    const key = templateFieldKey(parentKey, at);
    return leftOut.has(key) ? [] : [storedField(field, key, leftOut)];
  });
}

/**
 * The fields `template` adds, less those left out (by key, as the template
 * check keys them).
 */
export function templateFieldsToAdd(
  template: SchemaTemplate,
  leftOut: ReadonlySet<string>
): FieldDefinition[] {
  return storedFields(template.fields, null, leftOut);
}
