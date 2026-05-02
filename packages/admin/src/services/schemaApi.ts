// API service for schema preview/apply endpoints.
// Used by the visual schema builder save flow.
import { protectedApi } from "@admin/lib/api/protectedApi";

import type { ActionResponse } from "../lib/api/response-types";

// Field change types returned by the preview endpoint
export interface SchemaPreviewChange {
  added: Array<{
    name: string;
    type: string;
    required: boolean;
    hasDefault: boolean;
    classification: string;
  }>;
  removed: Array<{
    name: string;
    type: string;
    rowCount: number;
    classification: string;
  }>;
  changed: Array<{
    name: string;
    from: string;
    to: string;
    rowCount: number;
    classification: string;
    reason: string;
  }>;
  unchanged: string[];
}

// F4 Option E PR 5: rename candidates surfaced by the preview endpoint.
// One candidate per (drop, add) pair the rename detector picks up. The
// dialog renders these as radio buttons so the user picks "rename"
// (preserve data) or "drop_and_add" (data lost) for each one.
//
// Cartesian: a single dropped column can appear in multiple candidates
// when the same table has multiple new columns. The dialog handles the
// shrinking-pool UX (a drop disappears once one of its targets is
// chosen as a rename).
export interface SchemaPreviewRenameCandidate {
  table: string;
  from: string;
  to: string;
  fromType: string;
  toType: string;
  typesCompatible: boolean;
  defaultSuggestion: "rename" | "drop_and_add";
}

// User's choice for one rename candidate, posted with apply().
export interface SchemaRenameResolution {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}

// A field that requires user input to resolve
export interface InteractiveField {
  name: string;
  reason: "new_required_no_default" | "nullable_to_not_null_with_nulls";
  tableRowCount: number;
  nullCount?: number;
  options: Array<"provide_default" | "mark_nullable" | "cancel">;
}

// Full response from the preview endpoint
export interface SchemaPreviewResponse {
  hasChanges: boolean;
  hasDestructiveChanges: boolean;
  classification: "safe" | "destructive" | "interactive";
  changes: SchemaPreviewChange;
  warnings: string[];
  interactiveFields: InteractiveField[];
  ddlPreview: string[];
  schemaVersion: number;
  // F4 Option E PR 5: empty for pure-additive changes; populated when the
  // preview detects (drop, add) pairs that might be column renames.
  renamed: SchemaPreviewRenameCandidate[];
}

// Response from the apply endpoint.
// F1 PR 3: dropped the `restarting` field (single-process model means
// no child to restart). The dispatcher no longer emits it; this interface
// matches the new server shape.
//
// F10 PR 6: optional `toastSummary` carries a per-change-kind phrase
// like "1 field added, 1 renamed" so the Schema Builder save handler
// can render a contextual toast. Optional because older Nextly servers
// don't emit it; the admin falls back to a generic "Schema updated".
export interface SchemaApplyResponse {
  success: boolean;
  message: string;
  newSchemaVersion: number;
  toastSummary?: string;
}

// User resolution for an interactive field
export interface FieldResolution {
  action: "provide_default" | "mark_nullable" | "cancel";
  value?: string;
}

export const schemaApi = {
  // Preview schema changes (dry-run, returns diff without applying).
  //
  // Phase 4 (Task 19): the previewSchemaChanges dispatcher emits
  // `respondData({ ...legacyShape, renamed, schemaVersion })` so the wire
  // body IS the SchemaPreviewResponse shape; type the fetcher generic
  // directly.
  preview: async (
    slug: string,
    fields: unknown[]
  ): Promise<SchemaPreviewResponse> => {
    return protectedApi.post<SchemaPreviewResponse>(
      `/collections/schema/${slug}/preview`,
      { fields }
    );
  },

  // Apply schema changes (in-place update, no server restart).
  // renameResolutions are F4 Option E PR 5: one entry per rename
  // candidate the user picked in SchemaChangeDialog ("rename" preserves
  // data; "drop_and_add" lets the column drop and a new one create).
  //
  // Phase 4 (Task 19): the applySchemaChanges dispatcher emits
  // `respondAction(message, { newSchemaVersion, toastSummary? })`, so the
  // wire body is `{ message, newSchemaVersion, toastSummary? }`. The
  // canonical action shape has no boolean `success` field (a 2xx
  // response IS the success signal), so we synthesize `success: true`
  // here to keep the legacy SchemaApplyResponse contract intact for
  // existing callers (the schema builder reads `result.success`).
  apply: async (
    slug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>,
    renameResolutions?: SchemaRenameResolution[]
  ): Promise<SchemaApplyResponse> => {
    const result = await protectedApi.post<
      ActionResponse<{ newSchemaVersion: number; toastSummary?: string }>
    >(`/collections/schema/${slug}/apply`, {
      fields,
      confirmed: true,
      schemaVersion,
      resolutions,
      renameResolutions,
    });
    return {
      success: true,
      message: result.message,
      newSchemaVersion: result.newSchemaVersion,
      toastSummary: result.toastSummary,
    };
  },
};
