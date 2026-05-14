/**
 * Document-reference helpers — shared by relationship + upload mappers.
 *
 * Both field types reference documents in other collections, so they share
 * the same depth-dependent oneOf shape (the "Honest oneOf" decision). The
 * inflector used here is intentionally minimal; the proper inflector module
 * (`_inflect.ts`) may absorb / replace this helper.
 *
 * @module nextly/openapi/mapping/fields/_refs
 */

import type { OpenAPISchema } from "../../types";
import { collectionSchemaName } from "../_inflect";

/**
 * Convert a collection slug to its OAS schema name.
 *
 * Delegates to `collectionSchemaName` in `_inflect.ts`. Kept as a thin
 * alias so `relationship.ts` and `upload.ts` (which were written before
 * the inflector module existed) don't need import-path churn. Callers
 * that want to honor `collection.labels.singular` should import
 * `collectionSchemaName` directly from `../_inflect` and pass the label
 * — `slugToSchemaName` only sees the slug.
 */
export function slugToSchemaName(slug: string): string {
  return collectionSchemaName(slug);
}

/**
 * Build the polymorphic-reference object schema:
 *
 *   { type: 'object',
 *     required: ['relationTo', 'value'],
 *     properties: {
 *       relationTo: { type: 'string', enum: [...targets] },
 *       value: { type: 'string', description: 'Document ID' },
 *     } }
 *
 * This is what `RelationshipPolymorphicValue` and `UploadPolymorphicValue`
 * actually look like on the wire — see the source-of-truth types in
 * `collections/fields/types/relationship.ts:45` and `upload.ts:45`.
 */
export function buildPolymorphicRefObject(
  targets: readonly string[]
): OpenAPISchema {
  return {
    type: "object",
    required: ["relationTo", "value"],
    properties: {
      relationTo: { type: "string", enum: [...targets] },
      value: { type: "string", description: "Document ID" },
    },
  };
}
