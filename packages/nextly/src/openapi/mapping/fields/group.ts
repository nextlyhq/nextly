/**
 * Map *named* `group` fields to an inline object schema.
 *
 * Unnamed (presentational) groups never reach this mapper — `_compose.ts`
 * flattens their nested fields into the parent object directly. By the time
 * the registry dispatches to `mapGroupField`, the group always has a `name`.
 *
 * Groups inline their object body (no $ref) because a group has no semantic
 * identity beyond its parent — there's nothing useful to reuse via $ref. The
 * `properties` and `required` are produced by `composeFieldsToObjectSchema`,
 * which also handles nested groups, repeaters, and password omission.
 *
 * Spec: §7.1 row "group".
 *
 * @module nextly/openapi/mapping/fields/group
 */

import type { FieldConfig } from "../../../collections/fields/types";
import type { GroupFieldConfig } from "../../../collections/fields/types/group";

import { composeFieldsToObjectSchema } from "./_compose";
import type { FieldMapper, FieldMapperResult, MappingContext } from "./types";

export const mapGroupField: FieldMapper<GroupFieldConfig> = (
  field,
  ctx
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const childCtx: MappingContext = {
    ...ctx,
    fieldPath: `${ctx.fieldPath}.${field.name ?? "(anonymous)"}`,
  };

  // GroupFieldConfig.fields uses a private `GroupFieldConfig_FieldConfig`
  // alias that's structurally a subset of FieldConfig (group has stricter
  // nesting rules in the source-of-truth types). Runtime structure is
  // assignable; the cast is safe.
  const composed = composeFieldsToObjectSchema(
    field.fields as readonly FieldConfig[],
    childCtx
  );
  if (description) {
    composed.input.description = description;
    composed.output.description = description;
  }
  return composed;
};
