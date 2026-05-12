/**
 * Document-reference helpers — shared by relationship + upload mappers.
 *
 * Both field types reference documents in other collections, so they share
 * the same depth-dependent oneOf shape (spec §7.1, decision #8). The
 * inflector used here is intentionally minimal; T11 introduces a proper
 * inflector module (`_inflect.ts`) and may absorb / replace this helper.
 *
 * @module nextly/openapi/mapping/fields/_refs
 */

import type { OpenAPISchema } from "../../types";

/**
 * Convert a collection slug to its OAS schema name.
 *
 * Naive English-pluralization rules — good enough for `users → User`,
 * `categories → Category`, `media → Media`. T11 will replace with the
 * proper inflector that honors `collection.labels.singular`.
 */
export function slugToSchemaName(slug: string): string {
  let singular = slug;
  if (singular.endsWith("ies")) {
    singular = `${singular.slice(0, -3)}y`;
  } else if (
    singular.endsWith("ses") ||
    singular.endsWith("xes") ||
    singular.endsWith("zes")
  ) {
    singular = singular.slice(0, -2);
  } else if (singular.endsWith("s") && !singular.endsWith("ss")) {
    singular = singular.slice(0, -1);
  }
  return singular
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
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
