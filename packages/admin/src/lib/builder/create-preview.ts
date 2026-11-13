/**
 * The review of saving an entity that is not on the server yet.
 *
 * The server's schema preview diffs a save against an entity it already holds,
 * so an entity created in the editor has nothing for it to read. Its save is a
 * create: every field is new, nothing is removed or changed, and the entity
 * itself is created even with no fields. The create refuses what it refuses
 * on its own, so this review states what will be created and makes no claim
 * about safety.
 *
 * @module lib/builder/create-preview
 */
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";

export function createPreview(
  fields: readonly FieldDefinition[]
): SchemaPreviewResponse {
  return {
    // The entity itself is created, so the save is a change with no fields.
    hasChanges: true,
    hasDestructiveChanges: false,
    classification: "safe",
    changes: {
      added: fields.map(field => ({
        name: field.name,
        type: field.type,
        required: field.required === true,
        hasDefault: field.defaultValue !== undefined,
        classification: "safe",
      })),
      removed: [],
      changed: [],
      unchanged: [],
    },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    // Nothing is stored yet, so there is no version to apply against.
    schemaVersion: 0,
    renamed: [],
  };
}
