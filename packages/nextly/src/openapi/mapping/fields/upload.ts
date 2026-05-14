/**
 * Map `upload` fields to OpenAPI document-reference schemas.
 *
 * Structurally identical to `relationship` (same `relationTo`, `hasMany`,
 * `minRows`/`maxRows` knobs and the same depth-dependent oneOf shape) — the
 * only semantic difference is that upload references a file-bearing
 * collection (typically `media`) rather than any document. We reuse
 * `buildDocumentReferenceSchemas` to guarantee both mappers stay in lock
 * step over time.
 *
 * @module nextly/openapi/mapping/fields/upload
 */

import type { UploadFieldConfig } from "../../../collections/fields/types/upload";

import { buildDocumentReferenceSchemas } from "./relationship";
import type { FieldMapper, FieldMapperResult } from "./types";

export const mapUploadField: FieldMapper<UploadFieldConfig> = (
  field,
  ctx
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const isPolymorphic = Array.isArray(field.relationTo);
  const targets: readonly string[] = isPolymorphic
    ? (field.relationTo as string[])
    : [field.relationTo as string];

  return buildDocumentReferenceSchemas({
    targets,
    isPolymorphic,
    hasMany: field.hasMany === true,
    minRows: field.minRows,
    maxRows: field.maxRows,
    description,
    ctx,
  });
};
