// Shared types for the schema change confirmation flow.
// Post F8 PR 4 consumers:
//   - domains/schema/legacy-preview/translate.ts (server) — produces
//     SchemaPreviewResult / InteractiveField for backwards compat.
//   - dispatcher/handlers/collection-dispatcher.ts (server) — uses
//     FieldResolution only.
//   - packages/admin/src/services/schemaApi.ts (client) — re-declares
//     these shapes locally; this file is the source of truth.
// Task 22 (`tasks/nextly-dev-tasks/22-modernize-admin-schema-dialog.md`)
// retires these legacy types once the admin dialog is upgraded to
// consume ClassifierEvent[] directly.

import type { FieldDefinition } from "../../../schemas/dynamic-collections.js";

// Classification of a single field change
export type ChangeClassification = "safe" | "destructive" | "interactive";

// Overall classification of a schema change (most severe wins)
export type SchemaClassification = "safe" | "destructive" | "interactive";

// A field that was added, with classification metadata
export interface AddedField {
  name: string;
  type: string;
  required: boolean;
  hasDefault: boolean;
  classification: ChangeClassification;
}

// A field that was removed, with row-count impact
export interface RemovedField {
  name: string;
  type: string;
  rowCount: number; // COUNT(*) WHERE field IS NOT NULL
  classification: ChangeClassification;
}

// A field whose type or constraints changed
export interface ChangedField {
  name: string;
  from: string;
  to: string;
  rowCount: number;
  classification: ChangeClassification;
  reason: string; // e.g., "type_changed", "constraint_changed"
}

// A field that requires user input to resolve
export interface InteractiveField {
  name: string;
  reason: "new_required_no_default" | "nullable_to_not_null_with_nulls";
  tableRowCount: number;
  nullCount?: number; // only for nullable_to_not_null
  options: Array<"provide_default" | "mark_nullable" | "cancel">;
}

// User's resolution for an interactive field
export interface FieldResolution {
  action: "provide_default" | "mark_nullable" | "cancel";
  value?: string; // the default value, when action is "provide_default"
}

// Complete preview result returned by SchemaChangeService.preview()
export interface SchemaPreviewResult {
  hasChanges: boolean;
  hasDestructiveChanges: boolean;
  classification: SchemaClassification;
  changes: {
    added: AddedField[];
    removed: RemovedField[];
    changed: ChangedField[];
    unchanged: string[];
  };
  warnings: string[];
  interactiveFields: InteractiveField[];
  ddlPreview: string[]; // SQL statements from Drizzle Kit dry-run
}

// Request body for the apply endpoint
export interface SchemaApplyRequest {
  fields: FieldDefinition[];
  confirmed: boolean;
  schemaVersion: number; // optimistic locking
  resolutions?: Record<string, FieldResolution>;
}

// Result of applying schema changes
export interface SchemaApplyResult {
  success: boolean;
  message: string;
  newSchemaVersion: number;
  error?: string;
}
